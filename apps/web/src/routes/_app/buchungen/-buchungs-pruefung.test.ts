import { manualPostingFindings, type ManualLine, parseEuro } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buchungsFehler, buchungsMeldungen, kontoSuchfehler } from "./-buchungs-pruefung.ts";
import type { Data } from "./neu.tsx";
import { emptyRow, type Row } from "./-buchungs-zeile.tsx";

// #1277: Fehler einer Zeile am Feld, Meldungen zur ganzen Buchung erst, wenn die Zeilen stimmen
describe("Prüfung der manuellen Buchung je Feld", () => {
  const zeile = (key: number, patch: Partial<Row>): Row => ({ ...emptyRow(key), ...patch });
  const betrag = (text: string) => (text.trim() === "" ? 0 : (parseEuro(text) ?? Number.NaN));
  const pruefen = (
    rows: Row[],
    firma: { kontenrahmen: "SKR03" | "SKR04"; rechtsform: "gmbh" | "einzelunternehmen" } = { kontenrahmen: "SKR04", rechtsform: "gmbh" },
  ) => {
    const lines: ManualLine[] = rows.map((r) => ({ account: r.account, debit: betrag(r.debit), credit: betrag(r.credit), taxCode: null }));
    const findings = [...kontoSuchfehler(rows), ...manualPostingFindings(lines, firma.kontenrahmen, firma.rechtsform)];
    const { zellen, buchung } = buchungsFehler(rows, findings);
    return { fehler: Object.fromEntries(Object.entries(zellen).filter(([, e]) => e !== null)), buchung };
  };

  it("nimmt eine stimmige Buchung an und hat für jedes Feld jeder Zeile einen Schlüssel", () => {
    const rows = [zeile(1, { account: "3510", debit: "100,00" }), zeile(7, { account: "2900", credit: "100,00" })];
    expect(pruefen(rows)).toEqual({ fehler: {}, buchung: [] });
    expect(Object.keys(buchungsFehler(rows, []).zellen)).toEqual([
      "1.account",
      "1.debit",
      "1.credit",
      "1.taxCode",
      "7.account",
      "7.debit",
      "7.credit",
      "7.taxCode",
    ]);
  });

  it("meldet Konto und nicht lesbaren Betrag am Feld der Zeile, die Summe erst danach", () => {
    const rows = [zeile(1, { account: "12", debit: "100,00" }), zeile(2, { account: "2900", credit: "zehn" })];
    expect(pruefen(rows)).toEqual({
      fehler: { "1.account": "Konto hat vier Ziffern.", "2.credit": "Trag den Betrag im Haben ein, etwa 100,00, oder lass das Feld leer." },
      buchung: [],
    });
  });

  it("nennt, was die ganze Buchung betrifft, sobald die Zeilen stimmen", () => {
    const rows = [zeile(1, { account: "3510", debit: "100,00" }), zeile(2, { account: "2900", credit: "50,00" })];
    expect(pruefen(rows)).toEqual({ fehler: {}, buchung: ["Soll und Haben sind nicht gleich."] });
  });

  it("meldet einen Betrag außerhalb der Grenzen mit Seite und Grenze, „Betrag entweder …“ am Soll", () => {
    expect(pruefen([zeile(1, { account: "3510" }), zeile(2, { account: "2900", credit: "-5,00" })]).fehler).toEqual({
      "1.debit": "Betrag entweder im Soll oder im Haben.",
      "2.credit": "Trag einen Betrag von 0,00 bis 100.000.000,00 im Haben ein, etwa 100,00, oder lass das Feld leer.",
    });
    expect(pruefen([zeile(1, { account: "3510", debit: "100.000.000,01" }), zeile(2, { account: "2900", credit: "1,00" })]).fehler).toEqual({
      "1.debit": "Trag einen Betrag von 0,00 bis 100.000.000,00 im Soll ein, etwa 100,00, oder lass das Feld leer.",
    });
  });

  it("blendet bei einem Fehler in einer Zeile nur die Folgen der Beträge aus, nicht die übrigen Hinweise zur Buchung", () => {
    const rows = [zeile(1, { account: "1200", debit: "100,00" }), zeile(2, { account: "1800", credit: "zehn" })];
    const { fehler, buchung } = pruefen(rows, { kontenrahmen: "SKR03", rechtsform: "einzelunternehmen" });
    expect(Object.keys(fehler)).toEqual(["1.account", "2.credit"]);
    expect(buchung).toHaveLength(1);
    expect(buchung[0]).toMatch(/^Im Einzelunternehmen braucht der Bank-Anfangsbestand keine Buchung/);
  });

  it("nimmt bei einer Namenseingabe ohne Auswahl den Hinweis der Kontosuche statt „vier Ziffern“", () => {
    const rows = [zeile(1, { accountText: "Unbekanntes Konto", debit: "100,00" }), zeile(2, { account: "2900", credit: "100,00" })];
    expect(pruefen(rows).fehler).toEqual({ "1.account": "Konto nicht gefunden; aus der Liste wählen oder die Nummer eingeben." });
  });
});

// Review #1950: Was nur aus einem fehlenden oder falschen Konto folgt, ist wie die Summe eine Folge des Fehlers am Feld
describe("Folgemeldungen eines Kontos (Review #1950)", () => {
  const zeile = (key: number, patch: Partial<Row>): Row => ({ ...emptyRow(key), ...patch });
  const betrag = (text: string) => (text.trim() === "" ? 0 : (parseEuro(text) ?? Number.NaN));
  const buchungBei = (rows: Row[], data: Pick<Data, "kontenrahmen" | "rechtsform" | "kleinunternehmer">) => {
    const lines: ManualLine[] = rows.map((r) => ({ account: r.account, debit: betrag(r.debit), credit: betrag(r.credit), taxCode: null }));
    return buchungsFehler(rows, buchungsMeldungen(rows, lines, data as Data, "umbuchung")).buchung;
  };

  it("GmbH: „Buchen“ auf das leere Formular meldet nichts unter der Tabelle, die Fehler stehen an den Feldern", () => {
    expect(buchungBei([zeile(1, {}), zeile(2, {})], { kontenrahmen: "SKR04", rechtsform: "gmbh", kleinunternehmer: false })).toEqual([]);
  });

  it("GmbH: zwei Namenseingaben ohne Auswahl sind nicht „dasselbe Konto“", () => {
    const rows = [zeile(1, { accountText: "Bank", debit: "100,00" }), zeile(2, { accountText: "Kapital", credit: "100,00" })];
    expect(buchungBei(rows, { kontenrahmen: "SKR04", rechtsform: "gmbh", kleinunternehmer: false })).toEqual([]);
  });

  it("Einzelunternehmen SKR03: ein noch leeres Gegenkonto ist kein Bestandskonto neben dem Erfolgskonto", () => {
    const rows = [zeile(1, { account: "4900", debit: "100,00" }), zeile(2, { credit: "100,00" })];
    expect(buchungBei(rows, { kontenrahmen: "SKR03", rechtsform: "einzelunternehmen", kleinunternehmer: false })).toEqual([]);
  });
});
