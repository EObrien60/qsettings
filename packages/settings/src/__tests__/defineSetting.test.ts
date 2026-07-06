import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineSetting } from "../defineSetting"

describe("defineSetting", () => {
  it("accepts a valid dotted/underscored key", () => {
    const s = defineSetting({
      key: "qhaul.pod.signature_required",
      schema: z.boolean(),
      defaultValue: false,
      scopes: ["workspace"],
    })
    expect(s.key).toBe("qhaul.pod.signature_required")
    expect(s.sensitive).toBe(false)
    expect(s.readOnly).toBe(false)
  })

  it("rejects invalid keys", () => {
    expect(() =>
      defineSetting({ key: "Bad Key", schema: z.string(), scopes: ["workspace"] }),
    ).toThrow(/invalid setting key/i)
  })

  it("requires at least one valid scope", () => {
    expect(() => defineSetting({ key: "a.b", schema: z.string(), scopes: [] })).toThrow(/scope/i)
    expect(() =>
      // @ts-expect-error invalid scope on purpose
      defineSetting({ key: "a.b", schema: z.string(), scopes: ["galaxy"] }),
    ).toThrow(/invalid scope/i)
  })

  it("rejects a default that fails its own schema", () => {
    expect(() =>
      defineSetting({
        key: "branding.primary_color",
        schema: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        defaultValue: "not-a-color",
        scopes: ["workspace"],
      }),
    ).toThrow(/defaultValue fails/i)
  })
})
