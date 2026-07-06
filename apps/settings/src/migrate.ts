import { createLogger, pgAdapter, runMigrations } from "@obh/settings"
import { Pool } from "pg"

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is required")

  const log = createLogger((process.env.SETTINGS_LOG_LEVEL as never) || "info")
  const pool = new Pool({ connectionString: databaseUrl })
  const db = pgAdapter(pool)

  log.info("running migrations")
  await runMigrations(db)
  log.info("migrations complete")

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
