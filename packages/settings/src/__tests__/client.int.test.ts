import { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { pgAdapter } from "../adapters/pg"
import { createSettingsClient } from "../client"
import { defineSetting } from "../defineSetting"
import { createSettingsRegistry } from "../registry"
import { runMigrations } from "../migrations"
import { REDACTED, type SettingEvent } from "../types"

const url = process.env.DATABASE_URL
const suite = url ? describe : describe.skip

const emailEnabled = defineSetting({
  key: "notifications.email.enabled",
  schema: z.boolean(),
  defaultValue: false,
  scopes: ["platform", "workspace", "group", "user"],
})
const primaryColor = defineSetting({
  key: "branding.primary_color",
  schema: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  defaultValue: "#111111",
  scopes: ["workspace"],
})
const smtpPassword = defineSetting({
  key: "smtp.password",
  schema: z.string(),
  scopes: ["workspace"],
  sensitive: true,
})
const appRegion = defineSetting({
  key: "app.region",
  schema: z.string(),
  scopes: ["runtime"],
  readOnly: true,
})

suite("integration: settings client (Postgres)", () => {
  const pool = new Pool({ connectionString: url })
  const db = pgAdapter(pool)
  const registry = createSettingsRegistry([emailEnabled, primaryColor, smtpPassword, appRegion])
  const events: SettingEvent[] = []
  const client = createSettingsClient({
    registry,
    onEvent: (e) => {
      events.push(e)
    },
  })

  beforeAll(async () => {
    await runMigrations(db)
  })

  beforeEach(async () => {
    events.length = 0
    await db.query("truncate platform.setting_changes, platform.settings")
  })

  afterAll(async () => {
    await pool.end()
  })

  const key = "notifications.email.enabled"

  it("resolves effective values across the scope override order", async () => {
    const ctx = { workspaceId: "ws_1", groupIds: ["grp_a"], userId: "usr_1" }

    // default
    expect((await client.resolve(db, key, ctx)).source).toBe("default")
    expect(await client.get(db, key, ctx)).toBe(false)

    // platform
    await client.set(db, { key, scope: "platform", value: true, actorId: "admin" })
    let r = await client.resolve(db, key, ctx)
    expect(r.source).toBe("platform")
    expect(r.value).toBe(true)

    // workspace beats platform
    await client.set(db, { key, scope: "workspace", scopeId: "ws_1", value: false })
    r = await client.resolve(db, key, ctx)
    expect(r.source).toBe("workspace")
    expect(r.value).toBe(false)

    // group beats workspace
    await client.set(db, { key, scope: "group", scopeId: "grp_a", value: true })
    r = await client.resolve(db, key, ctx)
    expect(r.source).toBe("group")
    expect(r.value).toBe(true)

    // user beats group
    await client.set(db, { key, scope: "user", scopeId: "usr_1", value: false })
    r = await client.resolve(db, key, ctx)
    expect(r.source).toBe("user")
    expect(r.value).toBe(false)
  })

  it("rejects invalid values, unknown keys, disallowed scopes and read-only settings", async () => {
    await expect(
      client.set(db, { key, scope: "platform", value: "not-a-bool" as unknown as boolean }),
    ).rejects.toThrow(/invalid value/i)

    await expect(
      client.set(db, { key: "no.such_setting", scope: "platform", value: 1 }),
    ).rejects.toThrow(/unknown setting/i)

    await expect(
      client.set(db, { key: "branding.primary_color", scope: "user", scopeId: "usr_1", value: "#ffffff" }),
    ).rejects.toThrow(/not allowed/i)

    await expect(
      client.set(db, { key: "app.region", scope: "runtime", value: "eu" }),
    ).rejects.toThrow(/read-only/i)
  })

  it("upserts (no duplicate rows) and records change history", async () => {
    await client.set(db, { key, scope: "platform", value: true, actorId: "a1", reason: "on" })
    await client.set(db, { key, scope: "platform", value: false, actorId: "a2", reason: "off" })

    const count = await db.query<{ n: string }>(
      "select count(*)::text as n from platform.settings where key=$1 and scope='platform'",
      [key],
    )
    expect(count.rows[0]?.n).toBe("1")

    const changes = await client.listChanges(db, { key })
    expect(changes).toHaveLength(2)
    // most recent first: the second change flipped true -> false
    expect(changes[0]?.newValue).toBe(false)
    expect(changes[0]?.oldValue).toBe(true)

    expect(events.filter((e) => e.name === "setting.changed")).toHaveLength(2)
    // events never carry the value
    expect(events[0]).not.toHaveProperty("value")
  })

  it("redacts sensitive values in list and getEffectiveSettings but not in direct get", async () => {
    await client.set(db, { key: "smtp.password", scope: "workspace", scopeId: "ws_1", value: "hunter2" })

    // list redacts
    const listed = await client.list(db, { scope: "workspace", scopeId: "ws_1" })
    const secret = listed.find((s) => s.key === "smtp.password")
    expect(secret?.value).toBe(REDACTED)

    // getEffectiveSettings redacts by default, reveals with includeSensitive
    const eff = await client.getEffectiveSettings(db, { workspaceId: "ws_1" })
    expect(eff["smtp.password"]?.value).toBe(REDACTED)
    const effRaw = await client.getEffectiveSettings(db, { workspaceId: "ws_1" }, { includeSensitive: true })
    expect(effRaw["smtp.password"]?.value).toBe("hunter2")

    // direct get is not redacted (caller enforced read permission)
    expect(await client.get(db, "smtp.password", { workspaceId: "ws_1" })).toBe("hunter2")
  })

  it("unsets a value and records the change", async () => {
    await client.set(db, { key, scope: "workspace", scopeId: "ws_1", value: true })
    expect((await client.resolve(db, key, { workspaceId: "ws_1" })).source).toBe("workspace")

    const removed = await client.unset(db, { key, scope: "workspace", scopeId: "ws_1", actorId: "a1" })
    expect(removed).toBe(true)

    // falls back to default now
    expect((await client.resolve(db, key, { workspaceId: "ws_1" })).source).toBe("default")

    const changes = await client.listChanges(db, { key })
    expect(changes[0]?.newValue).toBeNull()
    expect(events.some((e) => e.name === "setting.unset")).toBe(true)

    // unsetting a missing value returns false
    expect(await client.unset(db, { key, scope: "workspace", scopeId: "ws_1" })).toBe(false)
  })

  it("commits set() inside a transaction and rolls it back with the caller", async () => {
    await expect(
      db.transaction(async (tx) => {
        await client.set(tx, { key, scope: "workspace", scopeId: "ws_tx", value: true })
        throw new Error("force rollback")
      }),
    ).rejects.toThrow(/force rollback/)

    const count = await db.query<{ n: string }>(
      "select count(*)::text as n from platform.settings where scope_id='ws_tx'",
    )
    expect(count.rows[0]?.n).toBe("0")
  })

  it("getEffectiveSettings returns a resolved entry per defined setting", async () => {
    const eff = await client.getEffectiveSettings(db, { workspaceId: "ws_1" })
    expect(Object.keys(eff).sort()).toEqual(
      ["app.region", "branding.primary_color", "notifications.email.enabled", "smtp.password"].sort(),
    )
    expect(eff["branding.primary_color"]?.value).toBe("#111111")
    expect(eff["branding.primary_color"]?.source).toBe("default")
  })
})
