import type { SettingDefinition } from "./types"

export type ValidationResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export type SettingsRegistry = {
  get(key: string): SettingDefinition | undefined
  has(key: string): boolean
  validate(key: string, value: unknown): ValidationResult
  list(): SettingDefinition[]
}

/**
 * Holds the known setting definitions. Unknown keys never validate — settings
 * are code-first, so a value can only be set for a defined key.
 */
export function createSettingsRegistry(defs: SettingDefinition[]): SettingsRegistry {
  const map = new Map<string, SettingDefinition>()
  for (const d of defs) {
    if (map.has(d.key)) throw new Error(`Duplicate setting definition: ${d.key}`)
    map.set(d.key, d)
  }

  return {
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    validate(key, value): ValidationResult {
      const def = map.get(key)
      if (!def) return { ok: false, error: `Unknown setting: ${key}` }
      const parsed = def.schema.safeParse(value)
      if (!parsed.success) return { ok: false, error: parsed.error.message }
      return { ok: true, value: parsed.data }
    },
    list: () => [...map.values()],
  }
}
