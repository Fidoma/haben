import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { INTERNAL_PROVIDERS } from "@haben/import";
import { describe, expect, it } from "vitest";

/*
 * INTERNAL_PROVIDERS fällt offen aus: Fehlt eine Anbindung, nimmt der REST-Import Lieferungen in ihre Quelle an
 * (#306; PayPal und Stripe wurden so schon vergessen). Jede Anbindung bindet ihre Quelle mit einem festen Anbieter
 * an `storeBatch` (`binding: { provider: "…" }`); hier wird jede solche Stelle im Code gegen die Liste geprüft. Die
 * Zahlungsdienstleister mit Adapter binden mit dem Anbieter ihrer Verbindung (zahlungsdienstleister/abruf.ts, #1729): Dort
 * zählt jeder Adapter aus der Liste der Anbieter.
 */

const modules = fileURLToPath(new URL("..", import.meta.url));

/** Anbieter aus `binding: { provider: "…"` in allen Dateien unter server/modules außer Tests */
function gebundeneAnbieter(): Map<string, string[]> {
  const gefunden = new Map<string, string[]>();
  for (const datei of readdirSync(modules, { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(datei) || /\.test\.tsx?$/.test(datei)) continue;
    const code = readFileSync(join(modules, datei), "utf8");
    for (const [, provider] of code.matchAll(/binding:\s*\{\s*provider:\s*"([^"]+)"/g)) {
      gefunden.set(provider!, [...(gefunden.get(provider!) ?? []), datei]);
    }
  }
  return gefunden;
}

describe("Interne Anbieter (#306)", () => {
  it("jede Anbindung in Haben steht in INTERNAL_PROVIDERS", () => {
    const gefunden = gebundeneAnbieter();
    // Die Suche selbst greift: die bekannten Abrufe werden gefunden
    expect([...gefunden.keys()]).toEqual(expect.arrayContaining(["enablebanking", "etsy"]));
    const fehlend = [...gefunden].filter(([provider]) => !(INTERNAL_PROVIDERS as readonly string[]).includes(provider));
    expect(Object.fromEntries(fehlend)).toEqual({});
  });

  it("jeder Adapter eines Zahlungsdienstleisters steht in INTERNAL_PROVIDERS", () => {
    // Die gemeinsame Anbindung bindet mit dem Anbieter der Verbindung, nicht mit einem festen Text
    const ordner = join(modules, "zahlungsdienstleister");
    expect(readFileSync(join(ordner, "abruf.ts"), "utf8")).toMatch(/binding:\s*\{\s*provider:\s*row\.provider/);
    // Jeder Adapter (`PspAdapter<…> = { provider: "…"`) gehört in die Liste
    const anbieter = readdirSync(ordner)
      .filter((datei) => datei.endsWith(".ts") && !datei.endsWith(".test.ts"))
      .flatMap((datei) => [...readFileSync(join(ordner, datei), "utf8").matchAll(/PspAdapter<[^=]*= \{\s*provider:\s*"([^"]+)"/g)].map((m) => m[1]!));
    expect(anbieter).toEqual(expect.arrayContaining(["paypal", "stripe"]));
    expect(anbieter.filter((p) => !(INTERNAL_PROVIDERS as readonly string[]).includes(p))).toEqual([]);
  });
});
