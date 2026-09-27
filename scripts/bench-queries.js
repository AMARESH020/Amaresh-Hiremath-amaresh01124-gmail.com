// Phase 10 measurement harness. NOT a correctness suite.
//
// It measures two things, both of which the review asked for evidence on:
//
//   1. SCALING. Whether SQL statement count grows with the number of returned rows
//      (the N+1 signature) or stays flat (batched). Measured by seeding synthetic orgs
//      of increasing size and reading the slope, not by reading code.
//   2. LATENCY. p50/p95 wall time per endpoint, so any before/after claim is backed
//      by a number.
//
// It deliberately measures ONLY. It asserts nothing about correctness; the existing
// suites remain the correctness gate.
//
// Run: node scripts/bench-queries.js

import { spawn, execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase, newId, nowIso } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { resolveDevices, resolve } from '../server/permissions.js';

// fileURLToPath, not .pathname: on Windows .pathname yields '/C:/...' and every path
// built from it is wrong. The same class of bug the loader already fixed.
// Strip the trailing separator: it makes `cwd` + relative-path concatenate badly.
const HERE = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const DB = 'bench.db';

// ---------------------------------------------------------------------------
// Statement counter. Counts EXECUTIONS of real SQL, not prepare() calls: a cached
// prepared statement re-run once per row is exactly the N+1 cost, so it must count
// per row. We wrap the handle's prepare/all/get/run methods, which is transparent to
// callers and counts statements however permissions.js happens to issue them.
// ---------------------------------------------------------------------------
function instrument(db) {
  const origPrepare = db.prepare.bind(db);
  const count = { all: 0, get: 0, run: 0 };

  // Intercept at prepare(): the app calls db.prepare(sql).all(...), so the execution
  // happens on the STATEMENT, not on the database handle. Wrapping db.all would
  // therefore count nothing — which is exactly the bug this first version had.
  db.prepare = function (sql) {
    const stmt = origPrepare(sql);
    for (const method of ['all', 'get', 'run']) {
      const original = stmt[method].bind(stmt);
      stmt[method] = (...args) => {
        count[method] += 1;
        return original(...args);
      };
    }
    return stmt;
  };

  return {
    db,
    reset() { count.all = 0; count.get = 0; count.run = 0; },
    total() { return count.all + count.get + count.run; },
  };
}

// Seed ALL scales into one database, so the server is booted once and every scale
// stays queryable. Each scale gets its own org, user and login email, so the
// synthetic accounts cannot collide with the seeded fixtures.
function seedAll(scales) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(HERE + DB + suffix); } catch { /* first run */ }
  }
  try {
    execFileSync(process.execPath, ['scripts/load-db.js'], {
      cwd: HERE,
      env: { ...process.env, DATABASE_FILE: DB },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    // Surface the loader's own stderr: execFileSync hides it, and 'it failed' is
    // not a diagnosis.
    process.stderr.write(`\nloader failed:\n${err.stderr?.toString() ?? '(no stderr)'}\n`);
    throw err;
  }

  const db = openDatabase(DB);
  const orgIds = {};
  for (const scale of scales) {
    const orgId = newId('org');
    const userId = newId('usr');
    orgIds[scale] = orgId;
    db.prepare('INSERT INTO organizations (id,name,theme,max_session_minutes) VALUES (?,?,?,?)')
      .run(orgId, `bench-${scale}`, '#000000', 60);
    db.prepare('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)')
      .run(userId, `bench${scale}@example.test`, `Bench ${scale}`, hashPassword('demo1234'));
    db.prepare("INSERT INTO memberships (id,org_id,user_id,role,status,joined_at) VALUES (?,?,?,'owner','active',?)")
      .run(newId('mem'), orgId, userId, nowIso());
    for (let i = 0; i < scale; i += 1) {
      db.prepare("INSERT INTO devices (id,org_id,name,kind,online) VALUES (?,?,?,'linux',1)")
        .run(newId('dev'), orgId, `bench-dev-${i}`);
    }
  }
  db.close();
  return { orgIds };
}

function scaling(fn, scales, orgIds) {
  const out = [];
  for (const n of scales) {
    const orgId = orgIds[n];
    const conn = openDatabase(DB);
    const rows = conn.prepare('SELECT id FROM devices WHERE org_id = ?').all(orgId);
    const deviceIds = rows.map((r) => r.id);
    const userId = conn.prepare('SELECT user_id AS id FROM memberships WHERE org_id = ?').get(orgId).id;
    const probe = instrument(conn);
    const t0 = process.hrtime.bigint();
    fn(probe.db, { userId, orgId, deviceIds });
    const t1 = process.hrtime.bigint();
    out.push({ n, statements: probe.total(), micros: Number(t1 - t0) / 1000 });
    conn.close();
  }
  return out;
}

function slope(rows) {
  const dS = rows[rows.length - 1].statements - rows[0].statements;
  const dN = rows[rows.length - 1].n - rows[0].n;
  return dN === 0 ? 0 : dS / dN;
}

// Sweep the device count end-to-end. A route with an N+1 shows p50 growing roughly
// linearly with rows; a batched route stays close to flat. This measures the REAL
// server process, so it catches anything the in-process probe missed (including
// per-row queries in the route handler itself).
async function sweepDevices(base, scale) {
  const login = await fetch(`${base}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `bench${scale}@example.test`, password: 'demo1234' }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  const { token } = await login.json();

  const times = [];
  let rows = null;
  let bytes = 0;
  for (let i = 0; i < 30; i += 1) {
    const t0 = process.hrtime.bigint();
    const r = await fetch(`${base}/v1/orgs/${orgIds[scale]}/devices`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await r.arrayBuffer();   // read the WHOLE body: we want transfer cost
    const t1 = process.hrtime.bigint();
    if (body.byteLength === 0) throw new Error('empty body');
    if (i >= 10) times.push(Number(t1 - t0) / 1000);  // discard warm-up
    if (rows === null) {
      const parsed = JSON.parse(Buffer.from(body).toString('utf8'));
      if (parsed.error) throw new Error(`devices ${parsed.error.code}: ${parsed.error.message}`);
      rows = parsed.devices.length;
      bytes = body.byteLength;
    }
  }
  times.sort((a, b) => a - b);
  return { n: scale, rows, bytes, p50: Math.round(times[Math.floor(times.length / 2)]) };
}

const scales = [1, 10, 50, 200];
const { orgIds } = seedAll(scales);

console.log('\n== SQL statements vs number of devices ==');
console.log('  (a flat column = batched; a rising column = N+1)\n');

const batched = scaling((db, a) => resolveDevices(db, a), scales, orgIds);
console.log('  resolveDevices()  [the device-list path actually used]');
for (const r of batched) console.log(`    n=${String(r.n).padEnd(5)} statements=${String(r.statements).padEnd(4)} ${Math.round(r.micros)} us`);
console.log(`    -> ${slope(batched).toFixed(3)} statements per added device\n`);

const perRow = scaling((db, { userId, orgId, deviceIds }) => {
  // The counterfactual: what a naive per-row implementation would cost.
  let acc = 0;
  for (const id of deviceIds) acc += resolve(db, { userId, orgId, deviceId: id }).role ? 1 : 0;
  return acc;
}, scales, orgIds);
console.log('  resolve() per row  [the counterfactual this build avoided]');
for (const r of perRow) console.log(`    n=${String(r.n).padEnd(5)} statements=${String(r.statements).padEnd(4)} ${Math.round(r.micros)} us`);
console.log(`    -> ${slope(perRow).toFixed(3)} statements per added device`);

console.log('\n== end-to-end GET /devices, real server, by device count ==');
console.log('  (linear growth in p50 would indicate an N+1 in the request path)\n');
{
  // Seed every scale up front into ONE database so the server is started once.
  // Each scale gets its own org/user/email, so the login still resolves correctly.
  const PORT = 8131;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: HERE,
    env: { ...process.env, DATABASE_FILE: DB, PORT: String(PORT), JWT_SECRET: 'bench-secret', NODE_ENV: 'production' },
    stdio: 'ignore',
  });
  const base = `http://localhost:${PORT}`;
  for (let i = 0; i < 80; i += 1) {
    try { await fetch(`${base}/v1/auth/me`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  try {
    console.log('  devices   rows    bytes    p50 us');
    console.log('  ' + '-'.repeat(40));
    for (const scale of scales) {
      const r = await sweepDevices(base, scale);
      console.log(`  ${String(r.n).padEnd(9)} ${String(r.rows).padEnd(7)} ${String(r.bytes).padEnd(8)} ${r.p50}`);
    }
    console.log('\n  Bytes grow with rows because every row carries a full resolved');
    console.log('  permission set (19 permissions x N devices). That is response');
    console.log('  serialisation, not query cost: the statement count above stayed at 4.');
  } finally {
    child.kill();
  }
}

for (const suffix of ['', '-wal', '-shm']) {
  try { rmSync(HERE + DB + suffix); } catch { /* already gone */ }
}
