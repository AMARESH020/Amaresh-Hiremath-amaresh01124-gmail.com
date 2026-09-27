// UI contract tests — presence semantics.
//
// Everything asserted here is on the documented data-* attributes, never on CSS selectors
// or pixels. The rule under test: an element is PRESENT (rendered, data-state="unlocked")
// or ABSENT (not in the DOM). There is no disabled state.
//
// Hiding is presentation, not enforcement: the endpoint behind an absent element must still
// refuse. Both halves are checked together wherever a permission is involved.

import { test, expect } from '@playwright/test';

async function login(page, email) {
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

const shell = (page) => page.getByTestId('app-shell');
const orgOption = (page, id) => page.locator(`[data-testid="org-option"][data-org-id="${id}"]`);
const deviceRow = (page, id) => page.locator(`[data-testid="device-row"][data-device-id="${id}"]`);

async function switchOrg(page, id) {
  await orgOption(page, id).click();
  await expect(shell(page)).toHaveAttribute('data-org-id', id);
}

// ---------------------------------------------------------------------------

test('the shell carries the active org identity', async ({ page }) => {
  await login(page, 'dana@example.test');
  await expect(shell(page)).toHaveAttribute('data-org-id', 'org_acme');
  await expect(shell(page)).toHaveAttribute('data-org-theme', 'cobalt');
  await expect(page.getByTestId('active-role')).toHaveText('owner');
});

// The visual-difference requirement, asserted objectively: the rendered background must
// actually change. HOW it changes is the candidate's choice.
test('switching orgs measurably changes the rendered appearance', async ({ page }) => {
  await login(page, 'dana@example.test');
  const colour = () => shell(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await colour();

  await switchOrg(page, 'org_globex');

  await expect.poll(colour).not.toBe(before);
  await expect(page.getByTestId('active-role')).toHaveText('viewer');
});

// §5 of UI-INVENTORY.md — the nav shape itself is permission-driven. Owner sees all six
// cards; the viewer sees three. That is "different permissions, different views" made
// structural.
test('owner sees all six cards', async ({ page }) => {
  await login(page, 'dana@example.test');
  for (const key of ['devices', 'people', 'grants', 'sessions', 'audit', 'admin']) {
    await expect(page.getByTestId(`nav-${key}`)).toHaveCount(1);
  }
});

test('operator sees only Devices and Sessions', async ({ page }) => {
  await login(page, 'sam@example.test');   // operator in Acme
  for (const key of ['devices', 'sessions']) {
    await expect(page.getByTestId(`nav-${key}`)).toHaveCount(1);
  }
  for (const key of ['people', 'grants', 'audit', 'admin']) {
    await expect(page.getByTestId(`nav-${key}`)).toHaveCount(0);
  }
});

test('auditor sees Devices, People, Grants, Sessions, Audit — no Admin', async ({ page }) => {
  await login(page, 'sam@example.test');
  await switchOrg(page, 'org_globex');      // auditor there

  for (const key of ['devices', 'people', 'grants', 'sessions', 'audit']) {
    await expect(page.getByTestId(`nav-${key}`)).toHaveCount(1);
  }
  await expect(page.getByTestId('nav-admin')).toHaveCount(0);

  // Grants is present but read-only: rows visible, no create, no revoke.
  await page.getByTestId('nav-grants').click();
  await expect(page.getByTestId('new-grant')).toHaveCount(0);
  await expect(page.locator('[data-testid="revoke-grant"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="grant-row"]').first()).toBeVisible();
});

// §3 Admin card — admin has the panel but NO delete. This is the one element that
// separates owner from admin, so it is exactly where a candidate slips.
test('admin has the Admin card but no delete entry', async ({ page }) => {
  await login(page, 'admin@acme.test');

  await expect(page.getByTestId('nav-admin')).toHaveCount(1);
  await page.getByTestId('nav-admin').click();
  await expect(page.getByTestId('rename-org')).toHaveCount(1);     // org:update held
  await expect(page.getByTestId('delete-org')).toHaveCount(0);     // org:delete not held
});

test('the policy inspector shows server-resolved provenance at device scope', async ({ page }) => {
  await login(page, 'dana@example.test');
  await page.getByTestId('policy-inspector-toggle').click();
  await expect(page.locator('#policy-user option[value="usr_sam"]')).toHaveCount(1);
  await page.getByTestId('policy-user').selectOption('usr_sam');
  await page.getByTestId('policy-device').selectOption('dev_lab_mac_01');

  const control = page.locator('[data-testid="policy-permission"][data-permission="device:control"]');
  await expect(control).toHaveAttribute('data-effect', 'allow');
  await expect(control).toHaveAttribute('data-source', 'role:operator');
});

test('a device policy drawer shows server resolution and closes with Escape', async ({ page }) => {
  await login(page, 'dana@example.test');
  await deviceRow(page, 'dev_lab_mac_01').getByTestId('inspect-device-policy').click();

  const dialog = page.getByTestId('device-policy-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('lab-mac-01');
  const control = dialog.locator('[data-testid="device-policy-permission"][data-permission="device:control"]');
  await expect(control).toHaveAttribute('data-effect', 'allow');
  await expect(control).toHaveAttribute('data-source', 'role:owner');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('an operator can inspect their own policy without user:read', async ({ page }) => {
  await login(page, 'sam@example.test');
  await page.getByTestId('policy-inspector-toggle').click();
  await expect(page.getByTestId('policy-user')).toHaveValue(/ · you$/);
  await page.getByTestId('policy-device').selectOption('dev_lab_win_01');

  const terminal = page.locator('[data-testid="policy-permission"][data-permission="device:terminal"]');
  await expect(terminal).toHaveAttribute('data-effect', 'deny');
  await expect(terminal).toHaveAttribute('data-reason', 'explicit_deny');
});

test('owner has both Admin entries', async ({ page }) => {
  await login(page, 'dana@example.test');
  await page.getByTestId('nav-admin').click();
  await expect(page.getByTestId('rename-org')).toHaveCount(1);
  await expect(page.getByTestId('delete-org')).toHaveCount(1);
});

// D2 — the auditor/operator pair. Across two orgs the same person's cards differ.
test('auditor and operator see different cards', async ({ page }) => {
  await login(page, 'sam@example.test');          // operator in Acme
  await expect(page.getByTestId('nav-people')).toHaveCount(0);
  await expect(deviceRow(page, 'dev_lab_win_01').locator('[data-permission="device:control"]')).toHaveCount(1);

  await switchOrg(page, 'org_globex');            // auditor there
  await expect(page.getByTestId('nav-people')).toHaveCount(1);
  await expect(deviceRow(page, 'dev_globex_desk_01').locator('[data-permission="device:control"]')).toHaveCount(0);
});

// The audit NAV item in isolation. Lines 66 and 76 already include 'audit' inside a
// five-item loop, which proves it incidentally but never names the permission. If the nav
// definition for audit were deleted, those loops would still pass for the other four keys
// only if the expectation counted them — so an explicit both-directions assertion is
// worth having on the one nav item the brief calls out by test id.
//
// The SAME person is used for both directions (sam), across two orgs they belong to. That
// is deliberate: it holds identity, account and session constant, so the only variable is
// the resolved permission set. A role or org name is never asserted here — the test reads
// the server's answer, not the seed labels.
test('the audit nav item exists exactly when the resolved set allows audit:read', async ({ page }) => {
  await login(page, 'sam@example.test');

  // --- without audit:read: sam is operator in Acme -----------------------
  // The operator baseline does not include audit:read, so the item is not rendered.
  await expect(shell(page)).toHaveAttribute('data-org-id', 'org_acme');
  await expect(page.getByTestId('active-role')).toHaveText('operator');
  await expect(page.getByTestId('nav-audit')).toHaveCount(0);

  // --- with audit:read: sam is auditor in Globex -------------------------
  // The auditor baseline includes audit:read, so the item is rendered.
  await switchOrg(page, 'org_globex');
  await expect(page.getByTestId('active-role')).toHaveText('auditor');
  await expect(page.getByTestId('nav-audit')).toHaveCount(1);

  // Presence is not a lock: the item carries the permission it was gated on, unlocked.
  await expect(page.getByTestId('nav-audit')).toHaveAttribute('data-permission', 'audit:read');
  await expect(page.getByTestId('nav-audit')).toHaveAttribute('data-state', 'unlocked');

  // Switching back removes it again — the gate is re-evaluated per org, not latched.
  await switchOrg(page, 'org_acme');
  await expect(page.getByTestId('nav-audit')).toHaveCount(0);
});

// Hiding is presentation, not enforcement. The absent nav item must be backed by a
// refusal at the endpoint, or the UI would be the only thing protecting audit data.
//
// The access token is kept in memory and never exposed to the page, so the request is
// built from the token captured out of the login RESPONSE. That is the same credential
// the app itself holds, so this is a genuine authenticated probe rather than a check
// that the token happens to be absent from the DOM.
test('audit data stays refused when the nav item is absent', async ({ page }) => {
  let token = null;
  page.on('response', async (res) => {
    if (res.url().includes('/v1/auth/login') && res.status() === 200) {
      try { token = (await res.json()).token; } catch { /* leave null; the assert below reports it */ }
    }
  });

  await login(page, 'sam@example.test');            // operator in Acme: no audit:read
  await expect(page.getByTestId('nav-audit')).toHaveCount(0);

  expect(token, 'captured the access token from the login response').toBeTruthy();

  // The same caller, same org, same session — the only difference from the nav assertion
  // is that the request names the endpoint directly.
  const audit = await page.request.get('/v1/orgs/org_acme/audit', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(audit.status()).toBe(403);
  const body = await audit.json();
  expect(body.error.code).toBe('FORBIDDEN');
  expect(body.error.requestId).toMatch(/^req_/);
});
test('a device-scoped grant surfaces exactly one control', async ({ page }) => {
  await login(page, 'dana@example.test');
  await switchOrg(page, 'org_globex');

  await expect(deviceRow(page, 'dev_globex_desk_01').locator('[data-permission="device:control"]')).toHaveCount(1);
  await expect(deviceRow(page, 'dev_globex_kiosk_02').locator('[data-permission="device:control"]')).toHaveCount(0);
});

// §2 — a device the caller cannot view is not a redacted row; it is not listed.
test('a device the viewer cannot see is absent, not redacted', async ({ page }) => {
  await login(page, 'viewer@acme.test');
  await expect(page.locator('[data-testid="device-row"]')).toHaveCount(4);
  await expect(page.locator('[data-device-id="dev_kiosk_lobby_01"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// THE ARCHITECTURE TEST.
//
// Make the SERVER say deny, and the element must DISAPPEAR. A hardcoded client-side role
// matrix ignores the response and keeps rendering the button — which is exactly the bug
// this catches. It verifies where the decision is computed, not whether it happens to be right.
test('an element vanishes when the server withdraws the permission', async ({ page }) => {
  await login(page, 'dana@example.test');   // owner: control is present everywhere
  const control = () => deviceRow(page, 'dev_lab_mac_01').locator('[data-permission="device:control"]');
  await expect(control()).toHaveCount(1);

  await page.route('**/v1/orgs/*/devices', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const d of body.devices) {
      d.permissions['device:control'] = { effect: 'deny', source: 'grant:test', reason: 'explicit_deny' };
    }
    await route.fulfill({ response: res, json: body });
  });

  // Remount the view so it refetches.
  await page.getByTestId('nav-people').click();
  await page.getByTestId('nav-devices').click();

  await expect(control()).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Isolation, asserted on the rendered DOM rather than only on the API.
// NOTE: the other org's ID legitimately appears in the org switcher — Dana is a member of
// both. What must NOT appear is the other org's *content*.
test('no other org\'s content appears anywhere in the DOM', async ({ page }) => {
  await login(page, 'dana@example.test');

  const html = await page.content();
  for (const leak of ['dev_globex_desk_01', 'dev_globex_kiosk_02', 'globex-desk-01', 'globex-kiosk-02']) {
    expect(html, `leaked ${leak}`).not.toContain(leak);
  }

  await switchOrg(page, 'org_globex');
  const html2 = await page.content();
  for (const leak of ['dev_lab_mac_01', 'dev_lab_win_01', 'dev_build_server_01', 'lab-mac-01']) {
    expect(html2, `leaked ${leak}`).not.toContain(leak);
  }
});

test('two tabs on two orgs do not bleed', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();

  await login(pageA, 'dana@example.test');
  await login(pageB, 'dana@example.test');
  await switchOrg(pageB, 'org_globex');

  await expect(deviceRow(pageA, 'dev_lab_mac_01').locator('[data-permission="device:control"]')).toHaveCount(1);
  await expect(shell(pageB)).toHaveAttribute('data-org-id', 'org_globex');
  await expect(pageB.locator('[data-device-id="dev_lab_mac_01"]')).toHaveCount(0);
  await expect(pageB.locator('[data-device-id^="dev_globex"]')).toHaveCount(2);
  await expect(shell(pageA)).toHaveAttribute('data-org-id', 'org_acme');
  await expect(pageA.locator('[data-device-id^="dev_globex"]')).toHaveCount(0);

  await a.close();
  await b.close();
});

// D13 — the access token lives in memory. Nothing in web storage.
test('no token is persisted in web storage', async ({ page }) => {
  await login(page, 'dana@example.test');
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    cookies: document.cookie,
  }));
  expect(storage.local).toHaveLength(0);
  expect(storage.session).toHaveLength(0);
  expect(storage.cookies).not.toContain('rt=');
});

test('a reload restores the session from the refresh cookie', async ({ page }) => {
  await login(page, 'dana@example.test');
  await page.reload();
  await expect(shell(page)).toHaveAttribute('data-org-id', 'org_acme');
});

// ---------------------------------------------------------------------------
// Deny-wins, now as presence: the operator's Terminal entry is absent everywhere, while
// Control is untouched. (The explicit_deny REASON is asserted server-side — HIDDEN-BACKEND
// C1/C4 — because an absent element cannot explain itself.)
test('an org-wide deny removes the entry the baseline granted', async ({ page }) => {
  await login(page, 'sam@example.test');   // operator: terminal is in the baseline
  const row = deviceRow(page, 'dev_lab_win_01');

  await expect(row.locator('[data-permission="device:control"]')).toHaveCount(1);
  await expect(row.locator('[data-permission="device:terminal"]')).toHaveCount(0);
});

test('the grants view lists seeded grants', async ({ page }) => {
  await login(page, 'dana@example.test');
  await page.getByTestId('nav-grants').click();
  await expect(page.locator('[data-testid="grant-row"]')).toHaveCount(3);
  await expect(page.locator('[data-testid="grant-row"][data-effect="deny"]')).toHaveCount(2);
});

// Grant management entries are absent for levels without the permission.
test('grant management is absent below admin', async ({ page }) => {
  await login(page, 'viewer@acme.test');   // user:read, but no grant:create / grant:revoke
  await page.getByTestId('nav-grants').click();

  await expect(page.getByTestId('new-grant')).toHaveCount(0);
  await expect(page.locator('[data-testid="revoke-grant"]')).toHaveCount(0);
});

// Creating a grant through the UI makes the granted element APPEAR for the grantee.
test('a grant created through the UI surfaces the item it grants', async ({ page }) => {
  await login(page, 'dana@example.test');   // owner

  // owner already holds it, so check the grantee's side instead
  await page.getByTestId('nav-grants').click();
  await page.getByTestId('new-grant').click();
  await page.getByTestId('grant-user').selectOption('usr_acme_viewer');
  await page.getByTestId('grant-device').selectOption('dev_qa_android_01');
  await page.getByTestId('grant-effect').selectOption('allow');
  await page.locator('[data-permission-key="device:terminal"]').check();
  await page.getByTestId('grant-submit').click();
  await expect(page.locator('[data-testid="grant-row"]')).toHaveCount(4);

  const other = await page.context().browser().newContext();
  const p2 = await other.newPage();
  await login(p2, 'viewer@acme.test');
  await expect(deviceRow(p2, 'dev_qa_android_01').locator('[data-permission="device:terminal"]')).toHaveCount(1);
  await expect(deviceRow(p2, 'dev_lab_win_01').locator('[data-permission="device:terminal"]')).toHaveCount(0);
  await other.close();
});

// Creating organizations from the UI — a stated requirement.
test('a new org can be created from the UI and you become its owner', async ({ page }) => {
  await login(page, 'dana@example.test');
  const before = await shell(page).getAttribute('data-org-id');

  await page.getByTestId('create-org').click();
  await page.getByTestId('new-org-name').fill('E2E Fresh Org');
  await page.getByTestId('new-org-submit').click();

  await expect(shell(page)).not.toHaveAttribute('data-org-id', before);
  await expect(page.getByTestId('active-role')).toHaveText('owner');
  await expect(page.locator('[data-testid="org-option"]', { hasText: 'E2E Fresh Org' })).toHaveCount(1);
  await expect(page.getByTestId('devices-empty')).toBeVisible();
  // A brand-new owner holds every permission, so all six cards appear.
  for (const key of ['devices', 'people', 'grants', 'sessions', 'audit', 'admin']) {
    await expect(page.getByTestId(`nav-${key}`)).toHaveCount(1);
  }
});

// ---------------------------------------------------------------------------
// Invites.
test('an invite link can be redeemed', async ({ page, request }) => {
  const auth = await request.post('/v1/auth/login', { data: { email: 'dana@example.test', password: 'demo1234' } });
  const { token } = await auth.json();
  const created = await request.post('/v1/orgs/org_acme/invites', {
    headers: { authorization: `Bearer ${token}` },
    data: { email: 'e2e-invitee@example.test', role: 'operator' },
  });
  const { inviteToken } = await created.json();

  await page.goto(`/invite/${inviteToken}`);
  await expect(page.getByTestId('invite-role')).toHaveText('operator');
  await expect(page.getByTestId('invite-email')).toHaveValue('e2e-invitee@example.test');

  await page.getByTestId('invite-name').fill('E2E Invitee');
  await page.getByTestId('invite-password').fill('password123');
  await page.getByTestId('invite-submit').click();
  await expect(page.getByTestId('login-form')).toBeVisible();
});

test('a bad invite link is refused without leaking anything', async ({ page }) => {
  await page.goto('/invite/totally-not-a-real-token-000000');
  await expect(page.getByTestId('invite-error')).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain('Acme');
  expect(html).not.toContain('org_acme');
});

// ---------------------------------------------------------------------------
// Failure feedback: a sign-in that fails has to say so, on screen, in words.

test('a failed sign-in states the reason on screen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-email').fill('dana@example.test');
  await page.getByTestId('login-password').fill('not-the-password');
  await page.getByTestId('login-submit').click();

  const error = page.getByTestId('login-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText(/invalid|password|credential/i);
  await expect(page.getByTestId('app-shell')).toHaveCount(0);
});

// The server answers the same way for an unknown account as for a wrong password, and the
// screen must not improve on that: "that account does not exist" is an enumeration oracle.
test('an unknown account is refused without revealing whether it exists', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-email').fill('nobody@example.test');
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('login-submit').click();

  const error = page.getByTestId('login-error');
  await expect(error).toBeVisible();
  await expect(error).not.toContainText(/no such|unknown|does not exist/i);
});

test('an empty sign-in form says what is missing', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-email').fill('');
  await page.getByTestId('login-password').fill('');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toContainText(/email|password/i);
});
