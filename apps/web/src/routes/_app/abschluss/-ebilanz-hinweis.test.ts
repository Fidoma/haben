import { abschluss } from "@haben/core";
import { ebilanzTaxonomie } from "@haben/elster";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../../server/functions/abschluss.ts", () => ({
  getJahresabschluss: {},
  closeYearFn: {},
  submitEbilanzFn: {},
  saveKapgAngabenFn: {},
  bookSteuerrueckstellungenFn: {},
  saveRestlaufzeitenFn: {},
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({}) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useLoaderData: () => state.data }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => createElement("a", { href: to }, children),
  notFound: () => new Error("notFound"),
  useNavigate: () => async () => {},
  useRouter: () => ({ invalidate: async () => {} }),
}));
import { EricHinweis } from "../../../components/EricHinweis.tsx";
import type { getJahresabschluss } from "../../../server/functions/abschluss.ts";
import { Route } from "./$jahr.tsx";

type Daten = Awaited<ReturnType<typeof getJahresabschluss>>;
type Kapitalgesellschaft = Extract<Daten, { kapitalgesellschaft: true }>;

const HINWEIS = renderToStaticMarkup(createElement(EricHinweis));
const SENDEKASTEN = "E-Bilanz übermitteln";

const ebilanz = (year: number, issues: NonNullable<Kapitalgesellschaft["ebilanz"]>["issues"] = []): NonNullable<Kapitalgesellschaft["ebilanz"]> => ({
  taxonomie: ebilanzTaxonomie(year),
  issues,
  history: [],
  sent: null,
});

/** Wie `getJahresabschluss` für eine GmbH: leere Bilanz, Steuern und Hinterlegung wie im ersten Jahr ohne Angaben */
const gmbh = (year: number, rechtsform: "gmbh" | "ug", status: Kapitalgesellschaft["status"]): Kapitalgesellschaft => ({
  year,
  rechtsform,
  kapitalgesellschaft: true,
  kontenrahmen: "SKR03",
  name: "Muster GmbH",
  report: abschluss("SKR03", []),
  names: {},
  issues: [],
  status,
  vermerke: [],
  restlaufzeiten: null,
  ebilanz: ebilanz(year),
  hinterlegung: { frist: `${year + 1}-12-31`, fristAbgelaufen: false, maengel: [], vorjahr: false },
  steuern: { angaben: null, gespeichert: false, angehobenVon: null, steuern: null, konten: {} } as unknown as Kapitalgesellschaft["steuern"],
  elster: { mode: "simuliert", certificate: null, herstellerIdConfigured: false },
});
const abgeschlossen = { closedAt: new Date("2027-02-01T10:00:00Z"), entries: 12, intact: true };

const seite = (daten: Daten) => {
  state.data = daten;
  const Seite = (Route as unknown as { options: { component: ComponentType } }).options.component;
  return renderToStaticMarkup(createElement(Seite));
};
const mit = (daten: Kapitalgesellschaft, ueberschreiben: Partial<Kapitalgesellschaft> = {}): Daten => ({ ...daten, ...ueberschreiben });

describe("Jahresabschluss: Hinweis bei fehlendem ERiC", () => {
  it("zeigt ohne ERiC, dass die E-Bilanz nichts ans Finanzamt schickt", () => {
    expect(seite(gmbh(2025, "gmbh", null))).toContain(HINWEIS);
  });

  it("zeigt ihn mit ERiC nicht", () => {
    const daten = gmbh(2025, "gmbh", null);
    const html = seite(mit(daten, { elster: { ...daten.elster, mode: "eric" } }));
    expect(html).toContain(SENDEKASTEN);
    expect(html).not.toContain(HINWEIS);
  });

  it("zeigt ihn im Einzelunternehmen nicht: dort gibt es keinen Sendekasten", () => {
    const { elster } = gmbh(2025, "gmbh", null);
    const html = seite({
      year: 2025,
      rechtsform: "einzelunternehmen",
      kapitalgesellschaft: false,
      vermerke: [],
      restlaufzeiten: null,
      ebilanz: null,
      hinterlegung: null,
      steuern: null,
      elster,
    });
    expect(html).toContain("Einen Jahresabschluss mit Bilanz gibt es für GmbH und UG");
    expect(html).not.toContain(SENDEKASTEN);
    expect(html).not.toContain(HINWEIS);
  });

  it.each([2024, 2025, 2026, 2027])("zeigt ihn %i genau dann, wenn die Seite den Sendekasten hat, einmal", (year) => {
    for (const rechtsform of ["gmbh", "ug"] as const) {
      for (const status of [null, abgeschlossen]) {
        const html = seite(gmbh(year, rechtsform, status));
        expect(html).toContain(`E-Bilanz ${year}`);
        expect(html.includes(HINWEIS)).toBe(html.includes(SENDEKASTEN));
        expect(html.split(HINWEIS)).toHaveLength(2);
      }
    }
  });

  it("zeigt ihn auch, wenn offene Punkte den Sendekasten sperren: er gilt für Prüfen und Senden", () => {
    const daten = gmbh(2025, "gmbh", null);
    const issues = [
      { tone: "fehler" as const, text: "Firmendaten: Steuernummer fehlt." },
      { tone: "hinweis" as const, text: "Echt senden lässt sich die E-Bilanz erst, wenn 2025 abgeschlossen ist." },
    ];
    const html = seite(mit(daten, { ebilanz: ebilanz(2025, issues), issues: [issues[0]!] }));
    expect(html).toContain("Firmendaten: Steuernummer fehlt.");
    expect(html).toContain(HINWEIS);
  });
});
