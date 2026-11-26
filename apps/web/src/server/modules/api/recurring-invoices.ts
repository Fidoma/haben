import { z } from "zod";
import { createRecurring, deleteRecurring, patchPausedRecurring, RecurringConflict, recurringInputSchema, recurringPatchSchema } from "../rechnungen/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { fail, noContent, notFound, ok, validate, type ApiRequest, type ApiResult } from "./http.ts";
import type { ApiRoute } from "./routes.ts";
import { requestSchemas, responseSchemas } from "./schemas.ts";

const recurringCreateSchema = recurringInputSchema
  .omit({ active: true, mode: true, sendByMail: true })
  .extend({
    format: recurringInputSchema.shape.format.optional(),
    paymentTermDays: recurringInputSchema.shape.paymentTermDays.optional(),
    note: recurringInputSchema.shape.note.default(""),
    taxTreatment: recurringInputSchema.shape.taxTreatment.optional(),
    exemptionReason: recurringInputSchema.shape.exemptionReason.default(""),
    endDate: recurringInputSchema.shape.endDate.default(null),
    servicePeriod: recurringInputSchema.shape.servicePeriod.default("laufend"),
  })
  .strict()
  .register(requestSchemas, { id: "RecurringInvoiceCreate" });

const recurringCreatedSchema = z.object({ id: z.uuid(), active: z.literal(false), url: z.url() }).register(responseSchemas, { id: "RecurringInvoiceCreated" });
recurringPatchSchema.register(requestSchemas, { id: "RecurringInvoicePatch" });
const recurringUpdatedSchema = recurringCreatedSchema.clone().register(responseSchemas, { id: "RecurringInvoiceUpdated" });
const NOT_FOUND = "Vorlage nicht gefunden.";

function pausedTemplateLink(baseUrl: string, id: string) {
  return { id, active: false as const, url: `${baseUrl}/rechnungen/wiederkehrend/${id}` };
}

async function createRecurringInvoiceHandler(request: ApiRequest): Promise<ApiResult> {
  const parsed = validate(recurringCreateSchema, request.body);
  if ("failure" in parsed) return parsed.failure;

  const { data } = parsed;
  const company = await loadCompany();
  const { id } = await createRecurring(request.actor, {
    ...data,
    format: data.format ?? company.defaultFormat,
    taxTreatment: data.taxTreatment ?? (company.kleinunternehmer ? "kleinunternehmer" : "regulaer"),
    paymentTermDays: data.paymentTermDays ?? company.paymentTermDays,
    active: false,
    mode: "entwurf",
    sendByMail: false,
  });
  const result = pausedTemplateLink(request.baseUrl, id) satisfies z.output<typeof recurringCreatedSchema>;
  return ok(result, 201, { Location: result.url });
}

async function updateRecurringInvoiceHandler(request: ApiRequest): Promise<ApiResult> {
  const parsed = validate(recurringPatchSchema, request.body);
  if ("failure" in parsed) return parsed.failure;
  try {
    const updated = await patchPausedRecurring(request.actor, request.params.id!, parsed.data);
    if (!updated) return notFound(NOT_FOUND);
    return ok(pausedTemplateLink(request.baseUrl, updated.id) satisfies z.output<typeof recurringUpdatedSchema>);
  } catch (error) {
    if (error instanceof RecurringConflict) return fail("conflict", error.message);
    throw error;
  }
}

async function deleteRecurringInvoiceHandler(request: ApiRequest): Promise<ApiResult> {
  try {
    return (await deleteRecurring(request.actor, request.params.id!)) ? noContent() : notFound(NOT_FOUND);
  } catch (error) {
    if (error instanceof RecurringConflict) return fail("conflict", error.message);
    throw error;
  }
}

export const RECURRING_INVOICE_ROUTES: ApiRoute[] = [
  {
    method: "POST",
    path: "/rechnungen/wiederkehrend",
    scope: "rechnungen:vorlagen-anlegen",
    tag: "Rechnungen",
    summary: "Vorlage für wiederkehrende Rechnungen anlegen",
    description: "Legt eine pausierte Vorlage im Entwurfsmodus an. Prüfung und Aktivierung erfolgen in Haben.",
    requestBody: "RecurringInvoiceCreate",
    responses: { 201: { schema: "RecurringInvoiceCreated", description: "Vorlage angelegt; Location führt zur Vorlage in Haben" } },
    handler: createRecurringInvoiceHandler,
  },
  {
    method: "PATCH",
    path: "/rechnungen/wiederkehrend/{id}",
    scope: "rechnungen:vorlagen-bearbeiten",
    tag: "Rechnungen",
    summary: "Pausierte Vorlage für wiederkehrende Rechnungen ändern",
    description:
      "Ändert die angegebenen Felder. lines ersetzt alle Positionen. Je nach Steuerbehandlung leitet Haben Preisart und Befreiungshinweis ab. Aktivierung, Ablaufmodus und E-Mail-Versand bleiben unverändert.",
    requestBody: "RecurringInvoicePatch",
    responses: { 200: { schema: "RecurringInvoiceUpdated", description: "Vorlage geändert; url führt zur Vorlage in Haben" } },
    errors: { 409: "Die Vorlage ist aktiv" },
    handler: updateRecurringInvoiceHandler,
  },
  {
    method: "DELETE",
    path: "/rechnungen/wiederkehrend/{id}",
    scope: "rechnungen:vorlagen-bearbeiten",
    tag: "Rechnungen",
    summary: "Vorlage für wiederkehrende Rechnungen löschen",
    description: "Löscht die Vorlage, wenn keine daraus erzeugte Rechnung und kein daraus erzeugter Entwurf vorhanden ist.",
    responses: { 204: { schema: null, description: "Gelöscht" } },
    errors: { 409: "Eine aus der Vorlage erzeugte Rechnung oder ein Entwurf ist vorhanden" },
    handler: deleteRecurringInvoiceHandler,
  },
];
