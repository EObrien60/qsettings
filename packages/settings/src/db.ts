/**
 * The tiny database contract the core depends on. Anything that can run a
 * parameterised SQL query satisfies SettingsDb; this keeps the core free of any
 * particular Postgres client or ORM.
 *
 * Methods take a db/tx handle as their first argument, so a set() can join the
 * app's own transaction (e.g. alongside a domain write and an event emit).
 */
export type QueryResult<T = unknown> = { rows: T[] }

export type SettingsDb = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
}

export type TransactionalSettingsDb = SettingsDb & {
  transaction<T>(fn: (tx: SettingsDb) => Promise<T>): Promise<T>
}
