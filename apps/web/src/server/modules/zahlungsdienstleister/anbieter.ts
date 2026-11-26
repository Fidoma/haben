import type { PspAdapter } from "./adapter.ts";
import { paypalAdapter } from "./paypal.ts";
import { stripeAdapter } from "./stripe.ts";

/*
 * Die Anbieter mit Adapter (#1729). Ein neuer Anbieter kommt mit seinem Adapter hier dazu; Tabelle, Zeitplan und Oberfläche
 * nehmen ihn dann auf (die übrigen Einträge: Skill anbindung-hinzufuegen). Die Reihenfolge ist die im Dialog „Anbieter wählen“ auf der Bankseite.
 */
export const ANBIETER = [stripeAdapter, paypalAdapter] as unknown as readonly PspAdapter[];

export function adapterFuer(provider: string): PspAdapter | null {
  return ANBIETER.find((a) => a.provider === provider) ?? null;
}
