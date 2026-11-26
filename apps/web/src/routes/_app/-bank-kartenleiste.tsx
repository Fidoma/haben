import { formatEuro } from "@haben/core";
import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../components/Icon.tsx";
import { type ActionMenuItem, MoreActionsMenu } from "../../components/MoreActionsMenu.tsx";
import { Status } from "../../components/Status.tsx";
import type { Kontokarte } from "../../lib/kontenkarten.ts";
import type { Data } from "./-bank-daten.ts";

/*
 * Kartenleiste der Konten auf der Bankseite (#1951): alle Konten als Karten in einer Zeile, seitlich rollbar, in Gruppen,
 * jede mit `⋯` für Abruf, Name und Zweck und Verbindung. Unter 1100 px dieselben Konten als schmale Zeile kleiner Karten,
 * die unter dem Seitenkopf stehen bleibt (bank.css). Beide stehen im Dokument, CSS zeigt eine; die verborgene ist weder per
 * Tab noch für Screenreader erreichbar.
 */

type Filter = "offen" | "zugeordnet" | "alle" | "vorschlag";
type Props = {
  data: Pick<Data, "karten" | "accountId" | "allAccounts">;
  filter: Filter;
  /** Punkte im Menü `⋯` einer Karte; "alle" für „Alle Konten“ */
  aktionen: (karte: Kontokarte | "alle") => ActionMenuItem[];
};

const GRUPPEN = [
  { gruppe: "banken", titel: "Banken" },
  { gruppe: "zahlungsdienstleister", titel: "Zahlungsdienstleister" },
] as const;

const anzahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`;

/**
 * Gewählte Karte: das Konto aus der Adresse, ohne eins das, welches die Daten zeigen. Nicht allein aus den Daten: Nach
 * einem Klick ist die Adresse schon weiter, während die Daten des neuen Kontos noch laden, und der Router markiert den
 * Link der Adresse von sich aus; mit den alten Daten wären zwei Karten gewählt. Hat die Adresse keine Karte („alle“ bei
 * nur einem Konto, ein gelöschtes Konto), zeigt der Server ein anderes Konto; dann gilt das der Daten.
 */
function useGewaehlt(data: Props["data"]): string | null {
  // Die Adresse, zu der es geht (state.location), nicht die der geladenen Treffer wie bei useSearch; nach ihr markiert der Router
  const konto = useRouterState({ select: (s) => (s.location.search as { konto?: string }).konto });
  const { karten } = data.karten;
  const hatKarte = konto === "alle" ? karten.length > 1 : karten.some((k) => k.id === konto);
  return hatKarte && konto ? konto : data.allAccounts ? "alle" : data.accountId;
}

/** Ob sich die Leiste nach links bzw. rechts rollen lässt; ohne Überlauf beides nicht */
function useRollen(ref: RefObject<HTMLElement | null>) {
  const [stand, setStand] = useState({ links: false, rechts: false });
  const messen = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setStand({ links: el.scrollLeft > 0, rechts: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Die gewählte Karte in den sichtbaren Bereich rollen, ohne die Seite zu bewegen. Gemessen an der Leiste selbst:
    // offsetLeft zählte ab dem nächsten positionierten Vorfahren (der Seite) und rollte eine ganz sichtbare Karte hinaus
    const aktiv = el.querySelector<HTMLElement>("[aria-current='page']");
    if (aktiv) {
      const karte = aktiv.getBoundingClientRect();
      const leiste = el.getBoundingClientRect();
      if (karte.right > leiste.right) el.scrollLeft += karte.left - leiste.left - 48;
    }
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    el.addEventListener("scroll", messen, { passive: true });
    return () => {
      beobachter.disconnect();
      el.removeEventListener("scroll", messen);
    };
  }, [ref, messen]);
  const rollen = (richtung: 1 | -1) => ref.current?.scrollBy({ left: richtung * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return { ...stand, rollen };
}

function Gruppe({ titel, children }: { titel: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="konten-gruppe" role="group" aria-labelledby={id}>
      <span id={id} className="konten-gruppe-titel">
        {titel}
      </span>
      <div className="konten-gruppe-karten">{children}</div>
    </div>
  );
}

function KarteStatus({ status, leise }: { status: Kontokarte["status"]; leise: string }) {
  return status ? (
    <Status tone={status.tone} emphasis={status.emphasis} detail={status.detail ?? undefined} inline>
      {status.text}
    </Status>
  ) : (
    <span className="konto-karte-quelle">{leise}</span>
  );
}

function Karte({
  name,
  zahl,
  saldo,
  offen,
  status,
  leise,
}: {
  name: string;
  zahl?: string;
  saldo?: number | null;
  offen: number;
  status: Kontokarte["status"];
  leise: string;
}) {
  // Ein negativer Saldo steht in der Farbe für Gefahr (DESIGN.md, Beträge)
  const negativ = saldo !== undefined && saldo !== null && saldo < 0;
  return (
    <>
      <span className="konto-karte-name">{name}</span>
      <span className="konto-karte-zahlen">
        <span className={`amount${negativ ? " betrag-negativ" : ""}`}>{zahl ?? (saldo === null || saldo === undefined ? "–" : formatEuro(saldo))}</span>
        {offen > 0 && <span className="konto-karte-offen">{offen} offen</span>}
      </span>
      <KarteStatus status={status} leise={leise} />
    </>
  );
}

/** Karte als Link zur Auswahl, `⋯` daneben und nicht im Link, damit beide eigene Ziele für Tab und Klick sind */
function Rahmen({ name, aktionen, children }: { name: string; aktionen: ActionMenuItem[]; children: ReactNode }) {
  return (
    <div className="konto-karte-rahmen">
      {children}
      <MoreActionsMenu label={`Aktionen für ${name}`} items={aktionen} ghost schwebend />
    </div>
  );
}

function KartenLeiste({ data, filter, aktionen }: Props) {
  const gewaehlt = useGewaehlt(data);
  const ref = useRef<HTMLElement>(null);
  const { links, rechts, rollen } = useRollen(ref);
  const { karten, alle } = data.karten;
  return (
    // Ohne Überlauf bleiben die Pfeile unsichtbar an ihrem Platz, damit die Leiste nicht springt
    <div className="konten-leiste" data-rollbar={links || rechts ? "" : undefined}>
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Konten nach links" onClick={() => rollen(-1)} disabled={!links}>
        <Icon name="chevron-left" />
      </button>
      <nav ref={ref} className="konten-karten" aria-label="Konten">
        {karten.length > 1 && (
          <Gruppe titel="Gesamt">
            <Rahmen name="alle Konten" aktionen={aktionen("alle")}>
              <Link to="/bank" search={{ konto: "alle", filter }} aria-current={gewaehlt === "alle" ? "page" : undefined} className="konto-karte">
                <Karte
                  name="Alle Konten"
                  zahl={anzahl(alle.konten, "Konto", "Konten")}
                  offen={alle.offen}
                  status={alle.mitStatus > 0 ? { text: "Prüfen", tone: "warn", emphasis: "notice", detail: anzahl(alle.mitStatus, "Konto", "Konten") } : null}
                  leise="Alles aktuell"
                />
              </Link>
            </Rahmen>
          </Gruppe>
        )}
        {GRUPPEN.map(({ gruppe, titel }) => {
          const inGruppe = karten.filter((k) => k.gruppe === gruppe);
          if (inGruppe.length === 0) return null;
          return (
            <Gruppe key={gruppe} titel={titel}>
              {inGruppe.map((k) => (
                <Rahmen key={k.id} name={k.name} aktionen={aktionen(k)}>
                  <Link to="/bank" search={{ konto: k.id, filter }} aria-current={k.id === gewaehlt ? "page" : undefined} className="konto-karte">
                    <Karte name={k.name} saldo={k.saldo} offen={k.offen} status={k.status} leise={k.quelle} />
                  </Link>
                </Rahmen>
              ))}
            </Gruppe>
          );
        })}
      </nav>
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Konten nach rechts" onClick={() => rollen(1)} disabled={!rechts}>
        <Icon name="chevron-right" />
      </button>
    </div>
  );
}

/** Kleine Karte der schmalen Zeile: Name, darunter der Status mit Punkt oder die Zahl offener Umsätze (fehlt bei null) */
function Klein({
  to,
  aktiv,
  name,
  offen,
  status,
}: {
  to: { konto: string; filter: Filter };
  aktiv: boolean;
  name: string;
  offen: number;
  status?: Kontokarte["status"];
}) {
  return (
    <Link to="/bank" search={to} aria-current={aktiv ? "page" : undefined} className="konto-klein" data-tone={status?.tone}>
      <span className="konto-klein-name">{name}</span>
      {status ? (
        <span className="konto-klein-zeile konto-klein-status">{status.text}</span>
      ) : (
        offen > 0 && <span className="konto-klein-zeile">{offen} offen</span>
      )}
    </Link>
  );
}

/** Schmale Zeile kleiner Karten, Gruppen durch eine Linie getrennt */
function KontenKlein({ data, filter }: Props) {
  const gewaehlt = useGewaehlt(data);
  const { karten, alle } = data.karten;
  return (
    <nav className="konten-klein" aria-label="Konten">
      {karten.length > 1 && (
        <Klein to={{ konto: "alle", filter }} aktiv={gewaehlt === "alle"} name="Alle" offen={alle.offen} status={alle.mitStatus > 0 ? PRUEFEN : null} />
      )}
      {GRUPPEN.map(({ gruppe }, i) => {
        const inGruppe = karten.filter((k) => k.gruppe === gruppe);
        if (inGruppe.length === 0) return null;
        return [
          (karten.length > 1 || (i > 0 && karten.some((k) => k.gruppe === "banken"))) && (
            <span key={`trenner-${gruppe}`} className="konten-klein-trenner" aria-hidden="true" />
          ),
          ...inGruppe.map((k) => <Klein key={k.id} to={{ konto: k.id, filter }} aktiv={k.id === gewaehlt} name={k.name} offen={k.offen} status={k.status} />),
        ];
      })}
    </nav>
  );
}

const PRUEFEN = { text: "Prüfen", tone: "warn", emphasis: "notice", detail: null } as const;

export function Kartenleiste(props: Props) {
  return (
    <>
      <KartenLeiste {...props} />
      <KontenKlein {...props} />
    </>
  );
}
