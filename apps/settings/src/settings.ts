import { defineSetting, type SettingDefinition } from "@obh/settings"
import { z } from "zod"

/**
 * Example settings catalogue. In a real deployment each product owns its own
 * definitions; these live here so the demo has a concrete registry. Remember:
 * readPermission/writePermission/sensitive are hints — the caller enforces RBAC.
 */

// --- Shared -----------------------------------------------------------------

export const BrandingCompanyName = defineSetting({
  key: "branding.company_name",
  description: "Display name shown on documents and the UI.",
  schema: z.string().min(1),
  scopes: ["workspace"],
  category: "branding",
  writePermission: "settings.workspace.write",
})

export const BrandingLogoFileId = defineSetting({
  key: "branding.logo_file_id",
  description: "qstore file id of the workspace logo.",
  schema: z.string(),
  scopes: ["workspace"],
  category: "branding",
  writePermission: "settings.workspace.write",
})

export const MaintenanceMode = defineSetting({
  key: "runtime.maintenance_mode",
  description: "Read-only, environment-derived maintenance flag.",
  schema: z.boolean(),
  defaultValue: false,
  scopes: ["runtime"],
  readOnly: true,
  category: "runtime",
})

// --- qHaul ------------------------------------------------------------------

export const qhaulSettings: SettingDefinition[] = [
  defineSetting({
    key: "qhaul.pod.signature_required",
    schema: z.boolean(),
    defaultValue: false,
    scopes: ["workspace"],
    category: "qhaul.pod",
    writePermission: "settings.workspace.write",
  }),
  defineSetting({
    key: "qhaul.pod.photo_required",
    schema: z.boolean(),
    defaultValue: true,
    scopes: ["workspace"],
    category: "qhaul.pod",
  }),
  defineSetting({
    key: "qhaul.delivery.customer_email_enabled",
    schema: z.boolean(),
    defaultValue: true,
    scopes: ["workspace", "group"],
    category: "qhaul.delivery",
  }),
  defineSetting({
    key: "qhaul.default_currency",
    schema: z.string().length(3),
    defaultValue: "EUR",
    scopes: ["platform", "workspace"],
    category: "qhaul",
  }),
  defineSetting({
    key: "qhaul.default_timezone",
    schema: z.string().min(1),
    defaultValue: "Europe/Dublin",
    scopes: ["platform", "workspace", "user"],
    category: "qhaul",
  }),
  defineSetting({
    key: "qhaul.consignment.auto_number_prefix",
    schema: z.string().regex(/^[A-Z]{1,6}$/),
    defaultValue: "CON",
    scopes: ["workspace"],
    category: "qhaul.consignment",
  }),
  defineSetting({
    key: "qhaul.reports.weekly_summary_enabled",
    schema: z.boolean(),
    defaultValue: false,
    scopes: ["workspace", "user"],
    category: "qhaul.reports",
  }),
]

// --- qMechanic --------------------------------------------------------------

export const qmechanicSettings: SettingDefinition[] = [
  defineSetting({
    key: "qmechanic.inspection.photo_required",
    schema: z.boolean(),
    defaultValue: true,
    scopes: ["workspace"],
    category: "qmechanic.inspection",
  }),
  defineSetting({
    key: "qmechanic.inspection.fail_requires_defect",
    schema: z.boolean(),
    defaultValue: true,
    scopes: ["workspace"],
    category: "qmechanic.inspection",
  }),
  defineSetting({
    key: "qmechanic.jobs.auto_assign_enabled",
    schema: z.boolean(),
    defaultValue: false,
    scopes: ["workspace", "group"],
    category: "qmechanic.jobs",
  }),
  defineSetting({
    key: "qmechanic.reports.daily_workshop_summary_enabled",
    schema: z.boolean(),
    defaultValue: false,
    scopes: ["workspace"],
    category: "qmechanic.reports",
  }),
  defineSetting({
    key: "qmechanic.default_timezone",
    schema: z.string().min(1),
    defaultValue: "Europe/Dublin",
    scopes: ["platform", "workspace", "user"],
    category: "qmechanic",
  }),
  defineSetting({
    key: "notifications.inspection_failed.enabled",
    schema: z.boolean(),
    defaultValue: true,
    scopes: ["workspace", "group", "user"],
    category: "notifications",
  }),
]

// De-duplicate by key so shared branding settings appear once.
const dedupe = (defs: SettingDefinition[]): SettingDefinition[] => {
  const seen = new Set<string>()
  const out: SettingDefinition[] = []
  for (const d of defs) {
    if (seen.has(d.key)) continue
    seen.add(d.key)
    out.push(d)
  }
  return out
}

export const allSettings: SettingDefinition[] = dedupe([
  BrandingCompanyName,
  BrandingLogoFileId,
  MaintenanceMode,
  ...qhaulSettings,
  ...qmechanicSettings,
])
