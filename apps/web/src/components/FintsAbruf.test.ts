import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useFintsAbruf, wartetAuf, zeilenGrund } from "./FintsAbruf.tsx";

// Die Server-Funktionen brauchen die Umgebung der App; geprüft werden hier nur die Sätze
vi.mock("../server/functions/fints.ts", () => ({ cancelFints: {}, connectFints: {}, continueFints: {}, disconnectFints: {}, syncFints: {} }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: async () => {} }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({}) }));

type Verbindung = Parameters<typeof zeilenGrund>[0];

/** Verbindung mit den Feldern, die der Grund liest; ibans sind ihre Konten in dieser Reihenfolge */
const verbindung = (id: string, bankName: string, ibans: string[] = []): Verbindung =>
  ({ id, bankName, status: "aktiv", accounts: ibans.map((iban) => ({ iban, name: `${bankName} Girokonto …${iban.slice(-4)}` })) }) as unknown as Verbindung;

const giro = verbindung("a", "Testbank", ["DE02120300000000202051", "DE12500105170648489890"]);
const zweiterZugang = verbindung("b", "Testbank", ["DE62370400440532013001"]);
const zweitbank = verbindung("c", "Zweitbank", ["DE39500105175407324924"]);
const ruhig = { verbinden: false, offen: null, busy: null };
const freigabe = (fuer: string) => ({ fuer, schritt: {} as never });

describe("Grund gesperrter FinTS-Knöpfe: Name der Verbindung (#1677)", () => {
  it("nennt eine Bank, die nur einmal verbunden ist, allein beim Namen", () => {
    expect(wartetAuf([giro, zweitbank], { offen: freigabe("a"), busy: null })).toBe("die Freigabe für Testbank gesendet oder abgebrochen ist");
  });

  it("unterscheidet zwei Verbindungen mit demselben Banknamen an der Endung der IBAN ihres ersten Kontos", () => {
    const alle = [zweiterZugang, zweitbank, giro];
    expect(wartetAuf(alle, { offen: freigabe("a"), busy: null })).toBe("die Freigabe für Testbank …2051 gesendet oder abgebrochen ist");
    expect(wartetAuf(alle, { offen: null, busy: "b" })).toBe("der Abruf für Testbank …3001 fertig ist");
  });

  it("bleibt beim Banknamen, wenn die Verbindung keine Konten hat", () => {
    const ohneKonten = verbindung("d", "Testbank");
    expect(wartetAuf([ohneKonten, giro], { offen: freigabe("d"), busy: null })).toBe("die Freigabe für Testbank gesendet oder abgebrochen ist");
  });
});

describe("Grund gesperrter FinTS-Knöpfe beim Trennen (#1677)", () => {
  const alle = [zweiterZugang, zweitbank, giro];
  const trennt = { ...ruhig, busy: "x-b" };

  it("nennt an den übrigen Zeilen alle Knöpfe, an der trennenden keinen", () => {
    expect(zeilenGrund(zweitbank, alle, trennt)).toEqual({
      text: "„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald die Verbindung zu Testbank …3001 getrennt ist.",
      trennen: true,
    });
    expect(zeilenGrund(zweiterZugang, alle, trennt)).toBeNull();
  });

  it("sperrt „Über FinTS verbinden“ nicht", () => {
    expect(wartetAuf(alle, trennt)).toBeNull();
  });

  it("nennt bei offenem Formular oben „Trennen“ in einem zweiten Satz", () => {
    expect(zeilenGrund(zweitbank, alle, { ...trennt, verbinden: true })).toEqual({
      text:
        "„Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald das Verbinden über FinTS oben fertig oder abgebrochen ist. " +
        "„Trennen“ geht wieder, sobald die Verbindung zu Testbank …3001 getrennt ist.",
      trennen: true,
    });
  });

  it("ohne Trennen bleibt der Grund beim offenen Formular, wie er war", () => {
    expect(zeilenGrund(zweitbank, alle, { ...ruhig, verbinden: true })).toEqual({
      text: "„Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald das Verbinden über FinTS oben fertig oder abgebrochen ist.",
      trennen: false,
    });
  });
});

describe("Grund beim Trennen ohne FINTS_PRODUKT_ID (Review #1693)", () => {
  // Ohne Registrierungsnummer zeigt eine Zeile nur „Trennen“; der Grund darf keine Knöpfe nennen, die es nicht gibt
  it("nennt an den übrigen Zeilen nur „Trennen“", () => {
    const html = renderToStaticMarkup(createElement(Gruende, { connections: [zweiterZugang, zweitbank, giro], busy: "x-b" }));
    expect(html).toContain("„Trennen“ geht wieder, sobald die Verbindung zu Testbank …3001 getrennt ist.");
    expect(html).not.toContain("„Jetzt abrufen“");
    expect(html).not.toContain("„Zugang ändern“");
  });
});

/** Gründe aller Zeilen ohne FINTS_PRODUKT_ID, wie die Seite Verbindungen sie aus dem Hook liest (#1951) */
function Gruende({ connections, busy }: { connections: Verbindung[]; busy: string }) {
  const f = useFintsAbruf({ configured: false, connections } as never, {
    verbinden: false,
    setVerbinden: () => {},
    vorlage: null,
    setVorlage: () => {},
    neuVerbinden: () => {},
    offen: null,
    setOffen: () => {},
    busy,
    setBusy: () => {},
  });
  return createElement("p", null, connections.map((c) => f.grund(c)?.text ?? "").join(" | "));
}
