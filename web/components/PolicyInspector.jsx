import React, { useEffect, useState } from 'react';
import { api, isAllowed } from '../api.js';

export default function PolicyInspector({ session }) {
  const { org, user, permissions } = session;
  const canInspectOthers = isAllowed(permissions, 'user:read');
  const canListDevices = isAllowed(permissions, 'device:list');
  const [members, setMembers] = useState([user]);
  const [userId, setUserId] = useState(members[0]?.id ?? '');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState([]);
  const [memberError, setMemberError] = useState(null);
  const [deviceError, setDeviceError] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canInspectOthers) {
      setMembers([user]);
      setUserId(user.id);
      return undefined;
    }
    let current = true;
    api.get(`/orgs/${org.id}/members`)
      .then(({ members: rows }) => {
        if (!current) return;
        setMembers(rows);
        setMemberError(null);
      })
      .catch((err) => { if (current) setMemberError(err.message); });
    return () => { current = false; };
  }, [org.id, user.id, canInspectOthers]);

  useEffect(() => {
    if (!canListDevices) return undefined;
    let current = true;
    api.get(`/orgs/${org.id}/devices`)
      .then(({ devices: rows }) => { if (current) setDevices(rows); })
      .catch((err) => { if (current) setDeviceError(err.message); });
    return () => { current = false; };
  }, [org.id, canListDevices]);

  useEffect(() => {
    if (!userId) return undefined;
    let current = true;
    const scope = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    setLoading(true);
    setError(null);
    setResult(null);
    api.get(`/orgs/${org.id}/users/${userId}/effective${scope}`)
      .then((resolved) => { if (current) setResult(resolved); })
      .catch((err) => { if (current) setError(`${err.code ?? err.status}: ${err.message}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [org.id, userId, deviceId]);

  return (
    <section className="policy-inspector" data-testid="policy-inspector"
             data-user-id={userId} data-device-id={deviceId} aria-busy={loading}>
      <header className="policy-heading">
        <div>
          <h3>Policy Inspector</h3>
        </div>
      </header>

      <div className="policy-controls">
        <div>
          <label htmlFor="policy-user">Member</label>
          {canInspectOthers ? (
            <select id="policy-user" data-testid="policy-user" value={userId}
                    onChange={(event) => setUserId(event.target.value)}>
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.name} · {member.role}</option>
              ))}
            </select>
          ) : (
            <input id="policy-user" data-testid="policy-user" value={`${user.name} · you`} readOnly />
          )}
        </div>
        {canListDevices && (
          <div>
            <label htmlFor="policy-device">Scope</label>
            <select id="policy-device" data-testid="policy-device" value={deviceId}
                    onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">Organization-wide</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>{device.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {memberError && <p className="policy-note" role="status">Member choices unavailable: {memberError}</p>}
      {deviceError && <p className="policy-note" role="status">Device choices unavailable: {deviceError}</p>}
      {error && <div className="banner" role="alert" data-testid="policy-error">{error}</div>}
      {loading && <p className="policy-note" role="status">Resolving permissions…</p>}
      {result && !loading && (
        <div className="policy-table-wrap">
          <table data-testid="policy-table">
            <caption>{result.deviceId ? 'Device-level permissions' : 'Organization-wide permissions'}</caption>
            <thead>
              <tr><th>Permission</th><th>Effect</th><th>Source</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {Object.entries(result.permissions).map(([permission, decision]) => (
                <tr key={permission} data-testid="policy-permission" data-permission={permission}
                    data-effect={decision.effect} data-source={decision.source ?? ''}
                    data-reason={decision.reason ?? ''}>
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
    </section>
  );
}