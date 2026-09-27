import React, { useState } from 'react';
import { api } from '../api.js';
import Action from './Action.jsx';
import Modal from './Modal.jsx';

// The Admin card. Visible for org:update OR org:delete — which is what separates an owner
// from an admin: the admin has this panel, but no delete entry.
export default function Admin({ session, reload }) {
  const { org } = session;

  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState('');
  const [renameError, setRenameError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function openRename() {
    // Seeded with the CURRENT name so the field is editable in place rather than empty.
    setName(org.name);
    setRenameError(null);
    setRenameOpen(true);
  }

  async function saveRename(event) {
    event.preventDefault();
    const next = name.trim();
    // Validate here for a fast, field-attached message. The server validates too, and its
    // rejection is shown below if the two ever disagree.
    if (!next) { setRenameError('Organization name is required.'); return; }
    if (next.length > 100) { setRenameError('Organization name must be 100 characters or fewer.'); return; }

    setSaving(true);
    setRenameError(null);
    try {
      await api.patch(`/orgs/${org.id}`, { name: next });
      await reload();
      setRenameOpen(false);      // close only on success, so a failure keeps the input
    } catch (err) {
      setRenameError(`${err.code ?? err.status}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.del(`/orgs/${org.id}`);
      api.logout();
      window.location.reload();   // the org is gone; sign out cleanly
    } catch (err) {
      setDeleteError(`${err.code ?? err.status}: ${err.message}`);
      setDeleting(false);
    }
  }

  return (
    <div className="card" data-testid="admin-card" style={{ maxWidth: 460 }}>
      <h3>Organization settings</h3>
      <div className="hint" style={{ marginTop: 0 }}>
        These operations apply to <strong>{org.name}</strong> and are visible only to the
        permission levels that hold them.
      </div>

      <div className="actions" style={{ marginTop: 14 }}>
        <Action permission="org:update" entry={session.permissions['org:update']}
                onClick={openRename} testid="rename-org">Rename org</Action>
        <Action permission="org:delete" entry={session.permissions['org:delete']}
                onClick={() => { setDeleteError(null); setDeleteOpen(true); }} testid="delete-org">Delete org</Action>
      </div>

      <div className="hint">
        <strong>owner</strong> sees both entries. <strong>admin</strong> sees Rename but not
        Delete. Every level below admin does not see this card at all — the nav item is absent.
      </div>

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        titleId="rename-org-title"
        testid="rename-org-form"
        onSubmit={saveRename}
        submitLabel="Save"
        busy={saving}
      >
        <h2 id="rename-org-title">Rename organization</h2>
        <label htmlFor="rename-org-name">Organization name</label>
        <input
          id="rename-org-name"
          data-testid="rename-org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          autoFocus
          required
        />
        {renameError && (
          <div className="alert" role="alert" data-testid="rename-org-error">{renameError}</div>
        )}
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        titleId="delete-org-title"
        testid="delete-org-form"
        onSubmit={(e) => { e.preventDefault(); confirmRemove(); }}
        submitLabel="Delete organization"
        busy={deleting}
      >
        <h2 id="delete-org-title">Delete organization</h2>
        <p>
          Delete <strong>{org.name}</strong>? This cannot be undone. Devices, memberships and
          sessions in this organization stop existing immediately.
        </p>
        {deleteError && (
          <div className="alert" role="alert" data-testid="delete-org-error">{deleteError}</div>
        )}
      </Modal>
    </div>
  );
}
