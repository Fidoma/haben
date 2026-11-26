/*
 * Texte der geführten Einrichtung eines Zahlungsdienstleisters (#1951) und der Auswahl des Anbieters, ohne
 * Serverfunktionen, damit Tests sie laden können.
 */

const UND = new Intl.ListFormat("de-DE", { type: "conjunction" });

/** Was der Zugang eines Anbieters ist, aus den geheimen Feldern seines Adapters: „API-Schlüssel“, „Client-ID und Secret“ */
export const zugangArt = (felder: readonly { label: string; art: string }[]) => UND.format(felder.filter((f) => f.art === "geheim").map((f) => f.label));

/** Bestehende Verbindungen eines Anbieters in der Auswahl */
export const verbundenText = (namen: readonly string[]) => (namen.length ? `verbunden: ${UND.format(namen.map((n) => `„${n}“`))}` : "noch nicht verbunden");

/** Wie die Schrittleiste einen Schritt des Adapters nennt */
export const SCHRITT_TITEL: Record<string, string> = { zugang: "Zugang", einstellungen: "Name und Zeitraum", abruf: "Erster Abruf" };

/**
 * Welches Konto in Haben die Verbindung bekommt: das gewählte, bei „Automatisch“ das, was die Prüfung genannt hat (an den
 * Abruf gebunden oder frei), sonst ein neues mit dem Namen der Verbindung
 */
export function kontoText(p: { gewaehlt: { name: string } | null; automatisch: { name: string } | null; gebunden: boolean; name: string }): string {
  if (p.gewaehlt) return `Der Abruf schreibt in das Konto „${p.gewaehlt.name}“.`;
  if (p.automatisch && p.gebunden) return `Der Abruf schreibt in das Konto „${p.automatisch.name}“, das die Umsätze dieses Kontos beim Anbieter schon bekommt.`;
  if (p.automatisch) return `Der Abruf schreibt in das freie Konto „${p.automatisch.name}“.`;
  return `Haben legt das Konto „${p.name.trim() || "…"}“ der Art Zahlungsdienstleister an.`;
}

/** Erste Zeile des Ergebnisses nach dem ersten Abruf */
export function abrufText(e: { entries: number; added: number; accountName: string | null }): string {
  const bewegungen = `${e.entries} ${e.entries === 1 ? "Bewegung" : "Bewegungen"} beim Anbieter`;
  if (e.accountName === null) return `${bewegungen}; übernommen ist nichts.`;
  return `${bewegungen}, ${e.added} ${e.added === 1 ? "neuer Umsatz" : "neue Umsätze"} im Konto „${e.accountName}“.`;
}
