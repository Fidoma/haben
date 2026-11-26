import { type CSSProperties, type KeyboardEvent, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  /** Linie davor, etwa vor „Alle Verbindungen“ am Ende des Menüs einer Karte */
  trenner?: boolean;
  /** ID eines Satzes, der den Punkt beschreibt, etwa warum er gerade gesperrt ist */
  beschreibung?: string;
  onSelect: () => void;
};

function enabledMenuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
}

/**
 * Lage eines schwebenden Menüs: fest über der Seite, bündig mit der rechten Kante des Auslösers, unter ihm oder, wenn
 * unten der Platz fehlt, über ihm, mit 8px Abstand zum Fenster. Beim Rollen und bei einer Größenänderung rückt es mit;
 * schlösse es dabei, ginge es schon zu, wenn der Browser beim Öffnen den ersten Punkt in den Blick rollt.
 */
function useSchwebendeLage(aktiv: boolean, ausloeser: RefObject<HTMLButtonElement | null>, menu: RefObject<HTMLDivElement | null>): CSSProperties | undefined {
  const [lage, setLage] = useState<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    if (!aktiv) return setLage(undefined);
    const ausrichten = () => {
      const knopf = ausloeser.current?.getBoundingClientRect();
      if (!knopf) return;
      const breite = menu.current?.offsetWidth ?? 0;
      const hoehe = menu.current?.offsetHeight ?? 0;
      const unten = knopf.bottom + 4 + hoehe <= window.innerHeight - 8 || knopf.top - 4 - hoehe < 8;
      setLage({
        position: "fixed",
        top: unten ? knopf.bottom + 4 : knopf.top - 4 - hoehe,
        left: Math.max(8, Math.min(knopf.right - breite, window.innerWidth - breite - 8)),
        right: "auto",
      });
    };
    ausrichten();
    window.addEventListener("scroll", ausrichten, { capture: true, passive: true });
    window.addEventListener("resize", ausrichten);
    return () => {
      window.removeEventListener("scroll", ausrichten, { capture: true });
      window.removeEventListener("resize", ausrichten);
    };
  }, [aktiv, ausloeser, menu]);
  return lage;
}

/**
 * Menüknopf `⋯` für weitere Aktionen in der Aktionsleiste am Handy (#396, Variante E), nach dem Muster „Menu Button“
 * der WAI-ARIA APG: öffnet mit Enter, Leertaste oder Pfeil nach unten/oben, hält die Pfeiltasten im Menü und setzt den
 * Fokus bei Escape zurück auf den Auslöser. Mit `text` ist der Auslöser ein Knopf mit Text und `chevron-down`
 * („Konto verbinden ▾“ auf der Bankseite, #1951); sein Text ist dann auch der Name des Menüs.
 */
export function MoreActionsMenu({
  label = "Weitere Aktionen",
  text,
  items,
  triggerRef,
  primary = false,
  ghost = false,
  schwebend = false,
}: {
  label?: string;
  text?: string;
  items: ActionMenuItem[];
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /** Auslöser mit Text als Hauptaktion des Kopfs („Konto verbinden ▾“, #1951) */
  primary?: boolean;
  /** Auslöser ohne Rahmen, etwa `⋯` auf einer Karte oder am Ende einer Zeile */
  ghost?: boolean;
  /**
   * Das Menü schwebt fest über der Seite statt im Fluss seines Behälters: für einen Auslöser in einer Fläche, die
   * überlaufenden Inhalt abschneidet (rollbare Kartenleiste, Karte mit Tabelle). Bündig mit der rechten Kante des
   * Auslösers, so weit der Platz reicht; beim Rollen rückt es mit.
   */
  schwebend?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [initialFocus, setInitialFocus] = useState<"first" | "last">("first");
  const container = useRef<HTMLDivElement>(null);
  const ownTrigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const setTriggerRef = (node: HTMLButtonElement | null) => {
    ownTrigger.current = node;
    if (triggerRef) triggerRef.current = node;
  };

  const closeMenu = (focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) ownTrigger.current?.focus();
  };

  const lage = useSchwebendeLage(schwebend && open, ownTrigger, menu);

  useEffect(() => {
    if (!open) return;
    const all = enabledMenuItems(menu.current);
    (initialFocus === "last" ? all.at(-1) : all[0])?.focus();
    const outside = (e: PointerEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, initialFocus]);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setInitialFocus(e.key === "ArrowUp" ? "last" : "first");
      setOpen(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const all = enabledMenuItems(menu.current);
    if (all.length === 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(true);
      }
      return;
    }
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(all.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={container} className="more-actions-menu">
      <button
        ref={setTriggerRef}
        type="button"
        className={`btn${text ? "" : " btn-icon"}${primary ? " btn-primary" : ""}${ghost ? " btn-ghost" : ""}`}
        aria-label={text ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setInitialFocus("first");
          setOpen((was) => !was);
        }}
        onKeyDown={onTriggerKey}
      >
        {text ? (
          <>
            {text}
            <Icon name="chevron-down" size={16} />
          </>
        ) : (
          <Icon name="more" size={16} />
        )}
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label={text ?? label} className="split-menu" style={lage} onKeyDown={onMenuKey}>
          {items.map((item) => [
            item.trenner && <hr key={`${item.key}-trenner`} className="split-menu-trenner" />,
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              aria-describedby={item.beschreibung}
              onClick={() => {
                closeMenu(true);
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              <span>{item.label}</span>
            </button>,
          ])}
        </div>
      )}
    </div>
  );
}
