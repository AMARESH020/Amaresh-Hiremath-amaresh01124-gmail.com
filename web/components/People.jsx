import React, { useCallback, useEffect, useState } from 'react';
import { api, isAllowed } from '../api.js';
import Action from './Action.jsx';
import Modal from './Modal.jsx';

const ROLES = ['owner', 'admin', 'operator', 'auditor', 'viewer'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function People({ session, reload }) {
  const { org } = session;
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteError, setInviteError] = useState(null);
  const [inviting, setInviting] = useState(false);
  // The raw invite token is a bearer credential returned exactly once. It is held here
  // only until the operator dismisses the result dialog — never stored, never re-fetched.
  const [issued, setIssued] = useState(null);

  const load = useCallback(async () => {
    try {
      setMembers((await api.get(`/orgs/${org.id}/members`)).members);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [org.id]);

  useEffect(() => { load(); }, [load]);

  async function act(fn) {
    setError(null);
    try {
      await fn();
      await load();
      await reload();   // permissions may have changed; re-read server truth
    } catch (err) {
      setError(`${err.code ?? err.status}${err.reason ? ` / ${err.reason}` : ''}: ${err.message}`);
    }
  }

  const setRole = (userId, role) => act(() => api.patch(`/orgs/${org.id}/members/${userId}`, { role }));
  const suspend = (userId) => act(() => api.post(`/orgs/${org.id}/members/${userId}/suspend`));
  const reinstate = (userId) => act(() => api.del(`/orgs/${org.id}/members/${userId}/suspend`));
  const remove = (userId) => act(() => api.del(`/orgs/${org.id}/members/${userId}`));

  function openInvite() {
    setInviteEmail('');
    setInviteRole('viewer');
    setInviteError(null);
    setInviteOpen(true);
  }

  async function sendInvite(event) {
    event.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!EMAIL.test(email)) {
      setInviteError('Enter a valid email address, for example name@example.com.');
      return;
    }
    if (!ROLES.includes(inviteRole)) { setInviteError('Choose a role for the invitation.'); return; }

    setInviting(true);
    setInviteError(null);
    try {
      const out = await api.post(`/orgs/${org.id}/invites`, { email, role: inviteRole });
      // Shown once. There is no endpoint that returns it again.
      setIssued({ email: out.email, role: out.role, inviteToken: out.inviteToken });
      setInviteOpen(false);
      await load();
    } catch (err) {
      setInviteError(`${err.code ?? err.status}${err.reason ? ` / ${err.reason}` : ''}: ${err.message}`);
    } finally {
      setInviting(false);
    }
  }

  if (!members) return <div>Loading people…</div>;

  return (
    <>
      {error && <div className="banner" data-testid="people-error">{error}</div>}

      <div className="actions" style={{ marginBottom: 12 }}>
        <Action permission="user:invite" entry={session.permissions['user:invite']}
                onClick={openInvite} testid="invite-user">
          Invite someone
        </Action>
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        titleId="invite-user-title"
        testid="invite-user-form"
        onSubmit={sendInvite}
        submitLabel="Send invite"
        busy={inviting}
      >
        <h2 id="invite-user-title">Invite someone</h2>
        <label htmlFor="invite-email">Email address</label>
        <input
          id="invite-email"
          data-testid="invite-email"
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          maxLength={320}
          autoFocus
          required
        />
        <label htmlFor="invite-role">Role</label>
        <select
          id="invite-role"
          data-testid="invite-role"
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value)}
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {inviteError && (
          <div className="alert" role="alert" data-testid="invite-user-error">{inviteError}</div>
        )}
      </Modal>

      <Modal
        open={Boolean(issued)}
        onClose={() => setIssued(null)}
        titleId="invite-issued-title"
        testid="invite-issued"
        onSubmit={(e) => { e.preventDefault(); setIssued(null); }}
        submitLabel="Done"
        cancelLabel="Copy token and close"
      >
        <h2 id="invite-issued-title">Invitation created</h2>
        <p>
          Invited <strong>{issued?.email}</strong> as <strong>{issued?.role}</strong>. Send them
          this link token — it is shown once and cannot be retrieved again.
        </p>
        <label htmlFor="invite-token">One-time invite token</label>
        <input
          id="invite-token"
          data-testid="invite-token"
          readOnly
          value={issued?.inviteToken ?? ''}
          onFocus={(e) => e.target.select()}
        />
        <div className="hint">
          Redeem it at <code>/v1/invites/&lt;token&gt;/accept</code>. The account is created on
          first acceptance, so the invited person sets their own password.
        </div>
      </Modal>

      <table data-testid="people-table">
        <thead>
          <tr><th>Person</th><th>Role</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const isSelf = m.id === session.user.id;
            const canUpdateRole = isAllowed(session.permissions, 'user:role:update') && !isSelf;
            const canRemove = isAllowed(session.permissions, 'user:remove') && !isSelf;
            return (
              <tr key={m.id} data-testid="user-row" data-user-id={m.id} data-role={m.role}>
                <td>
                  <strong>{m.name}</strong>
                  {isSelf && <span className="pill" style={{ marginLeft: 6 }}>you</span>}
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{m.email}</div>
                </td>
                <td>
                  {/* Presence, not state: the select exists only for levels holding
                      user:role:update. Everyone else sees their role as plain text. */}
                  {canUpdateRole ? (
                    <select
                      value={m.role}
                      data-testid="role-select"
                      data-permission="user:role:update"
                      data-state="unlocked"
                      onChange={(e) => setRole(m.id, e.target.value)}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span data-testid="role-label" data-permission="user:role:update">{m.role}</span>
                  )}
                </td>
                <td><span className={`pill ${m.status === 'active' ? 'online' : ''}`}>{m.status}</span></td>
                <td>
                  <div className="actions">
                    {m.status === 'active'
                      ? <Action permission="user:remove" entry={session.permissions['user:remove']}
                                onClick={() => suspend(m.id)} testid="suspend-user">Suspend</Action>
                      : <Action permission="user:remove" entry={session.permissions['user:remove']}
                                onClick={() => reinstate(m.id)} testid="reinstate-user">Reinstate</Action>}
                    <Action permission="user:remove" entry={session.permissions['user:remove']}
                            onClick={() => remove(m.id)} testid="remove-user">Remove</Action>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="hint">
        Removing a person removes their <strong>membership</strong>, never the user account —
        they may belong to other organizations, and their audit history must survive.
      </div>

    </>
  );
}
