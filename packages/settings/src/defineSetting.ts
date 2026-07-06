import type { ZodType } from "zod"
import { SCOPE_VALUES, type SettingDefinition, type SettingScope } from "./types"

// Lowercase dot/underscore notation, e.g. qhaul.pod.signature_required,
// branding.primary_color, notifications.inspection_failed.enabled.
const KEY_RE = /^[a-z0-9]+(?:[._][a-z0-9]+)*$/

/**
 * Declare a typed setting. The definition is the source of truth for its
 * schema, default, allowed scopes and metadata hints.
 *
 *   export const PrimaryColor = defineSetting({
 *     key: "branding.primary_color",
 *     schema: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
 *     defaultValue: "#111111",
 *     scopes: ["workspace"],
 *     writePermission: "settings.workspace.write",
 *   })
 */
export function defineSetting<T>(def: {
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
}): SettingDefinition<T> {
  if (!KEY_RE.test(def.key)) {
    throw new Error(
      `Invalid setting key "${def.key}". Use lowercase dot/underscore notation, e.g. "branding.primary_color".`,
    )
  }
  if (!Array.isArray(def.scopes) || def.scopes.length === 0) {
    throw new Error(`Setting "${def.key}" must declare at least one scope.`)
  }
  for (const scope of def.scopes) {
    if (!SCOPE_VALUES.includes(scope)) {
      throw new Error(`Setting "${def.key}" has invalid scope "${scope}".`)
    }
  }
  if (def.defaultValue !== undefined) {
    const parsed = def.schema.safeParse(def.defaultValue)
    if (!parsed.success) {
      throw new Error(
        `Setting "${def.key}" defaultValue fails its own schema: ${parsed.error.message}`,
      )
    }
  }

  return {
    key: def.key,
    description: def.description,
    schema: def.schema,
    defaultValue: def.defaultValue,
    scopes: def.scopes,
    sensitive: def.sensitive ?? false,
    encrypted: def.encrypted ?? false,
    readOnly: def.readOnly ?? false,
    readPermission: def.readPermission,
    writePermission: def.writePermission,
    category: def.category,
  }
}
