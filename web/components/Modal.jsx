import React, { useEffect, useRef } from 'react';

// A reusable modal built on the native <dialog> element, so the browser supplies the
// semantics we would otherwise have to hand-roll: modal focus trapping, inertness of the
// page behind it, Escape handling, and the top layer for stacking.
//
// It is opened with showModal() and closed with close(), driven by the `open` prop, so
// the React state and the dialog's own state cannot drift apart.
//
// This replaces window.prompt(), which is not implemented in every environment this app
// runs in (it threw "prompt() is not supported" in the test browser) and which gives us
// no labelled input, no validation message and no accessible error region.
export default function Modal({
  open,
  onClose,
  titleId,
  testid,
  onSubmit,
  submitLabel,
  busy = false,
  cancelLabel = 'Cancel',
  children,
  footer,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="org-dialog"
      aria-labelledby={titleId}
      // Native cancel fires on Escape. preventDefault stops the browser closing the dialog
      // behind our back so that onClose is the single place the state changes, exactly like
      // every other close path.
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      data-testid={testid}
    >
      <form onSubmit={onSubmit}>
        {children}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          {footer ?? (
            <button type="submit" className="primary" disabled={busy}>
              {submitLabel}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
