// End-to-end API check. Spawns the server against a throwaway database, drives the real
// HTTP contract, and asserts on behaviour rather than on implementation.
//
//   node scripts/check-api.js
//
// This is the seed of the public test suite. It is deliberately dependency-free so it
// can run before Playwright is installed.

import { spawn, execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { openDatabase } from '../server/db.js';

const PORT = 8123;
const BASE = `http://localhost:${PORT}/v1`;
const DB = 'check-api.db';

for (const s of ['', '-wal', '-shm']) if (existsSync(DB + s)) rmSync(DB + s);
execFileSync(process.execPath, ['scripts/load-db.js'], { env: { ...process.env, DATABASE_FILE: DB }, stdio: 'ignore' });

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_FILE: DB, PORT: String(PORT), NODE_ENV: 'production', JWT_SECRET: 'test-secret' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

await new Promise((r) => setTimeout(r, 1200));

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(56)}${ok ? '' : ` got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
};

async function call(method, path, { token, body, cookie } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;

  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json, raw: text, setCookie: res.headers.get('set-cookie') };
}

const login = (email, orgId, password = 'demo1234') =>
  call('POST', '/auth/login', { body: { email, password, ...(orgId ? { orgId } : {}) } });

// ---------------------------------------------------------------------------
console.log('\n== auth and org scoping ==');
const dana = await login('dana@example.test');
check('dana logs in', dana.status, 200);
check('dana is owner in Acme', dana.body.role, 'owner');
check('dana sees both orgs', dana.body.orgs.map((o) => o.name).sort(), ['Acme Robotics', 'Globex Industries']);
check('org themes differ', new Set(dana.body.orgs.map((o) => o.theme)).size, 2);

const danaAcme = dana.body.token;
const badPassword = await call('POST', '/auth/login', { body: { email: 'dana@example.test', password: 'wrong' } });
check('bad password rejected', badPassword.status, 401);
check('bad password error envelope has requestId', typeof badPassword.body.error.requestId === 'string', true);
check('bad password response does not echo credentials', JSON.stringify(badPassword.body).includes('wrong'), false);
const missingCredentials = await call('GET', '/orgs/org_acme/devices');
check('no token -> 401', missingCredentials.status, 401);
check('no-token error envelope', Object.keys(missingCredentials.body.error).sort(), ['code', 'message', 'reason', 'requestId']);
check('no-token requestId present', /^req_/.test(missingCredentials.body.error.requestId), true);
check('access token is not a refresh credential',
  (await call('POST', '/auth/refresh', { cookie: `rt=${danaAcme}` })).status, 401);

const originalRefreshCookie = dana.setCookie?.split(';')[0];
const rotatedRefresh = await call('POST', '/auth/refresh', { cookie: originalRefreshCookie });
check('refresh token rotates', rotatedRefresh.status, 200);
check('replayed refresh token rejected',
  (await call('POST', '/auth/refresh', { cookie: originalRefreshCookie })).status, 401);
const rotatedCookie = rotatedRefresh.setCookie?.split(';')[0];
check('replay revokes refresh family',
  (await call('POST', '/auth/refresh', { cookie: rotatedCookie })).status, 401);

console.log('\n== §6 cross-org is INVISIBLE, not forbidden ==');
const xorg = await call('GET', '/orgs/org_globex/devices', { token: danaAcme });
check('Acme token against Globex -> 404', xorg.status, 404);
check('  ...code is NOT_FOUND', xorg.body.error.code, 'NOT_FOUND');
check('  ...body carries no org data', JSON.stringify(xorg.body).includes('globex-desk'), false);
check('wrong-org 404 has requestId', /^req_/.test(xorg.body.error.requestId), true);
check('wrong-org error is generic', xorg.body.error.message.includes('globex'), false);

console.log('\n== §7.4 same login, different role per org ==');
const sw = await call('POST', '/auth/token', { token: danaAcme, body: { orgId: 'org_globex' } });
check('switch to Globex', sw.status, 200);
check('  ...role is viewer there', sw.body.role, 'viewer');
const danaGlobex = sw.body.token;
const globexOwner = (await login('owner@globex.test', 'org_globex')).body.token;
const crossOrgGrant = await call('POST', '/orgs/org_globex/grants', {
  token: globexOwner,
  body: { userId: 'usr_sam', deviceId: 'dev_lab_mac_01', effect: 'allow', permissions: ['device:control'] },
});
check('Acme device id is invisible to Globex grant', crossOrgGrant.status, 404);

const globexDevices = await call('GET', '/orgs/org_globex/devices', { token: danaGlobex });
const byName = Object.fromEntries(globexDevices.body.devices.map((d) => [d.name, d.permissions]));
check('D6 grant unlocks control on ONE device', byName['globex-desk-01']['device:control'].effect, 'allow');
check('  ...and stays locked on the other', byName['globex-kiosk-02']['device:control'].effect, 'deny');
check('  ...provenance names the grant', byName['globex-desk-01']['device:control'].source.startsWith('grant:'), true);

const startGrant = await call('POST', '/orgs/org_globex/grants', {
  token: globexOwner,
  body: { userId: 'usr_dana', deviceId: 'dev_globex_desk_01', effect: 'allow', permissions: ['session:start'] },
});
check('session-start grant created for revocation test', startGrant.status, 201);
const danaGlobexLogin = await login('dana@example.test', 'org_globex');
const danaGlobexCookie = danaGlobexLogin.setCookie?.split(';')[0];
const grantSession = await call('POST', '/orgs/org_globex/sessions', {
  token: danaGlobexLogin.body.token,
  body: { deviceId: 'dev_globex_desk_01', mode: 'control' },
});
check('device grant authorizes initial control session', grantSession.status, 201);
check('grant revoke succeeds',
  (await call('DELETE', `/orgs/org_globex/grants/${startGrant.body.id}`, { token: globexOwner })).status, 204);
const grandfathered = await call('GET', `/sessions/${grantSession.body.id}`, { token: globexOwner });
check('grant revoke leaves active session grandfathered', grandfathered.body.state, 'active');
const staleAfterRevoke = await call('POST', '/orgs/org_globex/sessions', {
  token: danaGlobexLogin.body.token,
  body: { deviceId: 'dev_globex_desk_01', mode: 'control' },
});
check('grant revoke makes old token stale', staleAfterRevoke.body.error.code, 'TOKEN_STALE');
const refreshedDana = await call('POST', '/auth/refresh', { cookie: danaGlobexCookie });
const danaFreshGlobex = await call('POST', '/auth/token', {
  token: refreshedDana.body.token, body: { orgId: 'org_globex' },
});
check('refreshed user cannot start after grant revoke',
  (await call('POST', '/orgs/org_globex/sessions', {
    token: danaFreshGlobex.body.token,
    body: { deviceId: 'dev_globex_desk_01', mode: 'control' },
  })).status, 403);

console.log('\n== §3 auditor/operator are NOT ordered (D2) ==');
const samAcme = (await login('sam@example.test')).body.token;
const samGlobex = (await call('POST', '/auth/token', { token: samAcme, body: { orgId: 'org_globex' } })).body.token;
console.log('\n== effective permissions for the policy inspector ==');
const samEffective = await call('GET', '/orgs/org_acme/users/usr_sam/effective?deviceId=dev_lab_mac_01', { token: danaAcme });
check('device-scoped inspection succeeds', samEffective.status, 200);
check('  ...returns the selected device', samEffective.body.deviceId, 'dev_lab_mac_01');
check('  ...shows the operator baseline provenance', samEffective.body.permissions['device:control'].source, 'role:operator');
check('member may inspect their own policy', (await call('GET', '/orgs/org_acme/users/usr_sam/effective', { token: samAcme })).status, 200);
check('member cannot inspect someone else without user:read', (await call('GET', '/orgs/org_acme/users/usr_dana/effective', { token: samAcme })).status, 403);
check('Acme(operator)  GET /audit  -> 403', (await call('GET', '/orgs/org_acme/audit', { token: samAcme })).status, 403);
check('Globex(auditor) GET /audit  -> 200', (await call('GET', '/orgs/org_globex/audit', { token: samGlobex })).status, 200);
check('Acme(operator)  control session -> 201', (await call('POST', '/orgs/org_acme/sessions', { token: samAcme, body: { deviceId: 'dev_lab_win_01', mode: 'control' } })).status, 201);
const modeDenied = await call('POST', '/orgs/org_globex/sessions', { token: samGlobex, body: { deviceId: 'dev_globex_desk_01', mode: 'control' } });
check('Globex(auditor) control session -> 403', modeDenied.status, 403);
check('permission denial envelope has requestId', /^req_/.test(modeDenied.body.error.requestId), true);

console.log('\n== §2 device:list gates the endpoint, device:view gates ROW INCLUSION ==');
const viewer = (await login('viewer@acme.test')).body.token;
const vDevices = await call('GET', '/orgs/org_acme/devices', { token: viewer });
const vNames = vDevices.body.devices.map((d) => d.name);
check('kiosk-lobby-01 is ABSENT (not redacted)', vNames.includes('kiosk-lobby-01'), false);
check('the others are present', vNames.length, 4);

console.log('\n== §9 compound session check, two distinct reasons ==');
const s1 = await call('POST', '/orgs/org_acme/sessions', { token: viewer, body: { deviceId: 'dev_lab_mac_01', mode: 'view' } });
check('viewer CAN view lab-mac-01 (grant)', s1.status, 201);
const s2 = await call('POST', '/orgs/org_acme/sessions', { token: viewer, body: { deviceId: 'dev_qa_android_01', mode: 'view' } });
check('...but not qa-android-01', s2.status, 403);
check('  ...reason: missing session:start', s2.body.error.reason, 'missing_permission');
const s3 = await call('POST', '/orgs/org_acme/sessions', { token: viewer, body: { deviceId: 'dev_lab_mac_01', mode: 'control' } });
check('  ...and control fails differently', s3.body.error.reason, 'missing_device_permission');

console.log('\n== D10 exclusive sessions; view is deliberately not ==');
const dup = await call('POST', '/orgs/org_acme/sessions', { token: samAcme, body: { deviceId: 'dev_lab_win_01', mode: 'control' } });
check('2nd control on same device -> 409', dup.status, 409);
check('  ...code DEVICE_BUSY', dup.body.error.code, 'DEVICE_BUSY');
const v1 = await call('POST', '/orgs/org_acme/sessions', { token: samAcme, body: { deviceId: 'dev_lab_win_01', mode: 'view' } });
check('concurrent VIEW on same device -> 201', v1.status, 201);

const raceDevice = await call('POST', '/orgs/org_acme/devices', {
  token: danaAcme, body: { name: 'exclusive-race-device', kind: 'linux' },
});
const exclusiveRace = await Promise.all([
  call('POST', '/orgs/org_acme/sessions', { token: danaAcme, body: { deviceId: raceDevice.body.id, mode: 'control' } }),
  call('POST', '/orgs/org_acme/sessions', { token: danaAcme, body: { deviceId: raceDevice.body.id, mode: 'terminal' } }),
]);
check('concurrent exclusive starts yield one winner', exclusiveRace.map((r) => r.status).sort((a, b) => a - b), [201, 409]);
const exclusiveWinner = exclusiveRace.find((r) => r.status === 201);
const ttlDb = openDatabase(DB);
ttlDb.prepare('UPDATE sessions SET expires_at=? WHERE id=?')
  .run(new Date(Date.now() - 1000).toISOString(), exclusiveWinner.body.id);
ttlDb.close();
await call('GET', '/orgs/org_acme/sessions', { token: danaAcme });
const expiredSession = await call('GET', `/sessions/${exclusiveWinner.body.id}`, { token: danaAcme });
check('expired session is swept on read', expiredSession.body.state, 'ended');
check('expired session reason', expiredSession.body.end_reason, 'session_expired');
const transferSession = await call('POST', '/orgs/org_acme/sessions', {
  token: danaAcme, body: { deviceId: raceDevice.body.id, mode: 'view' },
});

console.log('\n== §7.1 GRANDFATHERING: permission change does not kill a session ==');
const active = (await call('GET', '/orgs/org_acme/sessions', { token: samAcme })).body.sessions
  .filter((s) => s.state === 'active' && s.mode === 'control' && s.device_id === 'dev_lab_win_01');
const heldId = active[0].id;
const demote = await call('PATCH', '/orgs/org_acme/members/usr_sam', { token: danaAcme, body: { role: 'viewer' } });
check('owner demotes Sam to viewer', demote.status, 200);
const stillThere = await call('GET', `/sessions/${heldId}`, { token: danaAcme });
check('  ...the live session SURVIVES', stillThere.body.state, 'active');
check('  ...end_reason is still null', stillThere.body.end_reason, null);
check('  ...but a NEW session is now blocked (for Sam)', (await call('POST', '/orgs/org_acme/sessions', { token: samAcme, body: { deviceId: 'dev_lab_mac_01', mode: 'control' } })).status, 401);
check('  ...Sam\'s stale token -> 401 TOKEN_STALE', (await call('GET', '/orgs/org_acme/devices', { token: samAcme })).body.error.code, 'TOKEN_STALE');

console.log('\n== §7.2 suspension DOES cascade (account integrity, not a permission tweak) ==');
// Sam still OWNS the control session created above. Suspend Sam, not the viewer.
await call('POST', '/orgs/org_acme/members/usr_sam/suspend', { token: danaAcme });
const afterSuspend = await call('GET', `/sessions/${heldId}`, { token: danaAcme });
check('suspended user\'s session ended', afterSuspend.body.state, 'ended');
check('  ...end_reason user_suspended', afterSuspend.body.end_reason, 'user_suspended');
check('reinstate restores access', (await call('DELETE', '/orgs/org_acme/members/usr_sam/suspend', { token: danaAcme })).status, 200);

console.log('\n== D8 modification authority ==');
check('no self role change', (await call('PATCH', '/orgs/org_acme/members/usr_dana', { token: danaAcme, body: { role: 'admin' } })).body.error.code, 'SELF_ROLE_CHANGE');
// Acme has two owners, so demoting one is legitimate. The LAST_OWNER guard needs an org
// with exactly one owner — a freshly created org has exactly one, its creator.
const fresh = await call('POST', '/orgs', { token: danaAcme, body: { name: 'Solo Org' } });
check('create org makes the creator sole owner', fresh.body.role, 'owner');
// D18: the Acme-scoped token cannot address the new org AT ALL. This 404s before any
// permission check runs, which is the structural isolation guarantee, not a filter.
check('D18 Acme token cannot address the new org', (await call('DELETE', `/orgs/${fresh.body.id}/members/me`, { token: danaAcme })).status, 404);
const freshTok = (await call('POST', '/auth/token', { token: danaAcme, body: { orgId: fresh.body.id } })).body.token;
check('sole owner cannot leave (LAST_OWNER)', (await call('DELETE', `/orgs/${fresh.body.id}/members/me`, { token: freshTok })).body.error.code, 'LAST_OWNER');
check('sole owner cannot be removed',
  (await call('DELETE', `/orgs/${fresh.body.id}/members/usr_dana`, { token: freshTok })).body.error.code, 'LAST_OWNER');

const transfer = await call('POST', `/orgs/org_acme/devices/${raceDevice.body.id}/transfer`, {
  token: danaAcme, body: { targetOrgId: fresh.body.id },
});
check('device transfer succeeds with authority in both orgs', transfer.status, 200);
const transferredSession = await call('GET', `/sessions/${transferSession.body.id}`, { token: danaAcme });
check('device transfer ends its active session', transferredSession.body.state, 'ended');
check('device transfer session reason', transferredSession.body.end_reason, 'device_transferred');

check('demoting a NON-last owner is allowed', (await call('PATCH', '/orgs/org_acme/members/usr_acme_owner', { token: danaAcme, body: { role: 'viewer' } })).status, 200);
const adminTok = (await login('admin@acme.test')).body.token;
check('admin cannot confer owner', (await call('PATCH', '/orgs/org_acme/members/usr_acme_viewer', { token: adminTok, body: { role: 'owner' } })).body.error.code, 'FORBIDDEN');
check('owner can promote active member to admin',
  (await call('PATCH', '/orgs/org_acme/members/usr_acme_viewer', { token: danaAcme, body: { role: 'admin' } })).status, 200);
const equalRole = await call('PATCH', '/orgs/org_acme/members/usr_acme_viewer', { token: adminTok, body: { role: 'viewer' } });
check('equal-rank administrator cannot modify peer', equalRole.status, 403);
check('equal-rank failure is specific', equalRole.body.error.reason, 'insufficient_rank');
const launderedGrant = await call('POST', '/orgs/org_acme/grants', {
  token: adminTok,
  body: { userId: 'usr_acme_owner', effect: 'allow', permissions: ['org:delete'] },
});
check('admin cannot launder org:delete authority', launderedGrant.status, 403);

console.log('\n== D19 unknown permission is rejected ==');
const badGrant = await call('POST', '/orgs/org_acme/grants', { token: danaAcme, body: { userId: 'usr_acme_viewer', effect: 'allow', permissions: ['device:teleport'] } });
check('device:teleport -> 400', badGrant.status, 400);
check('  ...reason unknown_permission', badGrant.body.error.reason, 'unknown_permission');
const emptyGrant = await call('POST', '/orgs/org_acme/grants', { token: danaAcme, body: { userId: 'usr_acme_viewer', effect: 'allow', permissions: [] } });
check('empty permissions -> 400', emptyGrant.status, 400);
check('self-grant forbidden (D9)', (await call('POST', '/orgs/org_acme/grants', { token: danaAcme, body: { userId: 'usr_dana', effect: 'allow', permissions: ['audit:read'] } })).body.error.code, 'FORBIDDEN');

console.log('\n== removed membership ends sessions and invalidates access ==');
const currentViewer = await login('viewer@acme.test');
const removalSession = await call('POST', '/orgs/org_acme/sessions', {
  token: currentViewer.body.token, body: { deviceId: 'dev_lab_mac_01', mode: 'view' },
});
check('viewer session started before removal', removalSession.status, 201);
check('membership removal succeeds',
  (await call('DELETE', '/orgs/org_acme/members/usr_acme_viewer', { token: danaAcme })).status, 204);
const removedSession = await call('GET', `/sessions/${removalSession.body.id}`, { token: danaAcme });
check('removed member session ends', removedSession.body.state, 'ended');
check('removed member session reason', removedSession.body.end_reason, 'membership_removed');
check('removed member token is rejected',
  (await call('GET', '/orgs/org_acme/devices', { token: currentViewer.body.token })).status, 401);

console.log('\n== invites: single-use, hashed, no data leak ==');
const inv = await call('POST', '/orgs/org_acme/invites', { token: danaAcme, body: { email: 'newbie@example.test', role: 'operator' } });
check('invite created', inv.status, 201);
check('duplicate live invite -> 409',
  (await call('POST', '/orgs/org_acme/invites', { token: danaAcme, body: { email: 'newbie@example.test', role: 'operator' } })).status, 409);
check('raw token returned once', typeof inv.body.inviteToken === 'string' && inv.body.inviteToken.length > 20, true);
const rawToken = inv.body.inviteToken;

const peek = await call('GET', `/invites/${rawToken}`);
check('public peek works', peek.status, 200);
check('  ...shows org name', peek.body.orgName, 'Acme Robotics');
check('  ...leaks NO devices', JSON.stringify(peek.body).includes('lab-mac'), false);
check('  ...leaks NO org id', JSON.stringify(peek.body).includes('org_acme'), false);
check('unknown token -> 404', (await call('GET', '/invites/not-a-real-token-at-all-xxxx')).status, 404);

const accept = await call('POST', `/invites/${rawToken}/accept`, { body: { name: 'New Bie', password: 'hunter2hunter2' } });
check('accept succeeds', accept.status, 200);
check('  ...role is the invited role', accept.body.role, 'operator');
check('reuse -> 409', (await call('POST', `/invites/${rawToken}/accept`, { body: { name: 'X', password: 'hunter2hunter2' } })).status, 409);
check('new user can log in', (await login('newbie@example.test', null, 'hunter2hunter2')).status, 200);
check('  ...and cannot log in with the seed password', (await login('newbie@example.test')).status, 401);

const concurrentInvite = await call('POST', '/orgs/org_acme/invites', {
  token: danaAcme, body: { email: 'concurrent-accept@example.test', role: 'operator' },
});
const concurrentAccepts = await Promise.all([
  call('POST', `/invites/${concurrentInvite.body.inviteToken}/accept`, { body: { name: 'Race One', password: 'password-one' } }),
  call('POST', `/invites/${concurrentInvite.body.inviteToken}/accept`, { body: { name: 'Race Two', password: 'password-two' } }),
]);
check('concurrent invite accepts have one winner',
  concurrentAccepts.map((r) => r.status).sort((a, b) => a - b), [200, 409]);

const expiringInvite = await call('POST', '/orgs/org_acme/invites', {
  token: danaAcme,
  body: { email: 'expired-invite@example.test', role: 'operator' },
});
check('expired-invite scenario created', expiringInvite.status, 201);
const testDb = openDatabase(DB);
testDb.prepare('UPDATE invites SET expires_at=? WHERE id=?')
  .run(new Date(Date.now() - 1000).toISOString(), expiringInvite.body.id);
testDb.close();
check('expired invite lookup -> 410',
  (await call('GET', `/invites/${expiringInvite.body.inviteToken}`)).status, 410);
check('expired invite email can be reinvited',
  (await call('POST', '/orgs/org_acme/invites', {
    token: danaAcme,
    body: { email: 'expired-invite@example.test', role: 'operator' },
  })).status, 201);

const existingUserInvite = await call('POST', '/orgs/org_acme/invites', {
  token: danaAcme,
  body: { email: 'owner@globex.test', role: 'operator' },
});
check('existing-user invite scenario created', existingUserInvite.status, 201);
const expiryDb = openDatabase(DB);
expiryDb.prepare('UPDATE invites SET expires_at=? WHERE id=?')
  .run(new Date(Date.now() - 1000).toISOString(), existingUserInvite.body.id);
expiryDb.close();
check('existing-user expired invite email can be reinvited',
  (await call('POST', '/orgs/org_acme/invites', {
    token: danaAcme,
    body: { email: 'owner@globex.test', role: 'operator' },
  })).status, 201);

const revokedInvite = await call('POST', '/orgs/org_acme/invites', {
  token: danaAcme,
  body: { email: 'revoked-invite@example.test', role: 'operator' },
});
check('revoked-invite scenario created', revokedInvite.status, 201);
check('invite revoke succeeds',
  (await call('DELETE', `/orgs/org_acme/invites/${revokedInvite.body.id}`, { token: danaAcme })).status, 204);
check('revoked invite lookup -> 410',
  (await call('GET', `/invites/${revokedInvite.body.inviteToken}`)).status, 410);

console.log('\n== audit records DENIED attempts too ==');
const audit = await call('GET', '/orgs/org_acme/audit?limit=200', { token: danaAcme });
check('audit readable by owner', audit.status, 200);
check('  ...contains denials', audit.body.events.some((e) => e.result === 'deny'), true);
check('  ...denial carries a reason code', audit.body.events.some((e) => e.result === 'deny' && e.reason_code), true);

const auditDb = openDatabase(DB);
const auditId = auditDb.prepare('SELECT id FROM audit_events WHERE org_id=? LIMIT 1').get('org_acme')?.id;
let auditUpdateRejected = false;
let auditDeleteRejected = false;
try { auditDb.prepare('UPDATE audit_events SET action=? WHERE id=?').run('tampered', auditId); } catch { auditUpdateRejected = true; }
try { auditDb.prepare('DELETE FROM audit_events WHERE id=?').run(auditId); } catch { auditDeleteRejected = true; }
check('audit update blocked by schema trigger', auditUpdateRejected, true);
check('audit delete blocked by schema trigger', auditDeleteRejected, true);
auditDb.close();

console.log('\n== pagination boundaries are defined, not clamped ==');
for (const [q, expected] of [['limit=0', 400], ['limit=-1', 400], ['limit=99999', 400], ['offset=-1', 400], ['offset=99999', 200], ['limit=1', 200]]) {
  check(`audit?${q} -> ${expected}`, (await call('GET', `/orgs/org_acme/audit?${q}`, { token: danaAcme })).status, expected);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
server.kill();
process.exit(fail === 0 ? 0 : 1);
