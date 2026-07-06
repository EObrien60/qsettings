# qsettings

A small, boring, reliable **typed, scoped configuration service** for OBH SaaS
products (qHaul, qMechanic, …).

One typed way to define, read, override, audit, and resolve settings — replacing
random JSON blobs, `.env` sprawl, hardcoded business rules, and one-off settings
tables. Products ask:

```ts
settings.get("qhaul.pod.signature_required", { workspaceId })
```

instead of reading random JSON, falling back to env, checking a tenant table,
then guessing a default.

This is **not** an auth system, a feature-flag platform, a secrets manager, a
policy engine, or an admin-UI builder. On purpose. See [Restraint](#restraint).

---

## Scopes & resolution order

Values are defined once and can be overridden at five scopes. Resolution goes
**most specific → least specific**:

```txt
runtime      (read-only, env/deploy-derived; only if the setting opts in)
   ↓
user         scope_id = userId
   ↓
group        scope_id ∈ groupIds  (first in groupIds wins)
   ↓
workspace    scope_id = workspaceId
   ↓
platform     scope_id = null      (global default for the deployment)
   ↓
definition default
   ↓
unset
```

```ts
const r = await settings.resolve("notifications.email.enabled", {
  workspaceId, groupIds, userId,
})
// -> { value, source: "user" | "group" | "workspace" | "platform" | "default" | ..., scopeId, isSensitive }
```

Runtime settings are separate and read-only: they never get stored, and only
participate when a setting declares the `runtime` scope and the caller passes the
value in `context.runtime`.

---

## Settings does not own RBAC

Access control belongs to your auth/permissions layer. A definition can carry
**hints** — `readPermission`, `writePermission`, `sensitive` — but the caller
must check them:

```ts
await permissions.require(user, "settings.workspace.write")
await settings.set(db, { key: "branding.logo_file_id", scope: "workspace", scopeId, value: fileId })
```

`sensitive` values are **redacted** from bulk reads (`list`,
`getEffectiveSettings`) by default; direct `get`/`resolve` return the real value
(the caller already enforced read permission). Real secrets (SMTP passwords, API
tokens) belong in env or a proper secrets backend — v1 does not encrypt at rest.

---

## Repo layout

```txt
packages/settings/   @obh/settings      — the SDK (define, registry, client, resolver)
apps/settings/       @obh/settings-app  — example catalogue + migrate/demo
```

---

## Install & quickstart

```bash
pnpm install && pnpm -r build

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/qsettings_dev
pnpm --filter @obh/settings-app migrate   # create platform.settings / setting_changes
pnpm --filter @obh/settings-app demo       # define -> set -> resolve -> record -> event
```

SDK consumers need `zod` (peer) and a Postgres client such as `pg`.

---

## Using the SDK

### 1. Define settings (Zod-backed)

```ts
import { z } from "zod"
import { defineSetting } from "@obh/settings"

export const PodSignatureRequired = defineSetting({
  key: "qhaul.pod.signature_required",
  schema: z.boolean(),
  defaultValue: false,
  scopes: ["workspace"],
  writePermission: "settings.workspace.write",
})

export const PrimaryColor = defineSetting({
  key: "branding.primary_color",
  schema: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  defaultValue: "#111111",
  scopes: ["workspace"],
})
```

### 2. Registry + client

```ts
import { createSettingsRegistry, createSettingsClient, pgAdapter } from "@obh/settings"
import { Pool } from "pg"

const registry = createSettingsRegistry([PodSignatureRequired, PrimaryColor /* ... */])
const db = pgAdapter(new Pool({ connectionString: process.env.DATABASE_URL }))
const settings = createSettingsClient({
  registry,
  onEvent: (e) => bus.emit(e.name, e), // optional: setting.changed / setting.unset
})
```

### 3. Read & write

```ts
// resolve the effective value across scopes
const r = await settings.resolve(db, "qhaul.pod.signature_required", { workspaceId })
const on = await settings.get(db, "qhaul.pod.signature_required", { workspaceId }) // just the value

// set at a scope (validates against the schema; records history; emits an event)
await settings.set(db, {
  key: "qhaul.pod.signature_required",
  scope: "workspace",
  scopeId: workspaceId,
  value: true,
  actorId,
  reason: "Customer requires signed POD",
})

// remove an override (falls back to the next scope)
await settings.unset(db, { key: "qhaul.pod.signature_required", scope: "workspace", scopeId: workspaceId })

// bundle for a UI/session (sensitive values redacted unless includeSensitive)
const effective = await settings.getEffectiveSettings(db, { workspaceId, groupIds, userId })

// history
const changes = await settings.listChanges(db, { key: "qhaul.pod.signature_required" })
```

`set` runs inside the db/tx handle you pass, so it can commit atomically with a
domain write and an event emit:

```ts
await db.transaction(async (tx) => {
  await tx.query("update workspaces set branding_done = true where id = $1", [workspaceId])
  await settings.set(tx, { key: "branding.company_name", scope: "workspace", scopeId: workspaceId, value: name })
})
```

Bring your own pool/ORM by implementing the tiny `SettingsDb` interface
(`query(sql, params)`).

---

## Client methods

| Method | Purpose |
| ------ | ------- |
| `resolve(db, key, ctx)` | Full `{ value, source, scopeId, isSensitive }` across scopes |
| `get(db, key, ctx)` | Just the effective value |
| `set(db, input)` | Upsert a value at a scope (validates, records, emits) |
| `unset(db, input)` | Remove an override (records, emits) |
| `list(db, { scope, scopeId? })` | Stored rows at a scope (sensitive redacted) |
| `listChanges(db, { key?, limit? })` | Append-only change history |
| `getEffectiveSettings(db, ctx, opts?)` | Resolved map of every defined setting |
| `listDefinitions()` | The registered definitions |

---

## Database schema

Two tables under `platform` — full SQL in
[`packages/settings/src/migrations/0001_init.sql`](packages/settings/src/migrations/0001_init.sql),
also `INIT_SQL` / `runMigrations(db)` (idempotent):

- **`platform.settings`** — one row per (key, scope, scope_id). Unique via
  `(key, scope, coalesce(scope_id, ''))` so platform-scope (`scope_id = null`)
  rows dedupe correctly.
- **`platform.setting_changes`** — append-only history (old/new value, actor,
  reason). Settings-native history; also surfaced as `setting.changed` /
  `setting.unset` events for an audit consumer. Values are never included in
  events.

Settings are **code-first** — there is no `setting_definitions` table.

---

## Events

Pass `onEvent` to surface `setting.changed` and `setting.unset`
(`{ name, key, scope, scopeId, changedBy }` — no value). Best-effort: hook
failures are logged, not thrown. For transactional guarantees, emit your own
event inside the transaction. No hard dependency on an events package.

---

## Testing

```bash
pnpm -r test
```

Unit tests (definition validation, registry, and the full resolution-order
matrix in `resolve.test.ts`) need no database. The client **integration tests**
run against real Postgres and self-skip unless `DATABASE_URL` is set — covering
scope override order end-to-end, validation, upsert/no-duplicates, change
history, sensitive redaction, unset, and transaction rollback. CI runs
everything against Postgres 16.

---

## Restraint

The whole v1 loop is: **define setting → set value at scope → resolve effective
value → record change → emit event.** Not a feature-flag platform, secrets
manager, policy engine, or admin UI. Those are separate components.

## License

MIT
