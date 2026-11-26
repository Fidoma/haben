import { useFintsAbruf, type FintsZustand } from "../../components/FintsAbruf.tsx";
import { KonfliktKlaeren } from "../../components/ImportKonflikt.tsx";
import { usePspAbruf } from "../../components/ZahlungsdienstleisterAbruf.tsx";
import { quelleZuAnbieter } from "../../lib/import-quelle.ts";
import type { Kontokarte } from "../../lib/kontenkarten.ts";
import { hinweisText, type Loesung, loesungFuer, sammelHinweis } from "../../lib/verbindungen.ts";
import type { Data } from "./-bank-daten.ts";
import { useEnableBankingAbruf } from "./-bank-verbindung.tsx";

/*
 * Abruf der Konten für Bankseite und Seite Verbindungen (#1951): eine Stelle, die zu einer Karte die Verbindung findet
 * und sie abruft, ihren Zugang ändert oder trennt, gleich ob Enable Banking, FinTS oder ein Zahlungsdienstleister. Formulare,
 * Schritte der Bank und Meldungen stehen im `bereich`, den die Seite unter Kartenleiste bzw. Kopf stellt.
 */

export type Zugang = NonNullable<Kontokarte["zugang"]>;
type AbrufDaten = Pick<Data, "sync" | "fints" | "zahlungsdienstleister">;

export function useKontoAbruf(
  data: AbrufDaten,
  {
    fintsZustand,
    connecting,
    setConnecting,
    result,
    von,
  }: {
    fintsZustand: FintsZustand;
    connecting: boolean;
    setConnecting: (v: boolean) => void;
    result: { ok: boolean; message: string } | null;
    von: "/bank" | "/bank/verbindungen";
  },
) {
  const eb = useEnableBankingAbruf({ sync: data.sync, connecting, setConnecting, result, von });
  const fints = useFintsAbruf(data.fints, fintsZustand);
  const psp = usePspAbruf(data.zahlungsdienstleister);

  const finde = (z: Zugang) => ({
    eb: z.art === "enablebanking" ? data.sync.connections.find((c) => c.id === z.verbindungId) : undefined,
    fints: z.art === "fints" ? data.fints.connections.find((c) => c.id === z.verbindungId) : undefined,
    psp: z.art === "psp" ? data.zahlungsdienstleister.verbindungen.find((v) => v.id === z.verbindungId) : undefined,
  });

  /** Ob „Jetzt abrufen“ geht; FinTS nennt den Grund, wenn nicht (an einer anderen Zeile läuft etwas) */
  function abrufbar(z: Zugang): { geht: boolean; grund: { id: string; text: string } | null } {
    const v = finde(z);
    if (v.eb) return { geht: v.eb.status === "aktiv" && !eb.gesperrt, grund: null };
    if (v.fints) return { geht: fints.configured && !fints.gesperrt && !fintsZustand.verbinden, grund: fints.grund(v.fints) };
    if (v.psp) return { geht: !psp.gesperrt, grund: null };
    return { geht: false, grund: null };
  }

  async function abrufen(z: Zugang) {
    const v = finde(z);
    if (v.eb) await eb.abrufen(v.eb);
    else if (v.fints) await fints.abrufen(v.fints);
    else if (v.psp) await psp.abrufen(v.psp);
  }

  /** Läuft gerade eine Anfrage an diese Verbindung: „Rufe ab …“ statt „Jetzt abrufen“ */
  function laeuft(z: Zugang): boolean {
    const v = finde(z);
    return (v.eb && eb.laeuft(v.eb) === "abruf") || (v.fints && fints.laeuft(v.fints) === "abruf") || (v.psp && psp.laeuft(v.psp) === "abruf") || false;
  }

  /** Zugang ändern: FinTS im Formular, Zahlungsdienstleister im Dialog, Enable Banking mit neuer Anmeldung bei der Bank */
  function zugangAendern(z: Zugang) {
    const v = finde(z);
    if (v.eb) void eb.erneuern(v.eb);
    else if (v.fints) fints.zugangAendern(v.fints);
    else if (v.psp) psp.bearbeiten(v.psp);
  }

  function trennen(z: Zugang) {
    const v = finde(z);
    if (v.eb) eb.trennenFragen(v.eb);
    else if (v.fints) fints.trennenFragen(v.fints);
    else if (v.psp) psp.entfernenFragen(v.psp);
  }

  /**
   * Alle Verbindungen nacheinander abrufen. FinTS zuletzt und nur, solange die Bank keinen Schritt verlangt; dann bleibt
   * der Schritt offen und die übrigen warten auf „Jetzt abrufen“ an ihrer Zeile
   */
  async function alleAbrufen() {
    for (const c of data.sync.connections.filter((c) => c.status === "aktiv")) await eb.abrufen(c);
    for (const v of data.zahlungsdienstleister.verbindungen) await psp.abrufen(v);
    for (const c of data.fints.connections) {
      if (fintsZustand.offen) break;
      await fints.abrufen(c);
    }
  }

  return {
    eb,
    fints,
    psp,
    finde,
    abrufbar,
    abrufen,
    laeuft,
    zugangAendern,
    trennen,
    alleAbrufen,
    /** Eine Anfrage läuft irgendwo: „Alle abrufen“ wartet */
    beschaeftigt: eb.gesperrt || fints.gesperrt || psp.gesperrt,
    sichtbar: eb.sichtbar || fints.sichtbar || psp.sichtbar,
    bereich: (
      <>
        {eb.bereich}
        {fints.bereich}
        {psp.bereich}
      </>
    ),
  };
}
export type KontoAbruf = ReturnType<typeof useKontoAbruf>;

/** Offene Konflikte eines Kontos aus dem Abruf, mit der Quelle für die Texte im Dialog */
export function konflikteVon(data: Pick<Data, "sync">, kontoId: string) {
  const konflikte = data.sync.konflikte.filter((k) => k.bankAccountId === kontoId);
  return { konflikte, quelle: quelleZuAnbieter(konflikte[0]?.provider ?? "bank") };
}

/**
 * Knopf, der den Status eines Kontos löst; null ohne Status. „Klären“ öffnet den Dialog des Konflikts, „Datei importieren“
 * die Dateiauswahl für dieses Konto
 */
export function LoesungKnopf({
  karte,
  data,
  abruf,
  dateiFuer,
  klein = false,
  beschreibung,
}: {
  karte: Pick<Kontokarte, "id" | "name" | "status" | "zugang">;
  data: AbrufDaten;
  abruf: KontoAbruf;
  dateiFuer: (kontoId: string) => void;
  klein?: boolean;
  /** ID des Grundes, wenn der Knopf gesperrt ist und die Seite den Grund zeigt */
  beschreibung?: string;
}) {
  const loesung: Loesung | null = loesungFuer(karte);
  if (!loesung) return null;
  // Neutral, auch bei einem Fehlschlag: Die Dringlichkeit zeigt der Status bzw. die Fläche des Hinweises, und die
  // Hauptaktion der Seite steht im Kopf (DESIGN.md, Knöpfe in Zeilen und Hinweisen)
  const klasse = `btn${klein ? " btn-sm" : ""}`;
  if (loesung.art === "klaeren") {
    const { konflikte, quelle } = konflikteVon(data, karte.id);
    return <KonfliktKlaeren konflikte={konflikte} disabled={abruf.beschaeftigt} quelle={quelle} label={loesung.label} className={klasse} />;
  }
  const z = karte.zugang;
  const onClick = () => {
    if (loesung.art === "datei" || !z) dateiFuer(karte.id);
    else if (loesung.art === "abrufen") void abruf.abrufen(z);
    else abruf.zugangAendern(z);
  };
  // „Zugang ändern“ bei FinTS wartet wie „Jetzt abrufen“, solange an einer Zeile ein Schritt der Bank offen ist
  const fints = z?.art === "fints" ? abruf.finde(z).fints : undefined;
  const grund =
    z && loesung.art === "abrufen"
      ? abruf.abrufbar(z)
      : fints
        ? { geht: !abruf.fints.gesperrt && !abruf.fints.verbinden, grund: abruf.fints.grund(fints) }
        : null;
  return (
    <button
      type="button"
      className={klasse}
      onClick={onClick}
      disabled={grund ? !grund.geht : false}
      aria-describedby={grund?.grund ? beschreibung : undefined}
    >
      {z && loesung.art === "abrufen" && abruf.laeuft(z) ? "Rufe ab …" : loesung.label}
    </button>
  );
}

/**
 * Hinweis unter der Kartenleiste, nur wenn das gewählte Konto einen Status hat: der Satz links, der Knopf, der ihn löst,
 * rechts (DESIGN.md, Hinweis mit Aktion). Bei „Alle Konten“ ein Satz für alle mit dem Weg zu den Verbindungen.
 */
export function KontoHinweis({
  karte,
  alle,
  data,
  abruf,
  dateiFuer,
  zuVerbindungen,
}: {
  karte: Kontokarte | null;
  alle: readonly Kontokarte[] | null;
  data: AbrufDaten;
  abruf: KontoAbruf;
  dateiFuer: (kontoId: string) => void;
  zuVerbindungen: () => void;
}) {
  if (alle) {
    const satz = sammelHinweis(alle);
    if (!satz) return null;
    return (
      <div className="banner banner-warn banner-aktion konto-hinweis" role="status">
        <span>{satz}</span>
        <button type="button" className="btn btn-sm" onClick={zuVerbindungen}>
          Zu den Verbindungen
        </button>
      </div>
    );
  }
  if (!karte?.status) return null;
  return (
    <div className={`banner banner-${karte.status.tone === "danger" ? "danger" : "warn"} banner-aktion konto-hinweis`} role="status">
      <span>
        <strong>{karte.name}:</strong> {hinweisText(karte)}
      </span>
      <LoesungKnopf karte={karte} data={data} abruf={abruf} dateiFuer={dateiFuer} klein />
    </div>
  );
}
