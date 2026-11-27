import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { amountError, evatrPruefbar, parseEuro, parsePersonenkonto } from "@haben/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { UstIdHinweis } from "./UstIdHinweis.tsx";
import { saveContact } from "../server/functions/contacts.ts";
import type { Contact, ContactInput } from "../server/modules/stammdaten/index.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { ContactBasics, ContactInvoices, ContactTax, type IbanSuggestion } from "./ContactFormTeile.tsx";
import { ContactWeitereAngaben, feldFehler, weitereAngabenFeld } from "./ContactWeitereAngaben.tsx";
import { parseSkontoRows, type SkontoRow, toSkontoRows } from "./SkontoFields.tsx";
import { useAction } from "../lib/use-action.ts";
import { ContactAddressFields } from "./ContactAddressFields.tsx";
import type { BankverbindungOption } from "./BankverbindungField.tsx";
import { useFokusNachSperre } from "../lib/use-fokus-nach-sperre.ts";

const EMPTY: ContactInput = {
  kundennummer: "",
  name: "",
  strasse: "",
  plz: "",
  ort: "",
  land: "DE",
  email: "",
  telefon: "",
  ustId: "",
  iban: "",
  leitwegId: "",
  unsereLieferantennummer: "",
  defaultFormat: null,
  language: "de",
  isCustomer: true,
  isSupplier: false,
  lieferantennummer: "",
};

/** Ein neu angelegter Kontakt, wie ihn ein Formular für seine Auswahl braucht */
export type SavedContact = ContactInput & { id: string };

const SAVED_NOTICE = { tone: "ok", text: "Gespeichert. Die vorige Fassung bleibt als Version erhalten." } as const;

/**
 * nextNumber: Kundennummer, die Haben beim Anlegen ohne eigene Nummer vergibt; null = keine automatische Vergabe.
 * Im Dialog eines anderen Formulars (Beleg, Rechnungsentwurf, #330): prefill füllt vor, onSaved bekommt den neuen
 * Kontakt statt der Weiterleitung, onCancel ersetzt den Link zurück. Bei gleicher USt-IdNr. weist der Server auf den
 * vorhandenen Kontakt hin (UstIdHinweis); onPickExisting bietet ihn zum Wählen an, ohne ihn still zusammenzuführen.
 */
export function ContactForm({
  contact,
  nextNumber = null,
  prefill,
  onSaved,
  onCancel,
  onPickExisting,
  ibanSuggestion = null,
  saved = false,
  onUpdated,
  bankverbindungen,
}: {
  contact: Contact | null;
  nextNumber?: string | null;
  prefill?: Partial<ContactInput>;
  onSaved?: (saved: SavedContact) => void;
  onCancel?: () => void;
  onPickExisting?: (id: string) => void;
  /** IBAN vom Beleg (#329): nur ein Vorschlag, ins Feld erst auf ausdrücklichen Klick */
  ibanSuggestion?: IbanSuggestion | null;
  /**
   * Gerade gespeichert: Die Seite baut das Formular mit der neuen Version neu auf (key), sein Zustand ginge dabei verloren.
   * Deshalb merkt sich die Seite das Speichern (onUpdated) und gibt es hier zurück, damit die Meldung stehen bleibt.
   */
  saved?: boolean;
  onUpdated?: () => void;
  /** Weitere Zahlungskonten (#1887) zur Auswahl des bevorzugten am Kontakt */
  bankverbindungen?: { liste: readonly BankverbindungOption[]; standardIban: string };
}) {
  const [ustId, setUstId] = useState(contact?.ustId ?? prefill?.ustId ?? "");
  // Skonto: null = Vorgabe aus den Einstellungen; eigene Stufen, leer = ohne Skonto
  const [ownSkonto, setOwnSkonto] = useState(contact?.skonto != null);
  const [skontoRows, setSkontoRows] = useState(() => toSkontoRows(contact?.skonto ?? []));
  const [weitereOffen, setWeitereOffen] = useState(false);
  const { busy, notice, form, onSubmit } = useKontaktSpeichern({ contact, onSaved, onUpdated, ownSkonto, skontoRows, setWeitereOffen });
  const initial = initialValues(contact, prefill);

  return (
    <form ref={form} className="card form-card contact-form" onSubmit={onSubmit} aria-label="Kontakt">
      {/* Gesperrt, solange gespeichert wird: Danach baut die Seite das Formular mit der neuen Version im `key` neu auf, und
          was man bis dahin tippt, ginge verloren (#1824) */}
      <fieldset className="fieldset-plain" disabled={busy}>
        <ContactBasics initial={initial} isNew={!contact} nextNumber={nextNumber} />
        <ContactAddressFields initial={initial} countryLabel={onSaved ? undefined : "Land (z. B. DE)"} />
        <ContactTax initial={initial} ustId={ustId} onUstId={setUstId} ibanSuggestion={ibanSuggestion} />
        <ContactInvoices initial={initial} />
        <ContactWeitereAngaben
          initial={initial}
          ownSkonto={ownSkonto}
          onOwnSkonto={setOwnSkonto}
          skontoRows={skontoRows}
          onSkontoRows={setSkontoRows}
          offen={weitereOffen}
          onOffen={setWeitereOffen}
          {...(bankverbindungen ? { bankverbindungen } : {})}
        />
      </fieldset>

      <UstIdHinweis
        ustId={ustId}
        {...(contact ? { excludeId: contact.id } : {})}
        wanted={{ isCustomer: prefill?.isCustomer ?? false, isSupplier: prefill?.isSupplier ?? false }}
        {...(onPickExisting ? { onPickExisting } : {})}
      />
      <NoticeBanner notice={notice ?? (saved ? SAVED_NOTICE : null)} />
      <div className="actions form-footer">
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
        ) : (
          <Link to="/kontakte" className="btn">
            Abbrechen
          </Link>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {contact ? "Speichern" : "Kontakt anlegen"}
        </button>
      </div>
    </form>
  );
}

/** Die Felder zu Beginn: der gespeicherte Kontakt oder, beim Anlegen, die Vorgaben aus prefill */
function initialValues(contact: Contact | null, prefill: Partial<ContactInput> | undefined): ContactInput {
  if (!contact) return { ...EMPTY, ...prefill };
  return {
    ...EMPTY,
    ...contact,
    kundennummer: contact.kundennummer ?? "",
    lieferantennummer: contact.lieferantennummer ?? "",
    defaultFormat: contact.defaultFormat,
  };
}

/**
 * Prüfen und Speichern des Kontaktformulars. Geprüft wird vor dem Sperren der Felder, damit der Fokus ein Feld mit Fehler
 * findet (DESIGN.md, Gesperrte Knöpfe). Ein Fehler an einem Feld in „Weitere Angaben“, vom Formular oder vom Server, klappt
 * den Bereich auf; der Fokus geht ins Feld, sobald es wieder frei ist. Nach dem Speichern lädt die Seite bis zum Ende neu,
 * damit die Felder bis zum Neuaufbau gesperrt bleiben.
 */
function useKontaktSpeichern({
  contact,
  onSaved,
  onUpdated,
  ownSkonto,
  skontoRows,
  setWeitereOffen,
}: {
  contact: Contact | null;
  onSaved: ((saved: SavedContact) => void) | undefined;
  onUpdated: (() => void) | undefined;
  ownSkonto: boolean;
  skontoRows: SkontoRow[];
  setWeitereOffen: (offen: boolean) => void;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveContact);
  const { busy, notice, setNotice, run } = useAction();
  const form = useRef<HTMLFormElement>(null);
  // Nach einem Fehler beim Speichern steht der Fokus wieder im gesperrten Feld
  useFokusNachSperre(busy);
  // Feld in „Weitere Angaben“ mit Fehler; gesperrt nimmt es den Fokus nicht an
  const [fehlerFeld, setFehlerFeld] = useState<string | null>(null);
  useEffect(() => {
    if (busy || !fehlerFeld) return;
    (form.current?.elements.namedItem(fehlerFeld) as HTMLElement | null)?.focus();
    setFehlerFeld(null);
  }, [busy, fehlerFeld]);

  function feldZeigen(error: unknown) {
    const feld = weitereAngabenFeld(error);
    if (!feld) return;
    setWeitereOffen(true);
    setFehlerFeld(feld);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const eingaben = kontaktEingaben(new FormData(event.currentTarget), ownSkonto, skontoRows);
    if (eingaben instanceof Error) {
      setNotice({ tone: "danger", text: eingaben.message });
      feldZeigen(eingaben);
      return;
    }
    void run(async () => {
      try {
        const result = await save({ data: { id: contact?.id ?? null, contact: eingaben } });
        if (onSaved) {
          onSaved({ ...eingaben, id: result.id });
        } else if (contact) {
          onUpdated?.();
          await router.invalidate({ sync: true });
        } else {
          await navigate({ to: "/kontakte/$id", params: { id: result.id }, search: evatrPruefbar(eingaben.ustId) ? { bestaetigen: true } : {} });
        }
      } catch (error) {
        feldZeigen(error);
        throw error;
      }
    });
  }

  return { busy, notice, form, onSubmit };
}

/** Die Eingaben des Formulars, wie sie gespeichert werden, oder der erste Fehler, den schon der Browser erkennt */
function kontaktEingaben(form: FormData, ownSkonto: boolean, skontoRows: SkontoRow[]): ContactInput | Error {
  const text = (name: keyof ContactInput) => String(form.get(name) ?? "").trim();
  const format = text("defaultFormat");
  const isCustomer = form.get("isCustomer") === "on";
  const isSupplier = form.get("isSupplier") === "on";
  const skonto = parseSkontoRows(skontoRows);
  const debitor = parsePersonenkonto("debitor", text("debitorNr"));
  const kreditor = parsePersonenkonto("kreditor", text("kreditorNr"));
  const rate = text("hourlyRateCents") === "" ? null : parseEuro(text("hourlyRateCents"));
  if (!isCustomer && !isSupplier) return new Error("Ein Kontakt ist Kunde oder Lieferant oder beides.");
  if (!debitor.ok) return feldFehler("debitorNr", debitor.error);
  if (!kreditor.ok) return feldFehler("kreditorNr", kreditor.error);
  if (text("hourlyRateCents") !== "" && (rate === null || rate < 0)) return feldFehler("hourlyRateCents", amountError("den Stundensatz", 9_500));
  if (ownSkonto && !skonto.valid) return feldFehler("skonto", "Skonto: je Stufe einen Satz (z. B. 2) und eine Frist in Tagen angeben.");
  return {
    ...textFields(text),
    defaultFormat: format ? (format as ContactInput["defaultFormat"]) : null,
    language: text("language") === "en" ? "en" : "de",
    skonto: ownSkonto ? skonto.stufen : null,
    isCustomer,
    isSupplier,
    debitorNr: debitor.value,
    kreditorNr: kreditor.value,
    hourlyRateCents: rate,
    // Ohne weitere Zahlungskonten steht das Feld nicht da; dann bleibt die Vorgabe, wie sie ist
    ...(form.has("bankverbindungId") ? { bankverbindungId: text("bankverbindungId") || null } : {}),
  } satisfies ContactInput;
}

/** Die Textfelder des Formulars, wie sie gespeichert werden: USt-IdNr. und IBAN ohne Leerzeichen, Land in Großbuchstaben */
function textFields(text: (name: keyof ContactInput) => string) {
  return {
    kundennummer: text("kundennummer"),
    name: text("name"),
    strasse: text("strasse"),
    plz: text("plz"),
    ort: text("ort"),
    land: text("land").toUpperCase() || "DE",
    email: text("email"),
    telefon: text("telefon"),
    ustId: text("ustId").replace(/\s/g, "").toUpperCase(),
    iban: text("iban").replace(/\s/g, "").toUpperCase(),
    leitwegId: text("leitwegId"),
    unsereLieferantennummer: text("unsereLieferantennummer"),
    lieferantennummer: text("lieferantennummer"),
  };
}
