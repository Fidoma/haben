import { formatDecimal, type OutgoingTaxDetails, parseEuro, TAX_TREATMENTS, type TaxTreatment } from "@haben/core";
import { Field } from "./Field.tsx";
import { EMPTY_DETAILS, ForeignTaxFields, treatmentHint } from "./OutgoingTaxFields.tsx";

/** Steuer der übernommenen Fremdrechnung (#660): Behandlung, Leistungsort im Ausland (#1392), Netto und Steuer je Satz */

export type TaxRow = { rate: string; net: string; tax: string };

const RATES = [
  { value: "1900", label: "19 %" },
  { value: "700", label: "7 %" },
  { value: "0", label: "0 %" },
];

/** Behandlungen mit tatsächlichem Leistungsort im Ausland (§ 3a UStG); nur für sie fragt das Formular ihn ab */
export const FOREIGN = new Set<TaxTreatment>(["reverse_charge", "drittland", "eu_sonstige"]);

/**
 * Behandlungen, die die Übernahme annimmt: Ein Kleinunternehmer übernimmt Rechnungen nach § 19 UStG und Auslandsleistungen mit
 * bestätigtem Leistungsort (wie im Editor), alle anderen nicht § 19. Die eigenen Befreiungen von Kleinunternehmern brauchen eine
 * strukturierte Vorschrift, die das Formular nicht abfragt; der Server lehnt sie ab, also werden sie nicht angeboten.
 */
function offeredTreatments(kleinunternehmer: boolean): TaxTreatment[] {
  const all = Object.keys(TAX_TREATMENTS) as TaxTreatment[];
  return kleinunternehmer ? all.filter((key) => key === "kleinunternehmer" || FOREIGN.has(key)) : all.filter((key) => key !== "kleinunternehmer");
}

/**
 * Ohne deutsche Umsatzsteuer stehen alle Positionen auf 0 % (`treatmentIssues`), also gibt es nur eine Zeile ohne Steuer (#1880).
 * Mehrere Zeilen werden zum Nettobetrag zusammengerechnet; eine einzelne behält die Eingabe, wie sie ist. Ist ein Betrag
 * unlesbar, bleibt er stehen, damit das Absenden ihn meldet, statt dass er still aus der Summe fällt.
 */
export function nurNetto(rows: TaxRow[]): TaxRow[] {
  const filled = rows.map((r) => r.net.trim()).filter((net) => net !== "");
  const unreadable = filled.find((net) => parseEuro(net) === null);
  const net = rows.length === 1 ? rows[0]!.net : (unreadable ?? (filled.length > 0 ? formatDecimal(filled.reduce((sum, n) => sum + parseEuro(n)!, 0)) : ""));
  return [{ rate: "0", net, tax: "0,00" }];
}

/**
 * Zeilen beim Öffnen: aus der E-Rechnung so, wie sie gelesen wurden (ein Satz über 0 % bei einer Sonderbehandlung bleibt
 * sichtbar und wird beim Übernehmen abgelehnt), ohne E-Rechnung eine leere Zeile, regulär zu 19 %, sonst zu 0 %.
 */
export function startZeilen(taxes: { rate: number; net: number; tax: number }[], treatment: TaxTreatment): TaxRow[] {
  if (taxes.length > 0) return taxes.map((t) => ({ rate: String(t.rate), net: formatDecimal(t.net), tax: formatDecimal(t.tax) }));
  return treatment === "regulaer" ? [{ rate: "1900", net: "", tax: "" }] : nurNetto([{ rate: "1900", net: "", tax: "" }]);
}

/** Nur der Nettobetrag, wenn ohne deutsche Umsatzsteuer eine Zeile zu 0 % bleibt; sonst Satz, Netto und Steuer je Zeile */
const nurNettoFeld = (treatment: TaxTreatment, rows: TaxRow[]) => treatment !== "regulaer" && rows.length === 1 && rows[0]!.rate === "0";

export function TaxSection({
  treatment,
  onTreatment,
  kleinunternehmer,
  exemptionReason,
  onExemptionReason,
  foreignPlace,
  onForeignPlace,
  rows,
  onRows,
}: {
  treatment: TaxTreatment;
  kleinunternehmer: boolean;
  onTreatment: (treatment: TaxTreatment) => void;
  foreignPlace: OutgoingTaxDetails["foreignPlace"];
  onForeignPlace: (place: OutgoingTaxDetails["foreignPlace"]) => void;
  exemptionReason: string;
  onExemptionReason: (reason: string) => void;
  rows: TaxRow[];
  onRows: (rows: TaxRow[]) => void;
}) {
  return (
    <section className="form-section" aria-labelledby="fremdrechnung-steuer">
      <h2 id="fremdrechnung-steuer">Steuer</h2>
      <Field
        label="Steuerbehandlung"
        hint={
          kleinunternehmer && treatment === "kleinunternehmer"
            ? "Als Kleinunternehmer übernimmt Haben hier Rechnungen nach § 19 UStG und Auslandsleistungen mit geklärtem Leistungsort."
            : treatmentHint(treatment, false)
        }
      >
        {(control) => (
          <select {...control} value={treatment} onChange={(e) => onTreatment(e.target.value as TaxTreatment)}>
            {offeredTreatments(kleinunternehmer).map((key) => (
              <option key={key} value={key}>
                {TAX_TREATMENTS[key].label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {(treatment === "steuerfrei" || treatment === "kleinunternehmer") && (
        <Field label="Befreiungsvorschrift" hint="Wie auf der Rechnung, etwa „Steuerfrei nach § 4 Nr. 14 UStG“">
          {(control) => (
            <input {...control} value={exemptionReason} onChange={(e) => onExemptionReason(e.target.value)} required={treatment === "steuerfrei"} />
          )}
        </Field>
      )}
      {FOREIGN.has(treatment) && (
        <ForeignTaxFields
          values={{ ...EMPTY_DETAILS, foreignPlace }}
          disabled={false}
          update={(patch) => onForeignPlace(patch.foreignPlace ?? null)}
          treatment={treatment}
          kleinunternehmer={kleinunternehmer}
        />
      )}
      {!nurNettoFeld(treatment, rows) ? (
        <>
          <TaxRowFields rows={rows} onChange={onRows} />
          <div className="actions">
            <button type="button" className="btn btn-sm" onClick={() => onRows([...rows, { rate: "0", net: "", tax: "0,00" }])}>
              Weiteren Steuersatz
            </button>
          </div>
        </>
      ) : (
        <Field label="Netto (€)" hint="Ohne deutsche Umsatzsteuer gilt 0 %; trag den Rechnungsbetrag ein.">
          {(control) => (
            <input
              {...control}
              inputMode="decimal"
              value={rows[0]?.net ?? ""}
              onChange={(e) => onRows([{ rate: "0", net: e.target.value, tax: "0,00" }])}
              required
            />
          )}
        </Field>
      )}
    </section>
  );
}

function TaxRowFields({ rows, onChange }: { rows: TaxRow[]; onChange: (rows: TaxRow[]) => void }) {
  const set = (i: number, patch: Partial<TaxRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return rows.map((row, i) => (
    // Zeilen werden nur angehängt, nie umsortiert: der Index ist ein stabiler Schlüssel
    <div key={i} className="form-grid">
      <Field label={`Steuersatz ${i + 1}`}>
        {(control) => (
          <select {...control} value={row.rate} onChange={(e) => set(i, { rate: e.target.value })}>
            {RATES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Netto ${i + 1} (€)`}>
        {(control) => <input {...control} inputMode="decimal" value={row.net} onChange={(e) => set(i, { net: e.target.value })} required />}
      </Field>
      <Field label={`Steuer ${i + 1} (€)`}>
        {(control) => <input {...control} inputMode="decimal" value={row.tax} onChange={(e) => set(i, { tax: e.target.value })} required />}
      </Field>
    </div>
  ));
}
