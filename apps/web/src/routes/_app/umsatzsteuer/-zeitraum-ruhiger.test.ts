import { computeUstva, formatEuro } from "@haben/core";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./$zeitraum.tsx";
import { ZeitraumAblauf } from "./-zeitraum-abgabe.tsx";
import type { PageData } from "./-zeitraum-quellen.tsx";

vi.mock("@tanstack/react-router", async (original) => {
  const router = await original<typeof import("@tanstack/react-router")>();
  const { createElement } = await import("react");
  return {
    ...router,
    useNavigate: () => vi.fn(),
    useRouter: () => ({ invalidate: vi.fn() }),
    Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  };
});
vi.mock("@tanstack/react-start", async (original) => ({
  ...(await original<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("../../../server/functions/vat.ts", () =>
  Object.fromEntries(
    [
      "getVatPeriod",
      "getMeinElsterUstvaWerte",
      "saveVatDraft",
      "createVatCorrection",
      "submitVatReturn",
      "saveVatFrequency",
      "saveVatDauerfrist",
      "submitVatDauerfrist",
      "fileVatReturnElsewhere",
    ].map((name) => [name, vi.fn()]),
  ),
);
// Die Karten haben eigene Tests; hier zählt nur, ob und wo sie auf der Seite stehen
vi.mock("../../../components/umsatzsteuer/VatFrequencyCard.tsx", async (original) => ({
  ...(await original<typeof import("../../../components/umsatzsteuer/VatFrequencyCard.tsx")>()),
  VatFrequencyCard: () => createElement("i", { "data-karte": "zeitraum" }),
}));
vi.mock("../../../components/umsatzsteuer/DauerfristCard.tsx", () => ({ DauerfristCard: () => createElement("i", { "data-karte": "dauerfrist" }) }));

const zero = computeUstva({ kz81: 0, kz86: 0, kz66: 0 });

/** Eine Voranmeldung im Entwurf, ohne Buchungen; `current` null = noch nicht angelegt */
function seite(overrides: Record<string, unknown> = {}) {
  const data = {
    period: { year: 2026, month: 10 },
    current: null,
    returns: [],
    periods: [{ year: 2026, month: 10 }],
    frequency: { year: 2026, own: [], frequency: "monatlich", inherited: false, previousYearTax: null, suggestion: null },
    dauerfrist: { year: 2026, frequency: "monatlich", active: false, own: null, sent: false, vorschlag: null, submissions: [] },
    mode: "eric",
    herstellerIdConfigured: true,
    companyIssues: [],
    preflight: [],
    periodProblem: null,
    kleinunternehmer: false,
    uebernommen: false,
    kz39: 0,
    figures: {
      ...zero,
      versteuerung: "ist",
      revenue: [],
      inputTax: [],
      reverseCharge: [],
      igErwerb: [],
      kleinunternehmerUmsaetze: [],
      kz48Kleinunternehmer: 0,
    },
    filings: [],
    submissions: [],
    recent: [],
    posten: [],
    dueDate: "2026-11-10",
    today: "2026-11-23",
    ...overrides,
  };
  vi.spyOn(Route, "useLoaderData").mockImplementation(() => data as unknown as ReturnType<typeof Route.useLoaderData>);
  return renderToStaticMarkup(createElement(Route.options.component as ComponentType));
}

const entwurfVonHand = {
  ...zero,
  id: "entwurf",
  source: "manuell",
  computed: zero,
  status: "draft",
  berichtigt: false,
  sentAt: null,
  updatedAt: new Date("2026-11-01T12:00:00Z"),
  overrideReason: "Werte aus der alten Buchhaltung übernommen",
};

afterEach(() => vi.restoreAllMocks());

describe("Voranmeldung: Werte von Hand ändern (#1253, Punkt 30)", () => {
  it("zeigt berechnete Werte ohne Eingabefelder und den Zugang als kleinen Link unter der Tabelle", () => {
    const html = seite();
    expect(html).toContain('<output id="kz-81"');
    expect(html).not.toContain('<input id="kz-81"');
    expect(html).toMatch(/<button type="button" class="link-button"[^>]*>Werte von Hand ändern \(nur in Ausnahmen\)<\/button>/);
    expect(html).not.toContain("Manuell überschreiben");
    expect(html).not.toContain('class="mode-switch"');
    // Unter der Tabelle, nicht davor
    expect(html.indexOf("Werte von Hand ändern")).toBeGreaterThan(html.indexOf('id="kz-81"'));
  });

  it("zeigt einen schon von Hand überschriebenen Entwurf mit offenen Feldern, Begründung und dem Weg zurück", () => {
    const html = seite({ current: entwurfVonHand });
    expect(html).toContain('<input id="kz-81"');
    expect(html).toContain("Werte aus der alten Buchhaltung übernommen");
    expect(html).toMatch(/<button type="button" class="link-button"[^>]*>Zurück zu den berechneten Werten<\/button>/);
    expect(html).not.toContain("Werte von Hand ändern");
  });
});

/** Der eingeklappte Bereich „Fristen und Zeitraum ändern“ samt Inhalt, sonst null */
const fristen = (html: string) => html.match(/<section[^>]*aria-labelledby="ust-fristen"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? null;

describe("Voranmeldung: Fristen und Zeitraum ändern eingeklappt (#1253, Punkt 31)", () => {
  it("klappt beide Karten unter einer Überschrift zu, mit dem Gesetzten dahinter", () => {
    const bereich = fristen(seite());
    expect(bereich).not.toBeNull();
    expect(bereich).toMatch(/<details>/);
    expect(bereich).toContain('<h3 id="ust-fristen">Fristen und Zeitraum ändern</h3>');
    expect(bereich).toContain('<span class="form-section-kurz">2026: monatlich · Dauerfristverlängerung nicht eingetragen</span>');
    // Nichts fällt weg: beide Karten stehen im zugeklappten Bereich
    expect(bereich).toContain('data-karte="zeitraum"');
    expect(bereich).toContain('data-karte="dauerfrist"');
  });

  it("nennt Wechsel im Jahr, bestehende Dauerfristverlängerung mit Sondervorauszahlung und lässt sie bei Befreiung weg", () => {
    const wechsel = [
      { year: 2026, fromMonth: 1, frequency: "monatlich" },
      { year: 2026, fromMonth: 7, frequency: "vierteljaehrlich" },
    ];
    expect(fristen(seite({ frequency: { year: 2026, own: wechsel, frequency: "monatlich" } }))).toContain("2026: monatlich, ab Juli: vierteljährlich ·");
    const dauerfrist = { year: 2026, frequency: "monatlich", active: true, own: { year: 2026, active: true, sondervorauszahlung: 120_000 } };
    expect(fristen(seite({ dauerfrist }))).toContain(`Dauerfristverlängerung besteht, Sondervorauszahlung ${formatEuro(120_000)}`);
    expect(fristen(seite({ dauerfrist: { ...dauerfrist, own: null } }))).toContain("Dauerfristverlängerung besteht</span>");
    const befreit = fristen(
      seite({ frequency: { year: 2026, own: [], frequency: "keine" }, dauerfrist: { ...dauerfrist, frequency: "keine", active: false } }),
    );
    expect(befreit).toContain('<span class="form-section-kurz">2026: keine Voranmeldung (befreit)</span>');
  });

  it("steht offen, wenn der Zeitraum nicht zur Voranmeldung passt: Dort lässt sich das beheben", () => {
    const problem = "Für Oktober 2026 passt die Voranmeldung nicht zum eingestellten Zeitraum (vierteljährlich).";
    expect(fristen(seite({ periodProblem: problem }))).toMatch(/<details open="">/);
    expect(fristen(seite())).not.toMatch(/<details open/);
  });
});

/** Alles zwischen Seitenkopf und Kennzahlen: die Hinweise über den Zahlen */
const hinweise = (html: string) => html.slice(0, html.indexOf('<div class="grid-main">'));
const banner = (text: string) => [...text.matchAll(/<div class="banner[^"]*"/g)].length;

const ausgaben = { tone: "warn", text: "1 Ausgabe im Zeitraum ohne Beleg oder Zuordnung. Ohne Beleg wird keine Vorsteuer angesetzt.", link: "/bank" };
const eingaenge = { tone: "info", text: "2 Zahlungseingänge im Zeitraum noch nicht zugeordnet.", link: "/bank" };
const entwuerfe = { tone: "info", text: "1 Rechnungsentwurf mit Datum im Zeitraum.", link: "/rechnungen" };
const mitIgLieferung = {
  ...zero,
  kz41: 50_000,
  versteuerung: "ist",
  revenue: [],
  inputTax: [],
  reverseCharge: [],
  igErwerb: [],
  kleinunternehmerUmsaetze: [],
  kz48Kleinunternehmer: 0,
};

describe("Voranmeldung: weniger Hinweise über den Zahlen (#1253, Punkt 32)", () => {
  it("lässt Blockierendes je als eigenen Hinweis und bündelt die übrigen Hinweise mit Link in einem", () => {
    const html = seite({
      mode: "simuliert",
      herstellerIdConfigured: false,
      preflight: [ausgaben, eingaenge, entwuerfe],
      figures: mitIgLieferung,
    });
    const oben = hinweise(html);
    // ERiC, Hersteller-ID, die Warnung zu den Ausgaben und ein gebündelter Hinweis; vorher je einer für die fünf weiteren
    expect(banner(oben)).toBe(4);
    const gebuendelt = oben.match(/<div class="banner banner-info"[^>]*>(?:(?!<div class="banner)[\s\S])*?banner-list[\s\S]*?<\/ul>/)?.[0] ?? "";
    for (const text of ["Zahlungseingänge im Zeitraum", "Rechnungsentwurf mit Datum", "Zur Zusammenfassenden Meldung", "Zur Bank", "Zu den Rechnungen"]) {
      expect(gebuendelt, text).toContain(text);
    }
    expect(gebuendelt.match(/<li>/g)).toHaveLength(3);
    // Die Warnung bleibt einzeln, mit Link, und steht nicht in der Liste
    expect(oben).toMatch(/<div class="banner" role="status">[\s\S]*?Ausgabe im Zeitraum ohne Beleg[\s\S]*?Zur Bank/);
    expect(gebuendelt).not.toContain("Ausgabe im Zeitraum");
  });

  it("zeigt einen einzelnen Hinweis ohne Liste", () => {
    const oben = hinweise(seite({ preflight: [entwuerfe] }));
    expect(banner(oben)).toBe(1);
    expect(oben).toContain("Rechnungsentwurf mit Datum im Zeitraum.");
    expect(oben).not.toContain("banner-list");
  });

  it("behält Zeitraum und Firmendaten als eigene Hinweise, solange sie das Senden hindern", () => {
    const oben = hinweise(
      seite({ periodProblem: "Für Oktober 2026 passt die Voranmeldung nicht zum eingestellten Zeitraum (vierteljährlich).", companyIssues: ["Steuernummer"] }),
    );
    expect(banner(oben)).toBe(2);
    expect(oben).toMatch(
      /<div class="banner" role="status">[\s\S]*?passt die Voranmeldung nicht[\s\S]*?<div class="banner" role="status">[\s\S]*?Firmendaten unvollständig: Steuernummer[\s\S]*?In den Einstellungen ergänzen/,
    );
  });

  it("fragt nach einer gesendeten Anmeldung nicht mehr nach offenen Posten, verweist aber weiter auf die Zusammenfassende Meldung", () => {
    const gesendet = { ...entwurfVonHand, status: "sent", source: "berechnet" };
    const oben = hinweise(seite({ current: gesendet, preflight: [ausgaben, entwuerfe], figures: mitIgLieferung }));
    expect(oben).not.toContain("Rechnungsentwurf");
    expect(oben).not.toContain("Ausgabe im Zeitraum");
    expect(oben).toContain("Zur Zusammenfassenden Meldung");
    expect(banner(oben)).toBe(1);
  });

  it("nennt ohne eigene Hersteller-ID in einem Satz den Weg über Mein ELSTER, mit dem Link auf die Anleitung", () => {
    const oben = hinweise(seite({ herstellerIdConfigured: false }));
    expect(oben).toContain("Ohne eigene Hersteller-ID gibst du in Mein ELSTER ab:");
    expect(oben).toContain("XML für Mein ELSTER");
    expect(oben).toContain("im Formular Umsatzsteuer-Voranmeldung unter Datenübernahme › XML-Import");
    expect(oben).toContain('href="https://haben.app/elster-abgabe.html"');
    expect(oben).not.toContain("Prüfen und absenden machst du in Mein ELSTER");
  });
});

const mitZahllast = { ...mitIgLieferung, kz41: 0, kz81: 100_000 };
const mitErstattung = { ...mitIgLieferung, kz41: 0, kz66: 5_000 };
const gesendet = { ...entwurfVonHand, status: "sent", source: "berechnet" };
const posten = (offen: number, vatReturnId = "entwurf") => [
  { vatReturnId, berichtigt: false, betrag: 19_000, faellig: "2026-11-10", verrechnet: 0, bezahlt: 19_000 - offen, offen, zahlungen: [] },
];

/** Die Leiste „Ablauf der Voranmeldung“ samt Inhalt, sonst null */
const ablauf = (html: string) => html.match(/<section[^>]*aria-label="Ablauf der Voranmeldung"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? null;
/** Der Schritt mit aria-current="step", sonst null */
const aktuellerSchritt = (html: string) => ablauf(html)?.match(/<li[^>]*aria-current="step"[^>]*>([\s\S]*?)<\/li>/)?.[1] ?? null;
const satz = (html: string) => html.match(/Du zahlst [^<]*|Die Zahllast von [^<]*|Du bekommst [^<]*|Diesmal ist nichts zu zahlen\./)?.[0] ?? null;

describe("Voranmeldung: Ergebnis und Ablauf zuerst (#1253, Punkte 42 und 43)", () => {
  it("sagt über den Kennzahlen, was Zahllast, Erstattung oder 0 für dich heißt", () => {
    const zahllast = seite({ figures: mitZahllast, dueDate: "2026-12-10" });
    expect(satz(zahllast)).toBe(`Du zahlst ${formatEuro(19_000)} bis 10.12.2026.`);
    expect(ablauf(zahllast)).toContain(satz(zahllast));
    // Vor der Tabelle, nicht erst als letzte Zeile
    expect(zahllast.indexOf("Du zahlst")).toBeLessThan(zahllast.indexOf('id="kz-81"'));
    // Heute ist der 23.11.: Eine Frist am 10.11. liegt hinter uns
    expect(satz(seite({ figures: mitZahllast }))).toBe(`Die Zahllast von ${formatEuro(19_000)} war am 10.11.2026 fällig.`);
    expect(satz(seite({ figures: mitErstattung }))).toBe(`Du bekommst ${formatEuro(5_000)} zurück, sobald das Finanzamt zustimmt.`);
    expect(satz(seite())).toBe("Diesmal ist nichts zu zahlen.");
  });

  it("nimmt den Wert, den ein von Hand überschriebener Entwurf zeigt", () => {
    expect(satz(seite({ current: { ...entwurfVonHand, kz66: 12_300 } }))).toBe(`Du bekommst ${formatEuro(12_300)} zurück, sobald das Finanzamt zustimmt.`);
  });

  it("lässt den Satz bei einer festgeschriebenen Anmeldung weg: Status und Zahlung an das Finanzamt zeigen den echten Stand", () => {
    const html = seite({ current: gesendet, posten: posten(19_000) });
    expect(satz(html)).toBeNull();
    expect(html).toContain("Zahlung an das Finanzamt");
  });

  it("zeigt Zahlen prüfen, Abgeben und Zahlen als Liste und markiert den aktuellen Schritt", () => {
    const html = seite();
    expect(ablauf(html)).toMatch(/<ol[^>]*>[\s\S]*Zahlen prüfen[\s\S]*Abgeben[\s\S]*Zahlen[\s\S]*<\/ol>/);
    expect(ablauf(html)?.match(/<li/g)).toHaveLength(3);
    // Noch nichts gespeichert: die Zahlen prüfen
    expect(aktuellerSchritt(html)).toContain("Zahlen prüfen");
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    // Gespeichert und unverändert: abgeben
    expect(aktuellerSchritt(seite({ current: entwurfVonHand }))).toContain("Abgeben");
  });

  it("zeigt nach dem Festschreiben das Zahlen als aktuell und nennt Erledigtes mit Worten, nicht nur mit Farbe", () => {
    const html = seite({ current: gesendet, posten: posten(19_000) });
    expect(aktuellerSchritt(html)).toContain("Zahlen");
    expect(aktuellerSchritt(html)).not.toContain("prüfen");
    expect(ablauf(html)?.match(/\(erledigt\)/g)).toHaveLength(2);
    // Ausgeglichen: alles erledigt, nichts mehr aktuell
    const fertig = seite({ current: gesendet, posten: posten(0) });
    expect(fertig.match(/aria-current="step"/g)).toBeNull();
    expect(ablauf(fertig)?.match(/\(erledigt\)/g)).toHaveLength(3);
  });

  it("hält das Zahlen nicht offen, solange nur eine Erstattung aussteht: Es ist nichts zu zahlen", () => {
    const erstattung = [
      { vatReturnId: "entwurf", berichtigt: false, betrag: -5_000, faellig: "2026-11-10", verrechnet: 0, bezahlt: 0, offen: -5_000, zahlungen: [] },
    ];
    const html = seite({ current: gesendet, posten: erstattung });
    expect(html.match(/aria-current="step"/g)).toBeNull();
    expect(ablauf(html)?.match(/\(erledigt\)/g)).toHaveLength(3);
  });

  it("zählt alle Posten des Zeitraums: Der Rest am Original einer Berichtigung nach unten hält das Zahlen offen", () => {
    const posten = (restOriginal: number) => [
      {
        vatReturnId: "original",
        berichtigt: false,
        betrag: 100_000,
        faellig: "2026-11-10",
        verrechnet: 0,
        bezahlt: 100_000 - restOriginal,
        offen: restOriginal,
        zahlungen: [],
      },
      { vatReturnId: "entwurf", berichtigt: true, betrag: -50_000, faellig: "2026-11-10", verrechnet: 50_000, bezahlt: 0, offen: 0, zahlungen: [] },
    ];
    const berichtigung = { ...gesendet, berichtigt: true };
    expect(aktuellerSchritt(seite({ current: berichtigung, posten: posten(50_000) }))).toContain("Zahlen");
    expect(seite({ current: berichtigung, posten: posten(0) }).match(/aria-current="step"/g)).toBeNull();
  });

  it("nennt bei einer berichtigten Anmeldung kein Ergebnis: Zu zahlen oder zu erstatten ist nur der Unterschied zur ersten", () => {
    const berichtigung = { ...entwurfVonHand, source: "berechnet", berichtigt: true };
    for (const figures of [mitZahllast, mitErstattung]) {
      const html = seite({ current: berichtigung, figures, dueDate: "2026-12-10" });
      expect(satz(html)).toBeNull();
      expect(ablauf(html)).toContain("Zahlen prüfen");
    }
  });

  it("nennt kein Ergebnis, wenn der Zeitraum nicht zur Voranmeldung passt: Der Hinweis darüber und das gesperrte Senden widersprächen ihm", () => {
    const problem = "Für Oktober 2026 passt die Voranmeldung nicht zum eingestellten Zeitraum (vierteljährlich).";
    const html = seite({ periodProblem: problem, figures: mitZahllast, dueDate: "2026-12-10" });
    expect(satz(html)).toBeNull();
    expect(ablauf(html)).toContain("Zahlen prüfen");
    expect(satz(seite({ figures: mitZahllast, dueDate: "2026-12-10" }))).toBe(`Du zahlst ${formatEuro(19_000)} bis 10.12.2026.`);
  });

  it("lässt den Satz weg, solange von Hand ein Wert nicht lesbar ist: 0 wäre falsch, die Leiste bleibt", () => {
    const render = (werteGueltig: boolean) =>
      renderToStaticMarkup(
        createElement(ZeitraumAblauf, {
          data: { current: null, posten: [], dueDate: "2026-12-10", today: "2026-11-23" } as unknown as PageData,
          shown: zero,
          geaendert: true,
          werteGueltig,
        }),
      );
    expect(satz(render(true))).toBe("Diesmal ist nichts zu zahlen.");
    const ungueltig = render(false);
    expect(satz(ungueltig)).toBeNull();
    expect(ablauf(ungueltig)).toContain("Zahlen prüfen");
  });
});

/** Der Abschnitt „Schon anders abgegeben?“ samt Inhalt, sonst null */
const vermerk = (html: string) => html.match(/<section[^>]*aria-labelledby="ust-vermerk"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? null;

describe("Voranmeldung: Abgabe außerhalb von Haben eingeklappt (#1253, Punkt 42)", () => {
  it("klappt die Karte mit ERiC und eigener Hersteller-ID zu, ohne dass etwas wegfällt", () => {
    const bereich = vermerk(seite({ current: entwurfVonHand, herstellerIdConfigured: true }));
    expect(bereich).not.toBeNull();
    expect(bereich).toMatch(/<details>/);
    expect(bereich).toContain('<h3 id="ust-vermerk">Schon anders abgegeben?</h3>');
    expect(bereich).toContain('<span class="form-section-kurz">Abgabe in Mein ELSTER vermerken</span>');
    expect(bereich).toContain("Außerhalb von Haben abgegeben");
    expect(bereich).toContain("Kz 83 laut Protokoll");
  });

  it("lässt sie offen stehen, solange ERiC oder die Hersteller-ID fehlt (`herstellerIdConfigured` false): Dort ist Mein ELSTER der Hauptweg und der Vermerk der nächste Schritt", () => {
    const bereich = vermerk(seite({ current: entwurfVonHand, herstellerIdConfigured: false }));
    expect(bereich).toMatch(/<details open="">/);
    expect(bereich).toContain("Außerhalb von Haben abgegeben");
  });

  it("zeigt sie nur, wo sich eine Abgabe vermerken lässt: nicht ohne gespeicherten Entwurf und nicht nach dem Festschreiben", () => {
    expect(vermerk(seite())).toBeNull();
    expect(vermerk(seite({ current: gesendet }))).toBeNull();
  });
});
