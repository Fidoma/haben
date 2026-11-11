import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon.tsx";

/** Modaler, barrierefreier Slide-over für kompakte Details und Bearbeitungsformulare. */
export function SideDialog({
  open,
  title,
  caption,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  caption?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <OpenSideDialog title={title} caption={caption} onClose={onClose}>
      {children}
    </OpenSideDialog>,
    document.body,
  );
}

function OpenSideDialog({ title, caption, onClose, children }: { title: string; caption?: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressedBeside = useRef(false);

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="side-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={(event) => {
        pressedBeside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedBeside.current) event.currentTarget.close();
      }}
    >
      <header className="side-dialog-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {caption && <div className="small muted">{caption}</div>}
        </div>
        <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="side-dialog-body">{children}</div>
    </dialog>
  );
}
