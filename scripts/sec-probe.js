// TASK 5 security regression probe — READ ONLY.
//
// This does not assert the whole contract and it does not modify anything. It probes the
// specific items in the Task 5 checklist that the existing suites do not obviously assert,
// and prints the OBSERVED status/reason for each so the report rests on evidence rather
// than on reading code.
//
// Against a throwaway database. The application is started unmodified.

import { spawn, execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID } from 'node:crypto';

const HERE = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const DB = 'secprobe.db';
const PORT = 8141;
const SECRET = 'secprobe-secret';

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
const sign = (claims, secret = SECRET) => {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(claims));
  return `${h}.${p}.${b64(createHmac('sha256', secret).update(`${h}.${p}`).digest())}`;
};

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body: json };
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: 'demo1234' } })).body;

const rows = [];
const rec = (area, name, observed, expect) =>
  rows.push({ area, name, observed, expect, verdict: observed === expect ? 'MATCHES CONTRACT' : '*** DIVERGES ***' });

const now = Math.floor(Date.now() / 1000);
const dana = await login('dana@example.test');
const sam = await login('sam@example.test');

// ---------------------------------------------------------------- AUTHENTICATION
{
  const base = { iss: 'remoteops', aud: 'remoteops-api', sub: dana.user.id, org: 'org_acme',
                 role: 'owner', pv: 0, jti: randomUUID(), iat: now, exp: now + 300 };

  const noJti = { ...base, jti: undefined };
  const r1 = await call('GET', '/auth/me', { token: sign(noJti) });
  rec('auth', 'missing jti rejected', `${r1.status} ${r1.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  const badIss = await call('GET', '/auth/me', { token: sign({ ...base, iss: 'evil' }) });
  rec('auth', 'wrong issuer rejected', `${badIss.status} ${badIss.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  const badAud = await call('GET', '/auth/me', { token: sign({ ...base, aud: 'other-api' }) });
  rec('auth', 'wrong audience rejected', `${badAud.status} ${badAud.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  const expNow = await call('GET', '/auth/me', { token: sign({ ...base, exp: now }) });
  rec('auth', 'exp == now rejected (<=, not <)', `${expNow.status} ${expNow.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  const expired = await call('GET', '/auth/me', { token: sign({ ...base, exp: now - 10 }) });
  rec('auth', 'expired token rejected', `${expired.status} ${expired.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // alg:none -- unsigned token with a valid-looking payload
  const h = b64(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const p = b64(JSON.stringify(base));
  const algNone = await call('GET', '/auth/me', { token: `${h}.${p}.` });
  rec('auth', 'alg:none rejected', `${algNone.status} ${algNone.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // wrong signature: same claims, different key
  const wrongSig = await call('GET', '/auth/me', { token: sign(base, 'a-different-secret') });
  rec('auth', 'wrong signature rejected', `${wrongSig.status} ${wrongSig.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // garbage
  const garbage = await call('GET', '/auth/me', { token: 'not-a-jwt' });
  rec('auth', 'malformed token rejected', `${garbage.status} ${garbage.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');

  // refresh/access separation: an ACCESS token must not work as a refresh credential
  const asRefresh = await call('POST', '/auth/refresh', { token: dana.token });
  rec('auth', 'access token rejected by /auth/refresh', `${asRefresh.status} ${asRefresh.body?.error?.code ?? ''}`, '401 UNAUTHENTICATED');
}

// ------------------------------------------------------- STALE PERMISSION VERSION
{
  const stale = sign({ iss: 'remoteops', aud: 'remoteops-api', sub: dana.user.id, org: 'org_acme',
                       role: 'owner', pv: 999, jti: randomUUID(), iat: now, exp: now + 300 });
  const r = await call('GET', '/orgs/org_acme/devices', { token: stale });
  rec('auth', 'stale permission version -> TOKEN_STALE', `${r.status} ${r.body?.error?.code ?? ''}`, '401 TOKEN_STALE');
}

// ----------------------------------------------------------------------- TENANCY
{
  // Acme token reaching a Globex resource
  const r1 = await call('GET', '/orgs/org_globex/devices', { token: dana.token });
  rec('tenancy', 'Acme token -> Globex org', `${r1.status} ${r1.body?.error?.code ?? ''}`, '404 NOT_FOUND');

  // Acme device id submitted under Globex
  const acmeDevice = (await call('GET', '/orgs/org_acme/devices', { token: dana.token })).body.devices[0];
  const r2 = await call('POST', '/orgs/org_globex/sessions',
    { token: (await (await fetch(`${BASE}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${dana.token}` }, body: JSON.stringify({ orgId: 'org_globex' }) })).json()).token,
      body: { deviceId: acmeDevice.id, mode: 'view' } });
  rec('tenancy', 'Acme device id used under Globex', `${r2.status} ${r2.body?.error?.code ?? ''}`, '404 NOT_FOUND');

  // does the 404 body leak anything about the other org?
  const leak = JSON.stringify(r1.body ?? {}).toLowerCase();
  rec('tenancy', 'cross-org 404 leaks no org data', String(leak.includes('globex')), 'false');
}

// --------------------------------------------- SAME USER, DIFFERENT ROLE PER ORG
{
  const globexTok = (await (await fetch(`${BASE}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${dana.token}` }, body: JSON.stringify({ orgId: 'org_globex' }) })).json()).token;
  const inAcme = (await call('GET', '/auth/me', { token: dana.token })).body;
  const inGlobex = (await call('GET', '/auth/me', { token: globexTok })).body;
  rec('tenancy', 'same user, role differs per org', `${inAcme.role} vs ${inGlobex.role}`, 'owner vs viewer');
  rec('tenancy', 'permissions differ per org (audit:read)',
    `${inAcme.permissions['audit:read'].effect} vs ${inGlobex.permissions['audit:read'].effect}`, 'allow vs deny');
}

// ----------------------------------------------------------------- SESSION MODES
// The compound rule: session:start AND the permission for the requested mode.
{
  // Sam is auditor in Globex: no session:start at all.
  const globexSam = (await (await fetch(`${BASE}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${sam.token}` }, body: JSON.stringify({ orgId: 'org_globex' }) })).json()).token;
  for (const mode of ['view', 'control', 'terminal']) {
    const dev = (await call('GET', '/orgs/org_globex/devices', { token: globexSam })).body.devices[0];
    const r = await call('POST', '/orgs/org_globex/sessions', { token: globexSam, body: { deviceId: dev.id, mode } });
    rec('session-mode', `${mode} needs session:start (no holder)`, `${r.status} ${r.body?.error?.reason ?? ''}`, '403 missing_permission');
  }
}

// ------------------------------------------------------------- EXCLUSIVITY + TTL
{
  // Pick a device that holds NO active session, so the first control request can legitimately
  // succeed. The seed ships an active control session on dev_build_server_01; taking
  // devices[0] made the FIRST request 409 too, which read as a contract failure when it was
  // really the exclusivity rule working correctly.
  const all = (await call('GET', '/orgs/org_acme/devices', { token: dana.token })).body.devices;
  const busy = (await call('GET', '/orgs/org_acme/sessions', { token: dana.token })).body.sessions
    .filter((s) => s.state === 'active')
    .map((s) => s.device_id);
  const dev = all.find((d) => !busy.includes(d.id));
  rec('session', 'a free device exists to test exclusivity', String(Boolean(dev)), 'true');

  // view is not exclusive: two view sessions on one device are both allowed.
  const v1 = await call('POST', '/orgs/org_acme/sessions', { token: dana.token, body: { deviceId: dev.id, mode: 'view' } });
  const v2 = await call('POST', '/orgs/org_acme/sessions', { token: dana.token, body: { deviceId: dev.id, mode: 'view' } });
  rec('session', 'two view sessions on one device allowed', `${v1.status}/${v2.status}`, '201/201');

  // control IS exclusive: first succeeds, second is refused as DEVICE_BUSY.
  const c1 = await call('POST', '/orgs/org_acme/sessions', { token: dana.token, body: { deviceId: dev.id, mode: 'control' } });
  const c2 = await call('POST', '/orgs/org_acme/sessions', { token: dana.token, body: { deviceId: dev.id, mode: 'control' } });
  rec('session', 'second exclusive session -> DEVICE_BUSY', `${c1.status}/${c2.status} ${c2.body?.error?.code ?? ''}`, '201/409 DEVICE_BUSY');

  // a control session on one device must not block a DIFFERENT device
  const other = all.find((d) => d.id !== dev.id && !busy.includes(d.id));
  if (other) {
    const c3 = await call('POST', '/orgs/org_acme/sessions', { token: dana.token, body: { deviceId: other.id, mode: 'control' } });
    rec('session', 'exclusive lock is per-device, not org-wide', String(c3.status), '201');
  }
}

// ------------------------------------------------------------------- AUDIT TRIGGERS
{
  const Database = (await import('better-sqlite3')).default;
  // Relative, not absolute: the child loader writes DATABASE_FILE relative to its own
  // cwd, so an absolute path here would open a different (empty) file.
  const db = new Database(DB);
  let upd = 'DID NOT FAIL', del = 'DID NOT FAIL';
  try { db.prepare('UPDATE audit_events SET result = ? WHERE id = (SELECT id FROM audit_events LIMIT 1)').run('deny'); }
  catch (e) { upd = 'ABORTED'; }
  try { db.prepare('DELETE FROM audit_events WHERE id = (SELECT id FROM audit_events LIMIT 1)').run(); }
  catch (e) { del = 'ABORTED'; }
  const total = db.prepare('SELECT count(*) AS n FROM audit_events').get().n;
  db.close();
  rec('audit', 'UPDATE on audit row is aborted', upd, 'ABORTED');
  rec('audit', 'DELETE on audit row is aborted', del, 'ABORTED');
  rec('audit', 'audit rows still present after both attempts', String(total > 0), 'true');
}

// ---------------------------------------------------------------------- REPORT
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
