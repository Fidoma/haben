import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/** PMS-eigener Formulardialog; schließt mit Escape oder einem vollständigen Klick auf den Hintergrund. */
export function FormDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <OpenFormDialog title={title} onClose={onClose}>
      {children}
    </OpenFormDialog>,
    document.body,
  );
}

function OpenFormDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="form-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOnBackdrop.current) event.currentTarget.close();
        pressedOnBackdrop.current = false;
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
