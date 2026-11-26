import {
  formatEuro,
  SACHENTNAHME_KONTEN,
  freieBuchungPosting,
  type FreierSteuerschluessel,
  isKapitalgesellschaft,
  MANUAL_MAX_LINES,
  manualFindingTexts,
  parseEuro,
  type ManualKind,
  type ManualLine,
} from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { DatevEroeffnung } from "../../../components/DatevEroeffnung.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { useSubmitCheck } from "../../../lib/use-submit-check.ts";
import { createManualEntryFn, getManualEntryForm } from "../../../server/functions/journal.ts";
import styles from "../../../styles/auswertungen.css?url";
import { Field } from "../../../components/Field.tsx";
import { buchungsdatumFehler } from "./-buchungsdatum.ts";
import { BuchungsZeile, emptyRow, type Row, SCHLUESSEL_NAME } from "./-buchungs-zeile.tsx";
import { buchungsFehler, buchungsMeldungen, zellenSchluessel } from "./-buchungs-pruefung.ts";

export const Route = createFileRoute("/_app/buchungen/neu")({
  loader: () => getManualEntryForm(),
  head: () => ({ meta: [{ title: "Buchung erfassen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: ManualEntryPage,
});

/** Betrag aus dem Feld; leer = 0, unlesbar = NaN (am Feld meldet das buchungsFehler, der Server „Betrag ungültig“) */
const amountOf = (text: string) => (text.trim() === "" ? 0 : (parseEuro(text) ?? Number.NaN));

function ManualEntryPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/buchungen">Buchungen</Link> › Manuell
          </div>
          <h1>Buchung erfassen</h1>
        </div>
      </div>
      <ManualEntryForm data={data} />
    </>
  );
}

export type Data = Awaited<ReturnType<typeof getManualEntryForm>>;

function ManualEntryForm({ data }: { data: Data }) {
  const navigate = useNavigate();
  const create = useServerFn(createManualEntryFn);
  const { busy, notice, run } = useAction();
  const [kind, setKind] = useState<ManualKind>("umbuchung");
  const [date, setDate] = useState(data.today);
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow(1), emptyRow(2)]);
  const [nextKey, setNextKey] = useState(3);

  const gmbh = isKapitalgesellschaft(data.rechtsform);
  // Steuerschlüssel gibt es für Umbuchungen, nicht als Kleinunternehmer (§ 19 Abs. 1 UStG)
  const mitSchluesseln = kind === "umbuchung" && !data.kleinunternehmer;
  const lines: ManualLine[] = rows.map((r) => ({
    account: r.account.trim(),
    debit: amountOf(r.debit),
    credit: amountOf(r.credit),
    taxCode: mitSchluesseln && r.taxCode ? r.taxCode : null,
  }));
  const mitSchluessel = lines.some((l) => l.taxCode);
  const findings = buchungsMeldungen(rows, lines, data, kind);
  const { zellen, buchung } = buchungsFehler(rows, findings);
  const sum = (side: "debit" | "credit") => lines.reduce((s, l) => s + (Number.isFinite(l[side]) ? l[side] : 0), 0);
  const difference = sum("debit") - sum("credit");
  const touched = rows.some((r) => r.account || r.accountText || r.debit || r.credit);
  // Was gebucht wird, wenn eine Zeile einen Steuerschlüssel trägt: brutto geteilt in Netto und Steuer
  const gebucht = mitSchluessel && findings.length === 0 ? freieBuchungPosting(lines, data.kontenrahmen) : null;
  // Was an einer Zeile fehlt, steht an deren Feld; was die ganze Buchung betrifft, als Liste unter der Tabelle. Auf die
  // Liste zeigt das Konto der ersten Zeile und bekommt den Fokus
  const buchungsFehlerId = useId();
  // Schlüssel der Zellen je Zeile (`<key>.<feld>`), daher string
  const { form, error, check } = useSubmitCheck<string>({
    date: buchungsdatumFehler(date, data.today, kind),
    description: description.trim().length < 3 ? "Trag einen Buchungstext mit mindestens 3 Zeichen ein." : null,
    ...zellen,
    buchung: buchung.length > 0 ? buchung.join(" ") : null,
  });
  const buchungFehlt = Boolean(error("buchung"));
  // Vor dem ersten „Buchen“ sagt die Liste schon beim Tippen, was noch fehlt, auch an den Zeilen; danach stehen die Fehler
  // der Zeilen an ihren Feldern, und die Liste nennt nur noch, was die ganze Buchung betrifft
  const [versucht, setVersucht] = useState(false);
  const liste = versucht ? buchung : manualFindingTexts(findings);

  const update = (key: number, patch: Partial<Row>) => setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function addRow() {
    setRows((current) => [...current, emptyRow(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Vor check, damit die Liste schon beim Fokus nur noch die ganze Buchung nennt; geht die Prüfung durch, zeigt useSubmitCheck
    // keine Fehler mehr an den Feldern, und die Liste nennt beim Tippen wieder alles (etwa nach einem Fehler des Servers)
    setVersucht(true);
    if (!check()) return;
    setVersucht(false);
    void run(async () => {
      await create({ data: { kind, date, description, lines: lines.map((l) => ({ ...l, taxCode: l.taxCode ?? null })) } });
      await navigate({ to: "/buchungen", search: { jahr: Number(date.slice(0, 4)), monat: Number(date.slice(5, 7)) } });
    });
  }

  return (
    <>
      <form ref={form} className="card stack" onSubmit={onSubmit} aria-label="Manuelle Buchung" noValidate>
        <Buchungshinweise kontenrahmen={data.kontenrahmen} gmbh={gmbh} mitSchluesseln={mitSchluesseln} />
        {gmbh && (
          <ArtDerBuchung
            kind={kind}
            umbuchung={() => setKind("umbuchung")}
            eroeffnung={() => {
              setKind("eroeffnung");
              setDate(`${date.slice(0, 4)}-01-01`);
            }}
          />
        )}
        <div className="form-row cols-2">
          <Field label="Datum" error={error("date")}>
            {(control) => <input {...control} type="date" value={date} max={data.today} onChange={(e) => setDate(e.target.value)} required />}
          </Field>
          <Field label="Buchungstext" error={error("description")}>
            {(control) => <input {...control} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} required minLength={3} />}
          </Field>
        </div>

        {/* Am Handy steht jede Zeile als Karte (stack-table): In einer seitlich scrollenden Tabelle schnitte der Scrollbereich
            die Trefferliste der Kontosuche ab. Relativ, damit die unsichtbaren Spaltennamen (visually-hidden, absolut) in der
            Tabelle bleiben und die Seite nicht verbreitern */}
        <table className="report-table stack-table" style={{ position: "relative" }}>
          <caption className="visually-hidden">Buchungszeilen</caption>
          <thead>
            <tr>
              <th scope="col">Konto</th>
              <th scope="col">Bezeichnung</th>
              <th scope="col" className="num">
                Soll
              </th>
              <th scope="col" className="num">
                Haben
              </th>
              {mitSchluesseln && <th scope="col">Steuerschlüssel</th>}
              <th scope="col">
                <span className="visually-hidden">Entfernen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <BuchungsZeile
                key={r.key}
                r={r}
                index={index}
                accounts={data.accounts}
                kontenrahmen={data.kontenrahmen}
                mitSchluesseln={mitSchluesseln}
                meldung={(field) => error(zellenSchluessel(r.key, field))}
                fehlerId={buchungFehlt && index === 0 ? buchungsFehlerId : null}
                entfernbar={rows.length > 2}
                update={update}
                entfernen={() => setRows((current) => current.filter((x) => x.key !== r.key))}
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Summe{difference !== 0 && ` · Differenz ${formatEuro(Math.abs(difference))}`}
              </th>
              <td className="num" data-label="Soll">
                {formatEuro(sum("debit"))}
              </td>
              <td className="num" data-label="Haben">
                {formatEuro(sum("credit"))}
              </td>
              {mitSchluesseln && <td />}
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="actions">
          <button type="button" className="btn" onClick={addRow} disabled={rows.length >= MANUAL_MAX_LINES}>
            Zeile hinzufügen
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Buchen
          </button>
        </div>
        {gebucht && (
          <div className="small" role="status" aria-label="Gebucht wird">
            <p className="muted" style={{ margin: 0 }}>
              Gebucht wird, brutto geteilt:
            </p>
            <ul style={{ margin: 0 }}>
              {gebucht.map((l, i) => (
                <li key={`${l.account}-${i}`}>
                  <span className="mono">{l.account}</span> {data.accounts[l.account] ?? ""} · {l.debit > 0 ? "Soll" : "Haben"}{" "}
                  {formatEuro(l.debit || l.credit)}
                  {l.taxCode && ` · ${SCHLUESSEL_NAME[l.taxCode as FreierSteuerschluessel]}`}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(touched || buchungFehlt) && liste.length > 0 && (
          // Die id an der Liste selbst: Ein aria-label daran ersetzte für aria-describedby ihren Text
          <div role="status" aria-label="Noch nicht buchbar">
            <ul id={buchungsFehlerId} className={buchungFehlt ? "small field-error" : "small"} style={{ margin: 0 }}>
              {liste.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        <NoticeBanner notice={notice} />
      </form>
      {kind === "eroeffnung" && data.datevEroeffnung && <DatevEroeffnung data={data.datevEroeffnung} />}
    </>
  );
}

function Buchungshinweise({
  kontenrahmen,
  gmbh,
  mitSchluesseln,
}: {
  kontenrahmen: Awaited<ReturnType<typeof getManualEntryForm>>["kontenrahmen"];
  gmbh: boolean;
  mitSchluesseln: boolean;
}) {
  return (
    <>
      {!gmbh && (
        <p className="muted small" style={{ margin: 0 }}>
          <strong>Der Bank-Anfangsbestand braucht keine Buchung.</strong> Enthält der letzte Import oder Abruf einen Endsaldo, siehst du ihn unter{" "}
          <Link to="/bank">Bank</Link>.
        </p>
      )}
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Soll an Haben auf frei gewählten Konten ({kontenrahmen}),{" "}
        {gmbh ? "etwa das Stammkapital, ein Gesellschafterdarlehen oder eine falsche Kontierung" : "etwa eine Ausgabe ohne Beleg gegen Privat"}. Bank, Kasse,
        offene Posten, Umsatzsteuer, Erlöse aus Rechnungen und Anlagen führen ihre eigenen Seiten und lassen sich hier nicht bebuchen.
        {mitSchluesseln &&
          ` Mit Steuerschlüssel bucht eine Zeile auf das Erlöskonto des Satzes, etwa eine Leistung für private Zwecke gegen ${gmbh ? "das Gesellschafter-Verrechnungskonto" : "Privat"}, oder als Sachentnahme auf ${SACHENTNAHME_KONTEN[kontenrahmen][1900]} (19 %) bzw. ${SACHENTNAHME_KONTEN[kontenrahmen][700]} (7 %), wenn Waren oder Gegenstände des Betriebs privat entnommen werden; der Betrag ist brutto, Haben teilt ihn in Netto und Umsatzsteuer. Vorsteuer gibt es nur mit Beleg.`}{" "}
        Die Buchung ist sofort festgeschrieben; korrigiert wird per Storno.
      </p>
    </>
  );
}

/** Umbuchung oder Eröffnungsbuchung; die Wahl gibt es nur bei GmbH und UG */
function ArtDerBuchung({ kind, umbuchung, eroeffnung }: { kind: ManualKind; umbuchung: () => void; eroeffnung: () => void }) {
  return (
    <fieldset className="mode-switch" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="visually-hidden">Art der Buchung</legend>
      <label className="checkbox">
        <input type="radio" name="kind" checked={kind === "umbuchung"} onChange={umbuchung} />
        Umbuchung
      </label>
      <label className="checkbox">
        <input type="radio" name="kind" checked={kind === "eroeffnung"} onChange={eroeffnung} aria-describedby="kind-eroeffnung-hint" />
        Eröffnungsbuchung
      </label>
      <span id="kind-eroeffnung-hint" className="small muted" style={{ display: "block" }}>
        Salden aus der bisherigen Buchhaltung zum 1. Januar des ersten Jahres in Haben: Bestandskonten und der Kontostand der Bank gegen 9000 Saldenvorträge.
        Offene Rechnungen und Belege kommen einzeln über den Umzug, Anlagen über das Anlagenverzeichnis. Liegt der DATEV-Stapel der bisherigen Buchhaltung im
        Archiv, schlägt Haben die ganze Eröffnung aus seiner Schlussbilanz vor (unter dem Formular).
      </span>
    </fieldset>
  );
}
