import { computeUstva } from "@haben/core";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Route } from "./$zeitraum.tsx";

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
// Die Einstellkarten gehören nicht zur Kennzahlen-/Berichtigungsanzeige.
vi.mock("../../../components/umsatzsteuer/VatFrequencyCard.tsx", () => ({ VatFrequencyCard: () => null }));
vi.mock("../../../components/umsatzsteuer/DauerfristCard.tsx", () => ({ DauerfristCard: () => null }));

// #1268: Gesendete Voranmeldungen eines Kleinunternehmers von vor der Änderung haben Kz 48 ohne seine Umsätze. Wie der Abgleich
// gesendeter Voranmeldungen (gesendet-pruefen.ts) meldet die Seite dafür keine Änderung seit der Übermittlung, aber nur bei
// Anmeldungen ohne `smallBusinessRule` (#1811).
describe("Gesendete Voranmeldung mit Kz 48 ohne die Umsätze als Kleinunternehmer", () => {
  function seite(gesendet: ReturnType<typeof computeUstva>, figures: Record<string, unknown>, smallBusinessRule: "leistung" | null = null) {
    const current = {
      ...gesendet,
      smallBusinessRule,
      id: "alte-anmeldung",
      source: "berechnet",
      computed: gesendet,
      status: "sent",
      berichtigt: false,
      sentAt: new Date("2026-10-10T12:00:00Z"),
      updatedAt: new Date("2026-10-10T12:00:00Z"),
    };
    const data = {
      period: { year: 2026, month: 9 },
      current,
      returns: [current],
      periods: [{ year: 2026, month: 9 }],
      frequency: { year: 2026, own: [], frequency: "monatlich", inherited: false, previousYearTax: null, suggestion: null },
      dauerfrist: { year: 2026, frequency: "monatlich", active: false, own: null, sent: false, vorschlag: null, submissions: [] },
      mode: "eric",
      herstellerIdConfigured: true,
      companyIssues: [],
      preflight: [],
      periodProblem: null,
      kleinunternehmer: true,
      kz39: 0,
      figures: { revenue: [], inputTax: [], reverseCharge: [], igErwerb: [], kleinunternehmerUmsaetze: [], ...figures },
      filings: [],
      submissions: [],
      recent: [],
      posten: [],
      dueDate: "2026-10-12",
      today: "2026-11-23",
    };
    vi.spyOn(Route, "useLoaderData").mockImplementation(() => data as unknown as ReturnType<typeof Route.useLoaderData>);
    const html = renderToStaticMarkup(createElement(Route.options.component as ComponentType));
    vi.restoreAllMocks();
    return html;
  }

  it("keine Änderung, wenn nur die Umsätze als Kleinunternehmer dazugekommen sind", () => {
    const gesendet = computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz46: 10_000, kz47: 1_900, kz67: 1_900 });
    const html = seite(gesendet, {
      ...computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz46: 10_000, kz47: 1_900, kz67: 1_900, kz48: 80_000 }),
      kz48Kleinunternehmer: 80_000,
    });
    expect(html).not.toContain("Seit der Übermittlung haben sich die Buchungen dieses Monats geändert");
  });

  it("ein anderer abweichender Wert fällt weiter auf", () => {
    const gesendet = computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz46: 10_000, kz47: 1_900, kz67: 1_900 });
    const html = seite(gesendet, {
      ...computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz46: 12_000, kz47: 2_280, kz67: 2_280, kz48: 80_000 }),
      kz48Kleinunternehmer: 80_000,
    });
    expect(html).toContain("Seit der Übermittlung haben sich die Buchungen dieses Monats geändert");
  });

  it("nach dem Update gespeichert, fallen auch dazugekommene Umsätze als Kleinunternehmer auf (#1811)", () => {
    const gesendet = computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz46: 10_000, kz47: 1_900, kz67: 1_900 });
    const html = seite(
      gesendet,
      { ...computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz46: 10_000, kz47: 1_900, kz67: 1_900, kz48: 80_000 }), kz48Kleinunternehmer: 80_000 },
      "leistung",
    );
    expect(html).toContain("Seit der Übermittlung haben sich die Buchungen dieses Monats geändert");
  });
});
