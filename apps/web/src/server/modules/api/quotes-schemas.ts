import { inCents, QUOTE_LINE_KINDS, QUOTE_VALID_DAYS, type QuoteListStatus } from "@haben/core";
import { z } from "zod";
import { externalReferenceSchema, quoteDraftSchema } from "../rechnungen/index.ts";
import { CENTS, invoiceSchema, isoDate, lineInputSchema, optional, page, pageQuery, requestSchemas, responseSchemas, timestamp } from "./schemas.ts";

/*
 * Schemas der REST-API für Angebote (#297): lesen, Entwürfe anlegen und ändern. Positionen, Steuerangaben und Referenzen
 * beschreibt sie wie bei der Rechnung. Rabatte und Zahlungsplan setzt wie bei der Rechnung nur die Oberfläche; sie stecken
 * in net und gross, einzeln weist die API sie nicht aus.
 */

const invoiceFields = invoiceSchema.shape;
const quoteFields = quoteDraftSchema.shape;

// ── Eingaben ──────────────────────────────────────────────────────────────────

const quoteLineInputSchema = lineInputSchema
  .extend({
    kind: quoteFields.lines.element.shape.kind.describe(
      "optional = optionale Position, alternative = Alternative zur Hauptposition direkt darüber; beide zählen nicht zur Summe. Fehlt = normale Position",
    ),
  })
  .strict()
  .register(requestSchemas, { id: "QuoteLineInput" });

/**
 * Felder eines Entwurfs, die die API annimmt; Rabatte, Zahlungsplan und Ansprechpartner bleiben der Oberfläche vorbehalten.
 * Ohne die Vorgaben aus quoteDraftSchema (removeDefault): Beim Anlegen setzt der Server eigene (Textbausteine, Firmendaten,
 * Sprache des Kontakts), beim Ändern bleibt ein ungenanntes Feld stehen. Als default in der OpenAPI-Beschreibung stimmten sie
 * nicht, und ein Client, der sie mitschickt, setzte den Entwurf zurück.
 */
const quoteDraftApiFields = {
  contactId: quoteFields.contactId.describe("Kontakt aus /kontakte mit der Rolle Kunde; null = noch ohne Kunde"),
  issueDate: quoteFields.issueDate.describe("Angebotsdatum JJJJ-MM-TT, Vorgabe heute"),
  validUntil: quoteFields.validUntil.describe(`Gültig bis einschließlich, JJJJ-MM-TT; Vorgabe ${QUOTE_VALID_DAYS} Tage nach dem Angebotsdatum`),
  serviceFrom: quoteFields.serviceFrom,
  serviceTo: quoteFields.serviceTo,
  intro: quoteFields.intro.removeDefault().describe("Kopftext über den Positionen, Vorgabe: Standard-Kopftext für Angebote aus den Textbausteinen"),
  note: quoteFields.note.describe("Fußtext unter den Summen, Vorgabe: Standard-Fußtext für Angebote aus den Textbausteinen"),
  buyerOrderReference: quoteFields.buyerOrderReference
    .removeDefault()
    .describe("Bestellnummer des Kunden, geht in die Rechnung aus dem Angebot über; leer = keine"),
  sellerOrderReference: quoteFields.sellerOrderReference
    .removeDefault()
    .describe("Eigene Auftragsnummer, geht in die Rechnung aus dem Angebot über; leer = keine"),
  despatchAdviceReference: quoteFields.despatchAdviceReference
    .removeDefault()
    .describe("Lieferscheinnummer, geht in die Rechnung aus dem Angebot über; leer = keine"),
  taxTreatment: quoteFields.taxTreatment.removeDefault().describe("Umsatzsteuer des Angebots, Vorgabe aus den Firmendaten"),
  exemptionReason: quoteFields.exemptionReason.removeDefault(),
  // Die Beschreibung hängt an der Vorgabe; removeDefault gibt das Schema darunter zurück
  taxDetails: quoteFields.taxDetails.removeDefault().describe(quoteFields.taxDetails.description!),
  priceMode: quoteFields.priceMode.removeDefault().describe("Einzelpreise netto oder brutto inkl. USt, Vorgabe netto"),
  language: quoteFields.language.removeDefault().describe("Sprache des PDFs, Vorgabe die des Kontakts"),
  lines: z.array(quoteLineInputSchema).min(1, "Mindestens eine Position").max(200),
};

export const quoteDraftCreateSchema = z
  .object({
    ...optional(quoteDraftApiFields),
    lines: quoteDraftApiFields.lines,
    externalSource: externalReferenceSchema.shape.externalSource.optional().describe("Quellsystem, z. B. desk; nur zusammen mit externalId"),
    externalId: externalReferenceSchema.shape.externalId.optional().describe("Vorgangs-ID im Quellsystem; mit externalSource eindeutig"),
  })
  .strict()
  .refine(({ externalSource, externalId }) => (externalSource === undefined) === (externalId === undefined), {
    path: ["externalId"],
    message: "externalSource und externalId müssen gemeinsam angegeben werden.",
  })
  .register(requestSchemas, { id: "QuoteDraftCreate" });

/** Änderung eines Entwurfs: nur die genannten Felder; lines ersetzt alle Positionen */
export const quoteDraftPatchSchema = z.object(optional(quoteDraftApiFields)).strict().register(requestSchemas, { id: "QuoteDraftPatch" });

// ── Antworten ─────────────────────────────────────────────────────────────────

/** Stand wie in der Angebotsliste von Haben; satisfies hält die Liste beim Typ aus @haben/core (lebenszyklus.ts) */
const LIST_STATUS = ["entwurf", "offen", "abgelaufen", "angenommen", "abgelehnt", "abgerechnet"] as const satisfies readonly QuoteListStatus[];

const quoteSummaryShape = {
  id: z.uuid(),
  status: z.enum(["draft", "final"]).describe("draft = Entwurf, änderbar; final = festgeschrieben, unveränderlich"),
  listStatus: z
    .enum(LIST_STATUS)
    .describe(
      "Stand wie in der Angebotsliste von Haben; abgerechnet erst mit der nicht stornierten Rechnung über das ganze Angebot, nach Abschlägen bleibt es angenommen",
    ),
  number: z.string().nullable().describe("Angebotsnummer, erst ab dem Festschreiben"),
  contactId: z.uuid().nullable(),
  customer: z.string().describe("Name des Kunden"),
  issueDate: isoDate,
  validUntil: isoDate.describe("Gültig bis einschließlich"),
  net: inCents(z.number().int()).describe(`Ohne optionale und alternative Positionen; ${CENTS}`),
  gross: inCents(z.number().int()).describe(`Ohne optionale und alternative Positionen; ${CENTS}`),
  decision: z.enum(["angenommen", "abgelehnt"]).nullable().describe("Antwort des Kunden, in Haben eingetragen; null = noch keine"),
  invoiceId: z
    .uuid()
    .nullable()
    .describe("Nicht stornierte Rechnung über das ganze Angebot (Rechnung aus dem Angebot oder Schlussrechnung), auch als Entwurf; Abschlagsrechnungen nicht"),
  invoiceNumber: z.string().nullable().describe("Nummer dieser Rechnung; null, solange sie Entwurf ist"),
  url: z.url().describe("Seite des Angebots in Haben, dort wird festgeschrieben, versendet und abgerechnet"),
};

export const quoteSummarySchema = z.object(quoteSummaryShape).register(responseSchemas, { id: "QuoteSummary" });
export const quoteListSchema = page(quoteSummarySchema).register(responseSchemas, { id: "QuoteList" });

const quoteLineSchema = invoiceFields.lines.element.extend({
  kind: z.enum(QUOTE_LINE_KINDS).nullable().describe("optional oder alternative zur Hauptposition davor: zählt nicht zur Summe; null = normale Position"),
});

export const quoteSchema = z
  .object({
    ...quoteSummaryShape,
    externalSource: z.string().nullable().describe("Quellsystem der externen Referenz"),
    externalId: z.string().nullable().describe("Vorgangs-ID im Quellsystem"),
    serviceFrom: isoDate.nullable(),
    serviceTo: isoDate.nullable(),
    intro: z.string().describe("Kopftext über den Positionen"),
    note: z.string(),
    buyerOrderReference: invoiceFields.buyerOrderReference,
    sellerOrderReference: invoiceFields.sellerOrderReference,
    despatchAdviceReference: invoiceFields.despatchAdviceReference,
    language: invoiceFields.language,
    taxTreatment: invoiceFields.taxTreatment,
    exemptionReason: invoiceFields.exemptionReason,
    taxDetails: invoiceFields.taxDetails,
    priceMode: invoiceFields.priceMode,
    tax: inCents(z.number().int()).describe(CENTS),
    decidedAt: timestamp.nullable().describe("Zeitpunkt, zu dem die Antwort des Kunden eingetragen wurde"),
    lines: z.array(quoteLineSchema),
    choices: z
      .array(z.number().int())
      .describe("Vom Kunden gewählte optionale und alternative Positionen (position); Rechnung und Abschläge übernehmen nur diese"),
    createdAt: timestamp,
    updatedAt: timestamp,
    lockedAt: timestamp.nullable().describe("Zeitpunkt des Festschreibens"),
  })
  .register(responseSchemas, { id: "Quote" });

export const quoteQuerySchema = z
  .object({
    status: z.enum(["draft", "final"]).optional(),
    contactId: z.uuid().optional(),
    number: z.string().trim().min(1).max(40).optional().describe("Nur das Angebot mit dieser Nummer"),
    ...pageQuery,
  })
  .strict();
