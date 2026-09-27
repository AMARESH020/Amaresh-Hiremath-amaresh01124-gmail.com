import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, whyLocked } from '../api.js';
import Action from './Action.jsx';
import Toast from './Toast.jsx';
import Modal from './Modal.jsx';
import DevicePolicyInspector from './DevicePolicyInspector.jsx';

// The device list is where device-scoped authorization becomes visible.
//
// Note that each row's permission set comes from the API response — the server already
// resolved it PER DEVICE. The client does no filtering and no rule evaluation; it just
// reads `device.permissions`. That is why a viewer with a grant on one device shows an
// unlocked Control on that row and a locked one on every other row.
export default function Devices({ session, reload, onViewSessions }) {
  const { org } = session;
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [deviceKind, setDeviceKind] = useState('linux');
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [toast, setToast] = useState(null);
  const [inspectedDevice, setInspectedDevice] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const deviceDialogRef = useRef(null);

  useEffect(() => {
    const dialog = deviceDialogRef.current;
    if (!dialog) return;
    if (deviceDialogOpen && !dialog.open) dialog.showModal();
    if (!deviceDialogOpen && dialog.open) dialog.close();
  }, [deviceDialogOpen]);

  const load = useCallback(async () => {
    try {
      const out = await api.get(`/orgs/${org.id}/devices`);
      setDevices(out.devices);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [org.id]);

  // Drop the previous org's rows the moment the org changes. Keeping them until the new
  // fetch resolves leaves the OTHER org's device names, ids and permission provenance
  // (data-source="role:owner") in the DOM, which is a tenancy leak in the UI even though
  // the server scoped the request correctly. Null renders the loading state instead.
  useEffect(() => { setDevices(null); setError(null); }, [org.id]);

  useEffect(() => { load(); }, [load]);

  async function startSession(device, mode) {
    setBusy(`${device.id}:${mode}`);
    setError(null);
    try {
      const out = await api.post(`/orgs/${org.id}/sessions`, { deviceId: device.id, mode });
      setToast({ id: out.id, mode, deviceName: device.name });
      await load();
    } catch (err) {
      // Surface the server's own reason code — the two failure causes are deliberately
      // distinguishable (missing_permission vs missing_device_permission).
      setError(`${err.code}${err.reason ? ` / ${err.reason}` : ''}: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  function openRenameDevice(device) {
    // Seeded with the current name so the operator edits in place.
    setRenameTarget(device);
    setRenameValue(device.name);
    setRenameError(null);
  }

  async function saveRenameDevice(event) {
    event.preventDefault();
    const next = renameValue.trim();
    if (!next) { setRenameError('Device name is required.'); return; }
    if (next.length > 200) { setRenameError('Device name must be 200 characters or fewer.'); return; }

    setRenaming(true);
    setRenameError(null);
    try {
      await api.patch(`/orgs/${org.id}/devices/${renameTarget.id}`, { name: next, online: renameTarget.online });
      setRenameTarget(null);
      await load();
    } catch (err) {
      setRenameError(`${err.code ?? err.status}: ${err.message}`);
    } finally {
      setRenaming(false);
    }
  }

  async function decommission(device) {
    if (!confirm(`Decommission "${device.name}"? Its live sessions will end.`)) return;
    setError(null);
    try {
      await api.del(`/orgs/${org.id}/devices/${device.id}`);
      await load();
    } catch (err) {
      setError(`${err.code ?? err.status}: ${err.message}`);
    }
  }

  async function createDevice(event) {
    event.preventDefault();
    const name = deviceName.trim();
    if (!name) return;
    setCreatingDevice(true);
    setError(null);
    try {
      await api.post(`/orgs/${org.id}/devices`, { name, kind: deviceKind });
      setDeviceDialogOpen(false);
      setDeviceName('');
      await load();
    } catch (err) {
      setError(`${err.code ?? err.status}: ${err.message}`);
    } finally {
      setCreatingDevice(false);
    }
  }

  function openCreateDevice() {
    setDeviceName('');
    setDeviceKind('linux');
    setError(null);
    setDeviceDialogOpen(true);
  }

  if (!devices) return <div>Loading devices…</div>;

  return (
    <>
      {toast && (
        <Toast title="Session started" onDismiss={() => setToast(null)} testid="session-toast">
          <strong>{toast.deviceName}</strong>
          <div>Mode: {toast.mode}</div>
          <div>Session ID: {toast.id}</div>
          <div className="toast-actions">
            <button type="button" className="toast-link" onClick={onViewSessions}>
              View session · {toast.id}
            </button>
          </div>
        </Toast>
      )}
      {error && <div className="banner" data-testid="devices-error">{error}</div>}
      {inspectedDevice && (
        <DevicePolicyInspector
          orgId={org.id}
          user={session.user}
          device={inspectedDevice}
          onClose={() => setInspectedDevice(null)}
        />
      )}

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        titleId="rename-device-title"
        testid="rename-device-form"
        onSubmit={saveRenameDevice}
        submitLabel="Save"
        busy={renaming}
      >
        <h2 id="rename-device-title">Rename device</h2>
        <label htmlFor="rename-device-name">Device name</label>
        <input
          id="rename-device-name"
          data-testid="rename-device-name"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          maxLength={200}
          autoFocus
          required
        />
        {renameError && (
          <div className="alert" role="alert" data-testid="rename-device-error">{renameError}</div>
        )}
      </Modal>

      <div className="actions" style={{ marginBottom: 12 }}>
        <Action permission="device:provision" entry={session.permissions['device:provision']}
                onClick={openCreateDevice} testid="add-device">
          Add device
        </Action>
      </div>

      <dialog
        ref={deviceDialogRef}
        className="org-dialog"
        aria-labelledby="new-device-title"
        onCancel={(event) => { event.preventDefault(); setDeviceDialogOpen(false); }}
      >
        <form onSubmit={createDevice} data-testid="new-device-form">
          <h2 id="new-device-title">Add device</h2>
          <label htmlFor="new-device-name">Device name</label>
          <input
            id="new-device-name"
            data-testid="new-device-name"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            maxLength={200}
            autoFocus
            required
          />
          <label htmlFor="new-device-kind">Kind</label>
          <select
            id="new-device-kind"
            data-testid="new-device-kind"
            value={deviceKind}
            onChange={(event) => setDeviceKind(event.target.value)}
          >
            <option value="linux">Linux</option>
            <option value="macos">macOS</option>
            <option value="windows">Windows</option>
            <option value="android">Android</option>
            <option value="ios">iOS</option>
          </select>
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={() => setDeviceDialogOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" data-testid="new-device-submit" disabled={creatingDevice}>
              {creatingDevice ? 'Adding…' : 'Add device'}
            </button>
          </div>
        </form>
      </dialog>

      <table data-testid="device-table">
        <thead>
          <tr>
            <th>Device</th><th>Kind</th><th>Status</th><th>Sessions</th><th>Maintenance</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id} data-testid="device-row" data-device-id={device.id}>
              <td>
                <strong>{device.name}</strong>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{device.id}</div>
              </td>
              <td>{device.kind}</td>
              <td>
                <span className={`pill ${device.online ? 'online' : 'offline'}`}>
                  {device.online ? 'online' : 'offline'}
                </span>
              </td>
              <td>
                <div className="actions">
                  {['view', 'control', 'terminal'].map((mode) => {
                    const permission = `device:${mode}`;
                    const entry = device.permissions[permission];
                    return (
                      <Action
                        key={mode}
                        permission={permission}
                        entry={entry}
                        busy={busy === `${device.id}:${mode}`}
                        onClick={() => startSession(device, mode)}
                        testid={`start-${mode}`}
                      >
                        {mode === 'view' ? 'View' : mode === 'control' ? 'Control' : 'Terminal'}
                      </Action>
                    );
                  })}
                </div>
              </td>
              <td>
                <div className="actions">
                  <Action permission="device:update" entry={device.permissions['device:update']}
                          onClick={() => openRenameDevice(device)} testid="rename-device">Rename</Action>
                  <Action permission="device:file_transfer" entry={device.permissions['device:file_transfer']}
                          onClick={() => startSession(device, 'view')} testid="transfer-files">
                    Transfer files
                  </Action>
                  <Action permission="device:provision" entry={device.permissions['device:provision']}
                          onClick={() => decommission(device)} testid="decommission-device">
                    Decommission
                  </Action>
                  <button
                    type="button"
                    className="secondary policy-open"
                    data-testid="inspect-device-policy"
                    aria-label={`Inspect policy for ${device.name}`}
                    onClick={() => setInspectedDevice(device)}
                  >
                    Inspect policy
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {devices.length === 0 && (
        <div className="banner" data-testid="devices-empty">
          No devices are visible to you in this organization.
        </div>
      )}

      <div className="hint">
        Each row's permission set was resolved by the server <em>for that device</em>. Hover a
        locked button to see the reason — for example{' '}
        <code>{whyLocked(devices[0]?.permissions['device:control'])}</code>.
      </div>
    </>
  );
}
