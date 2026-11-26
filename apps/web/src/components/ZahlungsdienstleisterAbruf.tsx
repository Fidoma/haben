import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { zugangGueltigBisText } from "../lib/zahlungsdienstleister-text.ts";
import { removePspConnectionFn, syncPspNow } from "../server/functions/zahlungsdienstleister.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FormDialog } from "./FormDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { type PspDaten, type PspVerbindung, VerbindungFormular } from "./ZahlungsdienstleisterFormular.tsx";

/*
 * Verbindungen zu Zahlungsdienstleistern über ihre API (#1729) an den Zeilen der Konten (#1951): „Jetzt abrufen“,
 * „Bearbeiten“ (auch „Zugang ändern“) im Dialog und „Entfernen“. Neu verbunden wird über die geführte Einrichtung
 * (routes/_app/bank_.verbinden.$anbieter.tsx).
 */

/** Stand einer Verbindung in einem Satz, oben im Dialog „Bearbeiten“ */
export function verbindungStand(daten: PspDaten, v: PspVerbindung): string {
  const anbieter = daten.anbieter.find((a) => a.provider === v.provider);
  return [
    `${anbieter?.name ?? v.provider}: verbunden mit ${v.accountId} (${anbieter?.zugangName ?? "Zugang"} …${v.keyHint}).`,
    v.kontoName ? ` Konto in Haben: ${v.kontoName}.` : " Noch kein Konto in Haben.",
    v.lastSyncAt ? ` Letzter Abruf: ${formatDateTime(v.lastSyncAt)}. Der nächste Abruf holt ab dem ${formatDate(v.naechsterAbrufAb)}.` : " Noch kein Abruf.",
    v.zugangGueltigBis ? zugangGueltigBisText(v.zugangGueltigBis) : "",
  ].join("");
}

/**
 * Aktionen der Verbindungen und der Bereich mit Dialogen und Meldungen; die Meldung nach dem Entfernen steht hier, weil die
 * Zeile danach weg ist
 */
export function usePspAbruf(daten: PspDaten) {
  const router = useRouter();
  const remove = useServerFn(removePspConnectionFn);
  const sync = useServerFn(syncPspNow);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [bearbeiten, setBearbeiten] = useState<PspVerbindung | null>(null);
  const [entfernen, setEntfernen] = useState<PspVerbindung | null>(null);
  const { busy, notice, setNotice, run } = useAction();

  const abrufen = async (v: PspVerbindung) => {
    setLaeuft(v.id);
    await run(async () => {
      const result = await sync({ data: { id: v.id } });
      await router.invalidate();
      if (result.error) throw new Error(`${v.name}: ${result.error}`);
    }, `${v.name}: Abruf durchgelaufen.`);
    setLaeuft(null);
  };

  const bereich = (
    <>
      <FormDialog open={bearbeiten !== null} title={bearbeiten ? `${bearbeiten.name} bearbeiten` : ""} onClose={() => setBearbeiten(null)}>
        {bearbeiten && (
          <div className="stack" style={{ gap: 12 }}>
            <p className="small" style={{ margin: 0 }}>
              {verbindungStand(daten, bearbeiten)}
            </p>
            {bearbeiten.hinweis && (
              <div className="banner banner-warn" role="note">
                {bearbeiten.hinweis}
              </div>
            )}
            <VerbindungFormular
              daten={daten}
              verbindung={bearbeiten}
              onFertig={(gespeichert) => {
                setBearbeiten(null);
                if (gespeichert) setNotice({ tone: "ok", text: "Verbindung gespeichert." });
              }}
            />
          </div>
        )}
      </FormDialog>
      <ConfirmDialog
        open={entfernen !== null}
        title={`Verbindung ${entfernen?.name} entfernen?`}
        confirmLabel="Entfernen"
        danger
        onConfirm={() => {
          const v = entfernen;
          setEntfernen(null);
          if (v)
            void run(async () => {
              await remove({ data: { id: v.id } });
              await router.invalidate();
            }, "Verbindung entfernt. Übernommene Umsätze bleiben im Konto stehen.");
        }}
        onClose={() => setEntfernen(null)}
      >
        <p>
          Der Zugang wird gelöscht. Bereits übernommene Umsätze bleiben im Konto des Zahlungsdienstleisters stehen; ein neuer Abruf legt sie nicht noch einmal
          an.
        </p>
      </ConfirmDialog>
      <NoticeBanner notice={notice} />
    </>
  );

  return {
    gesperrt: busy,
    laeuft: (v: PspVerbindung) => (laeuft === v.id ? "abruf" : null),
    abrufen,
    bearbeiten: (v: PspVerbindung) => setBearbeiten(v),
    entfernenFragen: (v: PspVerbindung) => setEntfernen(v),
    sichtbar: notice !== null,
    bereich,
  };
}
export type PspAktionen = ReturnType<typeof usePspAbruf>;
