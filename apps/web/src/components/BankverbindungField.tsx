import { gruppierteIban } from "@haben/core";
import { Field } from "./Field.tsx";

/** Weiteres Zahlungskonto zur Auswahl in Rechnung, Angebot und Kontakt (#1887) */
export interface BankverbindungOption {
  id: string;
  bezeichnung: string;
  iban: string;
}

/**
 * Auswahl des eigenen Zahlungskontos; steht nur da, wenn es weitere gibt (Einstellungen › Firma). Leer = Standard aus
 * den Firmendaten. Der Name sagt „Zahlungskonto“, nicht „Bankverbindung“: Am Kontakt steht schon die IBAN des Kunden.
 */
export function BankverbindungField({
  label,
  bankverbindungen,
  standardIban,
  value,
  disabled,
  hint,
  name,
  onChange,
}: {
  /** „Zahlungskonto“ im Beleg, „Bevorzugtes Zahlungskonto“ am Kontakt */
  label: string;
  bankverbindungen: readonly BankverbindungOption[];
  standardIban: string;
  value: string;
  disabled: boolean;
  hint: string;
  /** Im Formular, das über FormData speichert (Kontakt) */
  name?: string;
  onChange: (id: string) => void;
}) {
  if (bankverbindungen.length === 0) return null;
  return (
    <Field label={label} hint={hint} style={{ gridColumn: "1 / -1" }}>
      {(control) => (
        <select {...control} name={name} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Standard{standardIban ? ` · ${gruppierteIban(standardIban)}` : ""}</option>
          {bankverbindungen.map((b) => (
            <option key={b.id} value={b.id}>
              {b.bezeichnung} · {gruppierteIban(b.iban)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
