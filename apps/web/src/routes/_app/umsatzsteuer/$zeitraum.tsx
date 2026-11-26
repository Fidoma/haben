import { computeUstva, formatDecimal, formatEuro, parseEuro, parsePeriodKey, periodKey, periodLabel } from "@haben/core";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { FristenAbschnitt } from "../../../components/umsatzsteuer/FristenAbschnitt.tsx";
import { VatStatus } from "../../../components/umsatzsteuer/VatStatus.tsx";
import { JournalVergleich } from "../../../components/umsatzsteuer/JournalVergleich.tsx";
import { formatLongDate } from "../../../lib/format.ts";
import { getVatPeriod } from "../../../server/functions/vat.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { usePruefungBeimSpeichern } from "./-zeitraum-pruefung.ts";
import { Field } from "../../../components/Field.tsx";
import type { PageData } from "./-zeitraum-quellen.tsx";
import { type FieldKey, KennzahlenTabelle } from "./-zeitraum-kennzahlen.tsx";
import { AbgabeSpalte, anmeldbar, useVoranmeldungAktionen, ZeitraumAblauf } from "./-zeitraum-abgabe.tsx";
import { ZeitraumHinweise } from "./-zeitraum-hinweise.tsx";
import { useFokusUeberWechsel } from "../../../lib/use-fokus-ueber-wechsel.ts";
import { useFokusNachSperre } from "../../../lib/use-fokus-nach-sperre.ts";

export const Route = createFileRoute("/_app/umsatzsteuer/$zeitraum")({
  loader: ({ params }) => {
    const period = parsePeriodKey(params.zeitraum);
    if (!period) throw notFound();
    return getVatPeriod({ data: period });
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `Umsatzsteuer ${loaderData ? periodLabel(loaderData.period) : ""} · Haben` }],
  }),
  component: VatPeriodPage,
});

const FIELDS: FieldKey[] = [
  "kz81",
  "kz86",
  "kz21",
  "kz39",
  "kz41",
  "kz43",
  "kz45",
  "kz46",
  "kz47",
  "kz48",
  "kz50",
  "kz61",
  "kz62",
  "kz66",
  "kz67",
  "kz84",
  "kz85",
  "kz89",
  "kz93",
];

type Figures = Pick<Record<FieldKey, number>, "kz81" | "kz86" | "kz66"> & Partial<Record<FieldKey, number>>;

/**
 * Kennzahlen für den Vergleich mit einer gesendeten Anmeldung: ohne Kz 50 wie der Abgleich in gesendet-pruefen.ts (#1267).
 * Sie ändert keine Steuer, und vor #1267 gesendete Anmeldungen haben sie nicht.
 */
const GESENDET_VERGLEICHEN = FIELDS.filter((field) => field !== "kz50");

/** Gleiche Kennzahlen? Fehlende Kz 21/45/48 (ältere Anmeldungen) zählen als 0 */
function sameFigures(a: Figures, b: Figures, fields: readonly FieldKey[] = FIELDS): boolean {
  return fields.every((field) => (a[field] ?? 0) === (b[field] ?? 0));
}

/**
 * Weicht die heutige Rechnung von der gesendeten Anmeldung ab? Bei einer vor #1811 gerechneten Anmeldung (ohne
 * `smallBusinessRule`) gilt Kz 48 auch ohne die Umsätze als Kleinunternehmer als gleich, so hat Haben sie vor #1268
 * gemeldet (wie gesendet-pruefen.ts)
 */
function seitGesendetGeaendert(gesendet: Figures, computed: Figures, data: PageData): boolean {
  if (sameFigures(gesendet, computed, GESENDET_VERGLEICHEN)) return false;
  if (data.current?.smallBusinessRule) return true;
  const vor1268 = computeUstva({ ...data.figures, kz48: data.figures.kz48 - data.figures.kz48Kleinunternehmer, kz39: data.kz39 });
  return !sameFigures(gesendet, vor1268, GESENDET_VERGLEICHEN);
}

/** „Kz 81 1.000,00 €, Kz 86 0,00 € und Kz 66 12,00 €“; Kz 21/45/48 nur, wenn belegt */
function describe(figures: Record<FieldKey, number>): string {
  const parts = FIELDS.filter((f) => ["kz81", "kz86", "kz66"].includes(f) || figures[f] !== 0).map((f) => `Kz ${f.slice(2)} ${formatEuro(figures[f])}`);
  return `${parts.slice(0, -1).join(", ")} und ${parts.at(-1)}`;
}

function VatPeriodPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  // Die Auswahl behält beim Wechsel den Fokus, obwohl die Seite neu entsteht
  const auswahl = useFokusUeberWechsel<HTMLSelectElement>("umsatzsteuer-zeitraum");
  const key = periodKey(data.period);
  // Meldungen überleben das Neuaufsetzen des Formulars nach dem Speichern; die Seite entsteht je Zeitraum neu
  const [notice, setNotice] = useState<Notice>(null);
  // Passt der Zeitraum nicht zur Voranmeldung, lässt es sich dort beheben: Bis man selbst auf- oder zuklappt, steht der
  // Bereich dann offen. Wie die Meldung gilt die Wahl nur für diesen Zeitraum
  const [fristen, setFristen] = useState<boolean | null>(null);
  const fristenOffen = fristen ?? Boolean(data.periodProblem);
  // „Schon anders abgegeben?“: Ohne ERiC oder ohne eigene Hersteller-ID (`herstellerIdConfigured` false) ist Mein ELSTER der Hauptweg und der Vermerk der nächste Schritt, dann steht er offen.
  // Wie die Fristen hier, weil der Editor beim Speichern neu entsteht und die Wahl sonst verwürfe
  const [vermerk, setVermerk] = useState<boolean | null>(null);
  // Zeiträume nach dem eingestellten Voranmeldungszeitraum, dazu der angezeigte, falls er nicht dazugehört
  const options = [...data.periods];
  if (!options.some((option) => periodKey(option) === key)) options.push(data.period);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Umsatzsteuer › Voranmeldung</div>
          <div className="title-with-status">
            <h1>{periodLabel(data.period)}</h1>
            <VatStatus current={data.current} filedOn={data.filings.find((f) => f.vatReturnId === data.current?.id)?.filedOn ?? null} dueDate={data.dueDate} />
          </div>
        </div>
        <Field label="Zeitraum">
          {(control) => (
            <select
              {...control}
              ref={auswahl.ref}
              value={key}
              onChange={(event) => {
                auswahl.merken();
                void navigate({ to: "/umsatzsteuer/$zeitraum", params: { zeitraum: event.target.value } });
              }}
            >
              {options.map((option) => (
                <option key={periodKey(option)} value={periodKey(option)}>
                  {periodLabel(option)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <ZeitraumHinweise data={data} />

      {/* key: Formular bei Wechsel der Anmeldung (Berichtigung) und nach dem Speichern neu aufsetzen, auf die Millisekunde,
          damit auch zwei Speichervorgänge in derselben Sekunde es neu aufsetzen (#1804) */}
      <VatReturnEditor
        key={`${data.current?.id ?? "neu"}-${data.current?.updatedAt.toISOString() ?? ""}`}
        data={data}
        notice={notice}
        setNotice={setNotice}
        vermerk={{ offen: vermerk ?? !data.herstellerIdConfigured, onOffen: setVermerk }}
      />
      {/* Außerhalb des Editors: der baut sich nach jedem Speichern der Anmeldung neu auf und verwürfe sonst die Auswahl hier */}
      <FristenAbschnitt frequency={data.frequency} dauerfrist={data.dauerfrist} setup={data} offen={fristenOffen} onOffen={setFristen} />
    </>
  );
}

function VatReturnEditor({
  data,
  notice,
  setNotice,
  vermerk,
}: {
  data: PageData;
  notice: Notice;
  setNotice: (notice: Notice) => void;
  vermerk: { offen: boolean; onOffen: (offen: boolean) => void };
}) {
  const current = data.current;
  const locked = current?.status === "sent";
  // Kz 39: die Sondervorauszahlung, abgezogen in der letzten Voranmeldung des Jahres
  const computed = computeUstva({ ...data.figures, kz39: data.kz39 });
  const [mode, setMode] = useState<"berechnet" | "manuell">(current?.source === "manuell" ? "manuell" : "berechnet");
  const [values, setValues] = useState<Record<FieldKey, string>>(
    () => Object.fromEntries(FIELDS.map((f) => [f, formatDecimal(current?.source === "manuell" ? current[f] : computed[f])])) as Record<FieldKey, string>,
  );
  const [reason, setReason] = useState(current?.overrideReason ?? "");
  const [openSources, setOpenSources] = useState<string | null>(null);
  const toggleSources = (kz: string) => setOpenSources((open) => (open === kz ? null : kz));
  const [dirty, setDirty] = useState(!current);

  const parsed = Object.fromEntries(FIELDS.map((f) => [f, parseEuro(values[f])])) as Record<FieldKey, number | null>;
  const manualFigures = Object.fromEntries(FIELDS.map((f) => [f, parsed[f] ?? 0])) as Record<FieldKey, number>;
  const allowed = anmeldbar(data);
  const shown = locked ? computeUstva(current!) : mode === "manuell" ? computeUstva(manualFigures) : computed;
  // Gespeicherter berechneter Entwurf, dessen Werte sich inzwischen geändert haben
  const stale = !locked && current?.source === "berechnet" && !sameFigures(current, computed);

  // Gesendete Anmeldung, deren Buchungen sich danach geändert haben (z. B. Zuordnung aufgehoben)
  const sentBasis = locked ? (current!.source === "berechnet" ? current! : current!.computed) : null;
  const drift = sentBasis !== null && sentBasis !== undefined && seitGesendetGeaendert(sentBasis, computed, data);

  function update(field: FieldKey, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  }

  function switchMode(next: "berechnet" | "manuell") {
    setMode(next);
    setDirty(true);
  }

  const { busy, onSave, onSubmit, onCorrect } = useVoranmeldungAktionen(data, { mode, manualFigures, reason, dirty, setDirty }, setNotice);
  // Prüfung beim Speichern statt gesperrtem Knopf (#1270)
  const { pruefung, check, speichern } = usePruefungBeimSpeichern(parsed, reason, mode, onSave);
  useFokusNachSperre(busy);

  const editable = !locked && mode === "manuell";

  return (
    <>
      <ZeitraumAblauf data={data} shown={shown} geaendert={dirty || stale} werteGueltig={mode !== "manuell" || !Object.values(parsed).includes(null)} />
      <div className="grid-main">
        <form ref={pruefung.form} noValidate className="card" onSubmit={speichern} aria-labelledby="kz-heading">
          <h2 id="kz-heading">Kennzahlen</h2>
          {data.kleinunternehmer && (
            <div className="banner banner-info" role="status">
              <Icon name="info" />
              <span>
                Du bist als Kleinunternehmer (§ 19 UStG) eingetragen und gibst in der Regel keine Voranmeldung ab. Nötig ist sie nur, wenn du selbst Steuer
                schuldest, etwa für Leistungen ausländischer Unternehmer an dich (Reverse Charge).
              </span>
            </div>
          )}
          {drift && (
            <div className="banner" role="alert">
              Seit der Übermittlung haben sich die Buchungen dieses Monats geändert. Aus den Buchungen ergäben sich jetzt {describe(computed)}. Prüfe die
              Änderung und lege bei Bedarf eine berichtigte Anmeldung an.
            </div>
          )}
          <JournalVergleich year={data.period.year} uebernommen={data.uebernommen} current={current} returns={data.returns} journal={computed} />
          {stale && mode === "berechnet" && (
            <div className="banner banner-info" role="status">
              Die Buchungen haben sich seit dem Speichern geändert; angezeigt sind die aktuellen Werte. Beim Senden werden sie übernommen.
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Kz = Kennzahl, die Nummer des Felds im ELSTER-Formular.
          </p>
          {/* Gesperrt, solange gespeichert, gesendet oder berichtigt wird: Danach baut die Seite das Formular mit dem neuen
              `updatedAt` im `key` neu auf, und was man bis dahin tippt, ginge verloren (#1824). Abstand wie in der Karte */}
          <fieldset className="stack fieldset-plain" style={{ gap: 12 }} disabled={busy}>
            <KennzahlenTabelle
              data={data}
              shown={shown}
              computed={computed}
              eingabe={{ locked, editable, values, fehler: (f) => pruefung.error(f), update, openSources, toggleSources }}
            />
            {!locked && (
              <p className="small" style={{ margin: 0 }}>
                <button type="button" className="link-button" onClick={() => switchMode(editable ? "berechnet" : "manuell")}>
                  {editable ? "Zurück zu den berechneten Werten" : "Werte von Hand ändern (nur in Ausnahmen)"}
                </button>
              </p>
            )}
            {editable && (
              <Field
                label="Begründung der Abweichung (Pflicht)"
                hint={<>Mindestens 10 Zeichen. Berechnet wären {describe(computed)}.</>}
                error={pruefung.error("reason")}
              >
                {(control) => (
                  <textarea
                    {...control}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setDirty(true);
                    }}
                    maxLength={1000}
                    placeholder="z. B. Zahlung vom 30.09. erst im Oktober zugeordnet"
                  />
                )}
              </Field>
            )}
          </fieldset>
          {locked && current?.source === "manuell" && current.overrideReason && (
            <p className="small muted" style={{ margin: 0 }}>
              Manuell überschrieben: {current.overrideReason}
            </p>
          )}
          <p id="kz-hint" className="small muted" style={{ margin: 0 }}>
            Bemessungsgrundlagen meldet ELSTER in vollen Euro; Cent werden abgeschnitten.{" "}
            {data.figures.versteuerung === "ist"
              ? "Versteuerung nach vereinnahmten Entgelten (Ist): Umsatzsteuer nach Zahlungseingang, Vorsteuer nach Belegdatum."
              : "Versteuerung nach vereinbarten Entgelten (Soll): Umsatzsteuer nach Rechnungsdatum, Vorsteuer nach Belegdatum."}{" "}
            Fällig am {formatLongDate(data.dueDate)}.
          </p>
          {!locked && (
            <div className="actions">
              <button type="submit" className="btn" disabled={busy || !allowed || (!dirty && Boolean(current) && !stale)}>
                Entwurf speichern
              </button>
              {current && !dirty && !stale && data.companyIssues.length === 0 && (
                <a className="btn" href={`/api/ustva/${current.id}`} download>
                  XML für Mein ELSTER
                </a>
              )}
            </div>
          )}
          {locked && (
            <div className="actions">
              <button type="button" className="btn" onClick={onCorrect} disabled={busy}>
                Berichtigte Anmeldung anlegen
              </button>
            </div>
          )}
          <NoticeBanner notice={notice} />
        </form>

        <AbgabeSpalte
          data={data}
          locked={locked}
          check={check}
          busy={busy}
          shown={shown}
          dirty={dirty}
          stale={stale}
          onSubmit={onSubmit}
          setNotice={setNotice}
          vermerk={vermerk}
        />
      </div>
    </>
  );
}
