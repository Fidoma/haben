import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../server/functions/ausschuettung.ts", () => ({
  getAusschuettungen: {},
  createAusschuettungFn: {},
  previewAusschuettung: {},
  reverseAusschuettungFn: {},
  submitKapEStFn: {},
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({}) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useLoaderData: () => state.data }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => createElement("a", { href: to }, children),
  useNavigate: () => async () => {},
  useRouter: () => ({ invalidate: async () => {} }),
}));
import { EricHinweis } from "../../components/EricHinweis.tsx";
import type { getAusschuettungen } from "../../server/functions/ausschuettung.ts";
import { Route } from "./ausschuettungen.tsx";

const hinweis = renderToStaticMarkup(createElement(EricHinweis));

type Daten = Awaited<ReturnType<typeof getAusschuettungen>>;
const ausschuettung = (id: string, beschlussDate: string): Daten["ausschuettungen"][number] => ({
  id,
  beschlussDate,
  auszahlungstag: "2026-07-01",
  geschaeftsjahr: 2025,
  zufluss: "2026-07-01",
  brutto: 2_000_000,
  empfaenger: [
    {
      name: "Erika Muster",
      anteil: 10_000,
      brutto: 2_000_000,
      ausEinlagekonto: 0,
      ertrag: 2_000_000,
      kapest: 500_000,
      soli: 27_500,
      kist: 0,
      netto: 1_472_500,
      kirchensteuer: 0,
      religionsschluessel: null,
    },
  ],
  entryId: `buchung-${id}`,
  createdAt: new Date("2026-06-30T10:00:00Z"),
  storniert: false,
  angemeldet: false,
  history: [],
  bescheinigungen: [],
});

const seite = (daten: Partial<Daten>) => {
  state.data = {
    year: 2026,
    rechtsform: "gmbh",
    ausschuettungen: [],
    today: "2026-07-01",
    certificate: null,
    herstellerIdConfigured: false,
    mode: "simuliert",
    ...daten,
  };
  const Seite = (Route as unknown as { options: { component: ComponentType } }).options.component;
  return renderToStaticMarkup(createElement(Seite));
};

describe("Ausschüttungen: Hinweis bei fehlendem ERiC", () => {
  it("zeigt ohne ERiC, dass die Kapitalertragsteuer-Anmeldung nichts ans Finanzamt schickt", () => {
    expect(seite({})).toContain(hinweis);
  });

  it("zeigt ihn mit ERiC nicht", () => {
    expect(seite({ mode: "eric" })).not.toContain(hinweis);
  });

  it("zeigt ihn im Einzelunternehmen nicht: dort gibt es keine Ausschüttung und nichts zu senden", () => {
    expect(seite({ rechtsform: "einzelunternehmen" })).not.toContain(hinweis);
  });

  it.each(["gmbh", "ug"] as const)("zeigt ihn bei %s einmal über den Sendekästen, nicht je Beschluss", (rechtsform) => {
    const html = seite({ rechtsform, ausschuettungen: [ausschuettung("a1", "2026-06-30"), ausschuettung("a2", "2026-06-15")] });
    expect(html.split("Kapitalertragsteuer-Anmeldung 01.07.2026")).toHaveLength(3);
    expect(html.split(hinweis)).toHaveLength(2);
  });
});
