import { germanDay } from "@haben/core";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatDateTime, formatLongDate } from "../../lib/format.ts";

// Die Aufgaben der Übersicht im Einzelnen: Text, Ziel samt Bereich der Einstellungen und Reihenfolge der Seite
const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../server/functions/backup.ts", () => ({}));
vi.mock("../../server/functions/invoices.ts", () => ({}));
vi.mock("../../server/functions/vat.ts", () => ({}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("../../server/functions/finanzamt.ts", () => ({ markPostfachDocument: () => undefined }));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({ ausgeblendet: [] }),
  createFileRoute: () => (options: unknown) => ({
    options,
    useLoaderData: () => state.data,
    useRouteContext: () => ({ einrichtung: null }),
  }),
  // Die Seite nutzt den Router nur zum Neuladen nach dem Abhaken eines Bescheids
  useRouter: () => ({ invalidate: async () => undefined }),
  // Der Bereich der Einstellungen hängt am Ziel, damit ein Test ihn sieht
  Link: ({ children, to, search, className }: { children: ReactNode; to: string; search?: { bereich?: string }; className?: string }) =>
    createElement("a", { href: search?.bereich ? `${to}?bereich=${search.bereich}` : to, className }, children),
}));
import { Route } from "./index.tsx";

const inTagen = (n: number) => {
  const tag = new Date(`${germanDay()}T12:00:00Z`);
  tag.setUTCDate(tag.getUTCDate() + n);
  return tag.toISOString().slice(0, 10);
};

const konto = (felder: Record<string, unknown>) => ({
  id: "k",
  name: "Konto",
  purpose: "geschaeft",
  balance: null,
  balanceDate: null,
  openCount: 0,
  staleOpenCount: 0,
  ...felder,
});

function fixture() {
  return {
    period: { year: 2026, month: 10 },
    previousMonth: { year: 2026, month: 10 },
    computedKz83: 0,
    transit: 0,
    vatPaid: 0,
    vatOpen: [] as unknown[],
    dueDate: inTagen(30),
    /** Erster Buchungsmonat (JJJJ-MM); ohne Buchung der heutige Monat */
    ersterBuchungsmonat: "2026-01",
    exempt: false,
    kleinunternehmer: false,
    afaPending: [] as unknown[],
    appeals: [] as unknown[],
    current: null,
    recent: [],
    certificate: { filename: "elster.pfx", validUntil: inTagen(365) } as { filename: string; validUntil: string | null } | null,
    companyIssues: [] as string[],
    companyName: "Musterfirma",
    mode: "echt",
    ustIdUngueltig: [] as unknown[],
    invoices: {
      openTotal: 0,
      openCount: 0,
      overdueCount: 0,
      drafts: 0,
      recent: [],
      bank: [] as unknown[],
      payables: { total: 0, count: 0, overdueCount: 0, nextDue: null },
      revenuePreviousMonth: 0,
    },
    backup: { failed: [] as unknown[], overdue: false, state: "ok", lastBackup: null as { at: string } | null },
  };
}

let data = fixture();
const render = () => renderToStaticMarkup(createElement(Route.options.component as ComponentType));
const titel = (html: string) => [...html.matchAll(/<span class="todo-title">([^<]*)<\/span>/g)].map((m) => m[1]);
/** Ziel und Text einer Aufgabe, gefunden über ihren Titel */
const aufgabe = (html: string, title: string) => {
  const m = html.match(
    new RegExp(`<a href="([^"]*)" class="todo">(?:(?!</a>).)*?<span class="todo-title">${title}</span><span class="small muted">([^<]*)</span>`),
  );
  return m ? { href: m[1], detail: m[2] } : null;
};

beforeEach(() => {
  data = fixture();
  state.data = data;
});

describe("Übersicht: Reihenfolge der Aufgaben", () => {
  // Bei gleicher Dringlichkeit bleibt die Reihenfolge der Seite (ordneAufgaben); sie hält dieser Test fest
  it("alle Arten zugleich: nahe Frist, dann Warnungen, Hinweise und Anstehendes je in der Reihenfolge der Seite", () => {
    data.vatOpen = [{ vatReturnId: "v9", year: 2026, month: 9, offen: 1900, faellig: inTagen(-5), berichtigt: false }];
    data.computedKz83 = 100000;
    data.ustIdUngueltig = [{ contactId: "c1", kontakt: "Donaublick GmbH", nummer: "ATU12345678", meldung: "Nicht gültig" }];
    data.invoices.bank = [
      konto({ id: "s1", name: "Rücklage", purpose: "steuer", balance: 20000 }),
      konto({ id: "p1", name: "Stripe", purpose: "zahlungsdienst", openCount: 1, staleOpenCount: 1 }),
      konto({ id: "g1", name: "Girokonto", balance: 100, openCount: 2 }),
    ];
    data.transit = 50000;
    data.invoices.overdueCount = 2;
    data.appeals = [{ id: "b1", veranlagungszeitraum: 2025, datenart: "DivaBescheidESt", fristende: inTagen(30) }];
    data.afaPending = [{ year: 2025, count: 1 }];
    data.invoices.drafts = 1;
    data.companyIssues = ["Steuernummer fehlt"];
    data.certificate = null;
    data.backup = {
      failed: [
        { kind: "backup", run: { at: "2026-11-20T03:00:00Z", message: "" } },
        { kind: "check", run: { at: "2026-11-21T03:00:00Z", message: "" } },
      ],
      overdue: true,
      state: "fehler",
      lastBackup: null,
    };
    expect(titel(render())).toEqual([
      "Umsatzsteuer September 2026 nicht bezahlt",
      "USt-IdNr. von Donaublick GmbH laut BZSt nicht gültig",
      "Steuerkonto Rücklage deckt die Zahllast nicht",
      "Geldtransit nicht ausgeglichen",
      "2 Rechnungen überfällig",
      "Firmendaten vervollständigen",
      "Backup fehlgeschlagen",
      "Test-Restore fehlgeschlagen",
      "Backup überfällig",
      "Voranmeldung Oktober 2026 senden",
      "Stripe: 1 Umsatz seit über zwei Wochen offen",
      "3 Bankumsätze ohne Zuordnung",
      "Bescheid 2025 prüfen",
      "Abschreibung (AfA) 2025 buchen",
      "1 Rechnungsentwurf",
      "ELSTER-Zertifikat hinterlegen",
    ]);
  });

  it("ohne Anlass: „Alles erledigt.“", () => {
    data.exempt = true;
    expect(titel(render())).toEqual([]);
    expect(render()).toContain("Alles erledigt.");
  });
});

describe("Übersicht: Voranmeldung vor dem ersten Buchungsmonat", () => {
  // Wie die Fristen (finanzamt/fristen.ts): Was vor dem Start in Haben endete, ist nicht in Haben zu melden, sondern lag davor
  const quartal3 = { year: 2026, month: 43 };

  it("ein Zeitraum, der vor dem ersten Buchungsmonat endete, steht nicht als fällig oder überfällig da", () => {
    data.period = quartal3;
    data.dueDate = "2026-10-12";
    data.ersterBuchungsmonat = "2026-11";
    expect(titel(render())).toEqual([]);
    expect(render()).not.toContain("Fällig");
  });

  it("ab dem Monat, in dem der Zeitraum endet, bleibt die Aufgabe wie bisher", () => {
    data.period = quartal3;
    data.dueDate = "2026-10-12";
    data.ersterBuchungsmonat = "2026-09";
    expect(aufgabe(render(), "Voranmeldung 3. Quartal 2026 senden")).toEqual({
      href: "/umsatzsteuer/$zeitraum",
      detail: `Fällig ${formatLongDate("2026-10-12")}`,
    });
    data.ersterBuchungsmonat = "2026-07";
    expect(titel(render())).toEqual(["Voranmeldung 3. Quartal 2026 senden"]);
  });

  it("eine unbezahlte Voranmeldung eines früheren Zeitraums bleibt davon unberührt", () => {
    data.period = quartal3;
    data.ersterBuchungsmonat = "2026-11";
    data.vatOpen = [{ vatReturnId: "v2", year: 2026, month: 42, offen: 1900, faellig: inTagen(-5), berichtigt: false }];
    expect(titel(render())).toEqual(["Umsatzsteuer 2. Quartal 2026 nicht bezahlt"]);
  });

  it.each([
    ["Monatszeitraum, Start im Monat danach", { year: 2026, month: 10 }, "2026-11", false],
    ["Monatszeitraum, Start im Monat selbst", { year: 2026, month: 10 }, "2026-10", true],
    ["4. Quartal 2025, Start im Januar 2026", { year: 2025, month: 44 }, "2026-01", false],
    ["4. Quartal 2025, Start im Dezember 2025", { year: 2025, month: 44 }, "2025-12", true],
  ])("%s: Aufgabe da = %s", (_name, period, start, da) => {
    data.period = period;
    data.ersterBuchungsmonat = start;
    expect(titel(render()).some((t) => t?.startsWith("Voranmeldung "))).toBe(da);
  });
});

describe("Übersicht: Kennzahl „USt-Zahllast“ vor dem ersten Buchungsmonat", () => {
  // Die Kennzahlenreihe erscheint erst, wenn es Zahlen gibt (ohneKennzahlen)
  const mitZahlen = (start: string) => {
    data.period = { year: 2026, month: 43 };
    data.dueDate = "2026-10-12";
    data.ersterBuchungsmonat = start;
    data.invoices.openCount = 1;
  };

  it("ein Zeitraum vor dem ersten Buchungsmonat zeigt keine fällige Voranmeldung", () => {
    mitZahlen("2026-11");
    const html = render();
    expect(html).toContain("Offene Forderungen");
    expect(html).not.toContain("Voranmeldung fällig");
    expect(html).not.toContain("USt-Zahllast");
  });

  it("eine Zahllast aus Kz 39 (Sondervorauszahlung) vor dem Start macht den Zeitraum nicht fällig", () => {
    mitZahlen("2026-11");
    data.computedKz83 = -100000;
    expect(render()).not.toContain("Voranmeldung fällig");
  });

  it("eine Zahllast vor dem Start meldet kein zu knappes Steuerkonto", () => {
    mitZahlen("2026-11");
    data.computedKz83 = 50000;
    data.invoices.bank = [konto({ id: "s1", name: "Rücklage", purpose: "steuer", balance: 0 })];
    expect(titel(render())).toEqual([]);
  });

  it("die Steuerkonto-Karte schreibt vor dem Start nicht „bezahlt“, sondern „keine Zahllast offen“", () => {
    mitZahlen("2026-11");
    data.computedKz83 = 50000;
    data.invoices.bank = [konto({ id: "s1", name: "Rücklage", purpose: "steuer", balance: 0 })];
    const html = render();
    expect(html).toContain("keine Zahllast offen");
    expect(html).not.toContain("bezahlt");
  });

  it("ab dem Startmonat nennt die Steuerkonto-Karte, was fehlt", () => {
    mitZahlen("2026-09");
    data.computedKz83 = 50000;
    data.invoices.bank = [konto({ id: "s1", name: "Rücklage", purpose: "steuer", balance: 0 })];
    expect(render()).toContain("es fehlen 500,00");
  });

  it("die Steuerkonto-Aufgabe nennt vor dem Start weder den Zeitraum noch dessen Frist, sondern die offenen Voranmeldungen", () => {
    mitZahlen("2026-11");
    data.period = { year: 2026, month: 10 };
    data.vatOpen = [{ vatReturnId: "v9", year: 2026, month: 9, offen: 1900, faellig: inTagen(-5), berichtigt: false }];
    data.invoices.bank = [konto({ id: "s1", name: "Rücklage", purpose: "steuer", balance: 0 })];
    expect(aufgabe(render(), "Steuerkonto Rücklage deckt die Zahllast nicht")?.detail).toBe("Es fehlen 19,00\u00a0€ für offene Voranmeldungen");
  });

  it("allein eine Zahllast vor dem Start hält die Kennzahlenreihe nicht", () => {
    data.period = { year: 2026, month: 43 };
    data.ersterBuchungsmonat = "2026-11";
    data.computedKz83 = 7600;
    expect(render()).not.toContain("grid-4");
    data.ersterBuchungsmonat = "2026-09";
    expect(render()).toContain("USt-Zahllast");
  });

  it("ab dem Startmonat bleibt die Karte wie bisher", () => {
    mitZahlen("2026-09");
    expect(render()).toContain(`Voranmeldung fällig ${formatDate("2026-10-12")}`);
  });

  it("mit gespeichertem Entwurf bleibt alles wie bisher: Aufgabe und Karte", () => {
    mitZahlen("2026-11");
    data.current = { status: "draft", kz83: 0 } as unknown as typeof data.current;
    const html = render();
    expect(titel(html)).toContain("Voranmeldung 3. Quartal 2026 senden");
    expect(html).toContain(`Voranmeldung fällig ${formatDate("2026-10-12")}`);
  });
});

describe("Übersicht: Aufgaben zur Bank", () => {
  it("Steuerkonto, Zahlungsdienstleister und offene Umsätze nennen Konto, Zahl und Betrag", () => {
    data.computedKz83 = 100000;
    data.invoices.bank = [
      konto({ id: "s1", name: "Rücklage", purpose: "steuer", balance: 20000 }),
      konto({ id: "p1", name: "PayPal", purpose: "zahlungsdienst", openCount: 3, staleOpenCount: 2 }),
    ];
    const html = render();
    expect(aufgabe(html, "Steuerkonto Rücklage deckt die Zahllast nicht")).toEqual({
      href: "/bank",
      detail: `Es fehlen 800,00\u00a0€ für Oktober 2026, fällig ${formatLongDate(data.dueDate)}`,
    });
    expect(aufgabe(html, "PayPal: 2 Umsätze seit über zwei Wochen offen")).toEqual({
      href: "/bank",
      detail: "Zahlungen, Gebühren oder Auszahlungen beim Zahlungsdienstleister noch nicht zugeordnet",
    });
    expect(aufgabe(html, "3 Bankumsätze ohne Zuordnung")).toEqual({ href: "/bank", detail: "PayPal" });
  });

  it("ein offener Umsatz in der Einzahl; ein gedecktes Steuerkonto meldet nichts", () => {
    data.computedKz83 = 100000;
    data.invoices.bank = [konto({ id: "s1", name: "Rücklage", purpose: "steuer", balance: 100000, openCount: 1 })];
    const html = render();
    expect(aufgabe(html, "1 Bankumsatz ohne Zuordnung")).toEqual({ href: "/bank", detail: "Rücklage" });
    expect(html).not.toContain("deckt die Zahllast nicht");
  });

  it("beim Kleinunternehmer meldet das Steuerkonto keine fehlende Zahllast", () => {
    data.kleinunternehmer = true;
    data.computedKz83 = 100000;
    data.invoices.bank = [konto({ id: "s1", name: "Rücklage", purpose: "steuer", balance: 0 })];
    expect(render()).not.toContain("deckt die Zahllast nicht");
  });
});

describe("Übersicht: Aufgaben zu den Einstellungen", () => {
  it("Firmendaten, Zertifikat und Backup führen in ihren Bereich", () => {
    data.companyIssues = ["Steuernummer fehlt", "Anschrift fehlt"];
    data.certificate = null;
    data.backup = {
      failed: [{ kind: "backup", run: { at: "2026-11-20T03:00:00Z", message: "Repository nicht erreichbar" } }],
      overdue: false,
      state: "fehler",
      lastBackup: null,
    };
    const html = render();
    expect(aufgabe(html, "Firmendaten vervollständigen")).toEqual({ href: "/einstellungen?bereich=firma", detail: "Steuernummer fehlt · Anschrift fehlt" });
    expect(aufgabe(html, "ELSTER-Zertifikat hinterlegen")).toEqual({
      href: "/einstellungen?bereich=elster",
      detail: "Die .pfx-Datei aus Mein ELSTER wird zum Senden gebraucht",
    });
    expect(aufgabe(html, "Backup fehlgeschlagen")).toEqual({
      href: "/einstellungen?bereich=export",
      detail: `${formatDateTime("2026-11-20T03:00:00Z")} · Repository nicht erreichbar`,
    });
  });

  it.each([
    [10, "ELSTER-Zertifikat läuft bald ab"],
    [-1, "ELSTER-Zertifikat abgelaufen"],
  ])("Zertifikat gültig bis in %i Tagen: %s", (tage, title) => {
    data.certificate = { filename: "elster.pfx", validUntil: inTagen(tage) };
    expect(aufgabe(render(), title)).toEqual({ href: "/einstellungen?bereich=elster", detail: `Gültig bis ${formatDate(inTagen(tage))}` });
  });

  it("Zertifikat mit mehr als 30 Tagen oder ohne Ablaufdatum meldet nichts", () => {
    data.certificate = { filename: "elster.pfx", validUntil: inTagen(31) };
    expect(render()).not.toContain("ELSTER-Zertifikat läuft");
    data.certificate = { filename: "elster.pfx", validUntil: null };
    expect(titel(render())).toEqual(["Voranmeldung Oktober 2026 senden"]);
  });

  it("Kleinunternehmer: kein Hinweis auf Firmendaten und Zertifikat", () => {
    data.kleinunternehmer = true;
    data.companyIssues = ["Steuernummer fehlt"];
    data.certificate = null;
    expect(titel(render())).toEqual([]);
  });

  it("Backup überfällig nennt das letzte erfolgreiche, sonst dass es keins gibt", () => {
    data.backup = { failed: [], overdue: true, state: "veraltet", lastBackup: { at: "2026-11-01T03:00:00Z" } };
    expect(aufgabe(render(), "Backup überfällig")).toEqual({
      href: "/einstellungen?bereich=export",
      detail: `Letztes erfolgreiches Backup ${formatDateTime("2026-11-01T03:00:00Z")}`,
    });
    data.backup = { failed: [{ kind: "check", run: { at: "2026-11-21T03:00:00Z", message: "" } }], overdue: true, state: "fehler", lastBackup: null };
    const html = render();
    expect(aufgabe(html, "Test-Restore fehlgeschlagen")?.detail).toBe(formatDateTime("2026-11-21T03:00:00Z"));
    expect(aufgabe(html, "Backup überfällig")?.detail).toBe("Noch kein erfolgreiches Backup");
    expect(html).not.toContain("Backup einrichten");
  });

  it("ohne Backup: „Backup einrichten“", () => {
    data.backup = { failed: [], overdue: false, state: "keins", lastBackup: null };
    expect(aufgabe(render(), "Backup einrichten")).toEqual({ href: "/einstellungen?bereich=export", detail: "Noch kein Backup eingetragen" });
  });
});
