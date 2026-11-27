import type { BankCsvMapping } from "@haben/import/bank-zuordnung";
import { describe, expect, it } from "vitest";
import { zuordnungNachladen } from "./bank-csv-zuordnung-start.ts";

const RECORDS = [
  { line: 1, cells: ["Buchungstag", "Gegenpartei", "Text", "Betrag"] },
  { line: 2, cells: ["2026-10-01", "Hafen Immobilien", "Miete Oktober", "-1190,00"] },
];

const STORED: BankCsvMapping = {
  header: ["Buchungstag", "Gegenpartei", "Text", "Betrag"],
  columns: {
    bookingDate: 0,
    amount: 3,
    counterpartyName: 1,
    purpose: 2,
  },
  amountFormat: "de",
};

describe("zuordnungNachladen", () => {
  it("übernimmt eine nachträglich geladene Zuordnung am Konto, solange im Dialog nichts geändert wurde", () => {
    const anfang = zuordnungNachladen(null, RECORDS, null, false);
    expect(anfang.saved).toBe(false);

    const nachgeladen = zuordnungNachladen(anfang, RECORDS, STORED, false);
    expect(nachgeladen.saved).toBe(true);
    expect(nachgeladen.mapping.columns.purpose).toBe(2);
  });

  it("überschreibt Änderungen des Nutzers nicht mehr", () => {
    const anfang = zuordnungNachladen(null, RECORDS, null, false);
    const geaendert = { ...anfang, mapping: { ...anfang.mapping, columns: { ...anfang.mapping.columns, purpose: null } }, saved: false };

    const danach = zuordnungNachladen(geaendert, RECORDS, STORED, true);
    expect(danach).toBe(geaendert);
  });

  it("behält den bisherigen Stand, wenn die nachgeladene Zuordnung nicht zur Kopfzeile passt", () => {
    const anfang = zuordnungNachladen(null, RECORDS, null, false);
    const fremd: BankCsvMapping = { ...STORED, header: ["Datum", "Wert"] };

    const danach = zuordnungNachladen(anfang, RECORDS, fremd, false);
    expect(danach).toBe(anfang);
  });

  it("übernimmt eine aktualisierte gespeicherte Zuordnung, wenn der Dialog vor router.invalidate() noch den alten Stand sah", () => {
    const alt = zuordnungNachladen(null, RECORDS, STORED, false);
    expect(alt.saved).toBe(true);
    expect(alt.mapping.columns.purpose).toBe(2);

    const aktualisiert: BankCsvMapping = {
      ...STORED,
      columns: { ...STORED.columns, purpose: null },
    };
    const danach = zuordnungNachladen(alt, RECORDS, aktualisiert, false);
    expect(danach.saved).toBe(true);
    expect(danach.mapping.columns.purpose).toBeNull();
  });
});
