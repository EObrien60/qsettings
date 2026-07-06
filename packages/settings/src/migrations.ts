import type { SettingsDb } from "./db"

/**
 * Schema for scoped settings and their change history. Idempotent (safe to run
 * repeatedly). This string is the source of truth; src/migrations/0001_init.sql
 * is a verbatim copy for DBAs who apply SQL by hand.
 *
 * Settings are code-first, so there is no setting_definitions table.
 *
 * Uniqueness note: platform-scope rows have scope_id = null, and SQL treats
 * nulls as distinct, so a plain unique(key, scope, scope_id) would not dedupe
 * them. We use a unique index over coalesce(scope_id, '') instead, which is also
 * the ON CONFLICT target used by set().
 */
export const INIT_SQL = `
create schema if not exists platform;

create table if not exists platform.settings (
  id text primary key,

  key text not null,

  scope text not null,
  scope_id text null,

  value jsonb not null,

  is_sensitive boolean not null default false,
  is_encrypted boolean not null default false,

  created_by text null,
  updated_by text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists settings_unique_idx
  on platform.settings (key, scope, coalesce(scope_id, ''));

create index if not exists settings_scope_idx
  on platform.settings (scope, scope_id);

create index if not exists settings_key_idx
  on platform.settings (key);

create table if not exists platform.setting_changes (
  id text primary key,

  setting_id text null,

  key text not null,
  scope text not null,
  scope_id text null,

  old_value jsonb null,
  new_value jsonb null,

  changed_by text null,
  reason text null,

  created_at timestamptz not null default now()
);

create index if not exists setting_changes_key_idx
  on platform.setting_changes (key, created_at desc);
`

export type Migration = { id: string; sql: string }

export const migrations: Migration[] = [{ id: "0001_init", sql: INIT_SQL }]

/** Apply all migrations. Idempotent DDL, safe to run on every boot. */
export async function runMigrations(db: SettingsDb): Promise<void> {
  for (const migration of migrations) {
    await db.query(migration.sql)
  }
}
