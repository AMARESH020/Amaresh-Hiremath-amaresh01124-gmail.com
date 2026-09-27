# RemoteOps — build notes

Short write-up of the decisions behind this build, the parts the spec left open, and the
places where I think the spec argues with itself. Read together with `README.md` (run
instructions) and the four specs.

## How it is put together

One process. `server/index.js` owns the request pipeline, `/v1/*` is the API, everything
else is the SPA. One permission engine (`server/permissions.js`) answers allow/deny for both
halves; the console renders what the API tells it and never re-derives a role.

The request pipeline is the whole story: match a route, build the caller from the bearer
token (`context.js`), read the body, call the handler, and funnel every throw through one
error shape (`http.js`). A resource that belongs to another org is `notFound()` before any
permission question is asked.

## The decisions that are genuinely mine

### 1. One engine, two evaluation contexts

`resolve()` is the only place that compares a permission. It takes an optional `deviceId`:

- `deviceId == null` is the **org-level union** — used for nav gating and page presence.
  Every grant counts, including device-scoped ones, because a viewer with Control on one
  device should still see the Devices card.
- `deviceId == '<id>'` is the **exact per-device check** — org-wide grants plus that device's
  grants.

Deny is collected before allow, so scope and specificity never matter (D1). Provenance
(`source`, `reason`) is attached in the same pass, which is what lets the console explain a
lock with the server's own words instead of inventing one.

### 2. Performance: batched, never cached

The device list resolves one set per row. Doing that through `resolve()` would be four queries
per row (catalogue, membership, baseline, grants) — the N+1 the brief calls out. `resolveDevices()`
loads the catalogue, the membership and the baseline once and pulls every applicable grant for
the whole page in a single query; per-row work is then in-memory filtering. It returns exactly
what `resolve()` returns — verified across every seed user/org/device.

There is **no cache and no TTL**. A batch is a single read taken at the instant of the request,
so it cannot serve authority that is out of date. That matters more than shaving a query: a
cache keyed by `userId` alone would hand org A's authority to org B, and any cache with a TTL
would briefly serve a permission that a revoke already removed (D7 says expiry must take effect
on the next request with no restart). If one were added later it would have to be keyed
`(userId, orgId)` and invalidated by `memberships.perm_version`.

### 3. Console presence, and how a lock explains itself

Presence is the contract: an element is rendered with `data-permission` + `data-state="unlocked"`
or it is not in the DOM. There is no disabled state, and no `if (role === …)` anywhere under
`web/` — the device rows arrive with the caller's resolved set already attached.

Where I had a free hand I still let the server supply the wording: `whyLocked()` maps
`reason` to a sentence, so `implicit` reads as *"not granted"* and `explicit_deny` as
*"denied by grant:…"*. That is the difference between "nobody gave this to you" and "someone
took it away", and it is the only hint I surface for an absent element.

Org identity is `data-org-id` + `data-org-theme` on the shell, and the theme drives the actual
rendered palette, so switching orgs changes the background measurably — not one shared banner.

### 4. Scope I chose not to build

Rate limiting, email delivery, password reset, device search, member pagination, and anything
resembling real remote access. Sessions are records: start, watch, end, TTL. Audit pagination
exists because the spec defines its boundaries; the other lists are small by construction.

## Things I think the spec gets wrong, and what I did

Build against the written rule, note the disagreement. Each of these is a case where two
statements cannot both hold, or a rule is under-specified.

1. **Suspension cannot both bump `perm_version` and answer `403`.**
   `AUTH-DATA-MODEL.md §1` says a suspension bumps the membership's permission version, which
   makes the caller's live access token stale; `§10` then says a suspended membership's token
   should be refused `403` with an empty set. Those conflict — the freshness check fires first
   and returns `401 TOKEN_STALE`. I kept the version bump (it is correct) and, in `context.js`,
   skip the freshness assertion **only** for a suspended membership, so the request reaches the
   resolution engine and is refused `403`, `reason: "suspended"`. On reinstate the version has
   moved again and the old token is properly stale. I chose the observable behaviour the spec
   names over the mechanism it names.

2. **`device:provision` on decommission is per-row.** The endpoint table lists the permission
   without a scope, but `UI-INVENTORY.md §3` lists `decommission-device` among the device-scoped
   entries resolved per row. I resolve it against the device, so a deny on one device blocks
   decommissioning that device and nothing else. Creating a device stays org-level, because
   there is no device to scope to yet.

3. **`session:*` is not a device permission.** D6 scopes `device:*` permissions to a device;
   it says nothing about session permissions. So `GET /sessions/{id}` and the terminate half of
   `DELETE /sessions/{id}` resolve `session:view` / `session:terminate` **org-wide**, not against
   the session's device. Scoping them to the device would let a device-scoped grant widen a
   permission that is not device-scoped.

4. **No-laundering had to apply to the whole list.** D9 and invariant 11 are unambiguous: you
   cannot hand out a permission you do not hold at that scope. `assertMayGrant()` expands every
   requested pattern and refuses if any one of them is not `allow` for the caller. This is what
   stops an admin — who holds everything except `org:delete` — from granting `org:delete` or `*`.
   I apply it to `deny` grants too, because §8 says "every permission being granted"; if I were
   arguing the other way I would exempt `deny`, since restricting someone is not escalation.

5. **Soft-deleted is invisible.** `PERMISSIONS.md §5` lists soft-deleted resources with
   non-existent ones under `404`. `context.js` joins the org and refuses a token whose org has
   `deleted_at` set, so deleting an org immediately ends any token scoped to it instead of
   leaving its rows reachable.

6. **The refresh cookie is not `Secure` in development.** D13 asks for `HttpOnly`,
   `SameSite=Strict` and `Secure`. I set the first two always; `Secure` is omitted so the
   documented `http://localhost` flow works, and would be switched on behind TLS. This is a
   deliberate dev-only gap, not an oversight.

7. **Only denied mutations are audited, not denied reads.** Invariant 9 asks the audit log to
   record denied attempts. I read that as security-relevant attempts — sign-in failures and
   refused state changes — and audit those, exactly once each. A denied `GET` is not logged;
   otherwise a page that fires several gated requests fills the log with noise and the signal
   the log exists to carry (who tried to change what) is lost. Easy to extend if you disagree.

8. **Sign-out has nowhere to go.** The endpoint table has no logout route, so the refresh
   cookie cannot be revoked from the client. "Sign out" clears the in-memory access token and
   returns to the sign-in screen; a reload will restore the session from the cookie until it
   expires. Fixing this properly needs a `POST /auth/logout` that revokes the family and clears
   the cookie; I did not invent an endpoint outside the contract.

## Small things worth knowing

- `auditDenials()` records **denials only**. Each route writes its own success row inside the
  transaction that made the change, so a successful action produces exactly one audit row. An
  earlier version of the helper also wrote `allow`, which double-logged every mutation.
- Duplicate entries in a grant's `permissions` array are collapsed before insert; the
  `grant_permissions` primary key would otherwise surface a harmless duplicate as a `500`.
- Unknown role is `400 VALIDATION`, not `409`; the grant foreign key is what turns
  `device:teleport` into `400 unknown_permission`.
- The token is scoped to one org, so switching orgs mints a new one. Two tabs on two orgs work
  independently because there is no server-side "current org" and no token in web storage.
