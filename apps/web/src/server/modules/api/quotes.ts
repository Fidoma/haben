import type { z } from "zod";
import {
  createQuoteDraft,
  deleteQuoteDraft,
  findQuoteIdByReference,
  getQuote,
  listQuotes,
  newQuoteDefaults,
  quoteDraftInputOf,
  quoteDraftSchema,
  updateQuoteDraft,
} from "../rechnungen/index.ts";
import { getContact } from "../stammdaten/index.ts";
import { isUniqueViolation } from "../../errors.ts";
import { fail, noContent, notFound, ok, validate, type ApiRequest, type ApiResult, type Issue } from "./http.ts";
import { contactProblem } from "./invoices.ts";
import { quoteDraftCreateSchema, quoteDraftPatchSchema, quoteQuerySchema, type quoteSchema, type quoteSummarySchema } from "./quotes-schemas.ts";

/*
 * Angebote über die REST-API (#297): alle lesen, Entwürfe anlegen, ändern und löschen. Festschreiben, Versenden, die
 * Antwort des Kunden und die Rechnung aus dem Angebot bleiben ein Klick in Haben, auf den `url` in jeder Antwort zeigt.
 */

type ListRow = Awaited<ReturnType<typeof listQuotes>>[number];
type Detail = NonNullable<Awaited<ReturnType<typeof getQuote>>>;

const QUOTE_NOT_FOUND = "Angebot nicht gefunden.";
const LOCKED = "Das Angebot ist festgeschrieben und kann über die API nicht geändert oder gelöscht werden.";

function summaryOut(row: ListRow, baseUrl: string): z.output<typeof quoteSummarySchema> {
  return {
    id: row.id,
    status: row.status,
    listStatus: row.listStatus,
    number: row.number,
    contactId: row.contactId,
    customer: row.customer,
    issueDate: row.issueDate,
    validUntil: row.validUntil,
    net: row.net,
    gross: row.gross,
    decision: row.decision,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    url: `${baseUrl}/angebote/${row.id}`,
  };
}

function quoteOut(row: ListRow, { quote, lines, choices }: Detail, baseUrl: string): z.output<typeof quoteSchema> {
  return {
    ...summaryOut(row, baseUrl),
    externalSource: quote.externalSource,
    externalId: quote.externalId,
    serviceFrom: quote.serviceFrom,
    serviceTo: quote.serviceTo,
    intro: quote.intro,
    note: quote.note,
    buyerOrderReference: quote.buyerOrderReference,
    sellerOrderReference: quote.sellerOrderReference,
    despatchAdviceReference: quote.despatchAdviceReference,
    language: quote.language,
    taxTreatment: quote.taxTreatment,
    exemptionReason: quote.exemptionReason,
    taxDetails: quote.taxDetails,
    priceMode: quote.priceMode,
    tax: quote.tax,
    decidedAt: quote.decidedAt?.toISOString() ?? null,
    lines: lines.map(({ position, description, detail, itemNumber, quantity, unit, unitPrice, taxRate, net, kind, arbeitskosten }) => ({
      position,
      description,
      detail,
      itemNumber,
      quantity,
      unit,
      unitPrice,
      taxRate,
      net,
      kind,
      arbeitskosten,
    })),
    choices,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    lockedAt: quote.lockedAt?.toISOString() ?? null,
  };
}

async function respondWith(id: string, request: ApiRequest, status = 200, headers: Record<string, string> = {}): Promise<ApiResult> {
  const [detail, [row]] = await Promise.all([getQuote(id), listQuotes(request.today, id)]);
  if (!detail || !row) return notFound(QUOTE_NOT_FOUND);
  return ok(quoteOut(row, detail, request.baseUrl), status, headers);
}

export async function listQuotesHandler(request: ApiRequest): Promise<ApiResult> {
  const query = validate(quoteQuerySchema, request.query);
  if ("failure" in query) return query.failure;
  const { status, number, limit, offset } = query.data;
  // Zod nimmt die UUID auch in Großbuchstaben an, Postgres liefert sie klein; Pfad-IDs schreibt der Router ebenso klein
  const contactId = query.data.contactId?.toLowerCase();
  const rows = (await listQuotes(request.today)).filter(
    (row) => (!status || row.status === status) && (!contactId || row.contactId === contactId) && (!number || row.number === number),
  );
  return ok({ data: rows.slice(offset, offset + limit).map((row) => summaryOut(row, request.baseUrl)), total: rows.length, limit, offset });
}

export async function getQuoteHandler(request: ApiRequest): Promise<ApiResult> {
  return respondWith(request.params.id!, request);
}

/**
 * Neuer Entwurf mit den Vorgaben der Oberfläche: gültig ab dem Angebotsdatum so lange wie ein neues Angebot in Haben,
 * Standard-Textbausteine, Steuer aus den Firmendaten, Sprache des Kunden; die Standardanhänge hängt createQuoteDraft an.
 * Eine optionale externe Referenz macht Wiederholungen nach einem Verbindungsabbruch sicher.
 */
export async function createQuoteHandler(request: ApiRequest): Promise<ApiResult> {
  const shape = validate(quoteDraftCreateSchema, request.body);
  if ("failure" in shape) return shape.failure;
  const { externalSource, externalId } = shape.data;
  const reference = externalSource !== undefined && externalId !== undefined ? { externalSource, externalId } : undefined;
  const existing = reference && (await findQuoteIdByReference(reference));
  if (existing) return respondWith(existing, request, 200, { Location: `/api/v1/angebote/${existing}` });
  const problem = await contactProblem(shape.data.contactId);
  if (problem) return problem;
  const contact = shape.data.contactId ? (await getContact(shape.data.contactId))?.contact : undefined;
  const defaults = await newQuoteDefaults(shape.data.issueDate ?? request.today);
  const merged = { ...defaults, ...(contact ? { language: contact.language } : {}), ...(request.body as Record<string, unknown>) };
  const input = validate(quoteDraftSchema, merged);
  if ("failure" in input) return input.failure;
  try {
    const quote = await createQuoteDraft(request.actor, input.data, reference);
    return respondWith(quote.id, request, 201, { Location: `/api/v1/angebote/${quote.id}` });
  } catch (error) {
    // Der eindeutige Index entscheidet bei gleichzeitigen Anforderungen für dieselbe Referenz.
    if (!reference || !isUniqueViolation(error, "quotes_external_ref")) throw error;
    const winner = await findQuoteIdByReference(reference);
    if (!winner) throw error;
    return respondWith(winner, request, 200, { Location: `/api/v1/angebote/${winner}` });
  }
}

/** Setzt nur Haben; die API nimmt sie nicht an */
const UI_ONLY_FIELDS = ["discount", "paymentPlan"];

/**
 * Prüft den Entwurf nach einem PATCH. Scheitert er allein an Gesamtrabatt oder Zahlungsplan aus Haben, etwa weil die neuen
 * Positionen weniger ergeben, kann der Client das nicht beheben: ein Konflikt mit dem gespeicherten Stand (409), keine
 * ungültige Eingabe (400).
 */
function validatePatched(merged: Record<string, unknown>) {
  const input = validate(quoteDraftSchema, merged);
  if (!("failure" in input)) return input;
  const issues = (input.failure.body as { error: { issues?: Issue[] } }).error.issues ?? [];
  const uiOnly = issues.filter((issue) => UI_ONLY_FIELDS.some((field) => issue.path === field || issue.path.startsWith(`${field}.`)));
  if (uiOnly.length === 0 || uiOnly.length < issues.length) return input;
  const reasons = uiOnly.map((issue) => issue.message).join("; ");
  return {
    failure: fail("conflict", `Gesamtrabatt oder Zahlungsplan passen nicht zu den Positionen (${reasons}); sie lassen sich nur in Haben ändern.`, {
      issues: uiOnly,
    }),
  };
}

/** Ändert nur die genannten Felder eines Entwurfs; lines ersetzt alle Positionen, Gesamtrabatt und Zahlungsplan bleiben */
export async function updateQuoteHandler(request: ApiRequest): Promise<ApiResult> {
  const shape = validate(quoteDraftPatchSchema, request.body);
  if ("failure" in shape) return shape.failure;
  const found = await getQuote(request.params.id!);
  if (!found) return notFound(QUOTE_NOT_FOUND);
  const { quote, lines } = found;
  if (quote.status !== "draft") return fail("conflict", LOCKED);
  const body = { ...(request.body as Record<string, unknown>) };
  // Zod nimmt die UUID auch in Großbuchstaben an, Postgres liefert sie klein; so ist derselbe Kunde kein Wechsel
  if (typeof body.contactId === "string") body.contactId = body.contactId.toLowerCase();
  const merged = { ...quoteDraftInputOf(quote, lines), ...body };
  // Ein Ansprechpartner gehört zu genau einem Kunden (#424): Wechselt der Kunde, entfällt die Person, die jemand in Haben gewählt hat
  // Ebenso die Bankverbindung (#1887): Ohne Angabe gilt dann die Vorgabe des neuen Kunden (bankverbindungFuerEntwurf)
  if ("contactId" in body && body.contactId !== quote.contactId) Object.assign(merged, { contactPersonId: null, bankverbindungId: undefined });
  const input = validatePatched(merged);
  if ("failure" in input) return input.failure;
  const problem = await contactProblem(input.data.contactId);
  if (problem) return problem;
  await updateQuoteDraft(request.actor, quote.id, input.data);
  return respondWith(quote.id, request);
}

export async function deleteQuoteHandler(request: ApiRequest): Promise<ApiResult> {
  const found = await getQuote(request.params.id!);
  if (!found) return notFound(QUOTE_NOT_FOUND);
  if (found.quote.status !== "draft") return fail("conflict", LOCKED);
  await deleteQuoteDraft(request.actor, found.quote.id);
  return noContent();
}
