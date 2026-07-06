import type { SettingChange, SettingRecord, SettingScope } from "./types"

export type SettingRow = {
  id: string
  key: string
  scope: string
  scope_id: string | null
  value: unknown
  is_sensitive: boolean
  is_encrypted: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string | Date
  updated_at: string | Date
}

export type SettingChangeRow = {
  id: string
  setting_id: string | null
  key: string
  scope: string
  scope_id: string | null
  old_value: unknown
  new_value: unknown
  changed_by: string | null
  reason: string | null
  created_at: string | Date
}

const iso = (v: string | Date): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString()

export function rowToSettingRecord(row: SettingRow): SettingRecord {
  return {
    id: row.id,
    key: row.key,
    scope: row.scope as SettingScope,
    scopeId: row.scope_id,
    value: row.value,
    isSensitive: row.is_sensitive,
    isEncrypted: row.is_encrypted,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function rowToSettingChange(row: SettingChangeRow): SettingChange {
  return {
    id: row.id,
    settingId: row.setting_id,
    key: row.key,
    scope: row.scope as SettingScope,
    scopeId: row.scope_id,
    oldValue: row.old_value ?? null,
    newValue: row.new_value ?? null,
    changedBy: row.changed_by,
    reason: row.reason,
    createdAt: iso(row.created_at),
  }
}
