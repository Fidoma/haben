import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { anbieterAufzaehlung, zugangGueltigBisText } from "../lib/zahlungsdienstleister-text.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { KonfliktKlaeren } from "./ImportKonflikt.tsx";
import { quelleZuAnbieter } from "../lib/import-quelle.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { type PspDaten, type PspVerbindung, VerbindungFormular } from "./ZahlungsdienstleisterFormular.tsx";
import { removePspConnectionFn, syncPspNow } from "../server/functions/zahlungsdienstleister.ts";

/**
 * Verbindungen zu Zahlungsdienstleistern über ihre API (Einstellungen › Bank, #1729): Stripe, PayPal und jeder weitere Anbieter
 * mit Adapter, auch mehrere beim selben Anbieter. Haben holt Zahlungen, Erstattungen, Gebühren und Auszahlungen selbst und legt
 * sie im Konto des Zahlungsdienstleisters an; der Export des Anbieters bleibt der Weg für ältere Zeiträume.
 */
export function ZahlungsdienstleisterCard({ daten }: { daten: PspDaten }) {
  const [neu, setNeu] = useState(false);
  // Meldungen nach dem Anlegen und Entfernen stehen an der Karte: Formular und Zeile sind danach weg
  const meldung = useAction();
  return (
    <section className="card" aria-labelledby="psp-heading">
      <h2 id="psp-heading">Zahlungsdienstleister</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben holt die Umsätze von {anbieterAufzaehlung(daten.anbieter.map((a) => a.name))} über deren Schnittstelle und legt sie im Konto des
        Zahlungsdienstleisters an. Je Verbindung ein Konto; mehrere Konten beim selben Anbieter gehen, jedes mit eigenem Namen.
      </p>
      {daten.verbindungen.length === 0 && !neu && (
        <p className="small" style={{ margin: "0.5rem 0 0" }}>
          <strong>Nicht eingerichtet.</strong>
        </p>
      )}
      {daten.verbindungen.map((v) => (
        <VerbindungZeile key={v.id} daten={daten} verbindung={v} entfernen={meldung.run} />
      ))}
      <NoticeBanner notice={meldung.notice} />
      {neu ? (
        <div style={TRENNUNG}>
          <VerbindungFormular
            daten={daten}
            onFertig={(gespeichert) => {
              setNeu(false);
              if (gespeichert) meldung.setNotice({ tone: "ok", text: "Verbindung gespeichert." });
            }}
          />
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setNeu(true)}>
            Verbindung hinzufügen
          </button>
        </div>
      )}
    </section>
  );
}

/** Jede Verbindung und das Formular einer neuen stehen unter einer Linie, ohne Karte in der Karte (DESIGN.md › Karten) */
const TRENNUNG = { borderTop: "1px solid var(--line)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 } as const;

/** Eine Verbindung: Stand, Meldungen, Konflikte und Aktionen; „Bearbeiten“ öffnet das Formular an ihrer Stelle */
function VerbindungZeile({ daten, verbindung: v, entfernen }: { daten: PspDaten; verbindung: PspVerbindung; entfernen: ReturnType<typeof useAction>["run"] }) {
  const router = useRouter();
  const remove = useServerFn(removePspConnectionFn);
  const sync = useServerFn(syncPspNow);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [geklaert, setGeklaert] = useState(false);
  const { busy, notice, setNotice, run } = useAction();
  const headingId = useId();
  const anbieter = daten.anbieter.find((a) => a.provider === v.provider);
  return (
    <section aria-labelledby={headingId} style={TRENNUNG}>
      <h3 id={headingId} style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        {v.name}
      </h3>
      <p className="small" style={{ margin: "0.25rem 0 0" }}>
        <strong>
          {anbieter?.name ?? v.provider}: verbunden mit {v.accountId} ({anbieter?.zugangName ?? "Zugang"} …{v.keyHint}).
        </strong>{" "}
        {v.kontoName ? `Konto in Haben: ${v.kontoName}. ` : "Noch kein Konto in Haben. "}
        {v.lastSyncAt ? `Letzter Abruf: ${formatDateTime(v.lastSyncAt)}.` : "Noch kein Abruf."}
        {v.lastSyncAt ? ` Der nächste Abruf holt ab dem ${formatDate(v.naechsterAbrufAb)}.` : ""}
        {v.zugangGueltigBis ? zugangGueltigBisText(v.zugangGueltigBis) : ""}
      </p>
      {v.hinweis && (
        <div className="banner banner-warn" role="note">
          {v.hinweis}
        </div>
      )}
      {v.lastError && (
        <div className="banner banner-danger" role="status">
          {v.lastError}
        </div>
      )}
      {(v.konflikte.length > 0 || geklaert) && (
        <div className="actions">
          <KonfliktKlaeren konflikte={v.konflikte} disabled={busy} quelle={quelleZuAnbieter(v.provider)} onGeklaert={() => setGeklaert(true)} />
        </div>
      )}
      {bearbeiten ? (
        <VerbindungFormular
          daten={daten}
          verbindung={v}
          onFertig={(gespeichert) => {
            setBearbeiten(false);
            if (gespeichert) setNotice({ tone: "ok", text: "Verbindung gespeichert." });
          }}
        />
      ) : (
        <div className="actions">
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirmingRemove(true)}>
            Verbindung entfernen
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setBearbeiten(true)}>
            Bearbeiten
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setGeklaert(false);
                const result = await sync({ data: { id: v.id } });
                await router.invalidate();
                if (result.error) throw new Error(result.error);
                return result;
              }, "Abruf durchgelaufen.")
            }
          >
            {busy ? "Laufe …" : "Jetzt abrufen"}
          </button>
        </div>
      )}
      <NoticeBanner notice={notice} />
      <ConfirmDialog
        open={confirmingRemove}
        title={`Verbindung ${v.name} entfernen?`}
        confirmLabel="Entfernen"
        danger
        onConfirm={() => {
          setConfirmingRemove(false);
          void entfernen(async () => {
            await remove({ data: { id: v.id } });
            await router.invalidate();
          }, "Verbindung entfernt. Übernommene Umsätze bleiben im Konto stehen.");
        }}
        onClose={() => setConfirmingRemove(false)}
      >
        <p>
          Der Zugang wird gelöscht. Bereits übernommene Umsätze bleiben im Konto des Zahlungsdienstleisters stehen; ein neuer Abruf legt sie nicht noch einmal
          an.
        </p>
      </ConfirmDialog>
    </section>
  );
}
