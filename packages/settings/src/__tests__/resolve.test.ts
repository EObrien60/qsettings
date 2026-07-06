import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineSetting } from "../defineSetting"
import { resolveFromRows, type StoredValue } from "../resolve"

const def = defineSetting({
  key: "notifications.email.enabled",
  schema: z.boolean(),
  defaultValue: false,
  scopes: ["platform", "workspace", "group", "user", "runtime"],
})

const row = (scope: StoredValue["scope"], scopeId: string | null, value: unknown): StoredValue => ({
  scope,
  scopeId,
  value,
})

const ctx = { workspaceId: "ws_1", groupIds: ["grp_a", "grp_b"], userId: "usr_1" }

describe("resolveFromRows", () => {
  it("falls back to the definition default", () => {
    const r = resolveFromRows("notifications.email.enabled", def, [], ctx)
    expect(r.value).toBe(false)
    expect(r.source).toBe("default")
  })

  it("is 'unset' when there is no default and no rows", () => {
    const noDefault = defineSetting({ key: "a.b", schema: z.string(), scopes: ["workspace"] })
    const r = resolveFromRows("a.b", noDefault, [], { workspaceId: "ws_1" })
    expect(r.value).toBeUndefined()
    expect(r.source).toBe("unset")
  })

  it("prefers platform over default, workspace over platform", () => {
    expect(resolveFromRows("k", def, [row("platform", null, true)], ctx).source).toBe("platform")
    const r = resolveFromRows("k", def, [row("platform", null, true), row("workspace", "ws_1", false)], ctx)
    expect(r.source).toBe("workspace")
    expect(r.value).toBe(false)
  })

  it("prefers group over workspace, user over group", () => {
    const rows = [
      row("platform", null, true),
      row("workspace", "ws_1", true),
      row("group", "grp_b", false),
      row("user", "usr_1", true),
    ]
    const r = resolveFromRows("k", def, rows, ctx)
    expect(r.source).toBe("user")
    expect(r.value).toBe(true)
    expect(r.scopeId).toBe("usr_1")
  })

  it("honours group priority (order of context.groupIds)", () => {
    const rows = [row("group", "grp_a", "A"), row("group", "grp_b", "B")]
    const r = resolveFromRows("k", def, rows, { groupIds: ["grp_a", "grp_b"] })
    expect(r.value).toBe("A")
    // reversed priority
    const r2 = resolveFromRows("k", def, rows, { groupIds: ["grp_b", "grp_a"] })
    expect(r2.value).toBe("B")
  })

  it("uses a runtime override when the setting opts into runtime scope", () => {
    const r = resolveFromRows("notifications.email.enabled", def, [row("user", "usr_1", false)], {
      ...ctx,
      runtime: { "notifications.email.enabled": true },
    })
    expect(r.source).toBe("runtime")
    expect(r.value).toBe(true)
  })

  it("ignores runtime for settings that do not declare runtime scope", () => {
    const noRuntime = defineSetting({
      key: "x.y",
      schema: z.boolean(),
      defaultValue: false,
      scopes: ["workspace"],
    })
    const r = resolveFromRows("x.y", noRuntime, [], { runtime: { "x.y": true } })
    expect(r.source).toBe("default")
    expect(r.value).toBe(false)
  })

  it("marks sensitivity from the definition", () => {
    const secret = defineSetting({
      key: "smtp.password",
      schema: z.string(),
      scopes: ["workspace"],
      sensitive: true,
    })
    const r = resolveFromRows("smtp.password", secret, [row("workspace", "ws_1", "hunter2")], {
      workspaceId: "ws_1",
    })
    expect(r.isSensitive).toBe(true)
  })
})
