import { ASSET_KIND_KEYS, ASSET_METHOD_KEYS, CAR_DRIVE_KEYS, inBasisPoints, inCents } from "@haben/core";
import { z } from "zod";

const isoDate = z.iso.date();

/**
 * Anlage aus der Vorgänger-Buchhaltung übernehmen (z. B. aus dem Anlagenverzeichnis von Lexoffice).
 * Neue Anschaffungen entstehen beim Buchen eines Belegs mit Kategorie „Anlagegut“.
 */
export const assetInputSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung fehlt").max(200),
  kind: z.enum(ASSET_KIND_KEYS),
  method: z.enum(ASSET_METHOD_KEYS),
  acquisitionDate: isoDate,
  cost: inCents(z.number().int().min(1).max(100_000_000_00)),
  usefulLifeMonths: z.number().int().min(1).max(600).nullable(),
  /** Nur bei degressiv: Satz in Basispunkten; ohne Angabe der Höchstsatz */
  degressiveRate: inBasisPoints(z.number().int().min(1).max(3000)).nullable().default(null),
  /** Nur bei degressiv: ab diesem Jahr linear (§ 7 Abs. 3 EStG) */
  linearFromYear: z.number().int().min(2000).max(2200).nullable().default(null),
  /** Erinnerungswert von 1 € bis zum Abgang */
  memoValue: z.boolean().default(false),
  openingDate: isoDate,
  openingBookValue: inCents(z.number().int().min(0).max(100_000_000_00)),
  disposalDate: isoDate.nullable(),
  /** Nur bei Fahrzeugen: private Nutzung nach der Listenpreismethode */
  privateUse: z
    .object({
      listPrice: inCents(z.number().int().min(100).max(100_000_000_00)),
      drive: z.enum(CAR_DRIVE_KEYS),
      rate: inBasisPoints(z.union([z.literal(100), z.literal(50), z.literal(25)])),
      vat: z.boolean(),
    })
    .nullable()
    .default(null),
  note: z.string().max(2000),
});

export type AssetInput = z.input<typeof assetInputSchema>;

/** Was an einer Anlage nach der Anlage noch geändert werden darf */
export const assetUpdateSchema = assetInputSchema.partial().extend({
  name: z.string().trim().min(1).max(200),
  // Ohne Vorgabe, damit eine Änderung ohne diese Felder sie nicht zurücksetzt
  degressiveRate: inBasisPoints(z.number().int().min(1).max(3000)).nullable().optional(),
  linearFromYear: z.number().int().min(2000).max(2200).nullable().optional(),
  memoValue: z.boolean().optional(),
  specialDepreciation: z
    .array(
      z.object({
        year: z.number().int().min(2000).max(2200),
        amount: inCents(z.number().int().positive().max(100_000_000_00)),
      }),
    )
    .max(5)
    .optional(),
});
