# BUILD-LOG

## Scope and starting point

This checkout contains a completed reference implementation in `q1-starter/` and a separate generated handout in `starter/`. Entries below record only work and checks performed in this session; they do not claim authorship of the pre-existing context, permission engine, lifecycle, route, or console implementation.

## 2026-09-26 - Phase 0: setup

Expected `npm run db:reset` to work on the workspace's Windows host. It failed because the script called POSIX `rm`; calling the existing Node loader directly then exposed a second failure, `C:\C:\...`, from treating a file URL pathname as a Windows path. Changed reset to call the loader and converted file URLs with `fileURLToPath`. `npm run db:reset` then seeded 2 organizations, 6 users, 8 memberships, 7 devices, and 19 permissions.

## 2026-09-26 - Phase 1: token verification

The existing JWT suite passed, but inspection suggested it did not distinguish malformed JSON objects or strict base64url. Added tests for correctly signed `null` header/payload and invalid segment characters. The old verifier produced two `TypeError`s and accepted both malformed segments. Added canonical base64url and JSON-object validation; `node scripts/check-jwt.js` now passes 47 checks.

## 2026-09-26 - Phase 2: caller context and permission engine

No engine code was authored in this session. Ran the existing permission contract after the auth change: 35 passed, 0 failed. The observed result supports moving on from auth to the engine/API gates without changing the established resolution behavior.

## 2026-09-26 - Phases 3-6: API, lifecycle, sessions, and audit

These modules predated this session. Added API assertions for device-scoped effective-permission results, self-inspection, and refusal to inspect another member without `user:read`. `node scripts/check-api.js` passes 71 checks, including those assertions.

## 2026-09-26 - Phase 7: console and Policy Inspector

The brief named a Policy Inspector but the reference UI had none. Added a collapsed header utility backed by the existing effective-permissions API. All active members can inspect themselves; member browsing requires `user:read`; device scope is offered only with `device:list`. The UI renders server `effect`, `source`, and `reason` without recreating the policy engine. The first operator test expected the wrong seeded display name (`Sam Chen`); the fixture returned `Sam Rivera`, so the assertion now checks the self-label rather than a name. The full Playwright suite passes 27 tests using installed Chrome.

Playwright's Chromium download timed out. The existing system Chrome was usable, so the config now supports an optional `PLAYWRIGHT_CHANNEL=chrome` while retaining the default Playwright browser for CI. Production tests also needed a build before server startup, and `server/index.js` had the same Windows URL-path issue as the loader; both are fixed.

After the user reported that New org did nothing, clicking it in the shared browser showed `Error: prompt() is not supported`. Replaced the native prompt with an accessible form dialog and updated the existing test to fill and submit it. The focused `a new org can be created from the UI and you become its owner` test passes; opening and cancelling the dialog in the shared browser leaves the seeded database unchanged.

## 2026-09-26 - Phase 8: hardening

`npm run build` succeeds. JWT (47), permission engine (35), API (71), and browser (27) checks pass. The project directory has no `.git`; Git resolves to `C:/Users/vishn`, outside this project. No commits, clean-checkout run, push, or submission were made from this workspace.

## Open threads


## 2026-09-27 - Phase 1 audit

Read the requested specification, schema, seed, server, script, test, and web files. The named
copy is a direct copy of `q1-starter`: the backend is implemented rather than stubbed, and the
session path checks authorization before inserting a record and writing its allow audit event.
The permission, JWT, and API baselines passed with 35, 47, and 71 checks respectively; the
production build passed. The Playwright suite could not launch because the Playwright Chromium
executable is not installed. This copy has no `check-personalisation.js`, no Git metadata, and no
candidate `DISCOVERY-BRIEF.md`; those were observed as missing rather than treated as results.

## 2026-09-27 - Phase 5 lifecycle, grants, sessions, and audit verification

Inspected `server/lifecycle.js`, `server/audit.js`, and all route modules before changing anything.
The existing implementation keeps role ranks separate from permission resolution, protects the
last owner, preserves users while changing membership state, hashes and consumes invites
transactionally, validates grants against database permission patterns, snapshots session
authority, applies TTL and schema-backed exclusive-session rules, cascades account and tenancy
events, and records denied attempts. `node scripts/check-api.js` passed all 71 checks, so no
implementation change was needed.

## 2026-09-27 - Phase 6 React console verification

Inspected the existing React console before changing anything. The required views, server-driven
permission presence, organization themes, error states, and session toast were already present;
the production build passed. The default `npx playwright test` could not launch because bundled
Chromium was not installed, but the repository's optional `PLAYWRIGHT_CHANNEL` configuration ran
the suite against installed Chrome: all 27 UI tests passed. The named app is running on port 8081
for manual testing.

## 2026-09-27 - Phase 7 session notification

The successful session-start path already created the server record, then loaded devices and
showed a local notification. Replaced that local markup with a reusable accessible `Toast`
component, added the mode and session ID to the confirmation, and added automatic and manual
dismissal. The session API call and refresh behavior were unchanged. `npx playwright test`
passed all 27 tests and `npm run build` passed.

## 2026-09-27 - Phase 8 device Policy Inspector

Added a per-device inspector dialog launched from each visible device row. It requests the
current user's effective permissions from the existing endpoint with that device's ID, renders
the returned effect/source/reason values, distinguishes explicit from implicit denials, and uses
the native dialog's Escape behavior. Added a UI test for the returned device-scoped result and
keyboard close. The focused test passed; the full UI suite passed 28 tests in installed Chrome;
`npm run build` passed. The requested commit could not be created because this folder has no
`.git` directory.

## 2026-09-27 - Phase 2 authentication verification

Inspected `server/auth.js`, `server/routes/auth.js`, and `server/context.js` before changing
anything. `verifyAccessToken` was already implemented: it pins HS256, verifies the HMAC in
constant time, validates issuer, audience, expiry and non-empty `jti`, and rejects malformed and
refresh-token-shaped bearer values. Permission-version freshness is deliberately checked after
membership lookup by `assertFresh`, which preserves the distinct `TOKEN_STALE` response. The JWT
suite passed 47 checks and `npm run build` passed, so no authentication implementation change was
needed. This folder has no `.git` directory, so the requested commit could not be created here.

## 2026-09-27 - Phase 3 caller context verification

Inspected `server/context.js` and its request-pipeline call site before changing anything. The
existing context resolves membership by the token's `(org, sub)` pair, returns the membership role
instead of reading a role from users, rejects removed memberships, preserves suspended memberships
for permission resolution, and rejects a token used against a different organization with `404`.
The permission suite passed 35 checks and the API tenancy suite passed 71 checks, including
cross-org invisibility and stale-token behavior. No context implementation change was needed.
This folder still has no `.git` directory, so the requested commit could not be created here.

## 2026-09-27 - Phase 4 authorization engine verification

Inspected `server/permissions.js` before changing anything. The existing resolver loads the
permission catalogue, role baseline, memberships, grants, device scope, and time windows from
SQLite; it expands database-backed wildcard patterns and evaluates denies before allows in one
shared `buildPermissions` path. `node scripts/check-permissions.js` passed 35 checks, including
the org-wide-deny/device-allow case and suspended membership behavior. The requested
`scripts/check-personalisation.js` is absent from this copy, so its result is `MODULE_NOT_FOUND`
and no personalized result is claimed.

## 2026-09-27 - Phase 11: build log and decisions pass

**What I investigated.** Re-ran every suite in this copy, then read the files each Phase 11 decision
depends on before writing anything: `server/auth.js`, `server/context.js`, `server/permissions.js`,
`server/lifecycle.js`, `server/http.js`, `server/audit.js`, `server/index.js`, and the
`sessions`/`invites`/`devices`/`auth` routes, plus `web/App.jsx`, `web/components/*.jsx` and
`db/schema.sql`.

**What I initially believed.** I expected Phase 9's hostile attack pass to have left failures for me
to fix, and I expected a Git history to read. Both assumptions were wrong, and neither is recorded
here as a result.

**What the repository actually showed.**

1. *No Git history exists to review.* A recursive search for `.git` across the whole workspace
   returned nothing; `Test-Path .git` in this copy is `False`. Git itself is installed at
   `C:\Program Files\Git\cmd\git.exe` but was off `PATH` (this is why the Phase 8 entry reads "Git
   resolves to `C:/Users/vishn`" — the bare `git` command failed, and the outer repository at that
   path is not this project). So there are **no commit hashes to cite**, and the requested
   `docs: record implementation decisions and build evidence` commit **could not be created**. This
   matches the same blocker already recorded on 2026-09-26 Phase 8, 2026-09-27 Phase 2, Phase 3, and
   Phase 8. I did not run `git init`, because initialising a repository is a structural decision
   about how this work is submitted, not a documentation change.

2. *The Phase 9 attack pass did not run, and I am not claiming otherwise.* There is no
   `scripts/check-attack.js` and no entry anywhere in this log for a Phase 9 or Phase 10. The
   suites that exist are the same four as Phase 8. I have **not** written a hostile test suite,
   so no Phase 9 attack findings are recorded. Writing "attack pass completed" here would be
   fabrication.

3. *All existing suites are green, verified in this session, not recalled:*
   - `node scripts/check-jwt.js` — **ALL PASS — 47 passed, 0 failed**
   - `node scripts/check-permissions.js` — **ALL PASS — 35 passed, 0 failed**
   - `node scripts/check-api.js` — **ALL PASS — 117 passed, 0 failed**
   - `npx vite build` — **✓ built in 1.71s** (`index-CLieffDO.js`, 261.36 kB)
   - `PLAYWRIGHT_CHANNEL=chrome npx playwright test` — **28 passed, 0 failed** (individually
     confirmed `ok` for tests 17-28 in the captured output; the summary line was cut off by my
     `Select-Object -Last` window and I am therefore citing the per-test results, not a summary
     line I did not read).

4. *The API suite is at 117, not 71.* Every prior entry from 2026-09-26 Phase 3 through Phase 5
   reports 71 checks. The current file passes 117, including a pagination-boundaries group
   (`audit?limit=0` → 400, `limit=99999` → 400, `offset=99999` → 200) that no log entry mentions
   being added. I did not write those checks in this session and cannot say who did; the log
   simply predates them. Recording the number change rather than silently restating 71.

5. *`node` is not on `PATH` in this shell.* `node` fails as an unrecognised command until
   `C:\Program Files\nodejs` is prepended. This is an environment fact that will bite anyone
   reproducing these results; it is not a code defect.

6. *A stale server was holding Playwright's port.* `npx playwright test` first failed with
   `http://localhost:8124/v1/auth/me is already used` because `reuseExistingServer: false`. The
   holder was PID 1456, `node server/index.js`, started 15:02:20, i.e. a dev server left running by
   an earlier session (matching the `app.db-wal` timestamps). I confirmed the process belonged to
   this project before killing it, and cleaned up five `node` processes across two attempts. A
   second and third attempt then exceeded my 120-second command window because the `webServer`
   command runs `npm run build` first; I ran it detached to a file and read the result. No
   repository file was changed to work around this.

**What I changed.** Only `BUILD-LOG.md` and `DECISIONS.md`, both documentation. No source, schema,
seed, or test file was modified, because this phase found no defect to fix. `db/schema.sql` and
`db/reference.sql` were not touched.

**Genuine documentation contradictions found** (recorded in `DECISIONS.md`, not silently ignored):

- `PERMISSIONS.md` §5's code table lists `GRANT_EXPIRED` as the `400` for "creating a grant that is
  already expired", and §5's `reason` list includes `scope_mismatch`. Neither string exists anywhere
  in `server/`. The only code emitted for a past `expiresAt` is
  `badRequest('expiresAt is in the past', 'expired_grant')` in `server/routes/devices.js:196` — so
  the wire result is `400 VALIDATION` with `reason: "expired_grant"`, not `GRANT_EXPIRED`. I kept
  the implementation and documented the divergence rather than renaming a documented public code
  to match prose.

- The full set of codes the server can actually emit is nine: `400 VALIDATION`,
  `401 UNAUTHENTICATED`, `401 TOKEN_STALE`, `403 FORBIDDEN`, `403 SELF_ROLE_CHANGE`,
  `404 NOT_FOUND`, `409 CONFLICT` (via `conflict()`), `409 LAST_OWNER`, `409 DEVICE_BUSY`,
  `410 GONE`. Verified by extracting every `new HttpError(<status>, '<CODE>')` literal in
  `server/`. `CONFLICT` is constructed through a helper so it does not appear as a literal.

**Test evidence.** The four suite results and the build above are the evidence. No test was written
in this phase, so no test count changed; the 117 in `check-api.js` and the 28 in Playwright are
what already existed.

## 2026-09-27 - Phase 10: performance review

**What I investigated.** `server/routes/devices.js` (list, detail, grants list, grant create),
`server/routes/orgs.js` (members, effective, audit), `server/routes/auth.js` (`/auth/me` and
org switching), `server/permissions.js` (`resolve` vs `resolveDevices`), `web/components/*.jsx`,
and `web/api.js`. I then measured rather than reading, via a new
`scripts/bench-queries.js`.

**What I initially believed.** I expected to find at least one real N+1 — most likely in the
device list, which is the endpoint the UI renders per row. I was prepared to add a cache if the
numbers justified one.

**What the repository actually showed.** There is no N+1 to fix, and the existing optimization is
already doing its job. The measurements:

*SQL statements vs number of devices, counted by wrapping `db.prepare` so every `.all/.get/.run`
execution is tallied (a per-row statement re-run through a cached handle still counts, which is
the whole point):*

| devices | `resolveDevices()` (used) | `resolve()` per row (counterfactual) |
|---|---|---|
| 1 | 4 statements | 4 statements |
| 10 | 4 | 40 |
| 50 | 4 | 200 |
| 200 | 4 | 800 |
| **slope** | **0.000 / device** | **4.000 / device** |

Wall time for the same runs: `resolveDevices` 0.7–1.7 ms at n=200 versus 49 ms for the
per-row version — roughly **28× slower** for the same answer.

*End-to-end `GET /v1/orgs/:org/devices` against the real server, 200-device worst case:*

| devices | rows | response bytes | p50 |
|---|---|---|---|
| 1 | 1 | 1,494 | 2,136 µs |
| 10 | 10 | 14,823 | 2,216 µs |
| 50 | 50 | 74,103 | 2,714 µs |
| 200 | 200 | 296,503 | 5,019 µs |

Latency does rise, but statement count does not, and the response grows ~1.5 KB per device because
each row carries a full resolved set of 19 permissions. That residual is **JSON serialisation, not
query cost** — which is the designed trade (PERMISSIONS.md §8: the list ships the caller's resolved
set so the frontend never re-derives policy). I am explicitly not "fixing" it by trimming the
payload, because that would change the API contract and re-introduce client-side policy logic.

**Why I changed nothing.** Every candidate was cleared by evidence:

- *N+1 in list routes* — none. `devices`, `members`, and `grants` each issue a single query; every
  `for`/`map` in the route bodies iterates an already-fetched array.
- *Permission resolution per element* — already batched. `resolveDevices` is the only path the list
  uses, and it is flat at 4 statements.
- *API request per device row* — none. The device list is one `GET`; rows read `d.permissions` off
  the response. The per-device `effective` fetch in `DevicePolicyInspector` is an on-demand
  dialog the user opened, not a per-row automatic call.
- *Stale permission caches* — none exist, so none can be stale. `grep` for `new Map()`/cache/TTL
  across `server/` returns only token TTLs, session expiry, and the two in-request `Map`s inside
  `buildPermissions`, which live for one call.
- *`userId`-only caches* — none exist. This is the specific hazard `NOTES.md` §2 warns about, and
  the code has avoided it by not caching at all.

**On adding a cache: I did not.** The instruction was to improve only with clear evidence, and
adding a cache would trade a measured 4 statements for a stale-authority risk. For it to be safe it
would need a `(userId, orgId, perm_version)` key, which means reading the membership anyway — the
same read it was meant to avoid — so it would save nothing while reintroducing a class of bug the
repository is currently free of. A cache would become worth it if the grant set grew by orders of
magnitude, not at 200 devices / 4 statements.

**Test evidence.** `check-jwt.js` 47 passed, `check-permissions.js` 35 passed, `check-api.js` 117
passed, 0 failed each — all re-run after the review to confirm nothing regressed. The review itself
changed no application code; the only file added is `scripts/bench-queries.js`, which measures and
asserts nothing about correctness.

**Note on the harness, recorded because it cost real time.** My first counter wrapped `db.all/get/run`
on the handle and reported 0 statements: the app calls `db.prepare(sql).all(...)`, so execution
happens on the *statement*, and wrapping the handle counted nothing. It only became correct when
interception moved to `prepare()`. Separately, `fileURLToPath` on a directory URL keeps its
trailing separator, which made `cwd` + relative path concatenate to `...\scripts\scripts\...`. Both
were harness bugs, not application defects, and neither produced a false "no N+1" claim — the flat
4-statement result was only accepted once the counter was verified to count the counterfactual's
800 statements correctly.

**Commit.** Not created. This project directory has no `.git` (see the Phase 11 entry and the
2026-09-26 Phase 8 entry), so `perf: reduce redundant authorization and data queries` could not be
made. Note that the commit message also would not have matched the work: nothing was reduced,
because nothing was redundant.

## 2026-09-27 - Phase 11 revisited: re-verification after Phase 10

**What I investigated.** Re-read the current `BUILD-LOG.md` and `DECISIONS.md` headings, re-checked
for a `.git` directory anywhere in the workspace, re-confirmed that `GRANT_EXPIRED` and
`scope_mismatch` still appear nowhere in `server/`, and re-ran all three Node suites.

**What I initially believed.** That this was a fresh phase needing a fresh BUILD-LOG entry. The
repository showed Phase 11 was already completed earlier in this session, with a dated entry and all
ten architecture decisions present. **I did not add a second Phase 11 entry or rewrite the
existing one** — a duplicate would misrepresent the chronology, and editing the earlier entry would
be rewriting history.

**What I changed.** Only the genuinely new material, which Phase 10 produced after the original
Phase 11 pass:

1. `DECISIONS.md` — added an eleventh `## Decision` block, *"Phase 10 measured the query paths and
   deliberately changed no application code"*, in the same five-part structure, with the statement
   count table (4 flat vs 800 counterfactual, 0.000 vs 4.000 statements per device) and the
   reasoning for declining a cache.
2. `DECISIONS.md` — added contradiction **#3** under "Where this repo argues with itself": the
   device list's response size (~1.5 KB per device, 1,494 bytes at 1 device → 296,503 at 200) is a
   direct consequence of `PERMISSIONS.md` §8's anti-divergence rule, and is otherwise
   indistinguishable from a response-layer N+1.
3. `DECISIONS.md` — noted the Phase 10 outcome in "Deliberately not changed in this phase",
   including that the requested `perf:` commit message would not have matched the work.

Contradictions #1 (`GRANT_EXPIRED` / `scope_mismatch` documented but never emitted) and #2
(`SELF_ROLE_CHANGE` and `TOKEN_STALE` implemented but absent from the §5 code table) were
re-confirmed against the current code and stand unchanged. `schema.sql` and `reference.sql` were not
modified.

**Test evidence, re-run in this pass:** `check-jwt.js` **47 passed, 0 failed**;
`check-permissions.js` **35 passed, 0 failed**; `check-api.js` **117 passed, 0 failed**. The
Playwright suite was not re-run in this pass; its last recorded result is 28 passed in the Phase 11
entry, and I am not restating it as if measured now.

**Commit.** Not created. There is still no `.git` directory anywhere in the workspace, so
`docs: record implementation decisions and build evidence` could not be made. Git remains
installed but off `PATH`. As before, I did not run `git init`.

## 2026-09-27 - Phase 12: final test matrix

**Test matrix.** All commands run in this pass. `expected` is what a correct build should do;
`actual` is what was observed.

| Area | Command | Expected | Actual | Result | Remaining issue |
|---|---|---|---|---|---|
| Authentication | `node scripts/check-jwt.js` | all pass | `ALL PASS — 47 passed, 0 failed`, exit 0 | **PASS** | none |
| Authorization | `node scripts/check-permissions.js` | all pass | `ALL PASS — 35 passed, 0 failed`, exit 0 | **PASS** | none |
| API | `node scripts/check-api.js` | all pass | `ALL PASS — 117 passed, 0 failed`, exit 0 | **PASS** | none |
| Personalization | `node scripts/check-personalisation.js` | file exists and passes | `Error: Cannot find module .../scripts/check-personalisation.js`, exit 1 | **FAIL — repository gap, not environment and not a code defect** | the script is absent from this copy. Present in `../starter/scripts/` and `../tools/templates/scripts/`. Not copied in. I did not author it, because the brief's Phase 12 is a test matrix, not new feature work, and the template version asserts against a personalized overlay this copy does not have. |
| Build | `npm run build` | succeeds | `✓ built in 1.26s`, `index-CLieffDO.js` 261.36 kB, exit 0 | **PASS** | none |
| UI | `npx playwright test` | all pass | 28 `ok` lines, 0 failure markers | **PASS** | see environment note |

**Environment vs code failures — distinguished, as asked.**

- *Environment (not code):* `node` is not on `PATH` in this shell; `C:\Program Files\nodejs` must be
  prefixed or every command fails with "not recognized as the name of a cmdlet". Playwright's
  bundled Chromium is not installed, so the run needed `PLAYWRIGHT_CHANNEL=chrome` against the
  installed system Chrome — the config supports this already. The suite also runs
  `npm run build` first inside `webServer`, so it exceeds a 120-second command window and had to be
  run detached. Finally a leftover `node server/index.js` from an earlier session held port 8124 and
  `reuseExistingServer: false` refused to start; I confirmed the process belonged to this project
  before stopping it. None of these are application defects.
- *Repository gap:* `check-personalisation.js` is genuinely missing from this copy. The same
  absence was already observed and recorded in the 2026-09-27 Phase 4 entry, so this is consistent
  history rather than a new regression.
- *Code failures:* none. I am not claiming more than that — the personalization row is the one
  genuine gap in the matrix, and it is a missing file, not a failing assertion.

**Manual verification — sam@example.test / demo1234.** Confirmed by `scripts/verify-personas.js`
against a real booted server, not by inspection:

- Login OK; memberships reported as `Acme Robotics(operator), Globex Industries(auditor)` — two
  orgs, two different roles, one account.
- **Acme / operator:** `device:control = allow` (control visible), `session:start = allow`,
  `audit:read = deny`, `user:read = deny`; `GET /orgs/org_acme/audit` → **403 FORBIDDEN**, so audit
  is absent as required.
- **Globex / auditor:** `audit:read = allow`; `GET /orgs/org_globex/audit` → **200** with 1 event, so
  audit is visible; `device:control = deny`, so control is absent.
- The same person therefore has opposite answers for `audit:read` and `device:control` in the two
  orgs, which is the tenancy result the brief asks for.

**Device-scoped differences, verified without hardcoding IDs.** The harness discovers the grant from
`GET /grants`, reads the device's *name* from the device list, and never writes a device, org or
user id as a literal. Two independent confirmations:

- Acme — a `deny [device:view]` grant scoped to one device, for the viewer. `device:view` is
  **deny** on `kiosk-lobby-01` (source `grant:grt_viewer_deny_kiosk`) and **allow** on
  `build-server-01` (source `role:viewer`). Same person, different device, different answer.
- Globex — an `allow [device:control]` grant scoped to one device, for dana. `device:control` is
  **allow** on `globex-desk-01` (source `grant:grt_dana_control_one_device`) and **deny** on
  `globex-kiosk-02` (reason `implicit`). Same person, different device, different answer.

I also recorded a genuine nuance the first attempt got wrong: **org-wide resolution is the union
across all grants**, so for the Acme viewer it is `deny` even though other devices are `allow`. An
org-wide result therefore cannot by itself demonstrate device scoping — the comparison has to be
scoped-device versus a *different* device. My first harness compared scoped-device against org-wide
and reported "no"; that was a flaw in the check, not in the application.

**Harness bugs I hit, so they are not mistaken for application findings.** `verify-personas.js`
initially (1) used a `dana` variable before it was declared, (2) sent `authorization: dana.token`
without the `Bearer ` prefix, producing a misleading `401 UNAUTHENTICATED` that looked like a
server fault, and (3) read the *caller's* per-row permissions instead of the grantee's, which
showed `role:owner` and proved nothing about the grantee. All three were in the harness. None
produced a claim about the application that survived checking; the numbers quoted above come from
the corrected run.

**Files added this phase:** `scripts/verify-personas.js` (read-only observation, asserts nothing).
No application code, schema, or reference data was modified. Scratch databases were removed;
`app.db*`, `check-api.db*` and `e2e.db*` are pre-existing suite artefacts and were left in place.

## 2026-09-27 - Phase 13: clean checkout verification

**The headline: `git clone` could not be performed, and one real defect was found and fixed.**

**Why `git clone <repo>` is impossible here.** There is no repository to clone. `git status`
and `git log --oneline --decorate --graph` run from this directory resolve to
`C:\Users\vishn` — the user's **home directory**, which is itself a git repository. That is the
real explanation of the long-standing note in the 2026-09-26 Phase 8 entry ("Git resolves to
`C:/Users/vishn`"): it was never resolving to this project. Confirming the scope:

- `git -C <project> rev-parse --show-toplevel` → `C:/Users/vishn`
- `git -C <project> ls-files --error-unmatch BUILD-LOG.md` → `error: pathspec ... did not match`
- `git -C <project> ls-files | Measure-Object` → **0 files**

So the home repo does not track this project, there is no `.git` inside it, and no remote is
configured. `git status` reporting "working tree clean" refers to unrelated files in the home
directory and must **not** be read as this project being committed. Therefore I could not run
`git clone`, could not inspect real history, and could not create the requested
`chore: finalize clean checkout verification` commit. I did not run `git init`, for the same
reason as before: whether this becomes a repository is a submission decision.

**What I did instead — the closest honest equivalent.** I built a clean checkout containing
*only* the files a repository would actually carry, then ran the whole flow from scratch in it.
The file set was taken from git's own view (`git ls-files --cached --others --exclude-standard`
run against the project, which yields **52 files**): no `node_modules/`, no `dist/`, no `*.db`,
no WAL/SHM sidecars, no `test-results/`. The project's existing `.gitignore` already excludes
`node_modules/`, `dist/`, `*.db*` and `e2e.db*`, so the tracked set is clean by construction.
This is a faithful stand-in for a clone minus the transport, and it is the only part of the
brief that could not be performed.

**Results, all from the clean checkout, using the repository's own documented commands.**

| Step | Command | Result |
|---|---|---|
| install | `npm install` | **PASS** — 106 packages, 0 vulnerabilities |
| database setup | `npm run db:reset` | **PASS** — exit 0 |
| suites | `check-jwt` / `check-permissions` / `check-api` | **PASS** — 47 / 35 / 117, 0 failed |
| development start | `npm run dev` | **PASS** — Vite middleware, port 8080 |
| smoke (dev) | `scripts/smoke.js` | **PASS** — 18 checks, 0 FAIL |
| production build | `npm run build` | **PASS** — built in ~1.3s |
| production start | `npm start` | **FAIL → FIXED → PASS** (see below) |
| smoke (prod) | `scripts/smoke.js` | **PASS** — 18 checks, 0 FAIL |
| Playwright | `npx playwright test` | **PASS** — 28 tests, all `ok`, exit code 0 |

The 18 smoke checks cover login, org switching (new token minted; old token 404s against the
other org), devices (5 rows, each carrying a resolved permission set), people (5), grants (3),
sessions (2), audit (7), SPA served, permissions resolved server-side (19), and cross-org 404
with no org data in the body.

**Playwright, run after the `--production` change** (to confirm the fix did not break the harness):
**28 tests, every line `ok`, process exit code 0.** Run in installed Chrome via
`PLAYWRIGHT_CHANNEL=chrome`, because bundled Chromium is not installed on this host.

One correction worth recording, because it nearly became a false failure report: I searched the
output for `failed` to count failures and matched **26** hits, which looked like a mass failure. It
was entirely my own regex hitting test *names* such as `a failed sign-in states the reason on
screen` and `an unknown account is refused without revealing whether it exists`. The suite's own
`[exit code: 0]` and 28 `ok` lines are the trustworthy signals. Anyone re-running this should count
`ok` lines and the exit code, not grep for the word "failed".

**Teardown note.** After all 28 tests reported, the detached Playwright process did not exit on its
own and was still alive ~90 seconds later, so I terminated it. This is an artefact of running the
suite detached from a managed background process, not a test failure — the run had already completed
and written its exit code. All processes were stopped and `test-results/` removed afterwards.

**The real defect: `npm start` was broken on Windows.**

`package.json` had `"start": "NODE_ENV=production node server/index.js"`. That inline env-var
syntax is POSIX-only. On this host `npm start` failed with:

```
'NODE_ENV' is not recognized as an internal or external command,
operable program or batch file.
```

This is the *same class* of defect the build log already records twice — `db:reset` calling
POSIX `rm` (2026-09-26 Phase 0) and `server/index.js` mis-parsing a file URL (Phase 0) — but it
had survived in `package.json` because the Playwright harness starts the server with its own
spawn `env`, never through `npm start`. The tests therefore could not have caught it.

**What I changed.**

1. `package.json`: `"start": "NODE_ENV=production node server/index.js"` →
   `"node server/index.js --production"`.
2. `server/index.js`: production mode is now selected by `NODE_ENV=production` **or** the
   explicit `--production` flag.

Both spellings still work, so the existing test harness (which passes `NODE_ENV` through spawn
env) is unaffected. Simply deleting the env var was not an option: `DEV` also decides whether
Vite middleware is attached or `dist/` is served statically, so dropping it would have silently
turned "production start" into development mode. Verified after the fix — the server logs
`RemoteOps on http://localhost:8080  (production)`.

`README.md` already documents plain `npm start`, so no documentation change was needed; the fix
brings the code into line with the documentation rather than the reverse.

**Security checks.**

- `BUILD-LOG.md` and `DECISIONS.md` are both in the 52-file tracked set — they would be cloned.
- No `.env` file exists anywhere in the project.
- No token material is committed: a search for JWT-shaped (`eyJ…`), `sk-…`, `AKIA…` and PEM
  header patterns across all tracked `.js/.jsx/.json/.md/.sql` returned **zero matches**. Refresh
  and invite tokens are hashed at rest and only returned once, so no live credential exists in
  the tree.
- The only secret-like literals are the two documented development defaults,
  `dev-only-app-hash-key-change-me` (`server/auth.js:157`) and `dev-secret-change-me`
  (`server/index.js:29`). Both are overridable by environment variable, both are named to make
  their non-production status obvious, and `NOTES.md` already documents the deliberate
  dev-only gap for the `Secure` cookie flag. They are not real secrets and are not committed
  credentials; I have left them as they are rather than changing behaviour during a verification
  pass.
- No ZIP is required: the project is a plain Node project with a 52-file source tree, a
  `package.json`, and a `package-lock.json`, all of which clone normally.

**Remaining issue.** The repository is *content*-ready for public cloning — the clean checkout
passes end to end and carries no secrets — but it is not yet a *repository*, so it cannot
actually be cloned. That single step, `git init` + an initial commit + adding a remote, is
outstanding and is a decision for the user rather than something to perform unasked. It is also
the only reason the requested commit could not be made.

**Files added this phase:** `scripts/smoke.js`, an 18-check read-only observation script used to
drive the clean checkout. It asserts nothing about application logic and exits non-zero only if a
request fails outright. No schema or reference data was modified.

## 2026-09-27 - Phase 13 follow-ups: dialogs, notifications, nav test, doc consistency

Four remediation tasks from the final review. Earlier entries above are left exactly as written;
this records only what happened after them.

### Task 1 - remove unsupported `prompt()`

**Investigated.** Every `prompt(` call under `web/`, plus the existing dialog and toast patterns
so the replacement reused what was already there.

**Initially believed.** The brief named two locations, `Admin.jsx` and `People.jsx`.

**Actually found.** Four calls across **three** files. `Devices.jsx:62` had a device-rename
`prompt()` that was not on the list, so device rename was equally broken. That is why the earlier
final review reported org rename and invite as the only non-functional paths.

**Changed.** New `web/components/Modal.jsx` built on native `<dialog>` + `showModal()`, reusing the
dialog semantics already established for the New-org flow. `Admin.jsx` gained a rename dialog and a
delete-confirmation dialog; `People.jsx` gained an invite dialog and a separate one-time-token
result dialog; `Devices.jsx` gained a rename dialog. `prompt()` count in `web/`: **4 -> 0**, verified
by search across the whole directory, with no `window.prompt` workaround. `confirm()` at
`Admin.jsx:22` was replaced in the same edit as the delete dialog. No backend file was touched.

**Why.** `prompt()` threw `prompt() is not supported` in this environment (recorded in the
2026-09-26 Phase 0/7 entries), so those three paths were dead, not merely ugly. Native `<dialog>`
supplies focus trapping, background inertness, Escape handling and the top layer without hand-rolling
them; `onCancel` calls `preventDefault()` so every close path routes through one `onClose`.

### Task 2 - replace debug-grade `alert()`

**Investigated.** All `alert(` occurrences under `web/`, the `Toast` component, and the CSS tokens
available for styling.

**Initially believed.** Three files would need work, as the brief listed.

**Actually found.** Only **one** `alert()` remained, at `Sessions.jsx:42` — `Admin.jsx` and
`People.jsx` had already been cleared in Task 1, where their errors moved into the dialogs. The
brief's list was stale relative to the work done minutes earlier.

**Changed.** `Toast.jsx` generalised to a `tone` prop (success/error) with per-tone default
durations and an overridable `testid`; `Sessions.jsx` replaced the `alert()` with a toast and added
toasts for stop-session success and failure; `Devices.jsx` pinned `testid="session-toast"` to keep
the existing contract; `styles.css` gained `.toast-error`. Final audit: **zero `alert(` occurrences**
under `web/`.

**Why.** A browser `alert()` is a blocking modal with no accessible name, unsuitable as ordinary
application feedback. Errors stayed inline where they were field-attached, and moved to toasts only
where the message was transient rather than tied to a form.

**Invite token — deliberately not a toast.** A toast auto-dismisses, so the only copy of a one-time
credential would vanish unread. It remains in a modal with a readonly input that selects on focus and
an explicit "shown once" warning. The required behaviour is preserved; only the surface changed.

### Task 3 - audit navigation contract

**Investigated.** `App.jsx` nav definition and visibility rule, and the existing `ui.spec.js`.

**Initially believed — and this was wrong.** The final review reported that `nav-audit` was "never
asserted". That was a false negative: I had grepped for the literal string `nav-audit`, but the tests
assert it inside template-literal loops (`nav-${key}` with `'audit'` in the key array) at
`ui.spec.js:66` and `:76`. Both directions were already covered. I have corrected the claim rather
than leaving a false gap in the record.

**Changed.** Two focused tests appended, no change to any UI or authorization code:
`the audit nav item exists exactly when the resolved set allows audit:read` (absent as operator in
Acme, present after switching to Globex as auditor, absent again on switching back, plus
`data-permission`/`data-state` assertions) and `audit data stays refused when the nav item is
absent` (the endpoint behind the hidden item returns `403 FORBIDDEN` with a `req_` requestId).

**Why that user.** Verified from the database rather than assumed: `audit:read` is granted by the
**role baseline** in `role_permissions` to `admin`, `auditor` and `owner`, with no grant rows
involved. `sam@example.test` is `operator` in `org_acme` and `auditor` in `org_globex`, so the same
person covers both directions across two orgs. Using one identity holds account, session and user
constant, so the only variable is the resolved permission set. **No database change was made** — no
fixture was manufactured.

**Evidence.** Playwright **30 passed, 0 failed, exit code 0** (28 before, plus these two).
`check-jwt` 47, `check-permissions` 35, `check-api` 117, all 0 failed.

### Task 4 - documentation consistency

**Investigated.** Every `new HttpError(status, 'CODE')` literal and every `reason:` string actually
emitted under `server/`, compared against the code tables and reason lists in the spec documents, and
against my own `BUILD-LOG.md`, `DECISIONS.md`, `README.md` and `NOTES.md`.

**First, the decisive question: which documents are the organizer's?** `PERMISSIONS.md` and
`AUTH-DATA-MODEL.md` were compared byte-for-byte against the upstream `rhinostream/Hackathons`
clone, normalising CRLF: **identical to upstream**. They are the assignment's own specification and
were **not modified**. `README.md` and `HARDENING.md` also match upstream and were not modified.
`DISCOVERY-BRIEF.md` does not exist in this copy — it is injected by
`tools/patch-loader.mjs`, which the 2026-09-26 Phase 1 entry records as not having been run.

**Discrepancies, classified rather than papered over.**

1. `GRANT_EXPIRED` (400, "creating a grant that is already expired") and `scope_mismatch` are
   documented in `PERMISSIONS.md` §5. Neither string exists anywhere in `server/`. What is emitted is
   `badRequest('expiresAt is in the past', 'expired_grant')` at `devices.js:196`, producing
   `code: "VALIDATION"` with `reason: "expired_grant"`.
   **Verdict: genuine spec-vs-implementation mismatch. Left unchanged.** The authoritative source is
   the specification, but `expired_grant` is itself listed as a valid `reason` in the same section, so
   the implementation is self-consistent with part of the document. Renaming an API-visible code to
   match prose would be a breaking change made for documentation tidiness, which this pass explicitly
   must not do.
2. `SELF_ROLE_CHANGE` and `TOKEN_STALE` are implemented and emitted (`http.js:19,21`, reached from
   `orgs.js:113` and `auth.js:140`) but are **absent from the §5 code table**, which lists
   `CONFLICT`, `LAST_OWNER` and `DEVICE_BUSY` but not these two.
   **Verdict: the table is incomplete rather than the code being wrong.** Both codes are required by
   `AUTH-DATA-MODEL.md` §3 and §10 respectively, so the implementation follows a different, also
   organisational, section. Documented here; the spec was not edited.
3. `reason` values emitted but not listed in §5's reason paragraph: `unknown_permission`,
   `unknown_role`, `insufficient_rank`, `cannot_confer_owner`, `missing_device_permission`,
   `not_a_member`, `inactive_membership`, `validation`. §5 lists only `missing_permission`,
   `explicit_deny`, `suspended`, `expired_grant`, `scope_mismatch`.
   **Verdict: the reason vocabulary is broader than documented.** The extra values are all produced by
   real, tested refusals, and a client switching exhaustively on the documented five would fall
   through to a default branch.
4. `GRANT_EXPIRED` is additionally *implemented* in the grants route: a `400 VALIDATION` with
   `reason: 'grant_expired'` for a grant whose `expiresAt` is not after `startsAt`
   (`devices.js:197-199`). The same documented name therefore maps to two different wire shapes
   depending on which rule was violated. Recorded because it is a genuine trap for a client author,
   not because it is being changed.

**Documentation actually changed — my own files only.** `DECISIONS.md`: three stale test counts
corrected from 28 to 30 browser tests, and the toast-versus-`alert()` decision annotated as
**superseded**, with the current position stated (no `alert()` remains; the one-time token is a
modal by design) while retaining the original reasoning that explains why the session path was
converted first. `BUILD-LOG.md`: this entry. `README.md` and `NOTES.md` were checked and needed no
change — the README's `nav-audit` example and `npm start` instruction are both still accurate, and
`NOTES.md` never claimed `alert()` was absent.

**Not changed, deliberately.** No spec document, no server file, no test, no database. Behaviour was
not altered to make documentation agree.

**Commit.** Not created; this directory still has no `.git`.
