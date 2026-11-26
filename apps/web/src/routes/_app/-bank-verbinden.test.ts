import { describe, expect, it, vi } from "vitest";
import { anbieterWahl, bankWege } from "./-bank-verbinden.tsx";

// Die Server-Funktionen brauchen die Umgebung der App; geprüft werden hier nur die Wege und ihre Gründe
vi.mock("../../server/functions/fints.ts", () => ({ cancelFints: {}, connectFints: {}, continueFints: {}, disconnectFints: {}, syncFints: {} }));
vi.mock("@tanstack/react-router", () => ({ Link: () => null, useNavigate: () => () => {}, useRouter: () => ({ invalidate: async () => {} }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({}) }));

type Daten = Parameters<typeof bankWege>[0];
const fints = { id: "a", bankName: "Testbank", status: "aktiv", accounts: [{ iban: "DE02120300000000202051", name: "Girokonto" }] };
const daten = (sync: boolean, fintsEingerichtet: boolean) =>
  ({ sync: { configured: sync }, fints: { configured: fintsEingerichtet, connections: [fints] } }) as unknown as Daten;
const ruhig = { offen: null, busy: null };
const gesperrt = (wege: ReturnType<typeof bankWege>) => Object.fromEntries(wege.map((w) => [w.wert, w.gesperrt !== null]));

describe("„Wie verbinden?“ (#1951)", () => {
  it("drei Wege; die Datei geht immer, Enable Banking und FinTS nur, wenn eingerichtet", () => {
    expect(gesperrt(bankWege(daten(true, true), ruhig))).toEqual({ enablebanking: false, fints: false, datei: false });
    expect(gesperrt(bankWege(daten(false, false), ruhig))).toEqual({ enablebanking: true, fints: true, datei: false });
  });

  it("FinTS wartet wie bisher auf einen offenen Schritt oder Abruf an einer Zeile, mit dem bisherigen Satz (#1647, #1660)", () => {
    const schritt = bankWege(daten(true, true), { offen: { fuer: "a", schritt: {} as never }, busy: null }).find((w) => w.wert === "fints");
    expect(schritt?.gesperrt).toBe("„Über FinTS verbinden“ geht wieder, sobald die Freigabe für Testbank gesendet oder abgebrochen ist.");
    const abruf = bankWege(daten(true, true), { offen: null, busy: "a" }).find((w) => w.wert === "fints");
    expect(abruf?.gesperrt).toBe("„Über FinTS verbinden“ geht wieder, sobald der Abruf für Testbank fertig ist.");
  });
});

describe("„Anbieter wählen“ (#1951)", () => {
  const stripe = {
    provider: "stripe",
    name: "Stripe",
    felder: [{ name: "apiKey", label: "API-Schlüssel", art: "geheim" }],
    schritte: ["zugang", "einstellungen", "abruf"],
  };
  const wahl = anbieterWahl({
    anbieter: [stripe],
    verbindungen: [{ provider: "stripe", name: "Shop DE" }],
  } as unknown as Parameters<typeof anbieterWahl>[0]);

  it("Anbieter mit Adapter zuerst, mit Zugang, Zahl der Schritte und bestehenden Verbindungen", () => {
    expect(wahl[0]).toEqual({ wert: "stripe", label: "Stripe", hint: "API-Schlüssel · 3 Schritte · verbunden: „Shop DE“", gesperrt: null });
  });

  it("die übrigen ausgegraut mit Grund, ohne „Anderer Zahlungsdienstleister“", () => {
    const uebrige = wahl.slice(1);
    expect(uebrige.every((w) => w.gesperrt !== null)).toBe(true);
    expect(uebrige.map((w) => w.wert)).toContain("etsy");
    expect(uebrige.map((w) => w.wert)).not.toContain("sonstige");
    expect(uebrige.find((w) => w.wert === "shopify")?.gesperrt).toBe("Noch kein Abruf; die Umsätze kommen als Datei über „Datei importieren“.");
  });
});
