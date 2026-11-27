import type { z } from "zod";
import type { StoreBatchInput } from "../bank/index.ts";

/*
 * Vertrag zwischen der gemeinsamen Anbindung und einem Zahlungsdienstleister (#1729). Die Anbindung kümmert sich um Tabelle,
 * Zeitplan, Fenster, Konto, Speichern nach dem Importvertrag und Meldungen; ein Adapter nur um das, was beim Anbieter anders ist.
 * Ein neuer Anbieter braucht keine Migration und keine Änderung an Tabelle, Zeitplan oder Oberfläche; welche festen Listen er außer
 * anbieter.ts noch braucht, steht im Skill anbindung-hinzufuegen (references/zahlungsdienstleister-api.md).
 */

/** Ein Feld des Zugangs, das der Adapter beschreibt; Einrichtung und Bearbeiten bauen daraus die Felder */
export interface AdapterFeld {
  name: string;
  label: string;
  /** Hinweis am Feld, etwa woher der Wert kommt */
  hint?: string;
  /** geheim: Passwortfeld, leer lassen behält den gespeicherten Wert; text: Freitext; auswahl: Auswahlliste aus `optionen` */
  art: "geheim" | "text" | "auswahl";
  optionen?: { wert: string | boolean; label: string }[];
  /** Wert einer neuen Verbindung (nur Felder der config) */
  standard?: string | boolean;
  /** Steht der Wert in config (nicht geheim) statt im Zugang */
  config?: true;
}

/**
 * Ein Schritt der geführten Einrichtung (#1951): Zugang eingeben und prüfen, Name und Zeitraum, erster Abruf. Rahmen,
 * Schrittleiste und Ergebnis sind für alle Anbieter gleich; ein Anbieter mit Anmeldung über Weiterleitung bringt hier
 * einen weiteren Schritt mit.
 */
export type AdapterSchritt = "zugang" | "einstellungen" | "abruf";

/** Die Schritte eines Anbieters, der nichts anderes sagt */
export const STANDARD_SCHRITTE: readonly AdapterSchritt[] = ["zugang", "einstellungen", "abruf"];

/** Ergebnis der Prüfung eines Zugangs beim Anbieter */
export interface Pruefung {
  /** Kennung des Kontos beim Anbieter: Quelle des Abrufs */
  accountId: string;
  /** Letzte Zeichen zur Anzeige */
  keyHint: string;
  /** Bis wann der Zugang gilt, wenn der Anbieter es sagt */
  gueltigBis?: Date | null;
  /** Was beim Prüfen auffiel, etwa fehlende Rechte mit ihrer Folge; die Einrichtung zeigt es unter der Kennung */
  hinweise?: string[];
}

/** Was ein Abruf liefert: alles für storeBatch außer Bindung und Dateiname, die die Anbindung setzt */
export interface Lieferung {
  input: Omit<StoreBatchInput, "binding" | "source">;
  /** Grundlage des Prüfwerts im Importprotokoll */
  inhalt: unknown;
  /** Zahl der Bewegungen beim Anbieter */
  eintraege: number;
  /** Meldungen zum Abruf selbst, auch ohne Konto in Haben (etwa fehlende Rechte des Schlüssels) */
  hinweise: string[];
  /** Meldungen zur Lieferung (Warnungen des Auszugs, nicht Unterstütztes); nur, wenn sie gespeichert wird */
  meldungen: string[];
  /** Gibt es nichts zu speichern (auch nichts Abgelehntes), legt die Anbindung keine Lieferung an */
  leer: boolean;
  /** Adapter-eigener Stand für den nächsten Start, etwa der Tag einer ausstehenden Zahlung */
  offenSeit?: string | null;
}

export interface Fenster {
  dateFrom: string;
  dateTo: string;
}

/**
 * Adapter eines Anbieters. `Zugang` ist das geheime Objekt in ciphertext, `Config` das nicht geheime in config; beide prüft der
 * Adapter mit seinen Schemas, auch beim Lesen.
 */
export interface PspAdapter<Zugang = unknown, Config = unknown> {
  provider: string;
  /** Name für Meldungen und Oberfläche */
  name: string;
  /** Kurzbeschreibung des Zugangs für die Oberfläche; `link` ist die Stelle beim Anbieter, wo der Zugang entsteht */
  beschreibung: string;
  link: { url: string; text: string };
  /** Wie der Teil des Zugangs heißt, dessen letzte Zeichen die Oberfläche zeigt („Schlüssel“, „Client-ID“) */
  zugangName: string;
  /** Hinweis zur config, etwa dass ein Zugang nur Testdaten liefert; null ohne Hinweis */
  configHinweis?(config: Config): string | null;
  felder: AdapterFeld[];
  /** Schritte der Einrichtung; fehlt: STANDARD_SCHRITTE */
  schritte?: readonly AdapterSchritt[];
  /** Liest den entschlüsselten Zugang, auch in älteren Formen */
  zugangLesen(text: string): Zugang;
  configSchema: z.ZodType<Config>;
  /**
   * Prüft die Eingabe und baut den Zugang. `eingabe` enthält die geheimen Felder (leer: nicht geändert), `bisher` den
   * gespeicherten Zugang mit seiner config; null, wenn die Eingabe den Zugang nicht ändert. Wirft einen UserError mit verständlicher Meldung,
   * mit `felder`, wenn die Meldung ein Feld aus `felder` betrifft (Einrichtung und Bearbeiten zeigen sie dort).
   */
  zugangAusEingabe(eingabe: Record<string, string>, config: Config, bisher: { zugang: Zugang; config: Config } | null): Zugang | null;
  /**
   * Fragt den Anbieter nach dem Konto: prüft so den Zugang. Lehnt der Anbieter die Zugangsdaten ab, mit `felder` wie bei
   * `zugangAusEingabe`; Netz- und Serverfehler liegen nicht an einem Feld und kommen ohne.
   */
  pruefen(zugang: Zugang, config: Config): Promise<Pruefung>;
  /** Weitere Prüfung der Einstellungen ohne Anbieter, etwa wie weit der Start zurückliegen darf; Meldung oder null */
  einstellungFehler?(einstellung: { fetchFrom: string; config: Config }, heute: string): string | null;
  /** Fenster des nächsten Abrufs aus dem Stand */
  fenster(fetchFrom: string, now: Date): Fenster;
  /** Holt die Bewegungen eines Fensters beim Anbieter und macht daraus eine Lieferung */
  holen(zugang: Zugang, config: Config, fenster: Fenster & { accountId: string; now: Date }): Promise<Lieferung>;
  /** Erster Tag des nächsten Abrufs nach einem erfolgreichen; `fetchFrom` ist der Stand vor dem Abruf */
  naechsterStart(stand: Fenster & { fetchFrom: string }, now: Date, lieferung: Lieferung): string;
  /** Stand nach einem fehlgeschlagenen Abruf: der bisherige, oder der Beginn des Fensters */
  standNachFehler: "bisher" | "fensterbeginn";
}
