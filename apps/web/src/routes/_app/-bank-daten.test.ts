import { describe, expect, it } from "vitest";
import {
  bankStand,
  type Data,
  type Detail,
  fortschrittArt,
  hatMarktplatzKonto,
  leereListeText,
  naechsteSchritte,
  naechstenOffenenZiel,
  nextOpenAfter,
  offenerEntwurf,
  offenText,
  type Posten,
  restAngebot,
  suchziel,
} from "./-bank-daten.ts";

// Rechnung über 119,00 €, Korrektur über −23,80 €, der Kunde zahlt 95,20 € (#1398)
const korrektur = { id: "k1", number: "RE-2026-0002", open: -2380 };
const rechnung = (openCorrections?: (typeof korrektur)[]) =>
  ({ type: "invoice", id: "r1", number: "RE-2026-0001", date: "2026-11-02", open: 11_900, partyName: "Kunde", partyIbans: [], openCorrections }) as Posten;
const zahlung = (open: number) => ({ id: "t1", amount: open, open, bookingDate: "2026-11-06" }) as Detail["transaction"];

describe("Rest einer Zahlung mit offener Korrektur (#1398)", () => {
  it("bietet bei „Rechnung minus Korrektur“ die Korrektur an statt Skonto, Forderungsausfall oder Gebühr", () => {
    const angebot = restAngebot(rechnung([korrektur]), zahlung(9520));
    expect(angebot.korrektur).toEqual({ corrections: [korrektur], skonto: 0 });
    expect(angebot.restKinds).toEqual([]);
    expect(angebot.feeRest).toBe(0);
    expect(angebot.rest).toBe(2380);
  });

  it("wählt unter mehreren offenen Korrekturen die, die den Rest genau ausgleicht", () => {
    const andere = { id: "k0", number: "RE-2026-0003", open: -1000 };
    expect(restAngebot(rechnung([andere, korrektur]), zahlung(9520)).korrektur?.corrections).toEqual([korrektur]);
  });

  it("nimmt mehrere Korrekturen zusammen, wenn erst ihre Summe den Rest ausgleicht", () => {
    const halb = [
      { id: "k1", number: "RE-2026-0002", open: -1190 },
      { id: "k2", number: "RE-2026-0003", open: -1190 },
    ];
    const angebot = restAngebot(rechnung(halb), zahlung(9520));
    expect(angebot.korrektur?.corrections).toEqual(halb);
    expect(angebot.restKinds).toEqual([]);
  });

  it("bietet bei Skonto nach der Korrektur nur das Skonto auf den geminderten Betrag an, nicht den Rest samt Korrektur", () => {
    // 95,20 € nach der Korrektur, 2 % Skonto = 1,90 €, gezahlt 93,30 € in der Frist
    const frist = { days: 10, percent: 200, until: "2026-11-12", paidBy: "2026-11-12", amount: 190, payable: 9330 };
    const mitSkonto = { ...rechnung([korrektur]), skontoNachKorrektur: [frist] } as Posten;
    const angebot = restAngebot(mitSkonto, zahlung(9330));
    expect(angebot.korrektur).toMatchObject({ corrections: [korrektur], skonto: 190 });
    expect(angebot.restKinds).not.toContain("skonto");
    expect(angebot.feeRest).toBe(0);
  });

  it("bleibt bei Skonto und Forderungsausfall, wenn der Rest nicht zur Korrektur passt", () => {
    const angebot = restAngebot(rechnung([korrektur]), zahlung(9000));
    expect(angebot.korrektur).toBeUndefined();
    expect(angebot.restKinds).toEqual(["skonto", "forderungsausfall"]);
    expect(angebot.feeRest).toBe(-2900);
  });

  it("bleibt bei Skonto und Forderungsausfall ohne offene Korrektur", () => {
    const angebot = restAngebot(rechnung(), zahlung(9520));
    expect(angebot.korrektur).toBeUndefined();
    expect(angebot.restKinds).toEqual(["skonto", "forderungsausfall"]);
  });

  it("bietet bei einer Rechnung in Fremdwährung auch keine Kursdifferenz an", () => {
    const usd = { ...rechnung([korrektur]), currency: "USD" } as Posten;
    const angebot = restAngebot(usd, zahlung(9520));
    expect(angebot.korrektur?.corrections).toEqual([korrektur]);
    expect(angebot.exchangeDifference).toBe(0);
  });

  it("bietet bei voller Zahlung keine Korrektur an", () => {
    expect(restAngebot(rechnung([korrektur]), zahlung(11_900)).korrektur).toBeUndefined();
  });
});

// Fortschritt der Zuordnung über der Umsatzliste (#1253)
const zeile = (id: string, open: number, privat = false) => ({ id, open, privat }) as Data["transactions"][number];

describe("Fortschritt der Zuordnung (#1253)", () => {
  it("nennt die Zahl der offenen Umsätze, einzeln und mehrfach", () => {
    expect(offenText(1)).toBe("1 Umsatz noch offen");
    expect(offenText(12)).toBe("12 Umsätze noch offen");
  });

  const liste = [zeile("a", 0), zeile("b", 500), zeile("c", 0), zeile("d", 700)];

  it("springt zum nächsten offenen Umsatz nach dem gewählten", () => {
    expect(nextOpenAfter(liste, "a")).toBe("b");
    expect(nextOpenAfter(liste, "b")).toBe("d");
  });

  it("beginnt am Ende der Liste wieder von vorn", () => {
    expect(nextOpenAfter(liste, "d")).toBe("b");
  });

  it("gibt ohne anderen offenen Umsatz nichts zurück, auch wenn nur der gewählte offen ist", () => {
    expect(nextOpenAfter([zeile("a", 0), zeile("b", 500)], "b")).toBeUndefined();
    expect(nextOpenAfter([zeile("a", 0)], "a")).toBeUndefined();
  });

  it("überspringt als privat gekennzeichnete Umsätze, die nicht als offen zählen", () => {
    expect(nextOpenAfter([zeile("a", 0), zeile("p", 900, true), zeile("b", 500)], "a")).toBe("b");
  });

  it("nimmt ohne Auswahl den ersten offenen Umsatz", () => {
    expect(nextOpenAfter(liste, undefined)).toBe("b");
  });
});

describe("Knopf „Nächsten offenen“ (#1253)", () => {
  it("wählt den nächsten offenen Umsatz der Liste und behält Filter und Suche", () => {
    expect(naechstenOffenenZiel("b", "alle", "miete")).toEqual({ umsatz: "b" });
  });

  it("fehlt im Filter „Offen“ ohne Suche, wenn kein weiterer offener Umsatz in der Liste steht", () => {
    expect(naechstenOffenenZiel(undefined, "offen", undefined)).toBeNull();
    expect(naechstenOffenenZiel(undefined, undefined, "")).toBeNull();
  });

  it("öffnet bei aktiver Suche ohne weiteren Treffer alle offenen Umsätze ohne Suche", () => {
    expect(naechstenOffenenZiel(undefined, "offen", "miete")).toEqual({ filter: "offen", suche: undefined, umsatz: undefined });
  });

  it("öffnet in einem anderen Filter den Filter „Offen“", () => {
    expect(naechstenOffenenZiel(undefined, "zugeordnet", undefined)).toEqual({ filter: "offen", suche: undefined, umsatz: undefined });
  });
});

describe("Suchfeld (#1253)", () => {
  it("hält Getipptes, bis es in der Adresse steht", () => {
    expect(offenerEntwurf("miet", "")).toBe("miet");
    expect(offenerEntwurf("miete", "miet")).toBe("miete");
    expect(offenerEntwurf("", "miete")).toBe("");
  });

  it("hält nichts mehr, sobald die Suche übernommen ist, sonst setzte das Feld eine von „Nächsten offenen“ geleerte Suche wieder ein", () => {
    const entwurf = offenerEntwurf("miete", "miete");
    expect(entwurf).toBeNull();
    expect(offenerEntwurf(entwurf, "")).toBeNull();
  });

  // Während der Loader läuft, steht die Suche der Navigation schon in `location`; `initial` und `resolvedLocation` sind noch die alten
  const ort = (suche?: string, pathname = "/bank") => ({ pathname, search: { suche } });
  const laeuft = (alt: string | undefined, neu: string | undefined) => suchziel({ location: ort(neu), resolvedLocation: ort(alt) }, alt ?? "");

  it("schickt Gelöschtes und Zurückgetipptes ab, während die vorige Suche noch lädt", () => {
    expect(offenerEntwurf("m", laeuft("", "m"))).toBeNull();
    expect(offenerEntwurf("", laeuft("", "m"))).toBe("");
    expect(offenerEntwurf("miete", laeuft("miete", "mietee"))).toBe("miete");
    expect(offenerEntwurf("miete", laeuft("miete", undefined))).toBe("miete");
    expect(offenerEntwurf("mietee", laeuft("", "miete"))).toBe("mietee");
  });

  it("folgt „Nächsten offenen“ und Browser-Zurück schon während des Ladens", () => {
    expect(laeuft("miete", undefined)).toBe("");
    expect(laeuft(undefined, "miete")).toBe("miete");
  });

  it("behält die Suche beim Wechsel auf eine andere Seite und vor dem ersten Laden", () => {
    expect(suchziel({ location: ort(undefined, "/belege"), resolvedLocation: ort("miete") }, "miete")).toBe("miete");
    expect(suchziel({ location: ort("miete"), resolvedLocation: undefined }, "miete")).toBe("miete");
  });

  it("schickt eine Suche aus der Adresse ohne Tippen nicht ab", () => {
    expect(offenerEntwurf(null, "miete")).toBeNull();
  });
});

describe("Fortschritt und leere Liste (#1253)", () => {
  it("zeigt den Zähler, solange etwas offen ist, auch ohne Import", () => {
    expect(fortschrittArt(3, true)).toBe("offen");
    expect(fortschrittArt(3, false)).toBe("offen");
  });

  it("zeigt „Alles zugeordnet.“ nur, wenn alles erledigt und ein Import da ist", () => {
    expect(fortschrittArt(0, true)).toBe("fertig");
    expect(fortschrittArt(0, false)).toBe("keine");
  });

  it("nennt als nächste Schritte Belege und Voranmeldung, beim Kleinunternehmer nur Belege", () => {
    expect(naechsteSchritte(false)).toEqual(["belege", "voranmeldung"]);
    expect(naechsteSchritte(true)).toEqual(["belege"]);
  });

  it("lässt die leere Liste im Filter „Offen“ stumm, wenn „Alles zugeordnet.“ schon dasteht", () => {
    expect(leereListeText("offen", 0, 0, true)).toBeNull();
  });

  it("sagt „Keine Umsätze.“ ohne Import, bei Suche ohne Treffer und in anderen Filtern", () => {
    expect(leereListeText("offen", 0, 0, false)).toBe("Keine Umsätze.");
    expect(leereListeText("offen", 0, 4, true)).toBe("Keine Umsätze.");
    expect(leereListeText("zugeordnet", 0, 0, true)).toBe("Keine Umsätze.");
    expect(leereListeText("vorschlag", 0, 2, true)).toBe("Keine Umsätze mit Vorschlag.");
  });

  it("hält einen leeren Auszug ohne Umsätze nicht für „Alles zugeordnet.“", () => {
    const konto = (openCount: number, hasTransactions: boolean) =>
      ({ openCount, hasTransactions, lastImport: { periodTo: "2026-10-31" } }) as unknown as Data["accounts"][number];
    expect(bankStand([konto(0, false)])).toEqual({ offen: 0, hatUmsaetze: false });
    expect(bankStand([konto(0, false), konto(0, true)])).toEqual({ offen: 0, hatUmsaetze: true });
    expect(bankStand([konto(2, true), konto(3, true)])).toEqual({ offen: 5, hatUmsaetze: true });
    expect(bankStand([])).toEqual({ offen: 0, hatUmsaetze: false });
  });

  it("zeigt keinen Text, solange die Liste Umsätze hat", () => {
    expect(leereListeText("alle", 5, 0, true)).toBeNull();
  });
});

/*
 * Vor dem Anlegen eines Zahlungsdienstleister-Kontos: Gibt es für Anbieter und Marktplatz schon ein Konto (etwa
 * Amazon.de), fragt die Seite nach, statt stillschweigend ein zweites anzulegen.
 */
describe("hatMarktplatzKonto", () => {
  const konten = [
    { provider: "amazon", marketplace: "Amazon.de" },
    { provider: "ebay", marketplace: null },
  ];

  it("findet ein Konto desselben Anbieters und Marktplatzes", () => {
    expect(hatMarktplatzKonto(konten, "amazon", "Amazon.de")).toBe(true);
  });

  it("unterscheidet Anbieter und Marktplatz", () => {
    expect(hatMarktplatzKonto(konten, "amazon", "Amazon.fr")).toBe(false);
    expect(hatMarktplatzKonto(konten, "paypal", "Amazon.de")).toBe(false);
  });

  it("ohne Marktplatz gibt es nichts zu fragen", () => {
    expect(hatMarktplatzKonto(konten, "paypal", null)).toBe(false);
    expect(hatMarktplatzKonto(konten, "ebay", undefined)).toBe(false);
  });
});
