// Phase 13 clean-checkout smoke test.
//
// Exercises every surface the clean-checkout verification asks for against a server
// started with the repository's own documented commands, and prints one line per
// check so the result is observable rather than silently asserted.
//
// The checkout under test may live outside the project directory, so the target is
// supplied via BASE. Nothing is read from outside that server.

const base = process.env.BASE ?? 'http://localhost:8080';
const rows = [];
const rec = (area, name, status, detail = '') => rows.push({ area, name, status, detail });

async function req(method, path, { token, body } = {}) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a non-JSON body is itself a finding */ }
  return { status: r.status, json, text };
}

// --- login -------------------------------------------------------------------
const dana = await req('POST', '/v1/auth/login', {
  body: { email: 'dana@example.test', password: 'demo1234' },
});
rec('login', 'dana@example.test / demo1234', dana.status === 200 ? 'PASS' : 'FAIL', `status=${dana.status}`);
if (dana.status !== 200) {
  for (const r of rows) console.log(`  ${r.status.padEnd(5)} ${r.area} / ${r.name}`);
  process.exit(1);
}
rec('login', 'access token issued', dana.json.token ? 'PASS' : 'FAIL');

const acme = dana.json.orgs.find((o) => o.role === 'owner');
const globex = dana.json.orgs.find((o) => o.role === 'viewer');
rec('login', 'two org memberships returned', dana.json.orgs.length === 2 ? 'PASS' : 'FAIL',
  dana.json.orgs.map((o) => `${o.name}(${o.role})`).join(', '));

// --- org switching -----------------------------------------------------------
const sw = await req('POST', '/v1/auth/token', { token: dana.json.token, body: { orgId: globex.id } });
rec('org switching', 'POST /auth/token switches org', sw.status === 200 ? 'PASS' : 'FAIL', `status=${sw.status}`);
rec('org switching', 'switching mints a NEW token (not re-scoped)',
  sw.json?.token && sw.json.token !== dana.json.token ? 'PASS' : 'FAIL');

const staleUse = await req('GET', `/v1/orgs/${globex.id}/devices`, { token: dana.json.token });
rec('org switching', 'old org token cannot address the new org (404)',
  staleUse.status === 404 ? 'PASS' : 'FAIL', `status=${staleUse.status}`);

// --- surfaces ----------------------------------------------------------------
const T = dana.json.token;
for (const [area, path, key] of [
  ['devices', `/v1/orgs/${acme.id}/devices`, 'devices'],
  ['people', `/v1/orgs/${acme.id}/members`, 'members'],
  ['grants', `/v1/orgs/${acme.id}/grants`, 'grants'],
  ['sessions', `/v1/orgs/${acme.id}/sessions`, 'sessions'],
  ['audit', `/v1/orgs/${acme.id}/audit`, 'events'],
]) {
  const r = await req('GET', path, { token: T });
  rec(area, `GET /${area}`, r.status === 200 ? 'PASS' : 'FAIL',
    `rows=${r.json?.[key]?.length ?? 'n/a'}`);
}
const devRows = (await req('GET', `/v1/orgs/${acme.id}/devices`, { token: T })).json?.devices ?? [];
rec('devices', 'each row carries its resolved permission set',
  devRows.length > 0 && !!devRows[0].permissions ? 'PASS' : 'FAIL');

// --- UI ----------------------------------------------------------------------
const spa = await req('GET', '/');
rec('UI', 'server serves the SPA shell',
  spa.status === 200 && /<div id="root"|<script/i.test(spa.text) ? 'PASS' : 'FAIL',
  `status=${spa.status}`);

const me = await req('GET', '/v1/auth/me', { token: T });
const perms = me.json?.permissions ?? {};
rec('UI', 'UI permissions are resolved server-side', Object.keys(perms).length > 0 ? 'PASS' : 'FAIL',
  `${Object.keys(perms).length} resolved`);
rec('UI', 'owner sees device:control', perms['device:control']?.effect === 'allow' ? 'PASS' : 'FAIL',
  `device:control=${perms['device:control']?.effect}`);

// --- tenancy -----------------------------------------------------------------
const crossOrg = await req('GET', '/v1/orgs/org_globex/devices', { token: T });
rec('tenancy', 'acme token addressing globex -> 404', crossOrg.status === 404 ? 'PASS' : 'FAIL',
  `status=${crossOrg.status}`);
rec('tenancy', '404 body leaks no org data',
  !JSON.stringify(crossOrg.json ?? {}).toLowerCase().includes('globex') ? 'PASS' : 'FAIL');

// --- personalized fixture ----------------------------------------------------
const eff = await req('GET', `/v1/orgs/${acme.id}/users/${dana.json.user.id}/effective`, { token: T });
rec('personalized fixture', 'per-user effective permissions resolve',
  eff.status === 200 && Object.keys(eff.json?.permissions ?? {}).length > 0 ? 'PASS' : 'FAIL',
  `status=${eff.status} permissions=${Object.keys(eff.json?.permissions ?? {}).length}`);

console.log('');
let last = '';
for (const r of rows) {
  if (r.area !== last) { console.log(`\n== ${r.area} ==`); last = r.area; }
  console.log(`  ${r.status.padEnd(5)} ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
}
const failed = rows.filter((r) => r.status === 'FAIL');
console.log(`\n${rows.length} checks, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
