import { ACCENT_PATTERN, DUNNING_LEVELS, numberFormatError, planTemplateSchema } from "@haben/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BEREICH_IDS } from "../../../lib/bereiche.ts";
import { schema, type Tx } from "../../db/index.ts";
import { geprueft, mitBezeichnung, UserError } from "../../errors.ts";
import { articleInputSchema, insertArticle } from "./articles.ts";
import { bankverbindungSchema } from "./bankverbindungen.ts";
import { setEinrichtung } from "./company.ts";
import { contactPersonInputSchema, insertContactPerson } from "./contact-persons.ts";
import { contactSchema, insertContact } from "./contacts.ts";
import { PLAN_TEMPLATES_MAX, planTemplatesProblem } from "./plan-templates.ts";
import { taxpayerSchema } from "./taxpayer.ts";
import { insertTextBlock, mahnstufeStandard, standardTexte, textBlockInputSchema } from "./text-blocks.ts";
import { insertUnit } from "./units.ts";

/*
 * Stammdaten aus der Einstellungsdatei einer anderen Instanz (#488) in der Transaktion des Aufrufers, mit denselben
 * Prüfungen wie die Formulare (insertContact, insertArticle, …). Dass die Instanz noch keine Stammdaten hat, prüft
 * modules/instanzwechsel vorher. Ein Fehler nennt den Eintrag und bricht die ganze Übernahme ab.
 */

export class UebernahmeError extends UserError {}

/** Zeitpunkt aus der Datei (archiviert, deaktiviert): gesetzt gilt, die neue Instanz trägt den Zeitpunkt der Übernahme ein */
const zeitpunkt = z.string().min(1).nullable();
const seitDerUebernahme = (wert: string | null): Date | null => (wert ? new Date() : null);

/** Bezeichnung eines Eintrags für die Meldung, ehe er geprüft ist */
export const genannt = (wert: unknown, feld: string): string => {
  const name = (wert as Record<string, unknown> | null)?.[feld];
  return typeof name === "string" && name.trim() ? `„${name.trim().slice(0, 80)}“` : "ohne Namen";
};

const firmaZusatzSchema = z.object({
  taxpayer: z.unknown(),
  paymentPlanTemplates: z.array(planTemplateSchema).max(PLAN_TEMPLATES_MAX),
  customerNumberFormat: z.string().trim().max(100),
  customerNumberNext: z.number().int().min(1).max(99_999_999),
  navColor: z.string().regex(ACCENT_PATTERN).nullable(),
  navLogo: z.boolean(),
  archiveSearch: z.boolean(),
});

/** Was zu den Firmendaten gehört, aber eigene Formulare hat: persönliche Angaben, Zahlungspläne, Kundennummern, Zeichen */
export async function firmaErgaenzen(tx: Tx, company: unknown): Promise<void> {
  const firma = geprueft(firmaZusatzSchema, company, "Firmendaten");
  const taxpayer = geprueft(taxpayerSchema, firma.taxpayer, "Persönliche Angaben");
  const planProblem = planTemplatesProblem(firma.paymentPlanTemplates);
  if (planProblem) throw new UebernahmeError(`Vorlagen für den Zahlungsplan: ${planProblem}.`);
  const formatProblem = firma.customerNumberFormat ? numberFormatError(firma.customerNumberFormat, { requireYear: false }) : null;
  if (formatProblem) throw new UebernahmeError(`Format der Kundennummer: ${formatProblem}`);
  await tx
    .update(schema.company)
    .set({
      taxpayer,
      paymentPlanTemplates: firma.paymentPlanTemplates,
      customerNumberFormat: firma.customerNumberFormat,
      customerNumberNext: firma.customerNumberNext,
      navColor: firma.navColor?.toUpperCase() ?? null,
      navLogo: firma.navLogo,
      archiveSearch: firma.archiveSearch,
      updatedAt: new Date(),
    })
    .where(eq(schema.company.id, 1));
}

const einrichtungSchema = z.object({
  ausgeblendeteBereiche: z.array(z.enum(BEREICH_IDS)).max(BEREICH_IDS.length),
  fragenAt: zeitpunkt,
  offen: z.array(z.enum(["rechtsform", "kleinunternehmer"])).max(2),
});

export async function einrichtungUebernehmen(tx: Tx, einrichtung: unknown): Promise<void> {
  const werte = geprueft(einrichtungSchema, einrichtung, "Fragen zur Einrichtung");
  await setEinrichtung(tx, {
    ausgeblendeteBereiche: [...new Set(werte.ausgeblendeteBereiche)].sort(),
    fragenAt: seitDerUebernahme(werte.fragenAt),
    offen: [...new Set(werte.offen)],
  });
}

const archiviert = z.object({ archivedAt: zeitpunkt });

export async function einheitenUebernehmen(tx: Tx, units: readonly unknown[]): Promise<void> {
  for (const raw of units) {
    const bezeichnung = `Einheit ${genannt(raw, "label")}`;
    const unit = geprueft(z.object({ label: z.string(), code: z.string() }).extend(archiviert.shape), raw, bezeichnung);
    const created = await mitBezeichnung(bezeichnung, () => insertUnit(tx, unit));
    if (unit.archivedAt) await tx.update(schema.units).set({ archivedAt: new Date() }).where(eq(schema.units.id, created.id));
  }
}

const herkunftSevdesk = z.object({ sevdeskId: z.string().max(100).nullable() });

export async function artikelUebernehmen(tx: Tx, articles: readonly unknown[]): Promise<void> {
  for (const raw of articles) {
    const bezeichnung = `Artikel ${genannt(raw, "description")}`;
    const input = geprueft(articleInputSchema, raw, bezeichnung);
    const { sevdeskId, archivedAt } = geprueft(herkunftSevdesk.extend(archiviert.shape), raw, bezeichnung);
    const created = await mitBezeichnung(bezeichnung, () => insertArticle(tx, input));
    if (sevdeskId || archivedAt) {
      await tx
        .update(schema.articles)
        .set({ sevdeskId, archivedAt: seitDerUebernahme(archivedAt) })
        .where(eq(schema.articles.id, created.id));
    }
  }
}

/** Weitere Zahlungskonten (#1887) mit ihrer ID aus der Datei, damit Kontakte sie als bevorzugtes Zahlungskonto finden */
export async function bankverbindungenUebernehmen(tx: Tx, rows: readonly unknown[]): Promise<void> {
  for (const raw of rows) {
    const bezeichnung = `Zahlungskonto ${genannt(raw, "bezeichnung")}`;
    const input = geprueft(bankverbindungSchema, raw, bezeichnung);
    const { id } = geprueft(z.object({ id: z.uuid() }), raw, bezeichnung);
    await mitBezeichnung(bezeichnung, () => tx.insert(schema.bankverbindungen).values({ ...input, id }));
  }
}

const kontaktZusatzSchema = z.object({
  id: z.uuid(),
  // Felder, die die Datenbank leer als null führt, das Formular als leeren Text
  kundennummer: z.string().nullable(),
  lieferantennummer: z.string().nullable(),
  lexofficeId: z.string().max(100).nullable(),
  sevdeskId: z.string().max(100).nullable(),
  fastbillId: z.string().max(100).nullable(),
  archivedAt: zeitpunkt,
});

/** Kontakte mit ihrer ID aus der Datei, damit Ansprechpartner und Textbausteine sie finden; danach die Ansprechpartner */
export async function kontakteUebernehmen(tx: Tx, actor: string, contacts: readonly unknown[], persons: readonly unknown[]): Promise<void> {
  for (const raw of contacts) {
    const bezeichnung = `Kontakt ${genannt(raw, "name")}`;
    const zusatz = geprueft(kontaktZusatzSchema, raw, bezeichnung);
    const input = geprueft(
      contactSchema,
      { ...(raw as object), kundennummer: zusatz.kundennummer ?? "", lieferantennummer: zusatz.lieferantennummer ?? "" },
      bezeichnung,
    );
    await mitBezeichnung(bezeichnung, () => insertContact(tx, input, { id: zusatz.id, vergeben: false }));
    const { lexofficeId, sevdeskId, fastbillId, archivedAt } = zusatz;
    if (lexofficeId || sevdeskId || fastbillId || archivedAt) {
      await tx
        .update(schema.contacts)
        .set({ lexofficeId, sevdeskId, fastbillId, archivedAt: seitDerUebernahme(archivedAt) })
        .where(eq(schema.contacts.id, zusatz.id));
    }
  }
  for (const raw of persons) {
    const bezeichnung = `Ansprechpartner ${genannt(raw, "name")}`;
    const { contactId, deactivatedAt } = geprueft(z.object({ contactId: z.uuid(), deactivatedAt: zeitpunkt }), raw, bezeichnung);
    const input = geprueft(contactPersonInputSchema, raw, bezeichnung);
    const id = await mitBezeichnung(bezeichnung, () => insertContactPerson(tx, actor, contactId, input));
    if (deactivatedAt) await tx.update(schema.contactPersons).set({ deactivatedAt: new Date() }).where(eq(schema.contactPersons.id, id));
  }
}

export async function textbausteineUebernehmen(tx: Tx, blocks: readonly unknown[]): Promise<void> {
  for (const raw of blocks.flatMap(alterMahnungsStandard)) {
    const bezeichnung = `Textbaustein ${genannt(raw, "name")}`;
    const input = geprueft(textBlockInputSchema, raw, bezeichnung);
    const { archivedAt } = geprueft(archiviert, raw, bezeichnung);
    const created = await mitBezeichnung(bezeichnung, () => insertTextBlock(tx, input, { uebernommen: true }));
    // Archiviert ist kein Standard mehr (#1494), wie bei setTextBlockArchived
    if (archivedAt) await tx.update(schema.textBlocks).set({ archivedAt: new Date(), standardFuer: null }).where(eq(schema.textBlocks.id, created.id));
  }
}

/**
 * Ein Standard „Mahnung“ aus einer Exportdatei der Version 2 (#1494) galt für jede Stufe. Wie in Migration 0317 wird er
 * Standard der 1. Mahnung, Zahlungserinnerung und letzte Mahnung bekommen je eine Kopie (#1678); archiviert ist er keiner
 */
/**
 * Höchstens `max` UTF-16-Einheiten wie textBlockInputSchema, ohne ein Emoji zu teilen; dieselbe Regel wie Migration 0317:
 * je Zeichen außerhalb der BMP ein Zeichen weniger
 */
function kuerzen(text: string, max: number): string {
  const zeichen = Array.from(text);
  return zeichen.slice(0, Math.max(max - zeichen.filter((z) => z.length > 1).length, 0)).join("");
}

function alterMahnungsStandard(raw: unknown): unknown[] {
  if (typeof raw !== "object" || raw === null || (raw as { standardFuer?: unknown }).standardFuer !== "mahnung") return [raw];
  const block = raw as { name?: unknown; archivedAt?: unknown };
  if (block.archivedAt) return [{ ...block, standardFuer: null }];
  const kopie = (level: 1 | 3) => {
    const zusatz = ` (${DUNNING_LEVELS[level].label})`;
    return { ...block, name: `${kuerzen(String(block.name ?? ""), 200 - zusatz.length)}${zusatz}`, standardFuer: mahnstufeStandard(level) };
  };
  return [{ ...block, standardFuer: mahnstufeStandard(2) }, kopie(1), kopie(3)];
}

/**
 * Eine Exportdatei von vor #1494 trägt die Standard-Einleitungen noch in den Firmendaten (invoiceIntro, quoteIntro):
 * Sie werden wie bei der Migration zu Kopftext-Bausteinen mit Standard, wenn die Datei dafür keinen Baustein mitbringt
 */
export async function alteStandardEinleitungen(tx: Tx, company: unknown): Promise<void> {
  const alt = z
    .object({ invoiceIntro: z.string().trim().max(2000).catch(""), quoteIntro: z.string().trim().max(2000).catch("") })
    .partial()
    .parse(company ?? {});
  const vorgaben = [
    { text: alt.invoiceIntro ?? "", standardFuer: "rechnung" as const, name: "Standard-Einleitung für Rechnungen" },
    { text: alt.quoteIntro ?? "", standardFuer: "angebot" as const, name: "Standard-Einleitung für Angebote" },
  ];
  for (const { text, standardFuer, name } of vorgaben) {
    if (!text || (await standardTexte(standardFuer, tx)).kopf) continue;
    await insertTextBlock(tx, { name, kind: "kopf", text, contactId: null, standardFuer }, { uebernommen: true });
  }
}
