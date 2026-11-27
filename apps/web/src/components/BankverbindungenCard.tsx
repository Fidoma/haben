import { gruppierteIban, isValidIban } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { addBankverbindung, removeBankverbindung, saveBankverbindung } from "../server/functions/bankverbindungen.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { ScrollTable } from "./ScrollTable.tsx";

interface Row {
  id: string;
  bezeichnung: string;
  iban: string;
  bic: string;
  bank: string;
  kontoinhaber: string;
}

type Eingabe = Omit<Row, "id">;

const LEER: Eingabe = { bezeichnung: "", iban: "", bic: "", bank: "", kontoinhaber: "" };

/**
 * Weitere Zahlungskonten (#1887): Das Konto aus den Firmendaten bleibt der Standard. Gibt es hier eins, wählt man in
 * Rechnung und Angebot das Zahlungskonto und am Kontakt das bevorzugte; es steht auf dem Beleg und in der E-Rechnung (BT-84).
 * Löschen geht immer: Festgeschriebene Belege tragen eine Kopie, Entwürfe und Kontakte nehmen danach den Standard.
 */
export function BankverbindungenCard({ bankverbindungen }: { bankverbindungen: Row[] }) {
  const router = useRouter();
  const add = useServerFn(addBankverbindung);
  const save = useServerFn(saveBankverbindung);
  const remove = useServerFn(removeBankverbindung);
  const [loeschen, setLoeschen] = useState<Row | null>(null);
  const { busy, notice, run } = useAction();
  // null: Formular zu; "neu" oder die Id des Zahlungskontos, das gerade bearbeitet wird
  const [offen, setOffen] = useState<string | null>(null);
  const [eingabe, setEingabe] = useState<Eingabe>(LEER);
  const iban = eingabe.iban.replace(/\s+/g, "");
  const { form, error, check } = useSubmitCheck({
    bezeichnung: eingabe.bezeichnung.trim() === "" ? "Gib eine Bezeichnung ein, etwa „Objekt Nord“." : null,
    iban: iban === "" ? "Gib die IBAN ein." : isValidIban(iban) ? null : "Die IBAN stimmt nicht (Prüfziffer oder Länge).",
  });
  const setze = (feld: keyof Eingabe) => (value: string) => setEingabe((e) => ({ ...e, [feld]: value }));

  function oeffnen(row: Row | null) {
    setEingabe(row ? { bezeichnung: row.bezeichnung, iban: gruppierteIban(row.iban), bic: row.bic, bank: row.bank, kontoinhaber: row.kontoinhaber } : LEER);
    setOffen(row?.id ?? "neu");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!check()) return;
    const data = { ...eingabe, iban };
    const id = offen;
    void run(
      async () => {
        if (id === "neu") await add({ data });
        else if (id) await save({ data: { ...data, id } });
        setOffen(null);
        await router.invalidate();
      },
      id === "neu" ? `Zahlungskonto „${data.bezeichnung.trim()}“ angelegt.` : `Zahlungskonto „${data.bezeichnung.trim()}“ gespeichert.`,
    );
  }

  return (
    <section className="card stack" aria-labelledby="bankverbindungen-heading">
      <h2 id="bankverbindungen-heading">Weitere Zahlungskonten</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Für Rechnungen und Angebote auf ein anderes eigenes Konto, etwa je Objekt oder Kunde. Die Bankverbindung in den Firmendaten bleibt der Standard. Sobald
        hier eins steht, wählst du in Rechnung und Angebot das Zahlungskonto und am Kontakt das bevorzugte; es steht auf dem Beleg, im GiroCode und in der
        E-Rechnung.
      </p>
      <ConfirmDialog
        open={loeschen !== null}
        title={loeschen ? `Zahlungskonto „${loeschen.bezeichnung}“ löschen?` : "Zahlungskonto löschen?"}
        facts={loeschen ? [{ label: "IBAN", value: gruppierteIban(loeschen.iban), strong: true }] : undefined}
        confirmLabel="Löschen"
        danger
        onConfirm={() =>
          loeschen &&
          void run(async () => {
            await remove({ data: { id: loeschen.id } });
            await router.invalidate();
          }, `Zahlungskonto „${loeschen.bezeichnung}“ gelöscht.`)
        }
        onClose={() => setLoeschen(null)}
      >
        <p>
          Festgeschriebene Rechnungen und Angebote behalten das Konto, es steht in ihnen selbst. Entwürfe und Kontakte, die es gewählt haben, nehmen danach das
          Standardkonto aus den Firmendaten.
        </p>
      </ConfirmDialog>
      {bankverbindungen.length > 0 && (
        <ScrollTable className="report-table">
          <thead>
            <tr>
              <th scope="col">Bezeichnung</th>
              <th scope="col">IBAN</th>
              <th scope="col">
                <span className="visually-hidden">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {bankverbindungen.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.bezeichnung}
                  {row.bank && <div className="small muted">{row.bank}</div>}
                </td>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>
                  {gruppierteIban(row.iban)}
                </td>
                <td>
                  <div className="actions" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => oeffnen(row)} aria-label={`${row.bezeichnung} bearbeiten`}>
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => setLoeschen(row)}
                      aria-label={`${row.bezeichnung} löschen`}
                    >
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      {offen === null ? (
        <div className="actions">
          <button type="button" className="btn btn-dashed" onClick={() => oeffnen(null)}>
            + Zahlungskonto
          </button>
        </div>
      ) : (
        <form ref={form} onSubmit={onSubmit} className="stack" aria-label={offen === "neu" ? "Neues Zahlungskonto" : "Zahlungskonto bearbeiten"} noValidate>
          <div className="form-row cols-2">
            <Field label="Bezeichnung" hint="Nur für die Auswahl, steht nicht auf dem Beleg" error={error("bezeichnung")}>
              {(control) => <input {...control} value={eingabe.bezeichnung} maxLength={60} onChange={(e) => setze("bezeichnung")(e.target.value)} />}
            </Field>
            <Field label="IBAN" error={error("iban")}>
              {(control) => (
                <input
                  {...control}
                  value={eingabe.iban}
                  className="mono"
                  placeholder="DE00 0000 0000 0000 0000 00"
                  onChange={(e) => setze("iban")(e.target.value.toUpperCase())}
                />
              )}
            </Field>
          </div>
          <Field label="Kontoinhaber" hint="Nur nötig, wenn das Konto nicht auf den Firmennamen läuft">
            {(control) => <input {...control} value={eingabe.kontoinhaber} maxLength={70} onChange={(e) => setze("kontoinhaber")(e.target.value)} />}
          </Field>
          <div className="form-row cols-2">
            <Field label="Bank">
              {(control) => <input {...control} value={eingabe.bank} maxLength={100} onChange={(e) => setze("bank")(e.target.value)} />}
            </Field>
            <Field label="BIC">
              {(control) => (
                <input {...control} value={eingabe.bic} className="mono" maxLength={11} onChange={(e) => setze("bic")(e.target.value.toUpperCase())} />
              )}
            </Field>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setOffen(null)} disabled={busy}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {offen === "neu" ? "Zahlungskonto anlegen" : "Speichern"}
            </button>
          </div>
        </form>
      )}
      <NoticeBanner notice={notice} />
    </section>
  );
}
