import { randomUUID } from "node:crypto"

/**
 * Generate a prefixed id, e.g. newId("set") -> "set_9f2c...".
 * Prefixes make ids self-describing in logs.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`
}
