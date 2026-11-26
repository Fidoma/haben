import { describe, expect, it } from "vitest";
import { quelleTexte, quelleZuAnbieter } from "./import-quelle.ts";

/* Wer in der Konfliktklärung liefert: Zahlungsdienstleister heißen wie in PAYMENT_PROVIDERS, ohne eigene Liste (#1729) */
describe("Quelle eines Konflikts", () => {
  it("ordnet den Anbieter der Quellenbindung zu", () => {
    expect(quelleZuAnbieter("stripe")).toBe("stripe");
    expect(quelleZuAnbieter("paypal")).toBe("paypal");
    expect(quelleZuAnbieter("etsy")).toBe("etsy");
    expect(quelleZuAnbieter("enablebanking")).toBe("bank");
    // Über den REST-Import, auch wenn der Name nach einem Zahlungsdienstleister klingt
    expect(quelleZuAnbieter("shopify")).toBe("extern");
    expect(quelleZuAnbieter("toString")).toBe("extern");
  });

  it("nennt den Zahlungsdienstleister beim Namen", () => {
    expect(quelleTexte("stripe")).toEqual({ wer: "Stripe", von: "von Stripe", angaben: "von Stripe", abruf: "aus dem Stripe-Abruf" });
    expect(quelleTexte("paypal").abruf).toBe("aus dem PayPal-Abruf");
    expect(quelleTexte("etsy").abruf).toBe("aus dem Etsy-Abruf");
    expect(quelleTexte("bank").wer).toBe("Die Bank");
  });
});
