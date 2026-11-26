import { describe, expect, it } from "vitest";
import { mapFbContactPerson, mapFbCustomerDetails } from "./kunden.ts";

/*
 * Weitere Angaben der Kunden aus customer.get und ihre Ansprechpartner aus contact.get (#1939). Feldnamen nach der
 * API-Doku (https://apidocs.fastbill.com/fastbill/de/customer.html, contact.html); alle Werte erfunden.
 */

describe("mapFbCustomerDetails", () => {
  it("übernimmt Telefon, Leitweg-ID und DATEV-Debitor", () => {
    expect(mapFbCustomerDetails({ CUSTOMER_ID: "4", PHONE: "+49 941 123456", BUYER_REFERENCE: " 991-12345-67 ", CUSTOMER_ACCOUNT: "10004" })).toEqual({
      telefon: "+49 941 123456",
      leitwegId: "991-12345-67",
      debitorNr: 10_004,
      problems: {},
    });
  });

  it("nimmt ohne Telefon das Mobiltelefon und lässt leere Angaben leer", () => {
    expect(mapFbCustomerDetails({ CUSTOMER_ID: "5", PHONE: "", MOBILE: "0170 1234567" })).toEqual({
      telefon: "0170 1234567",
      leitwegId: "",
      debitorNr: null,
      problems: {},
    });
    expect(mapFbCustomerDetails({ CUSTOMER_ID: "6" })).toEqual({ telefon: "", leitwegId: "", debitorNr: null, problems: {} });
  });

  it("übernimmt nichts Ungültiges, sondern nennt es", () => {
    const d = mapFbCustomerDetails({ CUSTOMER_ID: "7", PHONE: "bitte anrufen", BUYER_REFERENCE: "9".repeat(47), CUSTOMER_ACCOUNT: "1400" });
    expect(d).toMatchObject({ telefon: "", leitwegId: "", debitorNr: null });
    expect(Object.keys(d.problems)).toHaveLength(3);
    expect(Object.values(d.problems).join(" ")).toMatch(/Telefon/);
    expect(Object.values(d.problems).join(" ")).toMatch(/Leitweg-ID/);
    expect(Object.values(d.problems).join(" ")).toMatch(/Debitor/);
  });

  it("CUSTOMER_ACCOUNT 0 heißt kein Debitor, wie 0 bei anderen IDs aus FastBill", () => {
    expect(mapFbCustomerDetails({ CUSTOMER_ID: "9", CUSTOMER_ACCOUNT: 0 })).toEqual({ telefon: "", leitwegId: "", debitorNr: null, problems: {} });
    expect(mapFbCustomerDetails({ CUSTOMER_ID: "9", CUSTOMER_ACCOUNT: "0" }).problems).toEqual({});
  });

  it("ist PHONE ungültig, nimmt es ein gültiges MOBILE und meldet nichts", () => {
    expect(mapFbCustomerDetails({ CUSTOMER_ID: "10", PHONE: "bitte anrufen", MOBILE: "0170 1234567" })).toMatchObject({
      telefon: "0170 1234567",
      problems: {},
    });
  });

  it("ein Debitor als Zahl wie im echten Konto", () => {
    expect(mapFbCustomerDetails({ CUSTOMER_ID: "8", CUSTOMER_ACCOUNT: 69_999 }).debitorNr).toBe(69_999);
  });
});

describe("mapFbContactPerson", () => {
  it("bildet Name, E-Mail, Telefon und Position als Funktion ab", () => {
    expect(
      mapFbContactPerson({
        CONTACT_ID: "31",
        CUSTOMER_ID: "4",
        SALUTATION: "Frau",
        FIRST_NAME: "Erika",
        LAST_NAME: "Muster",
        POSITION: "Buchhaltung",
        EMAIL: "buchhaltung@example.de",
        PHONE: "",
        MOBILE: "0170 7654321",
      }),
    ).toEqual({ customerId: "4", name: "Erika Muster", email: "buchhaltung@example.de", telefon: "0170 7654321", funktion: "Buchhaltung" });
  });

  it("lässt eine Person ohne Kunden oder ohne Namen aus und ein ungültiges Telefon weg", () => {
    expect(mapFbContactPerson({ CONTACT_ID: "32", CUSTOMER_ID: "0", FIRST_NAME: "Max", LAST_NAME: "Muster" })).toBeNull();
    expect(mapFbContactPerson({ CONTACT_ID: "33", CUSTOMER_ID: "4", FIRST_NAME: "", LAST_NAME: "" })).toBeNull();
    expect(mapFbContactPerson({ CONTACT_ID: "34", CUSTOMER_ID: "4", LAST_NAME: "Muster", PHONE: "abends" })).toMatchObject({ name: "Muster", telefon: "" });
    expect(mapFbContactPerson({ CONTACT_ID: "35", CUSTOMER_ID: "4", LAST_NAME: "Muster", PHONE: "abends", MOBILE: "0170 1" })).toMatchObject({
      telefon: "0170 1",
    });
    // Nur die Firma ohne Person ist kein Ansprechpartner
    expect(mapFbContactPerson({ CONTACT_ID: "36", CUSTOMER_ID: "4", ORGANIZATION: "Muster GmbH" })).toBeNull();
  });
});
