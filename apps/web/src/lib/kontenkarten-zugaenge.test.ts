import { describe, expect, it } from "vitest";
import { anbieterZugaenge } from "./kontenkarten-zugaenge.ts";
import { kontenkarten } from "./kontenkarten.ts";
import { loesungFuer } from "./verbindungen.ts";

/* Ablauf eines Zugangs zum Zahlungsdienstleister in der Kartenleiste (#1951): dieselbe Frist wie bei Enable Banking */
const JETZT = new Date("2026-11-26T12:00:00Z");
const uebersicht = (zugangGueltigBis: Date | null) =>
  ({
    anbieter: [{ provider: "stripe", name: "Stripe" }],
    verbindungen: [{ id: "v1", provider: "stripe", bankAccountId: "k1", lastSyncAt: null, lastError: null, zugangGueltigBis }],
  }) as unknown as Parameters<typeof anbieterZugaenge>[0];
const tage = (n: number) => new Date(JETZT.getTime() + n * 86_400_000);

describe("Zugänge der Zahlungsdienstleister in der Kartenleiste", () => {
  it("nennt den Ablauf erst 14 Tage vorher, danach „abgelaufen“", () => {
    expect(anbieterZugaenge(uebersicht(tage(20)), JETZT, 14)[0]).toMatchObject({
      weg: "Stripe",
      art: "psp",
      verbindungId: "v1",
      laeuftAbAm: null,
      abgelaufen: false,
    });
    expect(anbieterZugaenge(uebersicht(tage(10)), JETZT, 14)[0]).toMatchObject({ laeuftAbAm: tage(10), abgelaufen: false });
    expect(anbieterZugaenge(uebersicht(tage(-1)), JETZT, 14)[0]).toMatchObject({ laeuftAbAm: null, abgelaufen: true });
    expect(anbieterZugaenge(uebersicht(null), JETZT, 14)[0]).toMatchObject({ laeuftAbAm: null, abgelaufen: false });
  });
});

describe("Konflikt beim Abruf eines Zahlungsdienstleisters", () => {
  it("zeigt „Konflikt“ mit „Klären“, nicht „Fehlgeschlagen“, wenn der Abruf wegen eines offenen Konflikts abgelehnt wurde", () => {
    // So schreibt abruf.ts einen Konflikt an die Verbindung (stripe.test.ts: lastError enthält „Konflikt“, konflikte hat einen)
    const konflikt = { bankAccountId: "k1", provider: "stripe" };
    const mitKonflikt = {
      anbieter: [{ provider: "stripe", name: "Stripe" }],
      verbindungen: [
        {
          id: "v1",
          provider: "stripe",
          bankAccountId: "k1",
          lastSyncAt: null,
          lastError: "Abruf fehlgeschlagen: Konflikt mit schon übernommenen Umsätzen: txn_1 hat einen anderen Betrag.",
          zugangGueltigBis: null,
          konflikte: [konflikt],
        },
      ],
    } as unknown as Parameters<typeof anbieterZugaenge>[0];
    const { karten } = kontenkarten({
      accounts: [{ id: "k1", name: "Stripe", purpose: "zahlungsdienstleister", openCount: 0, providerBalance: 0, lastImport: null }],
      zugaenge: anbieterZugaenge(mitKonflikt, JETZT, 14),
      konflikte: [konflikt],
      jetzt: JETZT,
    });
    expect(karten[0]!.status?.text).toBe("Konflikt");
    expect(loesungFuer(karten[0]!)?.art).toBe("klaeren");
  });

  it("bleibt „Fehlgeschlagen“ ohne offenen Konflikt", () => {
    const ohne = {
      anbieter: [{ provider: "stripe", name: "Stripe" }],
      verbindungen: [
        {
          id: "v1",
          provider: "stripe",
          bankAccountId: "k1",
          lastSyncAt: null,
          lastError: "Abruf fehlgeschlagen: Schlüssel abgelehnt",
          zugangGueltigBis: null,
          konflikte: [],
        },
      ],
    } as unknown as Parameters<typeof anbieterZugaenge>[0];
    expect(anbieterZugaenge(ohne, JETZT, 14)[0]!.fehler).toBe("Abruf fehlgeschlagen: Schlüssel abgelehnt");
  });
});
