import type { KontoZugang } from "./kontenkarten.ts";

/* Zugänge der Zahlungsdienstleister für die Kartenleiste (#1951), ohne Serverfunktionen, damit Tests sie laden können */

type Verbindung = {
  id: string;
  provider: string;
  bankAccountId: string | null;
  lastSyncAt: Date | string | null;
  lastError: string | null;
  zugangGueltigBis: Date | string | null;
  /** Offene Konflikte des Abrufs an dieser Verbindung */
  konflikte?: readonly unknown[];
};

/**
 * Je Verbindung mit Konto ein Zugang, beim Anbieter genannt („Stripe“). „Läuft ab“ ab `vorlaufTage` vor dem Ablauf des Zugangs,
 * dieselbe Frist wie bei Enable Banking (RENEW_WARNING_DAYS); danach „abgelaufen“.
 */
export function anbieterZugaenge(
  uebersicht: { anbieter: { provider: string; name: string }[]; verbindungen: Verbindung[] },
  jetzt: Date,
  vorlaufTage: number,
): KontoZugang[] {
  const name = new Map(uebersicht.anbieter.map((a) => [a.provider, a.name]));
  return uebersicht.verbindungen.flatMap((v) => {
    if (!v.bankAccountId) return [];
    const bis = v.zugangGueltigBis ? new Date(v.zugangGueltigBis) : null;
    const tage = bis ? (bis.getTime() - jetzt.getTime()) / 86_400_000 : null;
    return [
      {
        bankAccountId: v.bankAccountId,
        art: "psp" as const,
        verbindungId: v.id,
        weg: name.get(v.provider) ?? v.provider,
        lastSyncAt: v.lastSyncAt,
        // Ein Konflikt lehnt den Abruf ab und steht dann auch in lastError; die Karte zeigt ihn als „Konflikt“ mit „Klären“
        fehler: v.konflikte?.length ? null : v.lastError,
        abgelaufen: tage !== null && tage < 0,
        laeuftAbAm: tage !== null && tage >= 0 && tage <= vorlaufTage ? bis : null,
      },
    ];
  });
}
