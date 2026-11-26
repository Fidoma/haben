import { PAYMENT_METHODS, PRICE_MODES, RECURRENCE_KEYS, TAX_TREATMENT_KEYS } from "@haben/core";
import { z } from "zod";
import { draftLineSchema } from "./draft-line.ts";
import { outgoingTaxDetailsSchema } from "./tax-details.ts";

const isoDate = z.iso.date();

export const recurringInputSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung fehlt").max(200),
  active: z.boolean(),
  contactId: z.uuid(),
  format: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]),
  paymentTermDays: z.number().int().min(0).max(120),
  /** Einleitung über den Positionen; Platzhalter wie bei den Positionen */
  intro: z.string().max(2000).default(""),
  note: z.string().max(2000),
  propertyRetention: z.boolean().default(false),
  taxTreatment: z.enum(TAX_TREATMENT_KEYS),
  exemptionReason: z.string().trim().max(300),
  taxDetails: outgoingTaxDetailsSchema,
  /** Einzelpreise netto oder brutto inkl. USt */
  priceMode: z.enum(PRICE_MODES).default("netto"),
  lines: z.array(draftLineSchema).min(1, "Mindestens eine Position").max(200),
  /** Abstand als Dauer nach ISO 8601, etwa P1W oder P3M (#1691) */
  recurrence: z.enum(RECURRENCE_KEYS, { error: "Intervall nicht unterstützt." }),
  nextDate: isoDate,
  endDate: isoDate.nullable(),
  servicePeriod: z.enum(["laufend", "vorher", "keiner"]),
  mode: z.enum(["entwurf", "festschreiben"]),
  /** Nur mit festschreiben wirksam */
  sendByMail: z.boolean().default(false),
  /** Überweisung oder Lastschrift (#445); fehlt = Überweisung */
  paymentMethod: z.enum(PAYMENT_METHODS).default("ueberweisung"),
});

export type RecurringInput = z.input<typeof recurringInputSchema>;

export const recurringPatchSchema = recurringInputSchema
  .omit({ active: true, mode: true, sendByMail: true })
  .extend({
    intro: recurringInputSchema.shape.intro.removeDefault(),
    propertyRetention: recurringInputSchema.shape.propertyRetention.removeDefault(),
    taxDetails: recurringInputSchema.shape.taxDetails.removeDefault(),
    priceMode: recurringInputSchema.shape.priceMode.removeDefault(),
    paymentMethod: recurringInputSchema.shape.paymentMethod.removeDefault(),
  })
  .partial()
  .strict();
