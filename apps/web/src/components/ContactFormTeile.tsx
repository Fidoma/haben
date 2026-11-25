import { useRef } from "react";
import type { ContactInput } from "../server/modules/stammdaten/index.ts";
import { Field } from "./Field.tsx";

// Abschnitte des Kontaktformulars (ContactForm): Allgemein, Anschrift, Steuer und Zahlung, Rechnungen

export interface IbanSuggestion {
  iban: string;
  source: "e-rechnung" | "ki";
  /** Textausschnitt des Belegs, in dem die IBAN steht (KI-Auslesung) */
  fundstelle: string | null;
  /** Prüfziffer nach ISO 13616 stimmt */
  valid: boolean;
}

/** Abschnitt „Allgemein“: Name, Rolle, Kontaktwege und Nummern; isNew: beim Anlegen nennt das Feld Kundennummer die voraussichtlich nächste (nextNumber) */
export function ContactBasics({ initial, isNew, nextNumber }: { initial: ContactInput; isNew: boolean; nextNumber: string | null }) {
  return (
    <section className="form-section" aria-labelledby="contact-basics">
      <h2 id="contact-basics">Allgemein</h2>
      <Field label="Name oder Firma">
        {(control) => <input {...control} name="name" defaultValue={initial.name} required autoComplete="organization" placeholder="z. B. Muster GmbH" />}
      </Field>
      <fieldset className="field-group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small">Rolle</legend>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label className="checkbox">
            <input type="checkbox" name="isCustomer" defaultChecked={initial.isCustomer ?? true} />
            Kunde
          </label>
          <label className="checkbox">
            <input type="checkbox" name="isSupplier" defaultChecked={initial.isSupplier ?? false} />
            Lieferant
          </label>
        </div>
        <p className="field-hint">Kunden stehen bei Rechnungen und Angeboten zur Auswahl, Lieferanten bei den Belegen. Beides geht.</p>
      </fieldset>
      <div className="form-row cols-2">
        <Field label="E-Mail" hint="Mehrere Adressen mit Komma trennen, bis zu fünf. Der Versand schreibt an alle.">
          {(control) => (
            <input
              {...control}
              name="email"
              type="email"
              multiple
              defaultValue={initial.email}
              autoComplete="email"
              placeholder="rechnung@kunde.de, freigabe@kunde.de"
            />
          )}
        </Field>
        <Field label="Telefon">
          {(control) => (
            <input {...control} name="telefon" type="tel" defaultValue={initial.telefon} autoComplete="tel" placeholder="optional, z. B. +49 941 123456" />
          )}
        </Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Kundennummer" hint={isNew && nextNumber ? `Leer lassen: Haben vergibt die nächste Nummer, voraussichtlich ${nextNumber}.` : undefined}>
          {(control) => (
            <input {...control} name="kundennummer" defaultValue={initial.kundennummer} placeholder={isNew && nextNumber ? nextNumber : "optional"} />
          )}
        </Field>
        <Field label="Lieferantennummer">
          {(control) => (
            <input
              {...control}
              name="lieferantennummer"
              defaultValue={initial.lieferantennummer}
              placeholder="optional, z. B. deine Kundennummer beim Lieferanten"
            />
          )}
        </Field>
      </div>
    </section>
  );
}

/** Abschnitt „Steuer und Zahlung“: USt-IdNr. (gehört dem Formular, für den Hinweis auf gleiche Nummern) und IBAN samt Vorschlag vom Beleg */
export function ContactTax({
  initial,
  ustId,
  onUstId,
  ibanSuggestion,
}: {
  initial: ContactInput;
  ustId: string;
  onUstId: (ustId: string) => void;
  ibanSuggestion: IbanSuggestion | null;
}) {
  const ibanInput = useRef<HTMLInputElement>(null);
  const takeIban = (iban: string) => {
    if (!ibanInput.current) return;
    ibanInput.current.value = iban;
    ibanInput.current.focus();
  };
  return (
    <section className="form-section" aria-labelledby="contact-tax">
      <h2 id="contact-tax">Steuer und Zahlung</h2>
      <div className="form-row cols-2">
        <Field label="USt-IdNr.">
          {(control) => <input {...control} name="ustId" value={ustId} onChange={(e) => onUstId(e.target.value)} placeholder="DE123456789" className="mono" />}
        </Field>
        <div className="stack" style={{ gap: 4 }}>
          <Field label="IBAN" describedBy={ibanSuggestion ? "iban-suggestion" : undefined}>
            {(control) => (
              <input {...control} ref={ibanInput} name="iban" defaultValue={initial.iban} placeholder="DE00 0000 0000 0000 0000 00" className="mono" />
            )}
          </Field>
          {ibanSuggestion && <IbanSuggestionHint suggestion={ibanSuggestion} onTake={() => takeIban(ibanSuggestion.iban)} />}
        </div>
      </div>
    </section>
  );
}

/** Abschnitt „Rechnungen“: die Sprache */
export function ContactInvoices({ initial }: { initial: ContactInput }) {
  return (
    <section className="form-section" aria-labelledby="contact-invoices">
      <h2 id="contact-invoices">Rechnungen</h2>
      <div className="form-row cols-2">
        <Field label="Sprache von Rechnungen und Angeboten">
          {(control) => (
            <select {...control} name="language" defaultValue={initial.language ?? "de"}>
              <option value="de">Deutsch</option>
              <option value="en">Englisch</option>
            </select>
          )}
        </Field>
      </div>
    </section>
  );
}

/** Vorschlag unter dem Feld: IBAN in Vierergruppen, Herkunft, Fundstelle und Prüfziffer; übernommen wird nur auf Klick */
function IbanSuggestionHint({ suggestion, onTake }: { suggestion: IbanSuggestion; onTake: () => void }) {
  return (
    <div id="iban-suggestion" className="small muted" style={{ overflowWrap: "anywhere" }}>
      Vorschlag vom Beleg: <span className="mono">{suggestion.iban.replace(/(.{4})/g, "$1 ").trim()}</span>,{" "}
      {suggestion.source === "e-rechnung" ? "aus der E-Rechnung (BT-84)" : "aus der KI-Auslesung"}
      {suggestion.fundstelle && <> („{suggestion.fundstelle}“)</>}.{" "}
      {suggestion.valid ? "Prüfziffer stimmt." : <strong style={{ color: "var(--danger-ink)" }}>Prüfziffer stimmt nicht.</strong>} Prüfe die IBAN beim
      Lieferanten, bevor du sie übernimmst.{" "}
      <button type="button" className="link-button" onClick={onTake}>
        IBAN übernehmen
      </button>
    </div>
  );
}
