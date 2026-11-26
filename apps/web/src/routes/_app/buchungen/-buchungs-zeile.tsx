import { FREIE_STEUERSCHLUESSEL, freieBuchungKonto, type FreierSteuerschluessel, type ManualField } from "@haben/core";
import { AccountCombobox } from "../../../components/AccountCombobox.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { ZEILEN_FELDER } from "./-buchungs-pruefung.ts";
import type { Data } from "./neu.tsx";

/** Zeilen der manuellen Buchung (neu.tsx): Formularstand und die Tabellenzeile mit den Meldungen ihrer Felder */
/** Eine Zeile, wie sie im Formular steht: Beträge als Text, bis zum Buchen.
 *  accountText ist die Eingabe im Konto-Feld (Nummer oder Namenseingabe zur Suche);
 *  account ist die gewählte Kontonummer, leer bis die Auswahl übernommen wurde. */
export interface Row {
  key: number;
  account: string;
  accountText: string;
  debit: string;
  credit: string;
  /** Steuerschlüssel einer freien Buchung; der Betrag ist dann brutto */
  taxCode: FreierSteuerschluessel | "";
}

export const emptyRow = (key: number): Row => ({ key, account: "", accountText: "", debit: "", credit: "", taxCode: "" });

/** Fehler eines Felds der Zeile, zu sehen erst nach dem ersten Druck auf „Buchen“ (useSubmitCheck) */
export type ZeilenMeldung = (field: ManualField) => string | undefined;

const meldungsId = (key: number, field: ManualField) => `buchung-fehler-${key}-${field}`;

/**
 * aria-Attribute einer Zelle: Die Zellen stehen ohne `Field`, tragen bei ihrem Fehler also selbst `aria-invalid` und zeigen
 * per `aria-describedby` auf ihre Meldung (DESIGN.md, Gesperrte Knöpfe)
 */
function zelle(meldung: ZeilenMeldung, key: number, field: ManualField) {
  const text = meldung(field);
  return { "aria-invalid": text ? true : undefined, "aria-describedby": text ? meldungsId(key, field) : undefined };
}

/** Die Meldungen der Zeile untereinander in einer Tabellenzeile darunter, in der Reihenfolge der Zellen (wie PositionsMeldungen) */
function ZeilenMeldungen({ meldung, rowKey, spalten }: { meldung: ZeilenMeldung; rowKey: number; spalten: number }) {
  const texte = ZEILEN_FELDER.flatMap((field) => {
    const text = meldung(field);
    return text ? [{ field, text }] : [];
  });
  if (texte.length === 0) return null;
  return (
    <tr className="zeilen-meldungen">
      <td colSpan={spalten}>
        <div className="line-errors">
          {texte.map(({ field, text }) => (
            <span key={field} id={meldungsId(rowKey, field)} className="field-error">
              {text}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

/** Steuerschlüssel freier Buchungen, wie sie die Auswahl nennt (docs/adr/journal-als-quelle.md, Entscheidung 4) */
export const SCHLUESSEL_NAME: Record<FreierSteuerschluessel, string> = { USt19: "USt 19 %", USt7: "USt 7 %", frei: "0 %" };

/**
 * Eine Zeile der Buchung mit den Meldungen ihrer Felder darunter; fehlerId verbindet das Konto der ersten Zeile mit der Liste
 * dessen, was der ganzen Buchung noch fehlt
 */
export function BuchungsZeile({
  r,
  index,
  accounts,
  kontenrahmen,
  mitSchluesseln,
  meldung,
  fehlerId,
  entfernbar,
  update,
  entfernen,
}: {
  r: Row;
  index: number;
  accounts: Data["accounts"];
  kontenrahmen: Data["kontenrahmen"];
  mitSchluesseln: boolean;
  meldung: ZeilenMeldung;
  fehlerId: string | null;
  entfernbar: boolean;
  update: (key: number, patch: Partial<Row>) => void;
  entfernen: () => void;
}) {
  const konto = zelle(meldung, r.key, "account");
  return (
    <>
      <tr>
        <td data-label="Konto">
          {/* Die Auswahl trägt Nummer und Namenseingabe zusammen; ein freier Zahlentext ohne Treffer zählt als Kontonummer */}
          <AccountCombobox
            index={index}
            value={r.accountText}
            accounts={accounts}
            invalid={Boolean(konto["aria-invalid"] || fehlerId)}
            describedBy={konto["aria-describedby"] ?? fehlerId ?? undefined}
            onInput={(text) => update(r.key, { accountText: text, account: /^\d{1,4}$/.test(text.trim()) ? text.trim() : "" })}
            onPick={(a) => update(r.key, { account: a.number, accountText: a.number })}
          />
        </td>
        {/* Der Name steht schon in der Kontenzeile hinter der Nummer; die Spalte bleibt für Zeilen ohne Auswahl leer */}
        <td className="small muted" data-label="Bezeichnung">
          {r.account ? (accounts[r.account] ?? "") : ""}
        </td>
        <td className="num" data-label="Soll">
          <input
            aria-label={`Soll Zeile ${index + 1}`}
            {...zelle(meldung, r.key, "debit")}
            inputMode="decimal"
            size={10}
            value={r.debit}
            onChange={(e) => update(r.key, { debit: e.target.value })}
          />
        </td>
        <td className="num" data-label="Haben">
          <input
            aria-label={`Haben Zeile ${index + 1}`}
            {...zelle(meldung, r.key, "credit")}
            inputMode="decimal"
            size={10}
            value={r.credit}
            onChange={(e) => update(r.key, { credit: e.target.value })}
          />
        </td>
        {mitSchluesseln && (
          <td data-label="Steuerschlüssel">
            {/* biome-ignore lint/plugin: Zelle der Buchungstabelle: der Spaltenkopf und aria-label benennen sie, eine Hülle `.field` je Zelle sprengte die Zeile */}
            <select
              aria-label={`Steuerschlüssel Zeile ${index + 1}`}
              {...zelle(meldung, r.key, "taxCode")}
              style={{ minWidth: 136 }}
              value={r.taxCode}
              onChange={(e) => {
                const taxCode = e.target.value as Row["taxCode"];
                // Ein Schlüssel gehört zu genau einem Erlöskonto; ein leeres Konto füllt Haben vor
                update(r.key, {
                  taxCode,
                  ...(taxCode && !r.account && !r.accountText
                    ? { account: freieBuchungKonto(kontenrahmen, taxCode), accountText: freieBuchungKonto(kontenrahmen, taxCode) }
                    : {}),
                });
              }}
            >
              <option value="">ohne</option>
              {(Object.keys(FREIE_STEUERSCHLUESSEL) as FreierSteuerschluessel[]).map((code) => (
                <option key={code} value={code}>
                  {SCHLUESSEL_NAME[code]}
                </option>
              ))}
            </select>
          </td>
        )}
        <td>
          {entfernbar && (
            <button type="button" className="icon-btn" onClick={entfernen} aria-label={`Zeile ${index + 1} entfernen`}>
              <Icon name="close" size={16} />
            </button>
          )}
        </td>
      </tr>
      <ZeilenMeldungen meldung={meldung} rowKey={r.key} spalten={mitSchluesseln ? 6 : 5} />
    </>
  );
}
