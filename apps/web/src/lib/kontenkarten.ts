import { daysUntil, formatDayMonth, formatTime } from "./format.ts";

/*
 * Stand der Karten auf der Bankseite (#1951): je Konto Saldo, offene Umsätze, Weg und Zeit des letzten Abrufs oder Imports
 * und ein Status nur bei Abweichung. Eine Stelle für alle Konten, damit Karte, Chip und „Alle Konten“ dasselbe sagen.
 */

/** Ab so vielen Tagen ohne Import oder Abruf gilt ein Konto als veraltet */
export const VERALTET_TAGE = 7;
/** Läuft die Zustimmung in höchstens so vielen Tagen ab, ist es dringend, wie bei den Fristen (DESIGN.md › Status) */
const DRINGEND_TAGE = 7;

/**
 * Ein Zugang, der ein Konto abruft: FinTS, Enable Banking, Stripe, PayPal. Heute aus den Tabellen je Weg zusammengestellt;
 * eine gemeinsame Tabelle der Verbindungen (#1729) liefert später dieselben Felder.
 */
export type KontoZugang = {
  bankAccountId: string;
  /** Art und ID der Verbindung, damit Karte und Seite Verbindungen sie abrufen oder bearbeiten können */
  art: ZugangArt;
  verbindungId: string;
  /** Wie der Weg auf der Karte heißt: „FinTS“, „Abruf“, „Stripe“, „PayPal“ */
  weg: string;
  /** Letzter erfolgreicher Abruf */
  lastSyncAt: string | Date | null;
  /** Fehler des letzten Abrufs; nur ein echter Fehlschlag, kein Konflikt */
  fehler: string | null;
  /** Die Bank wartet auf eine Freigabe, etwa eine TAN (FinTS) */
  freigabe?: boolean;
  /** Zustimmung abgelaufen (Enable Banking) */
  abgelaufen?: boolean;
  /** Ende der Zustimmung, nur wenn es bald kommt (Enable Banking) */
  laeuftAbAm?: string | Date | null;
};

export type ZugangArt = "enablebanking" | "fints" | "psp";

export type KontoEingabe = {
  id: string;
  name: string;
  purpose: string;
  openCount: number;
  providerBalance: number | null;
  lastImport: { format: string; createdAt: string | Date; closingBalance: number | null } | null;
};

export type KartenStatus = { text: string; tone: "warn" | "danger"; emphasis: "notice" | "urgent"; detail: string | null };

export type Kontokarte = {
  id: string;
  name: string;
  gruppe: "banken" | "zahlungsdienstleister";
  /** Kontostand der letzten Datei bzw. beim Dienstleister die Summe der Umsätze; null, wenn keiner bekannt ist */
  saldo: number | null;
  offen: number;
  /** Leise Zeile im Normalfall: Weg und Zeit, etwa „FinTS · heute 06:00“ */
  quelle: string;
  status: KartenStatus | null;
  /** Verbindung, die das Konto abruft; null bei einem Konto, das nur Dateien bekommt */
  zugang: { art: ZugangArt; verbindungId: string } | null;
  /** Fehler des letzten Abrufs im Wortlaut, für den Hinweis zum gewählten Konto */
  fehler: string | null;
};

export type Kontenkarten = {
  karten: Kontokarte[];
  /** Karte „Alle Konten“: Zahl der Konten, offene Umsätze und Konten mit Status */
  alle: { konten: number; offen: number; mitStatus: number };
};

/** Weg eines Imports nach seinem Format; Dateien heißen einfach „Datei“ */
export function importWeg(format: string): string {
  if (format === "fints") return "FinTS";
  if (format === "enablebanking") return "Abruf";
  if (format.startsWith("importvertrag")) return "REST-Import";
  const abruf: Record<string, string> = {
    "stripe-api": "Stripe",
    "paypal-api": "PayPal",
    "etsy-ledger": "Etsy",
    "store-payout": "Auszahlung",
  };
  return abruf[format] ?? "Datei";
}

/** „heute 06:00“ am selben Tag, sonst „13.11.“ */
export function zeitText(zeit: string | Date, jetzt: Date): string {
  return daysUntil(zeit, jetzt) === 0 ? `heute ${formatTime(zeit)}` : formatDayMonth(zeit);
}

const spaeter = (a: string | Date | null | undefined, b: string | Date | null | undefined) => {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
};

/** Status bei Abweichung, das Dringendste zuerst: Fehlschlag, Ablauf der Zustimmung, Freigabe, Konflikt, bald Ablauf, veraltet */
export function kartenStatus(zugang: KontoZugang | undefined, konflikte: number, letzterStand: string | Date | null, jetzt: Date): KartenStatus | null {
  if (zugang?.fehler) return { text: "Fehlgeschlagen", tone: "danger", emphasis: "urgent", detail: null };
  if (zugang?.abgelaufen) return { text: "Abgelaufen", tone: "warn", emphasis: "urgent", detail: null };
  if (zugang?.freigabe) return { text: "Freigabe nötig", tone: "warn", emphasis: "notice", detail: null };
  if (konflikte > 0) return { text: "Konflikt", tone: "warn", emphasis: "notice", detail: `${konflikte} ${konflikte === 1 ? "Umsatz" : "Umsätze"}` };
  if (zugang?.laeuftAbAm) {
    const tage = Math.max(daysUntil(zugang.laeuftAbAm, jetzt), 0);
    const detail = tage === 0 ? "heute" : `in ${tage} ${tage === 1 ? "Tag" : "Tagen"}`;
    return { text: "Läuft ab", tone: "warn", emphasis: tage <= DRINGEND_TAGE ? "urgent" : "notice", detail };
  }
  if (letzterStand && -daysUntil(letzterStand, jetzt) > VERALTET_TAGE)
    return { text: "Veraltet", tone: "warn", emphasis: "notice", detail: formatDayMonth(letzterStand) };
  return null;
}

/** Karten aller Konten, Banken vor Zahlungsdienstleistern, innerhalb der Gruppe in der Reihenfolge der Eingabe */
export function kontenkarten(input: {
  accounts: readonly KontoEingabe[];
  zugaenge: readonly KontoZugang[];
  /** Offene Konflikte im Abruf, je einer mit seinem Konto */
  konflikte: readonly { bankAccountId: string }[];
  jetzt: Date;
}): Kontenkarten {
  const karten = input.accounts.map((account): Kontokarte => {
    // Mehrere Zugänge an einem Konto: ein fehlgeschlagener geht vor
    const eigene = input.zugaenge.filter((z) => z.bankAccountId === account.id);
    const zugang = eigene.find((z) => z.fehler) ?? eigene[0];
    const konflikte = input.konflikte.filter((k) => k.bankAccountId === account.id).length;
    const stand = spaeter(zugang?.lastSyncAt, account.lastImport?.createdAt);
    const weg = zugang?.weg ?? (account.lastImport ? importWeg(account.lastImport.format) : null);
    const zahlungsdienstleister = account.purpose === "zahlungsdienstleister";
    return {
      id: account.id,
      name: account.name,
      gruppe: zahlungsdienstleister ? "zahlungsdienstleister" : "banken",
      saldo: zahlungsdienstleister ? account.providerBalance : (account.lastImport?.closingBalance ?? null),
      offen: account.openCount,
      quelle: weg ? (stand ? `${weg} · ${zeitText(stand, input.jetzt)}` : weg) : "Noch kein Import",
      status: kartenStatus(zugang, konflikte, stand, input.jetzt),
      zugang: zugang ? { art: zugang.art, verbindungId: zugang.verbindungId } : null,
      fehler: zugang?.fehler ?? null,
    };
  });
  const sortiert = [...karten.filter((k) => k.gruppe === "banken"), ...karten.filter((k) => k.gruppe === "zahlungsdienstleister")];
  return {
    karten: sortiert,
    alle: { konten: karten.length, offen: karten.reduce((summe, k) => summe + k.offen, 0), mitStatus: karten.filter((k) => k.status).length },
  };
}
