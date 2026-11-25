import { inCents } from "@haben/core";
import { z } from "zod";
import { documentReferenceSchema, MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import { documentTaxShape } from "./document-tax-schema.ts";
import { CENTS, isoDate, page, pageQuery, requestSchemas, responseSchemas, timestamp } from "./schemas.ts";

/* Schemas der REST-API für Belege: Upload, Liste und Detail. Gemeinsame Bausteine kommen aus schemas.ts. */

const MB = MAX_DOCUMENT_SIZE / 1024 / 1024;

/** Formate wie beim Upload unter Belege; Haben erkennt sie am Inhalt, nicht am Namen oder am angegebenen Typ */
export const DOCUMENT_MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "application/xml", "text/xml"] as const;

/**
 * Neuer Beleg als multipart/form-data. Lieferant, Nummer, Datum und Beträge nimmt die API bewusst nicht an: Sie kommen
 * wie beim Upload in Haben aus der E-Rechnung oder der KI-Auslesung, die sie sonst überschriebe, und geprüft wird in Haben.
 */
export const documentUploadSchema = z
  .object({
    datei: z
      .file()
      .optional()
      .describe(`Der Beleg: PDF, JPEG, PNG, WebP, HEIC oder E-Rechnungs-XML (XRechnung, ZUGFeRD), höchstens ${MB} MB; statt dessen auch im Feld file`),
    // Paperless-ngx hängt die Datei in seiner Webhook-Aktion fest unter „file“ an (#104); eine Datei je Anfrage
    file: z.file().optional().describe("Wie datei, für Werkzeuge mit festem Feldnamen wie die Webhook-Aktion von Paperless-ngx; nur eines von beiden"),
    dateiname: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe(
        "Anzeigename des Belegs, wenn die Quelle ihn kennt und die Datei unter einem festen Namen schickt, etwa die Webhook-Aktion von Paperless-ngx mit „document.pdf“ (#1904); ohne Endung ergänzt Haben die des erkannten Dateityps, leer gilt der Name aus dem Upload",
      ),
    note: z.string().max(2000).optional().describe("Notiz am Beleg, z. B. woher er kommt"),
    externalSource: documentReferenceSchema.shape.externalSource
      .optional()
      .describe("Quelle des Belegs, z. B. archiv, scanner oder mail; nur zusammen mit externalId"),
    externalId: documentReferenceSchema.shape.externalId.optional().describe("Kennung des Dokuments in der Quelle; mit externalSource eindeutig"),
  })
  .strict()
  .refine((d) => d.datei !== undefined || d.file !== undefined, { message: "Die Datei fehlt: bitte im Feld datei (oder file) mitschicken.", path: ["datei"] })
  .refine((d) => d.datei === undefined || d.file === undefined, {
    message: "Eine Datei je Anfrage: bitte im Feld datei oder file, nicht beide.",
    path: ["file"],
  })
  .refine((d) => (d.externalSource === undefined) === (d.externalId === undefined), {
    message: "externalSource und externalId nur zusammen angeben",
    path: ["externalId"],
  })
  .register(requestSchemas, { id: "DocumentUpload" });

const documentSummaryShape = {
  id: z.uuid(),
  filename: z.string().describe("Anzeigename des Belegs, aus dem Upload oder dem Feld dateiname"),
  mimeType: z.string().describe("Erkannter Dateityp"),
  status: z.enum(["neu", "gebucht"]).describe("neu = „Zu prüfen“ in Haben; gebucht = geprüft, gebucht und unveränderlich"),
  booked: z.boolean().describe("Ob der Beleg gebucht ist"),
  extractionStatus: z
    .enum(["keine", "laeuft", "fertig", "fehler"])
    .describe("Auslesung der Felder: keine, läuft (KI im Hintergrund), fertig oder fehler (dann in Haben von Hand)"),
  supplierName: z.string().describe("Lieferant, leer bis ausgelesen oder eingetragen"),
  invoiceNumber: z.string(),
  documentDate: isoDate.nullable().describe("Belegdatum"),
  category: z.string().nullable().describe("Kategorie der Ausgabe, z. B. software"),
  currency: z.string(),
  gross: inCents(z.number().int()).describe(`Brutto in Euro; ${CENTS}`),
  externalSource: z.string().nullable(),
  externalId: z.string().nullable(),
  uploadedAt: timestamp,
  bookedAt: timestamp.nullable().describe("Zeitpunkt des Buchens"),
  cancelledOn: isoDate
    .nullable()
    .describe(
      "Storniert: Datum der Gegenbuchung, die die Buchung aufhebt (im noch nicht gemeldeten Zeitraum der Belegbuchung deren Datum, sonst der Tag des Stornos); der Beleg bleibt gebucht und unveränderlich",
    ),
  url: z.url().describe("Seite des Belegs in Haben, dort wird geprüft und gebucht"),
};

export const documentSummarySchema = z.object(documentSummaryShape).register(responseSchemas, { id: "DocumentSummary" });
export const documentListSchema = page(documentSummarySchema).register(responseSchemas, { id: "DocumentList" });

export const documentSchema = z
  .object({
    ...documentSummaryShape,
    size: z.number().int().describe("Größe in Bytes"),
    extractedBy: z.enum(["zugferd", "xrechnung", "ki", "manuell"]).nullable().describe("Woher die Felder stammen"),
    extractionError: z.string().nullable().describe("Hinweis oder Fehler der Auslesung"),
    supplierUstId: z.string(),
    dueDate: isoDate.nullable(),
    payment: z.enum(["bank", "privat", "kasse"]),
    note: z.string(),
    net: inCents(z.number().int()).describe(`Netto in Euro; ${CENTS}`),
    tax: inCents(z.number().int()).describe(`Steuer in Euro; ${CENTS}`),
    ...documentTaxShape,
    issues: z.array(z.string()).describe("Was vor dem Buchen noch fehlt; leer, wenn bereit oder gebucht"),
    replacedById: z.uuid().nullable().describe("Bei einem stornierten Beleg: der neu erfasste Beleg mit derselben Datei"),
    replacesId: z.uuid().nullable().describe("Bei einer Neuerfassung: der stornierte Beleg, den dieser ersetzt"),
    updatedAt: timestamp,
  })
  .register(responseSchemas, { id: "Document" });

export const documentQuerySchema = z
  .object({
    status: z.enum(["neu", "gebucht"]).optional().describe("neu = „Zu prüfen“, gebucht"),
    externalSource: z.string().trim().min(1).max(40).optional().describe("Nur Belege aus dieser Quelle"),
    externalId: z.string().trim().min(1).max(100).optional().describe("Mit externalSource: der Beleg zu diesem Dokument"),
    ...pageQuery,
  })
  .strict();
