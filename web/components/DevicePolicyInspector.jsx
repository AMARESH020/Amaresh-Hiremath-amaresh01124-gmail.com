import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function DevicePolicyInspector({ orgId, user, device, onClose }) {
  const dialogRef = useRef(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let current = true;
    const scope = `?deviceId=${encodeURIComponent(device.id)}`;
    api.get(`/orgs/${orgId}/users/${user.id}/effective${scope}`)
      .then((resolved) => { if (current) setResult(resolved); })
      .catch((err) => { if (current) setError(`${err.code ?? err.status}: ${err.message}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [device.id, orgId, user.id]);

  return (
    <dialog
      ref={dialogRef}
      className="policy-dialog"
      aria-labelledby="device-policy-title"
      data-testid="device-policy-dialog"
      onClose={onClose}
    >
      <header className="policy-dialog-header">
        <div>
          <h2 id="device-policy-title">Permission policy</h2>
          <p>{device.name} · {user.name} · device scope</p>
        </div>
        <button type="button" className="secondary" onClick={() => dialogRef.current?.close()} autoFocus>
          Close
        </button>
      </header>

      {loading && <p role="status">Loading server-resolved permissions…</p>}
      {error && <div className="banner" role="alert">{error}</div>}
      {result && !loading && (
        <div className="policy-table-wrap">
          <table data-testid="device-policy-table">
            <caption>Resolved for {result.deviceId ? device.name : 'organization scope'}</caption>
            <thead>
              <tr><th>Permission</th><th>Effect</th><th>Source</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {Object.entries(result.permissions).map(([permission, decision]) => (
                <tr
                  key={permission}
                  data-testid="device-policy-permission"
                  data-permission={permission}
                  data-effect={decision.effect}
                  data-source={decision.source ?? ''}
                  data-reason={decision.reason ?? ''}
                  className={decision.reason === 'explicit_deny' ? 'policy-explicit-deny' : decision.reason === 'implicit' ? 'policy-implicit-deny' : ''}
                >
                  <td><code>{permission}</code></td>
                  <td><span className={`pill ${decision.effect}`}>{decision.effect}</span></td>
                  <td>{decision.source ?? '—'}</td>
                  <td>{decision.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </dialog>
  );
}
