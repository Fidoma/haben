import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "./database.ts";

type Query = Db | Tx;

/**
 * Optionale, nur lesende Referenzdaten des Hostsystems. Das PMS schreibt weder Kontakte noch Artikel und hält dafür
 * bewusst keine Datenbank-Fremdschlüssel. Änderungen an deren Aufbau bleiben auf diesen Adapter begrenzt.
 */
export function activeHostCustomers(q: Query = db) {
  return q
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      ort: schema.contacts.ort,
      kundennummer: schema.contacts.kundennummer,
      isCustomer: schema.contacts.isCustomer,
      ustId: schema.contacts.ustId,
    })
    .from(schema.contacts)
    .where(and(isNull(schema.contacts.archivedAt), eq(schema.contacts.isCustomer, true)))
    .orderBy(asc(schema.contacts.name));
}

export function activeHostArticles(q: Query = db) {
  return q
    .select({
      id: schema.articles.id,
      number: schema.articles.number,
      description: schema.articles.description,
      detail: schema.articles.detail,
      unit: schema.articles.unit,
      unitPrice: schema.articles.unitPrice,
      taxRate: schema.articles.taxRate,
      priceIncludesTax: schema.articles.priceIncludesTax,
    })
    .from(schema.articles)
    .where(isNull(schema.articles.archivedAt))
    .orderBy(asc(schema.articles.description));
}

export function hostContacts(ids: string[], q: Query = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return q
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      country: schema.contacts.land,
      archivedAt: schema.contacts.archivedAt,
      isCustomer: schema.contacts.isCustomer,
    })
    .from(schema.contacts)
    .where(inArray(schema.contacts.id, ids));
}

export function hostArticles(ids: string[], q: Query = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return q
    .select({
      id: schema.articles.id,
      number: schema.articles.number,
      description: schema.articles.description,
      detail: schema.articles.detail,
      unit: schema.articles.unit,
      unitPrice: schema.articles.unitPrice,
      taxRate: schema.articles.taxRate,
      priceIncludesTax: schema.articles.priceIncludesTax,
      archivedAt: schema.articles.archivedAt,
    })
    .from(schema.articles)
    .where(inArray(schema.articles.id, ids));
}
