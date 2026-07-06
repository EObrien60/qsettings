// Public surface of @obh/settings. Keep this small and boring.

export type {
  SettingScope,
  SettingDefinition,
  SettingsContext,
  SettingRecord,
  SettingChange,
  ResolvedSetting,
  ResolvedSource,
  SetSettingInput,
  UnsetSettingInput,
  ListSettingsInput,
  SettingEvent,
  SettingEventName,
} from "./types"
export { SCOPE_VALUES, REDACTED } from "./types"

export type { SettingsDb, TransactionalSettingsDb, QueryResult } from "./db"

export { defineSetting } from "./defineSetting"

export { createSettingsRegistry } from "./registry"
export type { SettingsRegistry, ValidationResult } from "./registry"

export { createSettingsClient } from "./client"
export type { SettingsClient, SettingsClientOptions, GetEffectiveOptions } from "./client"

export { resolveFromRows } from "./resolve"
export type { StoredValue } from "./resolve"

export { pgAdapter } from "./adapters/pg"

export { createLogger } from "./logger"
export type { Logger, LogLevel, LogFields } from "./logger"

export { newId } from "./ids"

export { rowToSettingRecord, rowToSettingChange } from "./rows"
export type { SettingRow, SettingChangeRow } from "./rows"

export { runMigrations, migrations, INIT_SQL } from "./migrations"
export type { Migration } from "./migrations"
