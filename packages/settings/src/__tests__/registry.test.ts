import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineSetting } from "../defineSetting"
import { createSettingsRegistry } from "../registry"

const podSignature = defineSetting({
  key: "qhaul.pod.signature_required",
  schema: z.boolean(),
  defaultValue: false,
  scopes: ["workspace"],
})

describe("createSettingsRegistry", () => {
  it("get / has / list", () => {
    const r = createSettingsRegistry([podSignature])
    expect(r.get("qhaul.pod.signature_required")).toBeDefined()
    expect(r.has("qhaul.pod.signature_required")).toBe(true)
    expect(r.has("nope")).toBe(false)
    expect(r.list()).toHaveLength(1)
  })

  it("validates values and rejects unknown keys", () => {
    const r = createSettingsRegistry([podSignature])
    expect(r.validate("qhaul.pod.signature_required", true).ok).toBe(true)
    expect(r.validate("qhaul.pod.signature_required", "yes").ok).toBe(false)
    const unknown = r.validate("nope", true)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toMatch(/unknown setting/i)
  })

  it("throws on duplicate keys", () => {
    expect(() => createSettingsRegistry([podSignature, podSignature])).toThrow(/duplicate/i)
  })
})
