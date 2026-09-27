# DECISIONS

These decisions describe changes made in this session. The broader backend and UI architecture predated it; see `NOTES.md` for the reference implementation's original decisions.

### JWT segments must be canonical base64url and JSON objects

**What I chose:** Reject non-string tokens, malformed/non-canonical segments, and parsed JSON values other than objects through the existing 401 path.
**Why:** `node scripts/check-jwt.js` initially passed 43 checks, but four new cases showed two uncaught `TypeError`s and two accepted malformed tokens. After the change, all 47 checks pass.
**What I rejected:** Relying on `Buffer.from(..., 'base64url')` and then reading properties. Node's decoder ignores invalid characters, and a valid JSON `null` is not an object with JWT claims.
**What would change my mind:** A verified interoperability requirement for padded or non-canonical JWT segments; none exists in this contract.

### Keep policy evaluation in the server

**What I chose:** Have the inspector call the existing effective-permissions endpoint and display its `effect`, `source`, and `reason` fields directly.
**Why:** The API suite now asserts device scope, baseline provenance, self-access, and the `user:read` refusal; the browser suite checks the resulting per-device allow and explicit deny.
**What I rejected:** Recomputing role/grant rules in React. It would diverge from the server's enforcement and could show an authority result the API refuses.
**What would change my mind:** A server response that omitted the decision provenance needed to explain an allow or deny; the current route returns it.

### Make self-inspection independent of People access

**What I chose:** Put the inspector in a collapsed authenticated-header utility. Any active member can inspect themselves; only callers with `user:read` can select another member.
**Why:** The endpoint explicitly allows self-inspection, while the operator has no `user:read`. The `an operator can inspect their own policy without user:read` browser test passes.
**What I rejected:** Nesting the inspector in the People card, which makes the self endpoint unreachable for roles that cannot open that card.
**What would change my mind:** A product requirement to hide all diagnostics from non-administrative roles; none was provided.

### Use Node APIs for Windows setup and static paths

**What I chose:** Run the idempotent Node DB loader directly and convert module-relative file URLs with `fileURLToPath`.
**Why:** On Windows, `npm run db:reset` failed at `rm`; direct loading exposed `C:\C:\...`; production static serving used the same `.pathname` pattern. The reset and full browser suite now pass.
**What I rejected:** Adding a shell portability dependency for one cleanup command, or leaving the loader idempotent while calling it through a failing wrapper.
**What would change my mind:** A supported non-Node shell-only packaging contract; the app already requires Node and ships a loader.

### Keep the browser override optional

**What I chose:** Let `PLAYWRIGHT_CHANNEL` select an installed browser, with Playwright's bundled Chromium remaining the default.
**Why:** The Chromium CDN timed out repeatedly, but local Chrome ran all 27 browser tests successfully.
**What I rejected:** Hardcoding the host's Chrome path, which would make CI and other developers depend on this machine.
**What would change my mind:** A repository-wide browser provisioning mechanism that makes this fallback unnecessary.

### Use an in-app form for organization creation

**What I chose:** Collect the organization name in an accessible modal and show request failures inline.
**Why:** Clicking New org in the shared browser produced `Error: prompt() is not supported`; the updated `a new org can be created from the UI and you become its owner` test now passes through the form.
**What I rejected:** Keeping `window.prompt()` or catching the exception. The browser environment does not implement that API, and swallowing it would still leave the primary action inert.
**What would change my mind:** A supported prompt API in every target browser and a product requirement to prefer browser-native prompts over an in-app form.

---

# Phase 11 — architecture decisions, re-derived from the code

The entries below were written after reading the implementation, not from memory. Where a decision
was already documented in `NOTES.md` by the reference implementation, this records that it was
verified to match the code rather than re-arguing it. "Evidence" cites what I actually ran or read.

## Decision — the access token carries authorization *inputs*, never the resolved permission set

### Chosen
`issueAccessToken` (`server/auth.js`) embeds `sub`, `org`, `role` and `pv` (the membership's
`perm_version`) and nothing else. The server calls `permissions.js` to resolve the actual set on
every request. Freshness is enforced by `assertFresh` comparing `claims.pv` to
`memberships.perm_version` with `!==`, so a role or grant change lands on the *next* request rather
than at token expiry.

### Alternatives considered
- Embed the resolved permission set in the JWT. Rejected: it makes revocation take effect only at
  expiry unless the server re-checks anyway, and it puts a derived value in a payload the README
  explicitly notes is base64, not encrypted.
- Drop `pv` and let tokens live until `exp`. Rejected: a demoted owner would keep admin authority
  for up to the 15-minute TTL, contradicting D7's "no propagation window" requirement.

### Why the alternative was rejected
The permission set is derivable state; `pv` is the invalidation signal. Storing derivable state in a
credential creates a second source of truth that can only ever be stale.

### Evidence
`server/auth.js:44-63` (the comment "the token carries the authorization INPUTS ... the server
resolves the permissions", D11) and `server/auth.js:138-141`. `node scripts/check-jwt.js` passes
47 checks. The API suite's stale-token case passes within 117.

### Trade-offs
Every request costs a membership read. That is the price of revocation taking effect immediately,
and the device list pays it once per page rather than once per row (see the batching decision).

---

## Decision — authorization is decided on the server, exclusively

### Chosen
`server/permissions.js` is the only module that answers allow/deny. `assertCan`,
`assertCanStartSession` and `assertMayGrant` all funnel into the shared `buildPermissions` core, and
`can()` reads that result. The console renders `effect`/`source`/`reason` returned by the API.

### Alternatives considered
- Recompute policy in React from a copied role matrix. Rejected: two copies of the matrix drift, and
  the UI could display an authority the API refuses.
- Gate on role in the UI (`if (role === 'admin')`). Rejected: roles are unordered by permission —
  `operator` and `auditor` are deliberately not ranked, which is the exact modelling error the
  auditor role exists to catch.

### Why the alternative was rejected
`PERMISSIONS.md` §8 states it directly: "The console derives every `data-state` from the resolved
permissions the server sends. There is no role-to-permission table in the frontend."

### Evidence
`web/` contains no `if (role === ...)`; components read `session.permissions[...]` and
`device.permissions[...]` (grep across `web/components/*.jsx`). `whyLocked()` maps the server's
`reason` to a sentence rather than inventing one.

### Trade-offs
The UI cannot render anything the server has not already authorized, so a permission that should be
explainable must be exposed by the API. That is why `/users/{id}/effective` and the per-row device
permissions exist at all.

---

## Decision — the permission model is database-driven, including wildcards

### Chosen
The catalogue (`SELECT key FROM permissions`), the role baseline (`role_permissions`), grants and
their patterns are all read from SQLite at request time. `expand()` resolves `'*'`, `'device:*'` and
exact keys against the live catalogue.

### Alternatives considered
- Hardcode the catalogue and role matrix in JS. Rejected: it duplicates the seed and would ignore
  a permission added to the database.
- Expand wildcards at write time. Rejected: a grant made before a new permission existed would never
  cover it, and revoking the permission would require rewriting history.

### Why the alternative was rejected
Expanding at read time means a catalogue change takes effect immediately for every existing grant,
with no migration.

### Evidence
`server/permissions.js:65-72` (`loadCatalogue`, `loadBaseline`) and `:21-28` (`expand`).
`node scripts/check-permissions.js` passes 35 checks, including `device:*` not conferring
`session:start` or `audit:read`.

### Trade-offs
A wildcard grant resolves to more permissions over time as the catalogue grows. That is the
intended semantics but it means `*` is a standing decision, not a snapshot.

---

## Decision — explicit deny is evaluated before allow, unconditionally

### Chosen
`buildPermissions` collects **all** deny rows into a `Map` first, then fills an `allowed` Map, and
only then assigns an effect per catalogue key. A key present in `denied` can never become allowed,
regardless of scope or specificity. This holds for role baselines too: a baseline `allow` loses to a
`deny` grant.

### Alternatives considered
- Specificity-based resolution (a device-scoped allow beating an org-wide deny). Rejected: that is
  the intuitive model and it is exactly what D1 forbids; it would make denials defeatable by
  narrowing scope.
- Last-write-wins ordering over the grant rows. Rejected: makes the result depend on row order,
  which is not a security property.

### Why the alternative was rejected
A deny that can be overridden is not a deny. Splitting evaluation into two ordered passes makes the
precedence structural rather than dependent on data ordering.

### Evidence
`server/permissions.js:94-120`. The permission suite includes the org-wide-deny / device-allow case
and passes.

### Trade-offs
An operator cannot carve an exception *into* a denial. If a deny is too broad, the only remedy is to
revoke the deny, which is a second operation. That is the correct direction of friction for a
security control.

---

## Decision — tenancy is scoped by the token's `org` claim, and enforced structurally

### Chosen
`context.js` throws `notFound()` when `params.org` differs from `claims.org`, and every
`org`-scoped query filters on `ctx.orgId`. A soft-deleted org is treated as absent (the membership
query joins `organizations` and reads `deleted_at`). Cross-org access is refused with `404`, never
`403`.

### Alternatives considered
- Filter cross-org rows out of results and return `200` with an empty list. Rejected: a `403` or a
  differing row count confirms existence; `404` is indistinguishable from "does not exist".
- Store a server-side "current org" per user. Rejected: a user with two memberships would have one
  shared cursor, so two browser tabs on two orgs would fight, and it would create exactly the
  user-only cache key that leaks org A's authority into org B.

### Why the alternative was rejected
`PERMISSIONS.md` §6 and `DISCOVERY-RUBRIC.md` B4 both ask whether isolation is *structural* or
*filtering*. Because the token cannot name another org, isolation is structural.

### Evidence
`server/context.js:47-48`. `server/routes/auth.js:92-105`: switching orgs **mints a new token**
(`POST /v1/auth/token`) rather than re-scoping an existing one, so each tab holds an independent
credential. UI test `no token is persisted in web storage` passes (30 passed), and two contexts on
two orgs are exercised by the tab-independence test. API suite asserts the wrong-org `404` body
contains no org data and a generic message.

### Trade-offs
Switching orgs costs a round trip to mint a token, and a stale token for the previous org is
discarded rather than reused. Access tokens are also single-org, so any future multi-org UI must hold
one token per org.

---

## Decision — a session's authority is snapshotted at start and does not change

### Chosen
`snapshotAuthority` stores `{role, grantIds, snapshotAt}` into `sessions.authorized_by` at creation.
Permission and role changes never terminate a live session. Only account-integrity and tenancy
events cascade via `endActiveSessions`: `user_suspended`, `membership_removed`,
`device_transferred`. A TTL (`org.max_session_minutes`, default 60) bounds grandfathering.

### Alternatives considered
- Re-resolve authority on every session read. Rejected: it would silently end a repair in progress
  the moment a grant was revoked — the disruptive lever, rather than the safe one.
- Revoke the session on any permission change. Rejected: same problem; `PERMISSIONS.md` §7 states
  there is deliberately no `permission_revoked` end reason.

### Why the alternative was rejected
Pulling an operator out of a live repair is the harmful action. Blocking the *next* session achieves
the same security goal without disrupting work in flight.

### Evidence
`server/lifecycle.js:50-51` (the comment stating this is explicitly NOT used for grant or role
changes) and `:76-88` (`snapshotAuthority`). `server/routes/devices.js:251` — the grant revoke path
carries the comment "Deliberately NOT ending sessions. Grandfathering, §7.1". The API suite's
"and control fails differently" / session-lifecycle checks pass within 117.

### Trade-offs
A revoked grant's authority survives until the session TTL expires — up to an hour. This is the
accepted cost, and the TTL is what makes it bounded rather than indefinite.

---

## Decision — concurrency is settled by database constraints, not check-then-act

### Chosen
Two races are arbitrated by the storage layer, with the application only translating the resulting
constraint error:
- **Exclusive sessions.** The partial unique index `one_exclusive_session_per_device` is the
  arbiter; `sessions.js` catches `SQLITE_CONSTRAINT*` and converts it to `409 DEVICE_BUSY` with the
  holder's session id.
- **Single-use invites.** `accept` runs a conditional
  `UPDATE invites SET accepted_at=? WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL`
  inside a transaction and requires `changes === 1`; a second concurrent accept sees `0` and gets
  `409`.
- **Append-only audit.** `BEFORE UPDATE` / `BEFORE DELETE` triggers `RAISE(ABORT)` on
  `audit_events`.

### Alternatives considered
- `SELECT` to check for an existing holder, then `INSERT`. Rejected: two parallel requests both see
  "free" and both insert.
- Enforce audit immutability by convention (documented, trusted). Rejected: a single stray `DELETE`
  from a script or a future route silently destroys evidence.
- Optimistic UI / application-level locking. Rejected: adds a lock manager for a problem the
  database already solves atomically and for free.

### Why the alternative was rejected
Check-then-act has a window between the read and the write. The unique index has none, and it
enforces the rule even for a code path that forgot to check.

### Evidence
`db/schema.sql:206-214` (the two audit triggers, with the invariant referenced in the message);
`server/routes/sessions.js:53-64`; `server/routes/invites.js:148-157`. The API suite asserts both
`audit delete blocked by schema trigger` and the concurrent-session outcome, passing within 117.

### Trade-offs
The unique index cannot express every rule — for example it cannot distinguish an exclusive mode
from a `view` session by itself, so the index is partial on the mode set. And the error arrives as
a generic SQLite code, so each catch site must re-query to produce a useful message, which is a
second read that could itself race (harmlessly here, since it only enriches the 409 body).

---

## Decision — frontend permission rendering is presence-as-contract, with no disabled state

### Chosen
An action is either in the DOM with `data-state="unlocked"` or it is not rendered at all. There is
no disabled-and-greyed variant, and no `if (role === ...)` anywhere under `web/`. The
`DevicePolicyInspector` dialog and the header inspector call
`GET /users/{id}/effective` and display the server's `effect`, `source` and `reason` verbatim.

### Alternatives considered
- Render disabled buttons with a tooltip. Rejected: it advertises the existence of controls the
  caller cannot use, and it is easy to ship a click handler still attached to a disabled control.
- Recompute the result client-side for instant feedback. Rejected: duplicates the engine and can
  disagree with the server after any revocation.

### Why the alternative was rejected
A locked control that is merely hidden behind CSS is still a locked control, but a *rendered*
control invites the question "why is this greyed?". Absence plus a reason is unambiguous.

### Evidence
`web/components/Devices.jsx:136,206-231`, `Admin.jsx:41-44`, `Grants.jsx:91,159-160` all read
`session.permissions[...]` / `device.permissions[...]`. `whyLocked()` renders the server's `reason`.
UI tests `an org-wide deny removes the entry the baseline granted` and
`grant management is absent below admin` pass (30 passed).

### Trade-offs
Removing and re-adding DOM nodes on every permission change is a bigger change than toggling a
class, and it means a hidden action cannot be discovered by keyboard navigation. The inspector
exists partly to recover that discoverability.

---

## Decision — in-app notification component for session start; `alert()` retained for invite tokens

### Chosen
Session-start confirmation uses a reusable `<Toast>` (`role="status"`, `aria-live="polite"`,
6-second auto-dismiss plus a manual Dismiss button) carrying device name, mode and session id. The
session API call and refresh behaviour are unchanged. Native `alert()` is still used for
`Admin.jsx` failures, for the invite-token display, and for the "Pick a device on the Devices view"
button.

### Alternatives considered
- `alert()` everywhere. Rejected: it is modal, blocks the page, is not announced politely, and is
  untestable without stubbing a global. The existing `prompt()` breakage in this same component tree
  is direct evidence that depending on browser dialogs is fragile here.
- A global toast provider. Rejected as unnecessary for one call site; `Devices.jsx` holds the state
  locally and renders `Toast` where it is needed.
- Replace all `alert()` calls. Not done: that is a UI refactor beyond this phase, and the invite
  token genuinely wants an interrupting, hard-to-miss surface because it is shown exactly once.

### Why the alternative was rejected
`ERROR: prompt() is not supported` was observed in this environment when New org was clicked. The
session toast was rebuilt as a real component; the remaining `alert()` uses are a separate,
lower-risk cleanup that I have deliberately not mixed into a documentation phase.

### Evidence
`web/components/Toast.jsx`; `Devices.jsx:49-50,113-123` sets `{id, mode, deviceName}` and renders
`<Toast title="Session started">`.

**Superseded later in this session.** This decision described the state at the time it was
written. The remaining `alert()` calls have since been replaced: `Admin.jsx` and `People.jsx`
now use in-app `Modal` dialogs with `role="alert"` error regions, and `Sessions.jsx` uses a
non-blocking `Toast`. The current position is: **no `alert()` remains anywhere under `web/`**, and
the one-time invite token is shown in a deliberate modal rather than a toast — a toast
auto-dismisses, which would let the only copy of a credential disappear unread. The original
`Toast`-versus-`alert()` reasoning below is kept because it explains why the session path was
converted first; it is not the current state of the file.

### Trade-offs
A polite live region is silent for screen-reader users who are not already on the page, so a
non-blocking toast is the wrong surface for an error. That is why the error paths still interrupt.

---

## Decision — batch the device list, and deliberately do not cache permission results

### Chosen
`resolveDevices()` loads the catalogue, membership and role baseline **once**, fetches every
applicable grant for the whole page in a **single** query, and then does per-row work as in-memory
filtering. It returns exactly what `resolve()` would return per device. There is **no cache and no
TTL** — a batch is a single read at the instant of the request.

### Alternatives considered
- Call `resolve()` once per device row. Rejected: four queries per row (catalogue, membership,
  baseline, grants) is the N+1 the brief calls out; at 200 rows that is ~800 statements per list
  request.
- Add a cache keyed by `userId`, invalidated by `perm_version`. Rejected as unsafe: a `userId`-only
  key hands org A's authority to org B for a user with two memberships.
- Add a short-TTL cache. Rejected: D7 requires a revoked permission to take effect on the next
  request with no restart, so any TTL window serves authority that has already been withdrawn.
- Push the batching into SQL (a recursive CTE emitting one row per device/permission). Rejected on
  maintainability: it duplicates the deny-before-allow precedence in a second language and would
  need to stay in sync with `buildPermissions`.

### Why the alternative was rejected
The optimisation that is safe is removing redundant *reads* within a single request. The
optimisation that is unsafe is *retaining* a previous request's answer. This line stops at the first.

### Evidence
`server/permissions.js:150-186`, including the comment "There is NO cache and no TTL: this is one
database read taken at the instant of the request, exactly like `resolve()`, so it can never serve
authority that is out of date." `NOTES.md` §2 records that batched results were verified equal to
`resolve()` across every seed user/org/device.

### Trade-offs
Every list request still reads the full grant set for the page, so cost grows with grant count
rather than staying flat. At this data size that is the right trade; if grant counts grew by orders
of magnitude, the next step would be a `perm_version`-keyed cache, not a TTL.

---

## Decision — Phase 10 measured the query paths and deliberately changed no application code

### Chosen
Add `scripts/bench-queries.js` as a measurement harness and leave `server/` and `web/` untouched.
The device list keeps its single batched resolution; **no cache was added**, despite being offered.

### Alternatives considered
- Add a `(userId, orgId)`-keyed permission cache with a short TTL. Rejected: see below — a
  TTL-bearing cache can serve a permission a revoke already removed, and D7 requires the change to
  land on the next request.
- Trim the device list payload to only the permissions the UI renders. Rejected: it changes the API
  contract and pushes policy derivation back into the frontend, violating `PERMISSIONS.md` §8.
- Push the batching into a SQL recursive CTE. Rejected: it would express deny-before-allow
  precedence in a second language that must stay in sync with `buildPermissions`.
- Optimise on inspection alone, without a harness. Rejected: reading code cannot distinguish "flat
  query count" from "N+1 behind a helper", and the whole point of the phase was evidence.

### Why the alternative was rejected
A cache is only safe if its key includes everything that can change the answer. The correct key is
`(userId, orgId, perm_version)` — but reading `perm_version` is itself the membership read the
cache was meant to eliminate. So the cache would save nothing while reintroducing a stale-authority
and cross-tenant bug class the repository currently does not have. Measured cost to avoid: 4 SQL
statements per device list, ~2 ms at 200 devices. That is not a trade worth making.

### Evidence
Statement counts from `scripts/bench-queries.js`, tallied by wrapping `db.prepare` so every
`.all/.get/.run` execution counts (a per-row statement through a cached handle still counts):

| devices | `resolveDevices()` (used) | `resolve()` per row (counterfactual) |
|---|---|---|
| 1 | 4 | 4 |
| 10 | 4 | 40 |
| 50 | 4 | 200 |
| 200 | 4 | 800 |
| slope | **0.000/device** | 4.000/device |

Wall time at n=200: 1.7 ms batched vs 49 ms per-row (~28x). End-to-end `GET /devices` against the
real server: 2,136 us at 1 device rising to 5,019 us at 200, with response size growing 1,494 to
296,503 bytes. The latency rise is therefore response serialisation (~1.5 KB per device, because
each row carries all 19 resolved permissions), **not** query cost — the statement count stayed at 4
throughout.

Negative results, all checked rather than assumed: no N+1 in `devices`/`members`/`grants` (single
query each; every `for`/`map` in the route bodies iterates an already-fetched array); no automatic
per-device API call (the inspector's fetch is an on-demand dialog); and `grep` for
`new Map()`/cache/TTL across `server/` finds only token TTLs, session expiry, and the two
per-call `Map`s inside `buildPermissions` — so no stale cache and no `userId`-only cache exist.

### Trade-offs
The harness (`scripts/bench-queries.js`) is a permanent file that seeds synthetic orgs and boots a
real server on port 8131, so it costs a few seconds per run and must be given its own port. It
asserts nothing, so it cannot substitute for the correctness suites — the measurement and the tests
are deliberately separate. The cost of not caching is re-reading 4 statements per list request,
which is the visible price of correctness-by-construction.

---

## Where this repo argues with itself

Two contradictions between the written specs and the shipped code were confirmed by reading both
sides in this session. They are recorded rather than silently reconciled, and no behaviour was
changed to hide either one.

**1. `GRANT_EXPIRED` and `scope_mismatch` are documented but never emitted.**
`PERMISSIONS.md` §5's code table lists `GRANT_EXPIRED` → `400` for "creating a grant that is already
expired", and its `reason` list includes `scope_mismatch`. Neither string appears anywhere in
`server/`. What the code actually emits is `server/routes/devices.js:196`:
`badRequest('expiresAt is in the past', 'expired_grant')`, which produces `400` with
`code: "VALIDATION"` and `reason: "expired_grant"`. A client written against the documented table
would branch on a code it will never receive. I kept the implementation and documented the
divergence; renaming a documented public code to match prose would be a breaking API change, and
`expired_grant` is also the string `PERMISSIONS.md` §5 itself lists as a valid `reason`.

**2. The documented code table is incomplete relative to what the server emits.**
Extracting every `new HttpError(<status>, '<CODE>')` literal in `server/` yields exactly:
`400 VALIDATION`, `401 UNAUTHENTICATED`, `401 TOKEN_STALE`, `403 FORBIDDEN`,
`403 SELF_ROLE_CHANGE`, `404 NOT_FOUND`, `409 LAST_OWNER`, `409 DEVICE_BUSY`, `410 GONE` — plus
`409 CONFLICT`, which is built through the `conflict()` helper and so does not appear as a literal.
The table in §5 documents `CONFLICT` and `LAST_OWNER` and `DEVICE_BUSY`, so the gap is
`SELF_ROLE_CHANGE` and `TOKEN_STALE` being implemented but not tabulated alongside the rest.
Minor, but a client switching exhaustively on the table would miss them.

**3. The performance spec and the visibility spec pull in opposite directions on the device list.**
`PERMISSIONS.md` §5 says an invisible resource is `404`; §8 says the device list ships the caller's
full resolved permission set per row. Shipping the full set is required for the "console derives
every `data-state` from the server" rule, but it means the list response grows ~1.5 KB per device
(measured: 1,494 bytes at 1 device, 296,503 bytes at 200). The two rules are not in conflict on
*visibility* — a denied device is still omitted from the array entirely — but the response size is
a direct consequence of the anti-divergence rule, so a reviewer expecting a small list will find
one that is large by design. Recorded because the measurement is otherwise indistinguishable from
an N+1 in the response.

A third tension was already documented by the reference implementation and re-verified as still
accurate rather than re-argued: suspension bumps `perm_version` (which would make the token stale
and return `401 TOKEN_STALE`) while `AUTH-DATA-MODEL.md` §10 says a suspended member should get
`403`. `context.js:45` resolves it by skipping `assertFresh` for a suspended membership only, so
the observable behaviour matches §10. See `NOTES.md` §1.

## Deliberately not changed in this phase

## Deliberately not built

No changes were made to the permission-resolution rules, schema, reference data, or session semantics. They were already implemented in `q1-starter/` and passed their checks. Commit history, clean-checkout validation, push, and form submission remain open because this project directory has no Git repository and the required account/form context is unavailable.

**Phase 11 specifically.** This was a documentation phase and it changed only `BUILD-LOG.md` and
`DECISIONS.md`. No source, test, schema, or seed file was edited, because nothing found was a code
defect: the four suites pass (47 / 35 / 117, plus 30 browser tests) and the production build
succeeds. `db/schema.sql` and `db/reference.sql` were not modified, as instructed.

**Not claimed.** The Phase 9 hostile attack pass and any Phase 10 work have no trace in this
repository: there is no `scripts/check-attack.js` and no log entry for either phase. No attack
findings are recorded, and the previously requested `test: harden authorization tenancy and
lifecycle edge cases` commit was not created. This phase must not be read as evidence that an
attack pass happened.

**Blocked.** A recursive search found no `.git` directory anywhere in the workspace, and
`Test-Path .git` in this copy is `False`, so there is no Git history to review and the requested
`docs: record implementation decisions and build evidence` commit could not be created. Git is
installed at `C:\Program Files\Git\cmd\git.exe` but is not on `PATH` in this shell, which is the
reason the 2026-09-26 Phase 8 entry describes Git resolving outside the project. I did not run
`git init`: initialising a repository is a submission decision, not a documentation edit.

**Phase 10 specifically.** Added `scripts/bench-queries.js` and changed no application code, because
the measurements found no N+1 and the existing batching was already flat at 4 statements. The
requested `perf: reduce redundant authorization and data queries` commit was likewise not creatable,
and would not have matched the work: nothing was reduced, because nothing was redundant. Details
and the measurement tables are in the Phase 10 entry of this log and the corresponding
`## Decision` in `DECISIONS.md`.

**Environment note for whoever reproduces this.** `node` is not on `PATH` by default here; prefix
`C:\Program Files\nodejs` first. The Playwright `webServer` command runs `npm run build` before
booting, so the suite takes longer than a 120-second command window allows — run it detached, and
stop any leftover `node server/index.js` first, because `playwright.config.js` sets
`reuseExistingServer: false` and will refuse to start on a busy port.

### Retain one database-driven authorization resolver

What I chose: Retain the existing `resolve()` and `resolveDevices()` paths, both of which finish in the shared `buildPermissions()` decision function.
Why: `node scripts/check-permissions.js` passed all 35 vectors, including explicit deny precedence, device-scoped grants, wildcard expansion, time windows, and suspended memberships.
What I rejected: Replacing the implementation or copying the documented role matrix into code. That would duplicate the source of truth and would not establish behavior for the missing personalized fixture.
What would change my mind: A runnable personalized checker or hidden-fixture failure showing that an undocumented role or permission is not loaded from SQLite at runtime.
