import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Link als <a>, mit Ziel, Parametern, Suche und Anker in href, damit der Test die Adresse sieht
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    hash,
  }: {
    children: ReactNode;
    to: string;
    params?: { id: string };
    search?: Record<string, string>;
    hash?: string;
  }) =>
    createElement("a", { href: `${to.replace("$id", params?.id ?? "")}${search ? `?${new URLSearchParams(search)}` : ""}${hash ? `#${hash}` : ""}` }, children),
}));
import { BuchungLink, BuchungLinks, type Vorgang, vorgangZurHerkunft, VorgangLink } from "./Ledger.tsx";

describe("Herkunft einer Buchung öffnet den Vorgang (Journal und Kontenblatt)", () => {
  const buchung = { sourceId: "q1", invoiceId: null, documentId: null, transactionId: null };

  it("Rechnung, Beleg und Anlage führen auf ihre Detailseite", () => {
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "invoice" })).toEqual({ to: "/rechnungen/$id", id: "q1" });
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "document" })).toEqual({ to: "/belege/$id", id: "q1" });
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "asset" })).toEqual({ to: "/anlagen/$id", id: "q1" });
  });

  it("Verrechnung führt auf ihre Rechnung bzw. ihren Beleg", () => {
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "verrechnung", invoiceId: "r1" })).toEqual({ to: "/rechnungen/$id", id: "r1" });
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "verrechnung", documentId: "b1" })).toEqual({ to: "/belege/$id", id: "b1" });
  });

  it("Bank, Kasse und Lohn haben keine eigene Detailseite", () => {
    for (const sourceType of ["allocation", "kasse", "lohn", "pauschale", "manuell"]) expect(vorgangZurHerkunft({ ...buchung, sourceType })).toBeNull();
  });
});

describe("Vorsteuerfreigabe zum Leistungsdatum (#693)", () => {
  it("führt auf den Beleg: ihre Quelle ist der Beleg selbst, nicht die Bank", () => {
    expect(vorgangZurHerkunft({ sourceType: "freigabe", sourceId: "b1", invoiceId: null, documentId: null, transactionId: null })).toEqual({
      to: "/belege/$id",
      id: "b1",
    });
  });
});

// Direkte Links zwischen Buchung und Bankumsatz (#1855)
describe("Buchung über die Bank öffnet ihren Umsatz (#1855)", () => {
  const zuordnung = { sourceType: "allocation", sourceId: "z1", invoiceId: null, documentId: null };

  it("führt mit dem Umsatz der Zuordnung auf genau diesen Umsatz, in allen Konten und ohne Filter", () => {
    const vorgang = vorgangZurHerkunft({ ...zuordnung, transactionId: "t1" });
    expect(vorgang).toEqual({ to: "/bank", umsatz: "t1" });
    expect(renderToStaticMarkup(createElement(VorgangLink, { vorgang: vorgang!, rolle: "inhaber" }, "Bank"))).toBe(
      '<a href="/bank?umsatz=t1&amp;konto=alle&amp;filter=alle">Bank</a>',
    );
  });

  it("die Steuerberatung sieht die Bank nicht und bekommt nur den Text", () => {
    expect(renderToStaticMarkup(createElement(VorgangLink, { vorgang: { to: "/bank", umsatz: "t1" }, rolle: "steuerberatung" }, "Bank"))).toBe(
      "<span>Bank</span>",
    );
  });

  it("ohne Umsatz bleibt es bei der Seite Bank", () => {
    expect(vorgangZurHerkunft({ ...zuordnung, transactionId: null })).toBeNull();
  });

  it("Rechnung und Beleg bleiben auch für die Steuerberatung Links, die Anlage nicht: diese Seite sieht sie nicht", () => {
    const id = "7f1c2a9e-3b4d-4e5f-8a6b-1c2d3e4f5a6b";
    const link = (vorgang: Vorgang, rolle: string) =>
      renderToStaticMarkup(createElement(VorgangLink, { vorgang, rolle, className: "journal-source" }, "Herkunft"));
    expect(link({ to: "/rechnungen/$id", id }, "steuerberatung")).toBe(`<a href="/rechnungen/${id}">Herkunft</a>`);
    expect(link({ to: "/belege/$id", id }, "steuerberatung")).toBe(`<a href="/belege/${id}">Herkunft</a>`);
    expect(link({ to: "/anlagen/$id", id }, "steuerberatung")).toBe('<span class="journal-source">Herkunft</span>');
    expect(link({ to: "/anlagen/$id", id }, "inhaber")).toBe(`<a href="/anlagen/${id}">Herkunft</a>`);
  });
});

describe("Link auf eine Buchung (#1855)", () => {
  it("führt ins Journal des Monats auf die Zeile der Buchung", () => {
    expect(renderToStaticMarkup(createElement(BuchungLink, { id: "e9", date: "2026-03-10" }, "Gegenbuchung"))).toBe(
      '<a href="/buchungen?jahr=2026&amp;monat=3#buchung-e9">Gegenbuchung</a>',
    );
  });
});

describe("Von Rechnung, Beleg und Bankumsatz zur Buchung (#1855)", () => {
  it("verlinkt jede Buchung im Journal ihres Monats auf ihre Zeile, Gegenbuchungen als solche", () => {
    const html = renderToStaticMarkup(
      createElement(BuchungLinks, {
        buchungen: [
          { id: "e1", date: "2026-03-20", reversal: false },
          { id: "e2", date: "2026-07-10", reversal: true },
        ],
      }),
    );
    expect(html).toBe(
      '<a href="/buchungen?jahr=2026&amp;monat=3#buchung-e1">Buchung vom 20.03.2026</a>, <a href="/buchungen?jahr=2026&amp;monat=7#buchung-e2">Gegenbuchung vom 10.07.2026</a>',
    );
  });

  it("ohne Buchung nichts", () => {
    expect(renderToStaticMarkup(createElement(BuchungLinks, { buchungen: [] }))).toBe("");
  });
});
