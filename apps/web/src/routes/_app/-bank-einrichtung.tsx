import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { KonfliktKlaeren } from "../../components/ImportKonflikt.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { Status } from "../../components/Status.tsx";
import {
  AnbieterHinweis,
  type Config,
  EinstellungFelder,
  type Einstellungen,
  einstellungFehler,
  geheimeEingabe,
  type PspAnbieter,
  type PspDaten,
  RHYTHMUS_LABELS,
  ZugangFelder,
  useZugangFehler,
} from "../../components/ZahlungsdienstleisterFormular.tsx";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { quelleZuAnbieter } from "../../lib/import-quelle.ts";
import { abrufText, kontoText, SCHRITT_TITEL } from "../../lib/psp-einrichtung.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { checkPspAccessFn, savePspConnectionFn, syncPspNow } from "../../server/functions/zahlungsdienstleister.ts";

/*
 * Schritte der geführten Einrichtung eines Zahlungsdienstleisters (#1951): Zugang prüfen, Name und Zeitraum, erster Abruf.
 * Rahmen und Schrittleiste stellt die Route (bank_.verbinden.$anbieter.tsx), die Felder kommen aus dem Adapter.
 */

export type Pruefung = Awaited<ReturnType<typeof checkPspAccessFn>>;

/** Schrittleiste: erledigte Schritte und der aktuelle in Akzent, der aktuelle mit aria-current */
export function Schrittleiste({ schritte, aktuell }: { schritte: readonly string[]; aktuell: number }) {
  return (
    <ol className="einrichtung-schritte" aria-label="Schritte">
      {schritte.map((s, i) => (
        <li key={s} data-erledigt={i <= aktuell ? "" : undefined} aria-current={i === aktuell ? "step" : undefined}>
          {i + 1} · {SCHRITT_TITEL[s] ?? s}
        </li>
      ))}
    </ol>
  );
}

/** Karte eines Schritts mit „Schritt n von m“ über dem Titel */
export function SchrittKarte({
  nummer,
  von,
  titel,
  zusatz,
  children,
}: {
  nummer: number;
  von: number;
  titel: string;
  zusatz?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card einrichtung-schritt" aria-labelledby="schritt-titel">
      <div className="einrichtung-schritt-kopf">
        <div>
          <div className="small muted">
            Schritt {nummer} von {von}
          </div>
          <h2 id="schritt-titel" style={{ margin: 0 }}>
            {titel}
          </h2>
        </div>
        {zusatz}
      </div>
      {children}
    </section>
  );
}

/** Was die Prüfung erkannt hat: Kennung, Gültigkeit, Hinweise des Adapters und ob das Konto schon verbunden ist */
function PruefErgebnis({ anbieter, pruefung }: { anbieter: PspAnbieter; pruefung: Pruefung }) {
  const verbunden = pruefung.schonVerbunden;
  return (
    <div className="einrichtung-ergebnis" role="status" aria-label="Zugang geprüft">
      <div className="einrichtung-ergebnis-kopf">
        <strong>Zugang geprüft</strong>
        {verbunden ? (
          <Status tone="warn" emphasis="notice" inline>
            Schon verbunden
          </Status>
        ) : (
          <Status tone="ok" inline>
            OK
          </Status>
        )}
      </div>
      <p style={{ margin: 0 }}>
        {anbieter.name}-Konto <code>{pruefung.accountId}</code> ({anbieter.zugangName} …{pruefung.keyHint})
        {pruefung.gueltigBis ? `, Zugang gilt bis ${formatDate(pruefung.gueltigBis)}` : ""}.
      </p>
      {pruefung.hinweise.map((h) => (
        <p key={h} className="small muted" style={{ margin: 0 }}>
          {h}
        </p>
      ))}
      {verbunden && (
        <p style={{ margin: 0 }}>
          {verbunden.text}{" "}
          {verbunden.bankAccountId && (
            <Link to="/bank" search={{ konto: verbunden.bankAccountId }}>
              Zur Verbindung
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

/** Schritt „Zugang“: Felder des Adapters, „Zugang prüfen“ fragt den Anbieter ohne zu speichern, dann „Weiter“ */
export function ZugangSchritt({
  anbieter,
  von,
  config,
  setConfig,
  pruefung,
  onGeprueft,
  onWeiter,
}: {
  anbieter: PspAnbieter;
  von: number;
  config: Config;
  setConfig: (c: Config) => void;
  pruefung: Pruefung | null;
  onGeprueft: (p: Pruefung | null, eingabe: Record<string, string>) => void;
  onWeiter: () => void;
}) {
  const pruefen = useServerFn(checkPspAccessFn);
  const { busy, notice, setNotice, run } = useAction();
  const zugangFehler = useZugangFehler(anbieter, busy);
  const weiter = pruefung !== null && !pruefung.schonVerbunden;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const eingabe = geheimeEingabe(anbieter, event.currentTarget);
    void run(() => zugangFehler.abfangen(async () => onGeprueft(await pruefen({ data: { provider: anbieter.provider, eingabe, config } }), eingabe)));
  }

  return (
    <SchrittKarte nummer={1} von={von} titel="Zugang">
      <AnbieterHinweis anbieter={anbieter} />
      {/* Jede Eingabe macht die Prüfung ungültig; onInput, nicht onChange: Das change beim Verlassen des Felds nähme die
          Meldung erst beim Klick auf „Zugang prüfen“ weg, der Knopf rückte unter dem Zeiger weg, und der Klick ginge daneben */}
      <form
        ref={zugangFehler.form}
        className="stack"
        onSubmit={onSubmit}
        onInput={() => {
          if (pruefung) onGeprueft(null, {});
          setNotice(null);
          zugangFehler.zuruecksetzen();
        }}
        aria-label="Zugang"
        noValidate
      >
        <ZugangFelder anbieter={anbieter} gespeichert={false} config={config} setConfig={setConfig} fehler={zugangFehler.fehler} />
        {pruefung && <PruefErgebnis anbieter={anbieter} pruefung={pruefung} />}
        <NoticeBanner notice={notice} />
        <div className="actions">
          <Link to="/bank" className="btn">
            Abbrechen
          </Link>
          <button type="submit" className={weiter ? "btn" : "btn btn-primary"} disabled={busy}>
            {busy ? "Prüfe …" : "Zugang prüfen"}
          </button>
          {weiter && (
            <button type="button" className="btn btn-primary" onClick={onWeiter}>
              Weiter
            </button>
          )}
        </div>
      </form>
    </SchrittKarte>
  );
}

/** Schritt „Name und Zeitraum“: Name, Konto in Haben, erster Tag und Rhythmus; „Speichern und abrufen“ legt die Verbindung an */
export function EinstellungenSchritt({
  anbieter,
  daten,
  von,
  pruefung,
  speichern,
  onZurueck,
  onGespeichert,
}: {
  anbieter: PspAnbieter;
  daten: PspDaten;
  von: number;
  pruefung: Pruefung;
  speichern: (werte: Einstellungen) => Promise<string>;
  onZurueck: () => void;
  onGespeichert: (id: string, werte: Einstellungen) => void;
}) {
  const [werte, setWerte] = useState<Einstellungen>({ name: anbieter.name, bankAccountId: "", fetchFrom: daten.heute, rhythmus: "taeglich" });
  const { busy, notice, run } = useAction();
  const check = useSubmitCheck(einstellungFehler(werte, daten.heute));
  // An den Abruf gebunden: nur dieses Konto; sonst die freien Konten des Anbieters
  const belegt = new Set(daten.verbindungen.map((v) => v.bankAccountId));
  const konten = pruefung.gebunden ? [] : daten.konten.filter((k) => k.provider === anbieter.provider && !belegt.has(k.id));
  const gewaehlt = konten.find((k) => k.id === werte.bankAccountId) ?? null;
  const automatisch = pruefung.konto ? `Automatisch: ${pruefung.konto.name}` : "Automatisch: ein neues Konto mit dem Namen der Verbindung";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check.check()) return;
    void run(async () => onGespeichert(await speichern(werte), werte));
  }

  return (
    <SchrittKarte nummer={2} von={von} titel="Name und Zeitraum">
      <form ref={check.form} className="stack" onSubmit={onSubmit} aria-label="Name und Zeitraum" noValidate>
        <EinstellungFelder werte={werte} setWerte={setWerte} konten={konten} automatisch={automatisch} heute={daten.heute} fehler={check.error} />
        <p className="small" style={{ margin: 0 }}>
          {kontoText({ gewaehlt, automatisch: pruefung.konto, gebunden: pruefung.gebunden, name: werte.name })}
        </p>
        <NoticeBanner notice={notice} />
        <div className="actions">
          <button type="button" className="btn" onClick={onZurueck} disabled={busy}>
            Zurück
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Speichere …" : "Speichern und abrufen"}
          </button>
        </div>
      </form>
    </SchrittKarte>
  );
}

type Ergebnis = Awaited<ReturnType<typeof syncPspNow>>;

/**
 * Schritt „Erster Abruf“: läuft beim Öffnen an. Der Server meldet keinen Fortschritt, deshalb steht die Phase als Text da,
 * ohne Ladekreis und ohne Balken (DESIGN.md: keine Endlos-Animationen); das Ergebnis folgt im selben Schritt
 */
export function AbrufSchritt({ daten, von, verbindungId, werte }: { daten: PspDaten; von: number; verbindungId: string; werte: Einstellungen }) {
  const router = useRouter();
  const abrufen = useServerFn(syncPspNow);
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const gestartet = useRef(false);
  const verbindung = daten.verbindungen.find((v) => v.id === verbindungId);

  async function starten() {
    setErgebnis(null);
    setFehler(null);
    try {
      const r = await abrufen({ data: { id: verbindungId } });
      // Erst neu laden: Konto und Konflikte der Verbindung stehen dann in den Daten
      await router.invalidate({ sync: true });
      setErgebnis(r);
    } catch (error) {
      setFehler(errorMessage(error));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: nur einmal beim Öffnen des Schritts
  useEffect(() => {
    if (gestartet.current) return;
    gestartet.current = true;
    void starten();
  }, []);

  const laeuft = ergebnis === null && fehler === null;
  const fehlgeschlagen = fehler ?? ergebnis?.error ?? null;
  const zusatz = laeuft ? null : fehlgeschlagen ? (
    <Status tone="danger" emphasis="urgent" inline>
      Fehlgeschlagen
    </Status>
  ) : (
    <Status tone="ok" inline>
      Fertig
    </Status>
  );

  return (
    <SchrittKarte nummer={3} von={von} titel="Erster Abruf" zusatz={zusatz}>
      <p className="small muted" style={{ margin: 0 }}>
        „{werte.name}“ ab {formatDate(werte.fetchFrom)}, {RHYTHMUS_LABELS[werte.rhythmus].toLowerCase()}
      </p>
      <div role="status" className="stack" style={{ gap: 8 }}>
        {laeuft && <p style={{ margin: 0 }}>Hole Umsätze ab {formatDate(werte.fetchFrom)} …</p>}
        {ergebnis && !ergebnis.error && <p style={{ margin: 0 }}>{abrufText(ergebnis)}</p>}
        {fehlgeschlagen && <div className="banner banner-danger">{fehlgeschlagen}</div>}
        {ergebnis && ergebnis.messages.length > 0 && (
          <ul className="upload-messages">
            {ergebnis.messages.map((m) => (
              <li key={m} className="banner banner-info">
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!laeuft && (
        <div className="actions">
          {verbindung && verbindung.konflikte.length > 0 && (
            <KonfliktKlaeren konflikte={verbindung.konflikte} disabled={false} quelle={quelleZuAnbieter(verbindung.provider)} />
          )}
          {fehlgeschlagen && (
            <button type="button" className="btn" onClick={() => void starten()}>
              Erneut abrufen
            </button>
          )}
          <Link to="/bank" search={verbindung?.bankAccountId ? { konto: verbindung.bankAccountId } : {}} className="btn btn-primary">
            Zum Konto
          </Link>
        </div>
      )}
    </SchrittKarte>
  );
}

/** Speichert die neue Verbindung aus Prüfung und Einstellungen; gibt ihre Kennung zurück */
export function useSpeichern(anbieter: PspAnbieter, eingabe: Record<string, string>, config: Config) {
  const save = useServerFn(savePspConnectionFn);
  return async (werte: Einstellungen) => {
    const { id } = await save({ data: { provider: anbieter.provider, ...werte, bankAccountId: werte.bankAccountId || null, eingabe, config } });
    return id;
  };
}
