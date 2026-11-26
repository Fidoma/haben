import { describe, expect, it } from "vitest";
import { anbieterAufzaehlung, zugangGueltigBisText } from "./zahlungsdienstleister-text.ts";

describe("Texte der Karte Zahlungsdienstleister", () => {
  it("zählt die Anbieter auf, auch ab drei", () => {
    expect(anbieterAufzaehlung(["Stripe"])).toBe("Stripe");
    expect(anbieterAufzaehlung(["Stripe", "PayPal"])).toBe("Stripe und PayPal");
    expect(anbieterAufzaehlung(["Stripe", "PayPal", "Mollie"])).toBe("Stripe, PayPal und Mollie");
  });

  it("nennt den Ablauf als Tag in Deutschland, nicht in UTC", () => {
    expect(zugangGueltigBisText(new Date("2027-03-31T23:30:00Z"))).toBe(" Der Zugang gilt bis 01.04.2027.");
  });
});
