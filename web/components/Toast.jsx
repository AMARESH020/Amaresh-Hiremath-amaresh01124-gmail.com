import React, { useEffect } from 'react';

// A non-blocking notification. Used for ordinary application feedback — something
// succeeded, or something failed and the user should know without losing their place.
//
// Deliberately NOT used for anything the user must act on before continuing: a one-time
// invite token is shown in a modal instead, because a toast auto-dismisses and would let
// the only copy of a credential disappear unread.
//
// role="status" + aria-live="polite" announces the message without stealing focus, so a
// notification never interrupts someone mid-keystroke. Errors are announced the same way
// but styled distinctly and, by default, stay longer: a failure is worth reading.
export default function Toast({
  title,
  tone = 'success',
  children,
  onDismiss,
  duration,          // undefined -> a sensible default per tone
  testid = 'toast',
}) {
  const ms = duration ?? (tone === 'error' ? 10000 : 6000);

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, ms);
    return () => window.clearTimeout(timer);
  }, [ms, onDismiss]);

  return (
    <aside
      className={`toast toast-${tone}`}
      role="status"
      aria-live="polite"
      data-testid={testid}
      data-tone={tone}
    >
      <div className="toast-title">
        <span aria-hidden="true">{tone === 'error' ? '!' : '✓'}</span> {title}
      </div>
      {children}
      <button type="button" className="toast-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </aside>
  );
}
