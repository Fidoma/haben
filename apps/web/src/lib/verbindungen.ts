import type { Kontokarte } from "./kontenkarten.ts";

/*
 * Was zu einem Status eines Kontos zu tun ist (#1951): ein Knopf, der ihn löst, und der Satz im Hinweis unter der
 * Kartenleiste. Dieselbe Stelle für die Bankseite und die Seite Verbindungen, damit beide dasselbe anbieten.
 */

type Karte = Pick<Kontokarte, "name" | "status" | "zugang" | "fehler">;

/** Was der Knopf zum Status tut: Konflikt klären, Zustimmung erneuern, Zugang ändern, abrufen oder eine Datei importieren */
export type Loesung = { art: "klaeren" | "erneuern" | "zugang" | "abrufen" | "datei"; label: string };

const ERNEUERN: Loesung = { art: "erneuern", label: "Neu anmelden" };
const ZUGANG: Loesung = { art: "zugang", label: "Zugang ändern" };
const ABRUFEN: Loesung = { art: "abrufen", label: "Jetzt abrufen" };
const DATEI: Loesung = { art: "datei", label: "Datei importieren" };

/**
 * Knopf zum Status, null ohne Status. Bei Enable Banking erneuert eine neue Anmeldung bei der Bank die Zustimmung; bei
 * FinTS und den Zahlungsdienstleistern steht der Zugang in Haben und wird dort geändert
 */
export function loesungFuer(karte: Pick<Karte, "status" | "zugang">): Loesung | null {
  const { status, zugang } = karte;
  if (!status) return null;
  const bank = zugang?.art === "enablebanking";
  switch (status.text) {
    case "Konflikt":
      return { art: "klaeren", label: "Klären" };
    case "Freigabe nötig":
      return ABRUFEN;
    case "Veraltet":
      return zugang ? ABRUFEN : DATEI;
    default:
      // Fehlgeschlagen, Abgelaufen, Läuft ab
      return bank ? ERNEUERN : ZUGANG;
  }
}

/** Satz im Hinweis zum gewählten Konto, ohne den Namen des Kontos davor */
export function hinweisText(karte: Karte): string {
  const { status, zugang } = karte;
  if (!status) return "";
  const wer = zugang?.art === "enablebanking" ? "Die Zustimmung bei der Bank" : "Der Zugang";
  switch (status.text) {
    case "Fehlgeschlagen":
      // FinTS und die Zahlungsdienstleister schreiben „Abruf fehlgeschlagen: …“ an die Verbindung; das steht hier schon
      return karte.fehler
        ? `Der letzte Abruf ist fehlgeschlagen: ${karte.fehler.replace(/^Abruf fehlgeschlagen:\s*/, "")}`
        : "Der letzte Abruf ist fehlgeschlagen.";
    case "Abgelaufen":
      return `${wer} ist abgelaufen. Bis du ${zugang?.art === "enablebanking" ? "sie" : "ihn"} erneuerst, ruft Haben nichts mehr ab.`;
    case "Läuft ab":
      return `${wer} läuft ${status.detail ?? "bald"} ab. Danach ruft Haben nichts mehr ab.`;
    case "Freigabe nötig":
      return "Die Bank wartet auf eine Freigabe, etwa eine TAN.";
    case "Konflikt":
      return `Der Abruf liefert ${status.detail ?? "Umsätze"} anders als beim ersten Mal. Bis du entscheidest, übernimmt Haben davon nichts.`;
    case "Veraltet":
      // Das Datum endet mit einem Punkt („13.11.“), der zugleich den Satz beendet
      return zugang
        ? `Der letzte Stand ist vom ${status.detail} Ruf das Konto neu ab.`
        : `Der letzte Stand ist vom ${status.detail} Importiere eine neuere Datei oder verbinde das Konto.`;
    default:
      return status.detail ? `${status.text}: ${status.detail}` : status.text;
  }
}

/** Hinweis bei „Alle Konten“: welche Konten einen Status haben, das Dringendste zuerst; null, wenn keins */
export function sammelHinweis(karten: readonly Karte[]): string | null {
  const mitStatus = nachDringlichkeit(karten.filter((k) => k.status));
  if (mitStatus.length === 0) return null;
  const liste = new Intl.ListFormat("de").format(mitStatus.map((k) => `${k.name} (${k.status!.text})`));
  return mitStatus.length === 1 ? `Ein Konto braucht dich: ${liste}.` : `${mitStatus.length} Konten brauchen dich: ${liste}.`;
}

/** Rang eines Status: fehlgeschlagen vor dringend vor Hinweis, ohne Status zuletzt */
function rang(k: Pick<Karte, "status">): number {
  if (!k.status) return 3;
  if (k.status.tone === "danger") return 0;
  return k.status.emphasis === "urgent" ? 1 : 2;
}

/** Zeilen mit Problem zuerst, das Dringendste oben; sonst bleibt die Reihenfolge */
export function nachDringlichkeit<T extends Pick<Karte, "status">>(karten: readonly T[]): T[] {
  return karten
    .map((k, i) => ({ k, i }))
    .sort((a, b) => rang(a.k) - rang(b.k) || a.i - b.i)
    .map(({ k }) => k);
}

/** IBAN kurz für eine Zeile: Land und Prüfziffer, dann die letzten vier Ziffern („DE12 …4567“) */
export function ibanKurz(iban: string | null): string | null {
  if (!iban) return null;
  const klar = iban.replace(/\s+/g, "");
  return `${klar.slice(0, 4)} …${klar.slice(-4)}`;
}
