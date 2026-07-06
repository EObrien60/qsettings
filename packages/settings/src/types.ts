import type { ZodType } from "zod"

export type SettingScope = "platform" | "workspace" | "group" | "user" | "runtime"

export const SCOPE_VALUES: SettingScope[] = [
  "platform",
  "workspace",
  "group",
  "user",
  "runtime",
]

/**
 * A typed, scoped setting contract. Settings are code-first: the definition is
 * the source of truth for schema, default, allowed scopes and metadata hints.
 *
 * Note on permissions: readPermission/writePermission/sensitive are METADATA
 * HINTS only. Settings does not enforce RBAC — the caller (auth/permissions
 * layer) must check these before exposing or changing a value.
 */
export type SettingDefinition<T = unknown> = {
  key: string
  description?: string

  schema: ZodType<T>
  defaultValue?: T

  scopes: SettingScope[]

  sensitive?: boolean
  encrypted?: boolean
  readOnly?: boolean

  readPermission?: string
  writePermission?: string

  category?: string
}

/** The context used to resolve an effective value across scopes. */
export type SettingsContext = {
  workspaceId?: string
  /** Applicable group ids, in priority order (first = highest priority). */
  groupIds?: string[]
  userId?: string
  /** Ephemeral, read-only values keyed by setting key (env/deploy-derived). */
  runtime?: Record<string, unknown>
}

export type SettingRecord<T = unknown> = {
  id: string
  key: string
  scope: SettingScope
  scopeId: string | null
  value: T
  isSensitive: boolean
  isEncrypted: boolean
  createdBy?: string | null
  updatedBy?: string | null
  createdAt: string
  updatedAt: string
}

export type SettingChange = {
  id: string
  settingId: string | null
  key: string
  scope: SettingScope
  scopeId: string | null
  oldValue: unknown | null
  newValue: unknown | null
  changedBy: string | null
  reason: string | null
  createdAt: string
}

/** Where a resolved value came from (most specific wins). */
export type ResolvedSource =
  | "runtime"
  | "user"
  | "group"
  | "workspace"
  | "platform"
  | "default"
  | "unset"

export type ResolvedSetting<T = unknown> = {
  key: string
  value: T | undefined
  source: ResolvedSource
  scopeId: string | null
  isSensitive: boolean
}

export const REDACTED = "[redacted]"

// --- Client inputs ----------------------------------------------------------

export type SetSettingInput<T = unknown> = {
  key: string
  scope: SettingScope
  scopeId?: string | null
  value: T
  actorId?: string | null
  reason?: string | null
}

export type UnsetSettingInput = {
  key: string
  scope: SettingScope
  scopeId?: string | null
  actorId?: string | null
  reason?: string | null
}

export type ListSettingsInput = {
  scope: SettingScope
  scopeId?: string | null
}

// --- Optional event hook ----------------------------------------------------

export type SettingEventName = "setting.changed" | "setting.unset"

/** Emitted on change. Never carries the value (sensitive-safe). */
export type SettingEvent = {
  name: SettingEventName
  key: string
  scope: SettingScope
  scopeId: string | null
  changedBy?: string | null
}
