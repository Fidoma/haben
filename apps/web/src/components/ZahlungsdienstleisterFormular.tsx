import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage, fehlerFelder } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { datumFehler, useSubmitCheck } from "../lib/use-submit-check.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { type getPspSettings, savePspConnectionFn } from "../server/functions/zahlungsdienstleister.ts";

export type PspDaten = Awaited<ReturnType<typeof getPspSettings>>;
export type PspVerbindung = PspDaten["verbindungen"][number];
export type PspAnbieter = PspDaten["anbieter"][number];
export type Rhythmus = PspVerbindung["rhythmus"];
export type Config = Record<string, string | number | boolean | null>;

/** Die Werte der config, mit denen eine neue Verbindung beginnt */
export const standardConfig = (anbieter: PspAnbieter | undefined): Config =>
  Object.fromEntries((anbieter?.felder ?? []).filter((f) => f.config && f.standard !== undefined).map((f) => [f.name, f.standard ?? null]));

/** Die geheimen Felder des Adapters aus dem Formular; leer heißt beim Bearbeiten „behalten“ */
export const geheimeEingabe = (anbieter: PspAnbieter | undefined, form: HTMLFormElement): Record<string, string> => {
  const formData = new FormData(form);
  return Object.fromEntries((anbieter?.felder ?? []).filter((f) => f.art === "geheim").map((f) => [f.name, String(formData.get(f.name) ?? "")]));
};

/** Auswahl für den automatischen Abruf; die Werte prüft der Server (RHYTHMEN in zahlungsdienstleister/regeln.ts) */
export const RHYTHMUS_LABELS: Record<Rhythmus, string> = {
  stuendlich: "Stündlich",
  taeglich: "Täglich",
  woechentlich: "Wöchentlich",
};

/** Was Formular und Einrichtung für Name, Konto, Start und Rhythmus halten */
export type Einstellungen = { name: string; bankAccountId: string; fetchFrom: string; rhythmus: Rhythmus };

/** Fehler der Einstellungen für useSubmitCheck */
export const einstellungFehler = (e: Einstellungen, heute: string) => ({
  name: e.name.trim() ? null : "Gib der Verbindung einen Namen.",
  fetchFrom: datumFehler(e.fetchFrom, "2000-01-01", heute),
});

/**
 * Name, Konto in Haben, erster Tag und Rhythmus einer Verbindung, im Formular und in der Einrichtung (#1951). `konten` sind
 * die wählbaren Konten des Anbieters; `automatisch` sagt, was „Automatisch“ tut.
 */
export function EinstellungFelder({
  werte,
  setWerte,
  konten,
  automatisch,
  heute,
  fehler,
}: {
  werte: Einstellungen;
  setWerte: (werte: Einstellungen) => void;
  konten: { id: string; name: string }[];
  automatisch: string;
  heute: string;
  fehler: (feld: "name" | "fetchFrom") => string | undefined;
}) {
  const setze = (teil: Partial<Einstellungen>) => setWerte({ ...werte, ...teil });
  return (
    <>
      <Field label="Name" hint="Frei wählbar, etwa „Shop DE“; so heißt die Verbindung in Haben" error={fehler("name")}>
        {(control) => <input {...control} name="name" required value={werte.name} onChange={(event) => setze({ name: event.target.value })} />}
      </Field>
      <Field label="Konto in Haben" hint="Konto der Art Zahlungsdienstleister, in das der Abruf schreibt; ein neues bekommt den Namen der Verbindung">
        {(control) => (
          <select {...control} name="bankAccountId" value={werte.bankAccountId} onChange={(event) => setze({ bankAccountId: event.target.value })}>
            <option value="">{automatisch}</option>
            {konten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Abruf ab" hint="Erster Tag, den Haben holt; davor gilt der Export des Anbieters" error={fehler("fetchFrom")}>
        {(control) => (
          <input
            {...control}
            name="fetchFrom"
            type="date"
            required
            max={heute}
            value={werte.fetchFrom}
            onChange={(event) => setze({ fetchFrom: event.target.value })}
          />
        )}
      </Field>
      <Field label="Automatischer Abruf">
        {(control) => (
          <select {...control} name="rhythmus" value={werte.rhythmus} onChange={(event) => setze({ rhythmus: event.target.value as Rhythmus })}>
            {Object.entries(RHYTHMUS_LABELS).map(([schluessel, label]) => (
              <option key={schluessel} value={schluessel}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

/**
 * Bearbeiten einer Verbindung zu einem Zahlungsdienstleister (#1729) an ihrer Zeile auf der Bankseite. Die Felder des
 * Zugangs kommen aus dem Adapter; geheime Felder bleiben leer und behalten den gespeicherten Wert, wenn sie leer bleiben.
 * Neue Verbindungen entstehen in der geführten Einrichtung (#1951).
 */
export function VerbindungFormular({
  daten,
  verbindung,
  onFertig,
}: {
  daten: PspDaten;
  verbindung: PspVerbindung;
  /** Geschlossen: nach dem Speichern mit true, nach „Abbrechen“ ohne */
  onFertig: (gespeichert?: boolean) => void;
}) {
  const router = useRouter();
  const save = useServerFn(savePspConnectionFn);
  const anbieter = daten.anbieter.find((a) => a.provider === verbindung.provider);
  const [werte, setWerte] = useState<Einstellungen>({
    name: verbindung.name,
    bankAccountId: verbindung.bankAccountId ?? "",
    fetchFrom: verbindung.fetchFrom,
    rhythmus: verbindung.rhythmus,
  });
  const [config, setConfig] = useState<Config>(verbindung.config);
  const { busy, notice, run } = useAction();
  const zugangFehler = useZugangFehler(anbieter, busy);
  const belegt = new Set(daten.verbindungen.filter((v) => v.id !== verbindung.id).map((v) => v.bankAccountId));
  const konten = daten.konten.filter((k) => k.provider === verbindung.provider && !belegt.has(k.id));
  const pruefung = useSubmitCheck(einstellungFehler(werte, daten.heute));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pruefung.check()) return;
    const form = event.currentTarget;
    const eingabe = geheimeEingabe(anbieter, form);
    void run(() =>
      zugangFehler.abfangen(async () => {
        await save({
          data: { id: verbindung.id, provider: verbindung.provider, ...werte, bankAccountId: werte.bankAccountId || null, eingabe, config },
        });
        form.reset();
        await router.invalidate();
        // Die Meldung zeigt, wer das Formular geöffnet hat: es schließt sich gleich
        onFertig(true);
      }),
    );
  }

  return (
    <form
      ref={(element) => {
        pruefung.form(element);
        zugangFehler.form.current = element;
      }}
      className="stack"
      onSubmit={onSubmit}
      onInput={zugangFehler.zuruecksetzen}
      noValidate
      aria-label={`Verbindung ${verbindung.name} bearbeiten`}
    >
      <EinstellungFelder
        werte={werte}
        setWerte={setWerte}
        konten={konten}
        automatisch="Automatisch: ein freies Konto des Anbieters, sonst ein neues"
        heute={daten.heute}
        fehler={pruefung.error}
      />
      {anbieter && <ZugangFelder anbieter={anbieter} gespeichert config={config} setConfig={setConfig} fehler={zugangFehler.fehler} />}
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
export function AnbieterHinweis({ anbieter }: { anbieter: PspAnbieter }) {
  return (
    <p className="small muted" style={{ margin: 0 }}>
      {anbieter.beschreibung}{" "}
      <a href={anbieter.link.url} target="_blank" rel="noreferrer">
        {anbieter.link.text}
      </a>
    </p>
  );
}

/**
 * Fachfehler des Servers an einem Feld des Adapters (`felder` am UserError); `ansagen`, wenn der Fokus schon im Feld stand
 * (mit Enter abgeschickt): Dann liest ihn nur `role="alert"` vor (DESIGN.md, Felder: `announceError`)
 */
export type ZugangFehler = { feld: string; text: string; ansagen: boolean } | null;

/**
 * Fehler des Servers am Feld des Adapters statt als Meldung unter dem Formular (DESIGN.md, Felder): `abfangen` nimmt
 * einen Fehler, der ein Feld des Adapters nennt, und gibt jeden anderen an `useAction` weiter. Ist die Aktion durch, bekommt
 * das Feld den Fokus; gesperrt nähme es ihn nicht an. `form` an das Formular hängen, `zuruecksetzen` bei jeder Eingabe.
 */
export function useZugangFehler(anbieter: PspAnbieter | undefined, busy: boolean) {
  const form = useRef<HTMLFormElement | null>(null);
  const [fehler, setFehler] = useState<ZugangFehler>(null);
  const [fokus, setFokus] = useState(false);
  useEffect(() => {
    if (busy || !fokus || !fehler) return;
    (form.current?.elements.namedItem(fehler.feld) as HTMLElement | null)?.focus();
    setFokus(false);
  }, [busy, fokus, fehler]);
  async function abfangen(work: () => Promise<unknown>) {
    setFehler(null);
    try {
      await work();
    } catch (error) {
      const feld = fehlerFelder(error).find((name) => anbieter?.felder.some((f) => f.name === name));
      if (!feld) throw error;
      const ansagen = form.current?.elements.namedItem(feld) === document.activeElement;
      setFehler({ feld, text: errorMessage(error), ansagen });
      setFokus(true);
    }
  }
  return { form, fehler, abfangen, zuruecksetzen: () => setFehler(null) };
}

/** Die Felder des Zugangs und der config, wie der Adapter sie beschreibt; `fehler` steht an seinem Feld */
export function ZugangFelder({
  anbieter,
  gespeichert,
  config,
  setConfig,
  fehler = null,
}: {
  anbieter: PspAnbieter;
  gespeichert: boolean;
  config: Config;
  setConfig: (config: Config) => void;
  fehler?: ZugangFehler;
}) {
  const fehlerAm = (name: string) => (fehler?.feld === name ? fehler.text : undefined);
  const ansagen = (name: string) => fehler?.feld === name && fehler.ansagen;
  return (
    <>
      {anbieter.felder.map((feld) => {
        if (feld.art === "geheim") {
          return (
            <Field
              key={feld.name}
              label={gespeichert ? `${feld.label} (leer lassen zum Behalten)` : feld.label}
              hint={feld.hint}
              error={fehlerAm(feld.name)}
              announceError={ansagen(feld.name)}
            >
              {(control) => <input {...control} name={feld.name} type="password" autoComplete="off" />}
            </Field>
          );
        }
        if (feld.art === "auswahl") {
          const optionen = feld.optionen ?? [];
          const aktuell = String(config[feld.name] ?? optionen[0]?.wert ?? "");
          return (
            <Field key={feld.name} label={feld.label} hint={feld.hint} error={fehlerAm(feld.name)} announceError={ansagen(feld.name)}>
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
          <Field key={feld.name} label={feld.label} hint={feld.hint} error={fehlerAm(feld.name)} announceError={ansagen(feld.name)}>
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
