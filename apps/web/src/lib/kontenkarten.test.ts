import { describe, expect, it } from "vitest";
import { importWeg, type KontoEingabe, kontenkarten, kartenStatus, zeitText } from "./kontenkarten.ts";

// 26.11.2026, 12:00 in Deutschland
const jetzt = new Date("2026-11-26T11:00:00Z");

const konto = (teil: Partial<KontoEingabe> & { id: string }): KontoEingabe => ({
  name: teil.id,
  purpose: "geschaeft",
  openCount: 0,
  providerBalance: null,
  lastImport: null,
  ...teil,
});

describe("importWeg", () => {
  it("nennt Abrufe nach ihrem Weg und alle Dateien „Datei“", () => {
    expect(importWeg("fints")).toBe("FinTS");
    expect(importWeg("enablebanking")).toBe("Abruf");
    expect(importWeg("stripe-api")).toBe("Stripe");
    expect(importWeg("paypal-api")).toBe("PayPal");
    expect(importWeg("importvertrag-v1")).toBe("REST-Import");
    expect(importWeg("camt.053")).toBe("Datei");
    expect(importWeg("stripe-csv")).toBe("Datei");
    expect(importWeg("dkb-csv")).toBe("Datei");
  });
});

describe("zeitText", () => {
  it("heute mit Uhrzeit in deutscher Zeit, sonst Tag und Monat", () => {
    expect(zeitText("2026-11-26T05:00:00Z", jetzt)).toBe("heute 06:00");
    expect(zeitText("2026-11-25T23:30:00Z", jetzt)).toBe("heute 00:30");
    expect(zeitText("2026-11-25T22:30:00Z", jetzt)).toBe("25.11.");
    expect(zeitText("2026-11-13T09:00:00Z", jetzt)).toBe("13.11.");
  });
});

describe("kartenStatus", () => {
  const frisch = "2026-11-26T05:00:00Z";

  it("ohne Abweichung kein Status", () => {
    expect(kartenStatus(undefined, 0, frisch, jetzt)).toBeNull();
    expect(kartenStatus(undefined, 0, null, jetzt)).toBeNull();
  });

  it("älter als 7 Tage: veraltet mit Datum; genau 7 Tage noch nicht", () => {
    expect(kartenStatus(undefined, 0, "2026-11-13T09:00:00Z", jetzt)).toEqual({ text: "Veraltet", tone: "warn", emphasis: "notice", detail: "13.11." });
    expect(kartenStatus(undefined, 0, "2026-11-19T09:00:00Z", jetzt)).toBeNull();
  });

  it("offene Konflikte mit Zahl der Umsätze", () => {
    expect(kartenStatus(undefined, 3, frisch, jetzt)).toEqual({ text: "Konflikt", tone: "warn", emphasis: "notice", detail: "3 Umsätze" });
    expect(kartenStatus(undefined, 1, frisch, jetzt)?.detail).toBe("1 Umsatz");
  });

  it("fehlgeschlagener Abruf ist dringend und geht Konflikt und Alter vor", () => {
    const zugang = {
      bankAccountId: "a",
      art: "psp" as const,
      verbindungId: "v-a",
      weg: "Stripe",
      lastSyncAt: "2026-11-01T05:00:00Z",
      fehler: "Schlüssel abgelehnt",
    };
    expect(kartenStatus(zugang, 2, "2026-11-01T05:00:00Z", jetzt)).toEqual({ text: "Fehlgeschlagen", tone: "danger", emphasis: "urgent", detail: null });
  });

  it("Ablauf der Zustimmung: ab 7 Tagen vorher dringend, abgelaufen immer", () => {
    const zugang = { bankAccountId: "a", art: "enablebanking" as const, verbindungId: "v-a", weg: "Abruf", lastSyncAt: frisch, fehler: null };
    expect(kartenStatus({ ...zugang, laeuftAbAm: "2026-12-07T10:00:00Z" }, 0, frisch, jetzt)).toEqual({
      text: "Läuft ab",
      tone: "warn",
      emphasis: "notice",
      detail: "in 11 Tagen",
    });
    expect(kartenStatus({ ...zugang, laeuftAbAm: "2026-12-03T10:00:00Z" }, 0, frisch, jetzt)?.emphasis).toBe("urgent");
    expect(kartenStatus({ ...zugang, abgelaufen: true }, 0, frisch, jetzt)).toMatchObject({ text: "Abgelaufen", emphasis: "urgent" });
  });

  it("wartet die Bank auf eine Freigabe (TAN), nennt die Karte das vor Konflikt und Alter", () => {
    const zugang = {
      bankAccountId: "a",
      art: "fints" as const,
      verbindungId: "v-a",
      weg: "FinTS",
      lastSyncAt: "2026-11-01T05:00:00Z",
      fehler: null,
      freigabe: true,
    };
    expect(kartenStatus(zugang, 2, "2026-11-01T05:00:00Z", jetzt)).toEqual({ text: "Freigabe nötig", tone: "warn", emphasis: "notice", detail: null });
  });
});

describe("kontenkarten", () => {
  const accounts = [
    konto({ id: "paypal", name: "PayPal", purpose: "zahlungsdienstleister", openCount: 5, providerBalance: 8820 }),
    konto({ id: "giro", name: "Geschäftskonto", openCount: 9, lastImport: { format: "fints", createdAt: "2026-11-26T05:00:00Z", closingBalance: 1248000 } }),
    konto({ id: "steuer", name: "Steuerkonto", lastImport: { format: "camt.053", createdAt: "2026-11-13T09:00:00Z", closingBalance: 420000 } }),
    konto({ id: "neu", name: "Neues Konto" }),
  ];

  it("Banken vor Zahlungsdienstleistern, Saldo je Art, Weg und Zeit aus Zugang oder Import", () => {
    const { karten } = kontenkarten({
      accounts,
      zugaenge: [
        { bankAccountId: "paypal", art: "psp" as const, verbindungId: "v-paypal", weg: "PayPal", lastSyncAt: new Date("2026-11-26T05:00:00Z"), fehler: null },
      ],
      konflikte: [],
      jetzt,
    });
    expect(karten.map((k) => [k.id, k.gruppe, k.saldo, k.quelle])).toEqual([
      ["giro", "banken", 1248000, "FinTS · heute 06:00"],
      ["steuer", "banken", 420000, "Datei · 13.11."],
      ["neu", "banken", null, "Noch kein Import"],
      ["paypal", "zahlungsdienstleister", 8820, "PayPal · heute 06:00"],
    ]);
  });

  it("der spätere Stand aus Zugang und Import zählt; Konflikte je Konto; „Alle Konten“ zählt Konten mit Status", () => {
    const ergebnis = kontenkarten({
      accounts,
      // Der Abruf lief heute ohne neue Umsätze: nicht veraltet, obwohl der letzte Import älter ist
      zugaenge: [
        { bankAccountId: "steuer", art: "fints" as const, verbindungId: "v-steuer", weg: "FinTS", lastSyncAt: "2026-11-26T05:00:00Z", fehler: null },
        { bankAccountId: "paypal", art: "psp" as const, verbindungId: "v-paypal", weg: "PayPal", lastSyncAt: null, fehler: "PayPal lehnt den Zugang ab." },
      ],
      konflikte: [{ bankAccountId: "giro" }, { bankAccountId: "giro" }],
      jetzt,
    });
    const status = Object.fromEntries(ergebnis.karten.map((k) => [k.id, k.status?.text ?? null]));
    expect(status).toEqual({ giro: "Konflikt", steuer: null, neu: null, paypal: "Fehlgeschlagen" });
    expect(ergebnis.karten.find((k) => k.id === "steuer")?.quelle).toBe("FinTS · heute 06:00");
    expect(ergebnis.alle).toEqual({ konten: 4, offen: 14, mitStatus: 2 });
  });

  it("von zwei Zugängen eines Kontos geht der fehlgeschlagene vor", () => {
    const { karten } = kontenkarten({
      accounts: [accounts[1]!],
      zugaenge: [
        { bankAccountId: "giro", art: "enablebanking" as const, verbindungId: "v-giro", weg: "Abruf", lastSyncAt: "2026-11-26T05:00:00Z", fehler: null },
        { bankAccountId: "giro", art: "fints" as const, verbindungId: "v-giro", weg: "FinTS", lastSyncAt: "2026-11-20T05:00:00Z", fehler: "PIN ungültig" },
      ],
      konflikte: [],
      jetzt,
    });
    expect(karten[0]?.status?.text).toBe("Fehlgeschlagen");
    // Die Karte nennt den fehlgeschlagenen Zugang und seinen Fehler, damit der Hinweis ihn lösen kann
    expect(karten[0]).toMatchObject({ zugang: { art: "fints", verbindungId: "v-giro" }, fehler: "PIN ungültig" });
  });

  it("ein Konto ohne Zugang hat weder Verbindung noch Fehler", () => {
    const { karten } = kontenkarten({ accounts: [accounts[2]!], zugaenge: [], konflikte: [], jetzt });
    expect(karten[0]).toMatchObject({ zugang: null, fehler: null });
  });
});
