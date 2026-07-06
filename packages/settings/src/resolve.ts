import type {
  ResolvedSetting,
  SettingDefinition,
  SettingScope,
  SettingsContext,
} from "./types"

/** A stored override, as fetched from platform.settings. */
export type StoredValue = {
  scope: SettingScope
  scopeId: string | null
  value: unknown
}

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

/**
 * Pure resolution: pick the effective value for `key` from the stored overrides
 * that apply to `context`, most specific first.
 *
 *   runtime (if the setting declares runtime scope and context.runtime has it)
 *   → user → group (by context.groupIds priority) → workspace → platform
 *   → definition default → unset
 *
 * Kept dependency-free and side-effect-free so it is trivially unit-testable.
 */
export function resolveFromRows(
  key: string,
  def: SettingDefinition | undefined,
  rows: StoredValue[],
  context: SettingsContext,
): ResolvedSetting {
  const isSensitive = def?.sensitive ?? false
  const done = (value: unknown, source: ResolvedSetting["source"], scopeId: string | null) =>
    ({ key, value, source, scopeId, isSensitive }) as ResolvedSetting

  // Runtime: only when the setting opts into runtime scope and context supplies it.
  if (def?.scopes.includes("runtime") && context.runtime && hasOwn(context.runtime, key)) {
    return done(context.runtime[key], "runtime", null)
  }

  // User (most specific override).
  if (context.userId) {
    const row = rows.find((r) => r.scope === "user" && r.scopeId === context.userId)
    if (row) return done(row.value, "user", row.scopeId)
  }

  // Group, honouring the order of context.groupIds (first = highest priority).
  if (context.groupIds && context.groupIds.length > 0) {
    for (const groupId of context.groupIds) {
      const row = rows.find((r) => r.scope === "group" && r.scopeId === groupId)
      if (row) return done(row.value, "group", groupId)
    }
  }

  // Workspace.
  if (context.workspaceId) {
    const row = rows.find((r) => r.scope === "workspace" && r.scopeId === context.workspaceId)
    if (row) return done(row.value, "workspace", row.scopeId)
  }

  // Platform (scopeId is null).
  const platform = rows.find((r) => r.scope === "platform" && r.scopeId == null)
  if (platform) return done(platform.value, "platform", null)

  // Definition default.
  if (def && def.defaultValue !== undefined) return done(def.defaultValue, "default", null)

  return done(undefined, "unset", null)
}
