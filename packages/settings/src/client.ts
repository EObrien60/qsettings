import type { SettingsDb } from "./db"
import { newId } from "./ids"
import { createLogger, type Logger } from "./logger"
import type { SettingsRegistry } from "./registry"
import { resolveFromRows, type StoredValue } from "./resolve"
import {
  rowToSettingChange,
  rowToSettingRecord,
  type SettingChangeRow,
  type SettingRow,
} from "./rows"
import {
  REDACTED,
  type ListSettingsInput,
  type ResolvedSetting,
  type SetSettingInput,
  type SettingChange,
  type SettingDefinition,
  type SettingEvent,
  type SettingRecord,
  type SettingScope,
  type SettingsContext,
  type UnsetSettingInput,
} from "./types"

export type SettingsClientOptions = {
  registry: SettingsRegistry
  idPrefix?: string
  /** Optional change hook. Best-effort: failures are logged, not thrown. */
  onEvent?: (event: SettingEvent) => Promise<void> | void
  logger?: Logger
}

export type GetEffectiveOptions = { includeSensitive?: boolean }

export type SettingsClient = {
  resolve<T = unknown>(db: SettingsDb, key: string, context: SettingsContext): Promise<ResolvedSetting<T>>
  get<T = unknown>(db: SettingsDb, key: string, context: SettingsContext): Promise<T | undefined>
  set<T = unknown>(db: SettingsDb, input: SetSettingInput<T>): Promise<SettingRecord<T>>
  unset(db: SettingsDb, input: UnsetSettingInput): Promise<boolean>
  list(db: SettingsDb, input: ListSettingsInput): Promise<SettingRecord[]>
  listChanges(db: SettingsDb, input: { key?: string; limit?: number }): Promise<SettingChange[]>
  getEffectiveSettings(
    db: SettingsDb,
    context: SettingsContext,
    opts?: GetEffectiveOptions,
  ): Promise<Record<string, ResolvedSetting>>
  listDefinitions(): SettingDefinition[]
}

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

// Matches rows applicable to a resolution context. $1 userId, $2 groupIds[], $3 workspaceId.
const CONTEXT_WHERE = `
  (scope = 'user' and scope_id = $1)
  or (scope = 'group' and scope_id = any($2::text[]))
  or (scope = 'workspace' and scope_id = $3)
  or (scope = 'platform' and scope_id is null)
`

export function createSettingsClient(opts: SettingsClientOptions): SettingsClient {
  const registry = opts.registry
  const log = opts.logger ?? createLogger("info")
  const settingPrefix = opts.idPrefix ?? "set"

  const emit = async (event: SettingEvent): Promise<void> => {
    if (!opts.onEvent) return
    try {
      await opts.onEvent(event)
    } catch (err) {
      log.warn("settings onEvent hook failed", { event: event.name, key: event.key, error: errMessage(err) })
    }
  }

  const isSensitive = (key: string, rowFlag: boolean): boolean =>
    registry.get(key)?.sensitive ?? rowFlag

  const normalizeScopeId = (scope: SettingScope, scopeId: string | null | undefined): string | null => {
    if (scope === "platform") return null
    if (scope === "runtime") {
      throw new Error("settings: runtime scope is read-only and cannot be set")
    }
    if (!scopeId) throw new Error(`settings: scopeId is required for scope "${scope}"`)
    return scopeId
  }

  const redact = (resolved: ResolvedSetting): ResolvedSetting =>
    resolved.isSensitive && resolved.value !== undefined
      ? { ...resolved, value: REDACTED }
      : resolved

  const contextParams = (context: SettingsContext): unknown[] => [
    context.userId ?? null,
    context.groupIds ?? [],
    context.workspaceId ?? null,
  ]

  const doResolve = async (
    db: SettingsDb,
    key: string,
    context: SettingsContext,
  ): Promise<ResolvedSetting> => {
    const rows = await db.query<{ scope: SettingScope; scope_id: string | null; value: unknown }>(
      `select scope, scope_id, value from platform.settings
       where key = $4 and (${CONTEXT_WHERE})`,
      [...contextParams(context), key],
    )
    const stored: StoredValue[] = rows.rows.map((r) => ({
      scope: r.scope,
      scopeId: r.scope_id,
      value: r.value,
    }))
    return resolveFromRows(key, registry.get(key), stored, context)
  }

  return {
    async resolve(db, key, context) {
      return (await doResolve(db, key, context)) as ResolvedSetting<never>
    },

    async get(db, key, context) {
      const resolved = await doResolve(db, key, context)
      return resolved.value as never
    },

    async set(db, input) {
      const def = registry.get(input.key)
      if (!def) throw new Error(`settings.set: unknown setting "${input.key}"`)
      if (def.readOnly) throw new Error(`settings.set: setting "${input.key}" is read-only`)
      if (!def.scopes.includes(input.scope)) {
        throw new Error(
          `settings.set: scope "${input.scope}" is not allowed for "${input.key}" (allowed: ${def.scopes.join(", ")})`,
        )
      }
      const validation = registry.validate(input.key, input.value)
      if (!validation.ok) {
        throw new Error(`settings.set: invalid value for "${input.key}": ${validation.error}`)
      }
      const scopeId = normalizeScopeId(input.scope, input.scopeId)

      if (def.encrypted) {
        log.warn("settings.set: encryption is not implemented in v1; storing plaintext", {
          key: input.key,
        })
      }

      const existing = await db.query<{ id: string; value: unknown }>(
        `select id, value from platform.settings
         where key = $1 and scope = $2 and coalesce(scope_id, '') = coalesce($3, '')`,
        [input.key, input.scope, scopeId],
      )
      const oldValue = existing.rows[0]?.value ?? null

      const upsert = await db.query<SettingRow>(
        `insert into platform.settings
           (id, key, scope, scope_id, value, is_sensitive, is_encrypted, created_by, updated_by)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $8)
         on conflict (key, scope, coalesce(scope_id, '')) do update
           set value = excluded.value,
               is_sensitive = excluded.is_sensitive,
               updated_by = excluded.updated_by,
               updated_at = now()
         returning *`,
        [
          newId(settingPrefix),
          input.key,
          input.scope,
          scopeId,
          JSON.stringify(input.value),
          def.sensitive ?? false,
          false, // is_encrypted: encryption not implemented in v1
          input.actorId ?? null,
        ],
      )
      const record = rowToSettingRecord(upsert.rows[0] as SettingRow)

      await db.query(
        `insert into platform.setting_changes
           (id, setting_id, key, scope, scope_id, old_value, new_value, changed_by, reason)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
        [
          newId("schg"),
          record.id,
          input.key,
          input.scope,
          scopeId,
          oldValue === null ? null : JSON.stringify(oldValue),
          JSON.stringify(input.value),
          input.actorId ?? null,
          input.reason ?? null,
        ],
      )

      await emit({
        name: "setting.changed",
        key: input.key,
        scope: input.scope,
        scopeId,
        changedBy: input.actorId ?? null,
      })

      return record as SettingRecord<never>
    },

    async unset(db, input) {
      const scopeId = normalizeScopeId(input.scope, input.scopeId)
      const existing = await db.query<{ id: string; value: unknown }>(
        `select id, value from platform.settings
         where key = $1 and scope = $2 and coalesce(scope_id, '') = coalesce($3, '')`,
        [input.key, input.scope, scopeId],
      )
      const old = existing.rows[0]
      if (!old) return false

      await db.query(
        `delete from platform.settings
         where key = $1 and scope = $2 and coalesce(scope_id, '') = coalesce($3, '')`,
        [input.key, input.scope, scopeId],
      )

      await db.query(
        `insert into platform.setting_changes
           (id, setting_id, key, scope, scope_id, old_value, new_value, changed_by, reason)
         values ($1, $2, $3, $4, $5, $6::jsonb, null, $7, $8)`,
        [
          newId("schg"),
          old.id,
          input.key,
          input.scope,
          scopeId,
          old.value === null ? null : JSON.stringify(old.value),
          input.actorId ?? null,
          input.reason ?? null,
        ],
      )

      await emit({
        name: "setting.unset",
        key: input.key,
        scope: input.scope,
        scopeId,
        changedBy: input.actorId ?? null,
      })

      return true
    },

    async list(db, input) {
      const rows = input.scopeId
        ? await db.query<SettingRow>(
            `select * from platform.settings
             where scope = $1 and coalesce(scope_id, '') = coalesce($2, '')
             order by key`,
            [input.scope, input.scopeId],
          )
        : await db.query<SettingRow>(
            `select * from platform.settings where scope = $1 order by key`,
            [input.scope],
          )
      return rows.rows.map((row) => {
        const record = rowToSettingRecord(row)
        if (isSensitive(record.key, record.isSensitive)) {
          return { ...record, value: REDACTED }
        }
        return record
      })
    },

    async listChanges(db, input) {
      const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000)
      const rows = input.key
        ? await db.query<SettingChangeRow>(
            `select * from platform.setting_changes where key = $1
             order by created_at desc limit $2`,
            [input.key, limit],
          )
        : await db.query<SettingChangeRow>(
            `select * from platform.setting_changes order by created_at desc limit $1`,
            [limit],
          )
      return rows.rows.map(rowToSettingChange)
    },

    async getEffectiveSettings(db, context, effectiveOpts) {
      const rows = await db.query<{ key: string; scope: SettingScope; scope_id: string | null; value: unknown }>(
        `select key, scope, scope_id, value from platform.settings where ${CONTEXT_WHERE}`,
        contextParams(context),
      )
      const byKey = new Map<string, StoredValue[]>()
      for (const r of rows.rows) {
        const list = byKey.get(r.key) ?? []
        list.push({ scope: r.scope, scopeId: r.scope_id, value: r.value })
        byKey.set(r.key, list)
      }

      const includeSensitive = effectiveOpts?.includeSensitive ?? false
      const out: Record<string, ResolvedSetting> = {}
      for (const def of registry.list()) {
        const resolved = resolveFromRows(def.key, def, byKey.get(def.key) ?? [], context)
        out[def.key] = includeSensitive ? resolved : redact(resolved)
      }
      return out
    },

    listDefinitions() {
      return registry.list()
    },
  }
}
