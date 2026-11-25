import {
  type Abfrage,
  type Befund,
  type Hinweis,
  type Leser,
  leseMomentaufnahme,
  pruefsumme,
  type Sollbestand,
  vergleiche,
} from "@firsttris/gobd-kern/sperren";
import { type SQL, sql } from "drizzle-orm";
import type { Db } from "./index.ts";
import { sealedTables } from "./sealed-tables.ts";
import expected from "./trigger-inventory.json";

type Connection = Pick<Db, "execute">;
type Reader = { transaction<T>(read: (tx: Connection) => Promise<T>, config?: { isolationLevel: "repeatable read"; accessMode: "read only" }): Promise<T> };

/** Sollbestand von Haben: Trigger, Funktionen `haben_…`, Standardwerte versiegelter Tabellen (@firsttris/gobd-kern/sperren) */
export type TriggerInventory = Sollbestand;

export interface TriggerProblem {
  art: "sperre";
  tabelle: string;
  zeile: null;
  seq: null;
  befund: string;
}

const optionen = { schema: "public", praefix: "haben" };

/** Text mit Platzhaltern $1, $2, … als drizzle-SQL mit Parametern */
function mitWerten(text: string, werte: unknown[]): SQL {
  const teile = text.split(/\$(\d+)/);
  return sql.join(teile.map((teil, i) => (i % 2 === 0 ? sql.raw(teil) : sql`${werte[Number(teil) - 1]}`)));
}

/** Lesende Transaktion für den Kern, über drizzle */
function leser(reader: Reader): Leser {
  return {
    transaktion: (lesen) =>
      reader.transaction(
        (tx) => {
          const abfrage: Abfrage = async <T>(text: string, werte: unknown[] = []) => [...(await tx.execute(mitWerten(text, werte)))] as T[];
          return lesen(abfrage);
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  };
}

/** Der Generator behält sein Format; Laufzeitvorgaben gehören nicht zum ausgelieferten Sollbestand. */
export async function readTriggerInventory(reader: Reader): Promise<TriggerInventory> {
  return (await leseMomentaufnahme(leser(reader), { ...optionen, tabellen: sealedTables })).bestand;
}

const ohneSchema = (table: string) => table.replace(/^public\./, "");

function vorgabeText({ vorgabe }: Extract<Befund, { art: "replica" }>): string {
  const scope =
    vorgabe.bereich === "verbindung"
      ? "Vorgabe der Verbindung"
      : vorgabe.bereich === "datenbank"
        ? `Datenbank ${vorgabe.datenbank}`
        : `Rolle ${vorgabe.rolle}${vorgabe.datenbank === null ? " (alle Datenbanken)" : ` in Datenbank ${vorgabe.datenbank}`}`;
  return `Dauerhafte Voreinstellung session_replication_role = replica (${scope}); normale Trigger werden nicht ausgeführt`;
}

const zusaetzlich = { funktion: "Zusätzliche Funktion", operator: "Zusätzlicher Operator", relation: "Zusätzliche Relation" } as const;

/** Tabelle und Text eines Befunds des Kerns, wie „Kette prüfen“, Mail und Startlog sie zeigen */
export function problem(befund: Befund): { tabelle: string; befund: string } {
  const datenbank = (text: string) => ({ tabelle: "Datenbank", befund: text });
  switch (befund.art) {
    case "replica":
      return datenbank(vorgabeText(befund));
    case "trigger-fehlt":
    case "trigger-aus":
    case "trigger-veraendert": {
      const zustand =
        befund.art === "trigger-aus"
          ? `ist ${befund.zustand === "D" ? "abgeschaltet" : "nur im Replikat aktiv"}`
          : befund.art === "trigger-fehlt"
            ? "fehlt"
            : "wurde verändert";
      return { tabelle: ohneSchema(befund.tabelle), befund: `Trigger ${befund.tabelle}.${befund.trigger} ${zustand}` };
    }
    case "funktion-fehlt":
    case "funktion-veraendert":
      return {
        tabelle: befund.tabelle === null ? "Funktionen" : ohneSchema(befund.tabelle),
        befund: `Funktion ${befund.funktion} ${befund.art === "funktion-fehlt" ? "fehlt" : "wurde verändert"}`,
      };
    case "standardwert-fehlt":
    case "standardwert-veraendert":
    case "standardwert-zusaetzlich": {
      const spalte = `${ohneSchema(befund.tabelle)}.${befund.spalte}`;
      const text =
        befund.art === "standardwert-fehlt"
          ? `Standardwert von ${spalte} fehlt`
          : befund.art === "standardwert-veraendert"
            ? `Standardwert von ${spalte} wurde verändert`
            : `Zusätzlicher Standardwert von ${spalte}`;
      return { tabelle: ohneSchema(befund.tabelle), befund: text };
    }
    case "zeilensicherheit-eingeschaltet":
      return { tabelle: befund.tabelle, befund: `Zeilensicherheit auf ${befund.tabelle} eingeschaltet` };
    case "zeilensicherheit-erzwungen":
      return { tabelle: befund.tabelle, befund: `Zeilensicherheit auf ${befund.tabelle} erzwungen` };
    case "policy":
      return { tabelle: befund.tabelle, befund: `Policy ${befund.policy} auf ${befund.tabelle} angelegt` };
    case "objekt-im-systemschema":
      return datenbank(`${zusaetzlich[befund.objektart]} ${befund.name} im Systemschema pg_catalog`);
    case "objekt-ueberdeckt":
      if (befund.objektart === "relation") return datenbank(`Relation ${befund.name} überdeckt eine gleichnamige Tabelle`);
      return datenbank(
        `${zusaetzlich[befund.objektart]} ${befund.name} überdeckt ${befund.objektart === "funktion" ? "eine gleichnamige Funktion" : "einen gleichnamigen Operator"}`,
      );
    case "cast":
      return datenbank(`Zusätzlicher Cast ${befund.name}`);
    case "schema-im-suchpfad":
      return datenbank(`Schema ${befund.schema} im Suchpfad der Verbindung`);
    case "pg-catalog-nicht-vorn":
      return datenbank("pg_catalog steht im Suchpfad der Verbindung nicht vorn");
    case "eingebaute-fehlt":
      return datenbank(`Eingebaute Funktion ${befund.funktion} fehlt oder wurde verändert`);
    case "eingebaute-veraendert":
      return datenbank(`Eingebaute Funktion ${befund.funktion} wurde verändert`);
    case "eingebaute-ersetzt":
      return datenbank(`Eingebaute Funktion ${befund.funktion} durch eigenen Code ersetzt`);
  }
}

/** Text eines Hinweises des Kerns */
export function hinweisText(hinweis: Hinweis): string {
  switch (hinweis.art) {
    case "trigger-zusaetzlich":
      return `Zusätzlicher Trigger ${hinweis.tabelle}.${hinweis.trigger}`;
    case "objekt-zusaetzlich":
      return `${zusaetzlich[hinweis.objektart]} ${hinweis.name}`;
    case "eingebaute-nicht-geprueft":
      return `Eingebaute Funktionen nicht geprüft: Der Sollbestand gilt für PostgreSQL ${hinweis.soll}, der Server hat ${hinweis.ist}`;
  }
}

/** Prüfsumme des eigenen Bestands und die des ausgelieferten Sollbestands, die auch in den Release Notes steht (#1683) */
export interface InventoryChecksum {
  own: string;
  shipped: string;
}

/**
 * Befunde, Hinweise und Prüfsumme aus einer Momentaufnahme. Der ausgelieferte Sollbestand stammt aus frischen
 * Testmigrationen, niemals aus der geprüften Instanz.
 */
export async function checkTriggerInventory(reader: Reader): Promise<{ problems: TriggerProblem[]; hints: string[]; checksum: InventoryChecksum }> {
  const ist = await leseMomentaufnahme(leser(reader), { ...optionen, tabellen: expected.sealedTables });
  const { befunde, hinweise } = vergleiche(expected, ist, optionen.schema);
  return {
    problems: befunde.map((befund) => ({ art: "sperre", ...problem(befund), zeile: null, seq: null })),
    hints: hinweise.map(hinweisText),
    checksum: { own: pruefsumme(ist.bestand), shipped: pruefsumme(expected) },
  };
}

/** Befunde und Hinweise ohne Prüfsumme */
export async function checkTriggerIntegrity(reader: Reader): Promise<{ problems: TriggerProblem[]; hints: string[] }> {
  const { problems, hints } = await checkTriggerInventory(reader);
  return { problems, hints };
}

/**
 * Eine Zeile beim Start; Befunde verhindern den Betrieb nicht und werden niemals automatisch repariert. `write` bekommt mit,
 * ob es Befunde gibt, damit der Logger sie als Warnung schreibt (plugins/trigger-integrity.ts).
 */
export async function logTriggerIntegrity(reader: Reader, write: (line: string, befunde: boolean) => void): Promise<void> {
  const result = await checkTriggerIntegrity(reader);
  write(
    `Sperrtrigger: ${result.problems.length} Befunde, ${result.hints.length} Hinweise${result.problems.length + result.hints.length === 0 ? "" : `; ${[...result.problems.map((p) => `${p.tabelle}: ${p.befund}`), ...result.hints].join("; ")}`}`,
    result.problems.length > 0,
  );
}
