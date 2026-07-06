import {
  createLogger,
  createSettingsClient,
  createSettingsRegistry,
  pgAdapter,
  runMigrations,
} from "@obh/settings"
import { Pool } from "pg"
import { allSettings } from "./settings"

/**
 * Demonstrates: define -> set at scope -> resolve effective value -> record
 * change -> emit event, plus the override order and a runtime setting.
 * Needs only a Postgres.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is required")

  const log = createLogger("info")
  const pool = new Pool({ connectionString: databaseUrl })
  const db = pgAdapter(pool)
  await runMigrations(db)

  const registry = createSettingsRegistry(allSettings)
  const settings = createSettingsClient({
    registry,
    onEvent: (e) => log.info("settings event", { name: e.name, key: e.key, scope: e.scope, scope_id: e.scopeId }),
  })

  const ws = "ws_demo"
  const user = "usr_demo"

  // qHaul: enable POD signature at the workspace scope
  await settings.set(db, {
    key: "qhaul.pod.signature_required",
    scope: "workspace",
    scopeId: ws,
    value: true,
    actorId: user,
    reason: "Customer requires signed POD",
  })

  const podReq = await settings.resolve(db, "qhaul.pod.signature_required", { workspaceId: ws })
  log.info("qHaul POD signature required", { value: podReq.value, source: podReq.source })

  // Platform default currency, overridden per workspace
  await settings.set(db, { key: "qhaul.default_currency", scope: "platform", value: "EUR", actorId: "admin" })
  await settings.set(db, { key: "qhaul.default_currency", scope: "workspace", scopeId: ws, value: "GBP" })
  const currency = await settings.get(db, "qhaul.default_currency", { workspaceId: ws })
  log.info("qHaul currency (workspace overrides platform)", { currency })

  // qMechanic inspection rule, read straight from the default
  const failRule = await settings.get(db, "qmechanic.inspection.fail_requires_defect", { workspaceId: ws })
  log.info("qMechanic fail_requires_defect", { value: failRule })

  // Runtime setting sourced from context (read-only, not stored)
  const maintenance = await settings.resolve(db, "runtime.maintenance_mode", {
    runtime: { "runtime.maintenance_mode": true },
  })
  log.info("runtime maintenance_mode", { value: maintenance.value, source: maintenance.source })

  // Effective bundle for a user in this workspace
  const effective = await settings.getEffectiveSettings(db, { workspaceId: ws, userId: user })
  log.info("effective settings resolved", { count: Object.keys(effective).length })

  const changes = await settings.listChanges(db, { limit: 10 })
  log.info("recent setting changes", { count: changes.length })

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
