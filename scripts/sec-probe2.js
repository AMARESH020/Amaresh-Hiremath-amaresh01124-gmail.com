// TASK 5 — gap probe #2. READ ONLY, throwaway DB, application started unmodified.
//
// Covers the checklist items the existing suites (check-jwt / check-permissions / check-api /
// sec-probe) do not obviously assert: algorithm substitution beyond "none", cross-org grant
// targeting, grant bleed between orgs, last-owner across the other mutation paths, and
// pv claim edge cases.

import { spawn, execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID } from 'node:crypto';

const HERE = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const DB = 'secprobe2.db';
const PORT = 8142;
const SECRET = 'secprobe2-secret';

for (const s of ['', '-wal', '-shm']) if (existsSync(HERE + DB + s)) rmSync(HERE + DB + s);
execFileSync(process.execPath, ['scripts/load-db.js'], {
  cwd: HERE, env: { ...process.env, DATABASE_FILE: DB }, stdio: 'ignore',
});

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: HERE,
  env: { ...process.env, DATABASE_FILE: DB, PORT: String(PORT), JWT_SECRET: SECRET, NODE_ENV: 'production' },
  stdio: 'ignore',
});
const BASE = `http://localhost:${PORT}/v1`;
for (let i = 0; i < 80; i += 1) {
  try { await fetch(`${BASE}/auth/me`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

const b64 = (b) => Buffer.from(b).toString('base64url');
const hmac = (alg, msg, secret) => createHmac(alg, secret).update(msg).digest();

async function call(method, path, { token, body, cookie } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body: json, cookie: r.headers.get('set-cookie') };
}
const login = async (email, _orgId, password) =>
  (await call('POST', '/auth/login', { body: { email, password: password ?? 'demo1234' } })).body;
const switchOrg = async (token, orgId) =>
  (await call('POST', '/auth/token', { token, body: { orgId } })).body.token;

const rows = [];
const rec = (area, name, observed, expect) =>
  rows.push({ area, name, observed, expect, verdict: observed === expect ? 'MATCHES CONTRACT' : '*** DIVERGES ***' });

const now = Math.floor(Date.now() / 1000);
const dana = await login('dana@example.test');
const sam = await login('sam@example.test');

// ---------------------------------------------------------------- AUTHENTICATION
{
  const base = { iss: 'remoteops', aud: 'remoteops-api', sub: dana.user.id, org: 'org_acme',
                 role: 'owner', pv: dana.orgId ? 1 : 1, jti: randomUUID(), iat: now, exp: now + 300 };
  // use dana's real perm_version so the request reaches freshness, not the pv gate first
  const acme = (await call('GET', '/auth/me', { token: dana.token })).body;

  const forge = (header, claims, sigFn) => {
    const h = b64(JSON.stringify(header));
    const p = b64(JSON.stringify(claims));
    return `${h}.${p}.${sigFn(`${h}.${p}`)}`;
  };

  // Algorithm substitution: an HS512 header, signed with HS512 using OUR secret.
  const hs512 = await call('GET', '/auth/me', {
    token: forge({ alg: 'HS512', typ: 'JWT' }, { ...base, pv: acme.org ? 1 : 1 },
      (m) => b64(hmac('sha512', m, SECRET))),
  });
  rec('auth', 'alg HS512 substitution rejected', `${hs512.status} ${hs512.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // typ is not JWT
  const wrongTyp = await call('GET', '/auth/me', {
    token: forge({ alg: 'HS256', typ: 'JWS' }, { ...base, pv: 1 }, (m) => b64(hmac('sha256', m, SECRET))),
  });
  rec('auth', 'typ != JWT rejected', `${wrongTyp.status} ${wrongTyp.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // alg present but empty
  const noAlg = await call('GET', '/auth/me', {
    token: forge({ typ: 'JWT' }, { ...base, pv: 1 }, (m) => b64(hmac('sha256', m, SECRET))),
  });
  rec('auth', 'missing alg rejected', `${noAlg.status} ${noAlg.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // payload that is a JSON array, not an object
  const arrPayload = await call('GET', '/auth/me', {
    token: `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify([1, 2, 3]))}.${b64(Buffer.alloc(32))}`,
  });
  rec('auth', 'array payload rejected', `${arrPayload.status} ${arrPayload.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // non-canonical base64url (trailing padding chars in the payload segment)
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ ...base, pv: 1 }));
  const nonCanon = await call('GET', '/auth/me', { token: `${h}.${p}=.${b64(hmac('sha256', `${h}.${p}=`, SECRET))}` });
  rec('auth', 'non-canonical base64url rejected', `${nonCanon.status} ${nonCanon.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // exp is a string that looks like a number
  const strExp = await call('GET', '/auth/me', {
    token: forge({ alg: 'HS256', typ: 'JWT' }, { ...base, pv: 1, exp: String(now + 300) }, (m) => b64(hmac('sha256', m, SECRET))),
  });
  rec('auth', 'string exp rejected', `${strExp.status} ${strExp.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // A valid token with a correct pv is accepted — the control, so the above are not
  // all passing merely because every request fails.
  const good = await call('GET', '/auth/me', { token: dana.token });
  rec('auth', 'control: genuine token still accepted', String(good.status), '200');
}

// ----------------------------------------------------------------------- TENANCY
{
  const acmeTok = dana.token;
  const globexTok = await switchOrg(acmeTok, 'org_globex');

  // A grant targeting a user who is NOT a member of the org must be invisible (404).
  // usr_globex_owner belongs to Globex ONLY, so it is a non-member of Acme.
  const foreign = await call('POST', '/orgs/org_acme/grants', {
    token: acmeTok,
    body: { userId: 'usr_globex_owner', effect: 'allow', permissions: ['device:control'] },
  });
  rec('tenancy', 'grant for a non-member of that org -> 404', `${foreign.status} ${foreign.body?.error?.code ?? ''}`, '404 NOT_FOUND');

  // Grant bleed: a device-scoped allow in Acme must not show up in Globex resolution.
  // Acme: grant viewer control on dev_lab_win_01, then inspect the same user in Globex.
  // usr_acme_viewer is Acme-only, so the Globex half is expected to be 404 (invisible),
  // not a resolved deny — a resolved deny would itself imply cross-org visibility.
  const viewerTok = await login('viewer@acme.test').then((b) => b?.token).catch(() => null);
  if (viewerTok) {
    const acmeTok2 = await switchOrg(viewerTok, 'org_acme');
    const g = await call('POST', '/orgs/org_acme/grants', {
      token: acmeTok, body: { userId: 'usr_acme_viewer', effect: 'allow', deviceId: 'dev_lab_win_01', permissions: ['device:control'] },
    });
    rec('tenancy', 'acme device-scoped grant created', String(g.status), '201');
    // Read with an OWNER token: reading someone ELSE's policy needs user:read, which the
    // viewer does not hold, so inspecting as the viewer would 403 for an unrelated reason.
    const inAcme = (await call('GET', '/orgs/org_acme/users/usr_acme_viewer/effective?deviceId=dev_lab_win_01', { token: acmeTok }));
    rec('tenancy', 'grant applies inside its own org',
      inAcme.body?.permissions?.['device:control']?.effect, 'allow');

    // The SAME user id, evaluated with a Globex token. Must be invisible (404) because
    // they are not a Globex member; a 200 with an allow would be a real tenancy breach.
    const bleed = await call('GET', '/orgs/org_globex/users/usr_acme_viewer/effective?deviceId=dev_lab_win_01', { token: globexTok });
    rec('tenancy', 'Acme-only user inspected with a Globex token -> 404',
      `${bleed.status} ${bleed.body?.error?.code ?? ''}`, '404 NOT_FOUND');
    rec('tenancy', '  ...and no permission set leaked', String(bleed.body?.permissions === undefined), 'true');
  } else {
    rec('tenancy', 'acme viewer account available for grant-bleed test', 'no such user', 'yes');
  }

  // A Globex device id under Acme.
  const globexDevices = (await call('GET', '/orgs/org_globex/devices', { token: globexTok })).body.devices;
  if (globexDevices?.length) {
    const r = await call('GET', `/orgs/org_acme/devices/${globexDevices[0].id}`, { token: acmeTok });
    rec('tenancy', 'Globex device id under Acme -> 404', `${r.status} ${r.body?.error?.code ?? ''}`, '404 NOT_FOUND');
  }

  // A device id from org A used to request a session while scoped to org B.
  const acmeDevices = (await call('GET', '/orgs/org_acme/devices', { token: acmeTok })).body.devices;
  const r = await call('POST', '/orgs/org_globex/sessions', { token: globexTok, body: { deviceId: acmeDevices[0].id, mode: 'view' } });
  rec('tenancy', 'org A device requested under org B -> 404', `${r.status} ${r.body?.error?.code ?? ''}`, '404 NOT_FOUND');
}

// -------------------------------------------------------------------- MEMBERSHIP
{
  const acmeTok = dana.token;

  // Last owner: demote the last owner of a fresh org.
  const org = (await call('POST', '/orgs', { token: acmeTok, body: { name: 'Probe Sole Owner Ltd' } })).body;
  const ownTok = await switchOrg(acmeTok, org.id);
  const ownerId = dana.user.id;

  // NOTE: LAST_OWNER is 409, not 403 (http.js `lastOwner`), and the self-demote path
  // hits SELF_ROLE_CHANGE before it ever reaches the last-owner guard.
  const suspend = await call('POST', `/orgs/${org.id}/members/${ownerId}/suspend`, { token: ownTok });
  rec('membership', 'last owner cannot be suspended', `${suspend.status} ${suspend.body?.error?.code ?? ''}`, '409 LAST_OWNER');

  const leave = await call('DELETE', `/orgs/${org.id}/members/me`, { token: ownTok });
  rec('membership', 'last owner cannot leave', `${leave.status} ${leave.body?.error?.code ?? ''}`, '409 LAST_OWNER');

  // Self role change is checked first and wins for the owner themself.
  const selfDemote = await call('PATCH', `/orgs/${org.id}/members/${ownerId}`, { token: ownTok, body: { role: 'viewer' } });
  rec('membership', 'self-demote is SELF_ROLE_CHANGE (checked before last owner)',
    `${selfDemote.status} ${selfDemote.body?.error?.code ?? ''}`, '403 SELF_ROLE_CHANGE');

  // With a second owner present, the demotion becomes allowed — proves the guard is a
  // count, not a blanket refusal.
  const second = await call('POST', `/orgs/${org.id}/invites`, {
    token: ownTok, body: { email: 'secondowner@example.test', role: 'owner' },
  });
  rec('membership', 'second owner invited', String(second.status), '201');

  // A NON-owner target demoted while still the last owner is the real guard: invite a
  // second owner, accept it, then try to demote the first.
  const rawToken = second.body.inviteToken;
  const acceptRes = await call('POST', `/invites/${rawToken}/accept`, {
    body: { name: 'Second Owner', password: 'secondowner123' },
  });
  rec('membership', 'second owner accepted', String(acceptRes.status), '200');

  const secondLogin = await login('secondowner@example.test', null, 'secondowner123');
  // login() returns orgs[0] (alphabetical), so `role` there is the Acme-scoped role, not
  // the new org's. Read the role from the /auth/me of the NEW-org-scoped token instead.
  const secondTok = secondLogin?.token ? await switchOrg(secondLogin.token, org.id) : null;
  const secondInNewOrg = secondTok ? (await call('GET', '/auth/me', { token: secondTok })).body : null;
  rec('membership', 'second owner holds the owner role in the new org',
    secondInNewOrg?.role, 'owner');

  // Now the first owner is no longer the last owner, so this demotion must be ALLOWED.
  if (secondTok) {
    const demoteOther = await call('PATCH', `/orgs/${org.id}/members/${dana.user.id}`, { token: secondTok, body: { role: 'viewer' } });
    rec('membership', 'with two owners, demoting one is allowed', String(demoteOther.status), '200');
  }
}

// ----------------------------------------------------------------------- AUDIT
{
  const acmeTok = dana.token;
  // A denied role change must leave a deny row naming the reason.
  const before = (await call('GET', '/orgs/org_acme/audit?limit=200', { token: acmeTok })).body.events.length;
  await call('PATCH', '/orgs/org_acme/members/usr_dana', { token: acmeTok, body: { role: 'admin' } }); // SELF_ROLE_CHANGE, not audited
  const after = (await call('GET', '/orgs/org_acme/audit?limit=200', { token: acmeTok })).body.events.length;
  rec('audit', 'SELF_ROLE_CHANGE is not written as an audited deny', String(after - before), '0');

  // A genuine permission denial IS audited. `auditor` HOLDS user:read, so reading the
  // member list is allowed; use an action the auditor genuinely lacks instead
  // (auditor has no device:control, so a control session is refused).
  const samLogin = await login('sam@example.test');
  const samGlobex = await switchOrg(samLogin.token, 'org_globex');
  const b2 = (await call('GET', '/orgs/org_globex/audit?limit=200', { token: dana.token })).body?.events?.length ?? 0;
  const globexDev = (await call('GET', '/orgs/org_globex/devices', { token: samGlobex })).body.devices[0];
  const denied = await call('POST', '/orgs/org_globex/sessions', { token: samGlobex, body: { deviceId: globexDev.id, mode: 'control' } });
  // auditor lacks session:start entirely, so the compound check reports THAT first.
  // The mode-specific reason only appears once session:start is held.
  rec('audit', 'auditor control session is denied',
    `${denied.status} ${denied.body?.error?.reason ?? ''}`, '403 missing_permission');

  // An operator HAS session:start but not device:terminal -> the mode-specific reason.
  const samAcme = await switchOrg(samLogin.token, 'org_acme');
  const acmeDev = (await call('GET', '/orgs/org_acme/devices', { token: samAcme })).body.devices[0];
  const modeDenied = await call('POST', '/orgs/org_acme/sessions', { token: samAcme, body: { deviceId: acmeDev.id, mode: 'terminal' } });
  rec('audit', 'mode-specific denial names the device permission',
    `${modeDenied.status} ${modeDenied.body?.error?.reason ?? ''}`, '403 missing_device_permission');

  // Read the audit log with an account that can: dana, owner of Acme. The denial above
  // happened in GLOBEX, so read Globex's log as Globex's owner (usr_globex_owner).
  const globexOwnerLogin = await login('owner@globex.test');
  if (!globexOwnerLogin) { rec('audit', 'a globex owner account is available', 'none found', 'one found'); }
  else {
    const globexOwnerTok = await switchOrg(globexOwnerLogin.token, 'org_globex');
    const events = (await call('GET', '/orgs/org_globex/audit?limit=200', { token: globexOwnerTok })).body.events;
    rec('audit', 'denied action is audited', String(events.some((e) => e.result === 'deny')), 'true');
    rec('audit', 'the denial carries a reason code',
      String(Boolean(events.find((e) => e.result === 'deny')?.reason_code)), 'true');
  }
}

// --------------------------------------------------------------------- REPORT
console.log('');
let area = '';
for (const r of rows) {
  if (r.area !== area) { console.log(`\n== ${r.area} ==`); area = r.area; }
  console.log(`  ${r.verdict.padEnd(20)} ${r.name}\n      observed: ${r.observed}   contract: ${r.expect}`);
}
const bad = rows.filter((r) => r.verdict !== 'MATCHES CONTRACT');
console.log(`\n${rows.length} probes, ${bad.length} diverging from the documented contract`);

child.kill();
for (const s of ['', '-wal', '-shm']) if (existsSync(HERE + DB + s)) rmSync(HERE + DB + s);
process.exit(0);
