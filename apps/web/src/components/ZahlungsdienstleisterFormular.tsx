import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { datumFehler, useSubmitCheck } from "../lib/use-submit-check.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { type getPspSettings, savePspConnectionFn } from "../server/functions/zahlungsdienstleister.ts";

export type PspDaten = Awaited<ReturnType<typeof getPspSettings>>;
export type PspVerbindung = PspDaten["verbindungen"][number];
type Anbieter = PspDaten["anbieter"][number];
type Rhythmus = PspVerbindung["rhythmus"];
type Config = Record<string, string | number | boolean | null>;

/** Die Werte der config, mit denen eine neue Verbindung beginnt */
const standardConfig = (anbieter: Anbieter | undefined): Config =>
  Object.fromEntries((anbieter?.felder ?? []).filter((f) => f.config && f.standard !== undefined).map((f) => [f.name, f.standard ?? null]));

/** Auswahl für den automatischen Abruf; die Werte prüft der Server (RHYTHMEN in zahlungsdienstleister/regeln.ts) */
const RHYTHMUS_LABELS: Record<Rhythmus, string> = {
  stuendlich: "Stündlich",
  taeglich: "Täglich",
  woechentlich: "Wöchentlich",
};

/**
 * Formular einer Verbindung zu einem Zahlungsdienstleister (#1729): neu oder bearbeiten. Die Felder des Zugangs kommen aus dem
 * Adapter des Anbieters; geheime Felder bleiben leer und behalten beim Bearbeiten den gespeicherten Wert, wenn sie leer bleiben.
 */
export function VerbindungFormular({
  daten,
  verbindung,
  onFertig,
}: {
  daten: PspDaten;
  /** fehlt: neue Verbindung */
  verbindung?: PspVerbindung;
  /** Geschlossen: nach dem Speichern mit true, nach „Abbrechen“ ohne */
  onFertig: (gespeichert?: boolean) => void;
}) {
  const router = useRouter();
  const save = useServerFn(savePspConnectionFn);
  const [provider, setProvider] = useState(verbindung?.provider ?? daten.anbieter[0]?.provider ?? "");
  const anbieter = daten.anbieter.find((a) => a.provider === provider);
  const [name, setName] = useState(verbindung?.name ?? anbieter?.name ?? "");
  const [bankAccountId, setBankAccountId] = useState(verbindung?.bankAccountId ?? "");
  const [config, setConfig] = useState<Config>(verbindung?.config ?? standardConfig(anbieter));
  const [fetchFrom, setFetchFrom] = useState(verbindung?.fetchFrom ?? daten.heute);
  const [rhythmus, setRhythmus] = useState<Rhythmus>(verbindung?.rhythmus ?? "taeglich");
  const { busy, notice, run } = useAction();
  const neu = !verbindung;
  const belegt = new Set(daten.verbindungen.filter((v) => v.id !== verbindung?.id).map((v) => v.bankAccountId));
  const konten = daten.konten.filter((k) => k.provider === provider && !belegt.has(k.id));
  const pruefung = useSubmitCheck({
    name: name.trim() ? null : "Gib der Verbindung einen Namen.",
    fetchFrom: datumFehler(fetchFrom, "2000-01-01", daten.heute),
  });

  function anbieterWechseln(wert: string) {
    const bisher = daten.anbieter.find((a) => a.provider === provider);
    const naechster = daten.anbieter.find((a) => a.provider === wert);
    // Der vorgeschlagene Name folgt dem Anbieter, solange niemand ihn geändert hat
    if (!name || name === bisher?.name) setName(naechster?.name ?? "");
    setProvider(wert);
    setConfig(standardConfig(naechster));
    setBankAccountId("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pruefung.check()) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const eingabe = Object.fromEntries((anbieter?.felder ?? []).filter((f) => f.art === "geheim").map((f) => [f.name, String(formData.get(f.name) ?? "")]));
    void run(async () => {
      await save({ data: { id: verbindung?.id, provider, name, bankAccountId: bankAccountId || null, eingabe, config, fetchFrom, rhythmus } });
      form.reset();
      await router.invalidate();
      // Die Meldung zeigt, wer das Formular geöffnet hat: es schließt sich gleich
      onFertig(true);
    });
  }

  return (
    <form
      ref={pruefung.form}
      className="stack"
      onSubmit={onSubmit}
      noValidate
      aria-label={neu ? "Neue Verbindung" : `Verbindung ${verbindung.name} bearbeiten`}
    >
      {neu && (
        <Field label="Anbieter">
          {(control) => (
            <select {...control} name="provider" value={provider} onChange={(event) => anbieterWechseln(event.target.value)}>
              {daten.anbieter.map((a) => (
                <option key={a.provider} value={a.provider}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {neu && anbieter && <AnbieterHinweis anbieter={anbieter} />}
      <Field label="Name" hint="Frei wählbar, etwa „Shop DE“; so heißt die Verbindung in Haben" error={pruefung.error("name")}>
        {(control) => <input {...control} name="name" required value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
      {anbieter && <ZugangFelder anbieter={anbieter} gespeichert={!neu} config={config} setConfig={setConfig} />}
      <Field label="Konto in Haben" hint="Konto der Art Zahlungsdienstleister, in das der Abruf schreibt; ein neues bekommt den Namen der Verbindung">
        {(control) => (
          <select {...control} name="bankAccountId" value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
            <option value="">Automatisch: ein freies Konto des Anbieters, sonst ein neues</option>
            {konten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Abruf ab" hint="Erster Tag, den Haben holt; davor gilt der Export des Anbieters" error={pruefung.error("fetchFrom")}>
        {(control) => (
          <input
            {...control}
            name="fetchFrom"
            type="date"
            required
            max={daten.heute}
            value={fetchFrom}
            onChange={(event) => setFetchFrom(event.target.value)}
          />
        )}
      </Field>
      <Field label="Automatischer Abruf">
        {(control) => (
          <select {...control} name="rhythmus" value={rhythmus} onChange={(event) => setRhythmus(event.target.value as Rhythmus)}>
            {Object.entries(RHYTHMUS_LABELS).map(([schluessel, label]) => (
              <option key={schluessel} value={schluessel}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => onFertig()}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Speichere …" : "Speichern"}
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

/** Was der Anbieter liefert und woher der Zugang kommt */
export function AnbieterHinweis({ anbieter }: { anbieter: Anbieter }) {
  return (
    <p className="small muted" style={{ margin: 0 }}>
      {anbieter.beschreibung}{" "}
      <a href={anbieter.link.url} target="_blank" rel="noreferrer">
        {anbieter.link.text}
      </a>
    </p>
  );
}

/** Die Felder des Zugangs und der config, wie der Adapter sie beschreibt */
function ZugangFelder({
  anbieter,
  gespeichert,
  config,
  setConfig,
}: {
  anbieter: Anbieter;
  gespeichert: boolean;
  config: Config;
  setConfig: (config: Config) => void;
}) {
  return (
    <>
      {anbieter.felder.map((feld) => {
        if (feld.art === "geheim") {
          return (
            <Field key={feld.name} label={gespeichert ? `${feld.label} (leer lassen zum Behalten)` : feld.label} hint={feld.hint}>
              {(control) => <input {...control} name={feld.name} type="password" autoComplete="off" />}
            </Field>
          );
        }
        if (feld.art === "auswahl") {
          const optionen = feld.optionen ?? [];
          const aktuell = String(config[feld.name] ?? optionen[0]?.wert ?? "");
          return (
            <Field key={feld.name} label={feld.label} hint={feld.hint}>
              {(control) => (
                <select
                  {...control}
                  name={feld.name}
                  value={aktuell}
                  onChange={(event) => setConfig({ ...config, [feld.name]: optionen.find((o) => String(o.wert) === event.target.value)?.wert ?? null })}
                >
                  {optionen.map((o) => (
                    <option key={String(o.wert)} value={String(o.wert)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          );
        }
        return (
          <Field key={feld.name} label={feld.label} hint={feld.hint}>
            {(control) => (
              <input
                {...control}
                name={feld.name}
                type="text"
                value={String(config[feld.name] ?? "")}
                onChange={(event) => setConfig({ ...config, [feld.name]: event.target.value })}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}
