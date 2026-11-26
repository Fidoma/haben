import { lstbFrist } from "@haben/core";
import { lstbOhneSchnittstelle } from "@haben/elster";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../../server/functions/lstb.ts", () => ({ getLstb: {}, stornoLstbFn: {}, submitLstbFn: {}, vermerkeLstbFn: {} }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({}) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useLoaderData: () => state.data }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => createElement("a", { href: to }, children),
  notFound: () => new Error("notFound"),
  useNavigate: () => async () => {},
  useRouter: () => ({ invalidate: async () => {} }),
}));
import { EricHinweis } from "../../../components/EricHinweis.tsx";
import type { getLstb } from "../../../server/functions/lstb.ts";
import { Route } from "./bescheinigung.$jahr.tsx";

const hinweis = renderToStaticMarkup(createElement(EricHinweis));

type Daten = Awaited<ReturnType<typeof getLstb>>;
const werte = (jahr: number) => ({
  jahr,
  von: `${jahr}-01-01`,
  bis: `${jahr}-12-31`,
  bruttoarbeitslohn: 3_600_000,
  lohnsteuer: 360_000,
  soli: 0,
  kirchensteuer: 0,
  rvArbeitgeber: 334_800,
  rvArbeitnehmer: 334_800,
  kvArbeitnehmer: 306_000,
  pvArbeitnehmer: 86_400,
  avArbeitnehmer: 46_800,
  pkvBasis: null,
  merkmale: [{ gueltigAb: `${jahr}-01-01`, steuerklasse: 1 as const, faktor: 1000, kinderfreibetraege: 0, konfession: null }],
});
const erika = (jahr: number): Daten["mitarbeiter"][number] => ({
  id: "e1",
  name: "Erika Muster",
  personalnummer: 1,
  ergebnis: { status: "bereit", werte: werte(jahr) },
  aktuell: null,
  status: "bereit",
  naechste: "neu",
  ausdruck: "entwurf",
  verlauf: [],
});
/** Wie `lstbUebersicht` und `getLstb`: ob ERiC das Jahr kann, sagt `lstbOhneSchnittstelle` */
const jahr = (year: number): Partial<Daten> => ({
  year,
  frist: lstbFrist(year, "BE"),
  ohneSchnittstelle: lstbOhneSchnittstelle(year),
  mitarbeiter: [erika(year)],
  heute: `${year + 1}-01-15`,
});

const seite = (daten: Partial<Daten>) => {
  state.data = {
    year: 2025,
    frist: "2026-02-28",
    ohneSchnittstelle: lstbOhneSchnittstelle(2025),
    firmenfehler: [],
    mitarbeiter: [],
    heute: "2026-01-15",
    certificate: null,
    herstellerIdConfigured: false,
    mode: "simuliert",
    ...daten,
  };
  const Seite = (Route as unknown as { options: { component: ComponentType } }).options.component;
  return renderToStaticMarkup(createElement(Seite));
};

describe("Lohnsteuerbescheinigung: Hinweis bei fehlendem ERiC", () => {
  it("zeigt ohne ERiC, dass nichts ans Finanzamt geht", () => {
    expect(seite({})).toContain(hinweis);
  });

  it("zeigt ihn mit ERiC nicht", () => {
    expect(seite({ mode: "eric" })).not.toContain(hinweis);
  });

  it("zeigt ihn nicht, wo ERiC die Bescheinigung nicht sendet: der Weg läuft dann über Mein ELSTER", () => {
    expect(seite(jahr(2026))).not.toContain(hinweis);
  });

  it.each([2024, 2025, 2026, 2027])("zeigt ihn %i genau dann, wenn die Seite den Sendekasten hat", (year) => {
    const html = seite(jahr(year));
    expect(html).toContain("Erika Muster");
    expect(html.includes(hinweis)).toBe(html.includes("Bescheinigung für Erika Muster senden"));
    expect(html.includes(hinweis)).toBe(year === 2025);
  });
});
