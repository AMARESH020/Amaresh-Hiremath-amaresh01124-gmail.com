// Phase 12 manual verification harness.
//
// The brief asks for manual verification of two personas across two orgs, including
// "verify device-scoped differences without hardcoding IDs". This checks the same
// facts through the API so the result is reproducible, and it deliberately NEVER
// hardcodes a device id: devices are located by name from the API response, and
// device-scoped grants are read from /grants to find WHICH device differs.
//
// It asserts nothing about code correctness (the suites do that). It reports what the
// running server actually returns, so the claims in the test matrix are observed.

import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const DB = 'manual.db';
const PORT = 8137;

for (const s of ['', '-wal', '-shm']) if (existsSync(HERE + DB + s)) rmSync(HERE + DB + s);

const { execFileSync } = await import('node:child_process');
execFileSync(process.execPath, ['scripts/load-db.js'], {
  cwd: HERE, env: { ...process.env, DATABASE_FILE: DB }, stdio: 'ignore',
});

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: HERE,
  env: { ...process.env, DATABASE_FILE: DB, PORT: String(PORT), JWT_SECRET: 'manual-secret', NODE_ENV: 'production' },
  stdio: 'ignore',
});
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 80; i += 1) {
  try { await fetch(`${base}/v1/auth/me`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

async function login(email) {
  const r = await fetch(`${base}/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234' }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return r.json();
}
const get = async (path, token) => {
  const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const out = [];
const say = (s) => { out.push(s); console.log(s); };

try {
  // ---- sam: operator in Acme, auditor in Globex ----
  const sam = await login('sam@example.test');
  say(`sam logins OK; orgs = ${sam.orgs.map((o) => `${o.name}(${o.role})`).join(', ')}`);

  const samAcmeTok = (await (await fetch(`${base}/v1/auth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${sam.token}` },
    body: JSON.stringify({ orgId: sam.orgs.find((o) => o.role === 'operator').id }),
  })).json()).token;

  const samGlobexTok = (await (await fetch(`${base}/v1/auth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${sam.token}` },
    body: JSON.stringify({ orgId: sam.orgs.find((o) => o.role === 'auditor').id }),
  })).json()).token;

  // ---- ACME / operator ----
  const acmeMe = await get('/v1/auth/me', samAcmeTok);
  say(`\n[ACME / operator] role=${acmeMe.body.role}`);
  const P = acmeMe.body.permissions;
  say(`  device:control = ${P['device:control'].effect}  (expect allow)`);
  say(`  audit:read     = ${P['audit:read'].effect}  (expect deny -> nav card absent)`);
  say(`  session:start  = ${P['session:start'].effect}`);
  say(`  user:read      = ${P['user:read'].effect}  (expect deny)`);

  const acmeAudit = await get('/v1/orgs/org_acme/audit', samAcmeTok);
  say(`  GET /orgs/org_acme/audit -> ${acmeAudit.status} ${acmeAudit.body?.error?.code ?? ''} (expect 403, audit absent)`);

  // ---- GLOBEX / auditor ----
  const globexMe = await get('/v1/auth/me', samGlobexTok);
  say(`\n[GLOBEX / auditor] role=${globexMe.body.role}`);
  const G = globexMe.body.permissions;
  say(`  audit:read     = ${G['audit:read'].effect}  (expect allow)`);
  say(`  device:control = ${G['device:control'].effect}  (expect deny -> control absent)`);

  const globexAudit = await get('/v1/orgs/org_globex/audit', samGlobexTok);
  say(`  GET /orgs/org_globex/audit -> ${globexAudit.status} events=${globexAudit.body?.events?.length ?? 'n/a'} (expect 200, audit visible)`);

  // ---- dana: owner in Acme, viewer in Globex — the cross-org contrast ----
  // Declared here because the device-scope check below reads grants as dana (who
  // holds user:read in Acme).
  const dana = await login('dana@example.test');

  // Discover the device-scoped grant from the data: list orgs' grants as a caller
  // with user:read, pick a grant that names a device, then find that device's NAME
  // from the list endpoint. No device id, org id or user id is written down here.
  for (const org of dana.orgs) {
    // The token is org-scoped, so reading another org's grants needs a token for it.
    const mint = await (await fetch(`${base}/v1/auth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${dana.token}` },
      body: JSON.stringify({ orgId: org.id }),
    })).json();
    const orgTok = mint.token;
    if (!orgTok) { say(`\n[device-scope] ${org.name}: could not mint a token for this org: ${JSON.stringify(mint)}`); continue; }

    const g = await get(`/v1/orgs/${org.id}/grants`, orgTok);
    if (g.status !== 200) {
      say(`\n[device-scope] ${org.name}: grants -> ${g.status} ${g.body?.error?.code ?? ''} ${g.body?.error?.reason ?? ''}`);
      continue;
    }
    const scoped = (g.body.grants ?? []).filter((x) => x.device_id);
    if (!scoped.length) { say(`\n[device-scope] ${org.name}: no device-scoped grants`); continue; }

    for (const grant of scoped) {
      const members = await get(`/v1/orgs/${org.id}/members`, orgTok);
      const grantee = (members.body.members ?? []).find((m) => m.id === grant.user_id);
      if (!grantee) continue;

      const key = grant.permissions[0];
      // Names come from the list endpoint. NO device id is written down in this file.
      const list = await get(`/v1/orgs/${org.id}/devices`, orgTok);
      const devices = list.body.devices ?? [];
      const scopedName = devices.find((d) => d.id === grant.device_id)?.name
        ?? '(scoped device not visible to the inspecting owner)';
      const otherName = devices.find((d) => d.id !== grant.device_id)?.name
        ?? '(no second device visible)';
      const otherId = devices.find((d) => d.id !== grant.device_id)?.id;

      const look = async (deviceId) => {
        const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
        const r = await get(`/v1/orgs/${org.id}/users/${grantee.id}/effective${q}`, orgTok);
        return r.status === 200 ? r.body.permissions[key] : { effect: `HTTP ${r.status}` };
      };

      const orgWide = await look(null);
      const onScoped = await look(grant.device_id);
      const onOther = otherId ? await look(otherId) : { effect: 'n/a' };

      say(`\n[device-scope] ${org.name}`);
      say(`  grant: ${grant.effect} [${grant.permissions}] scoped to ONE device, for ${grantee.name} (${grantee.role})`);
      say(`  scoped device (by name): ${scopedName}   a different device: ${otherName}`);
      say(`  ${key} org-wide (union of all grants)  = ${orgWide.effect}  [${orgWide.source ?? orgWide.reason}]`);
      say(`  ${key} on ${scopedName} = ${onScoped.effect}  [${onScoped.source ?? onScoped.reason}]`);
      say(`  ${key} on ${otherName}      = ${onOther.effect}  [${onOther.source ?? onOther.reason}]`);
      say(`  -> device scoping proven: ${onScoped.effect !== onOther.effect
        ? `YES — '${key}' differs between the two devices for the SAME person`
        : 'NOT demonstrated by this grant'}`);
      break; // one worked example per org is enough to demonstrate the mechanism
    }
  }

  // ---- dana's Globex view: the cross-org contrast ----
  const danaGlobex = (await (await fetch(`${base}/v1/auth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${dana.token}` },
    body: JSON.stringify({ orgId: dana.orgs.find((o) => o.role === 'viewer').id }),
  })).json()).token;
  const dv = await get('/v1/orgs/org_globex/devices', danaGlobex);
  const names = (dv.body.devices ?? []).map((d) => d.name);
  say(`\n[GLOBEX / viewer (dana)] visible devices = ${names.length} -> ${names.join(', ')}`);
  say('  (row exclusion, not redaction: devices without device:view are absent entirely)');
} finally {
  child.kill();
  for (const s of ['', '-wal', '-shm']) if (existsSync(HERE + DB + s)) rmSync(HERE + DB + s);
}
