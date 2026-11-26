import { PSP_FORMATS, type ParsedStatement } from "@haben/import";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { accountForIban, normalizeIban } from "./accounts.ts";
import { BankError, KontoWaehlenError } from "./bank-error.ts";

/**
 * Konto für einen Kontoauszug: das gewählte (passend zu IBAN und Art der Datei) oder, ohne Wahl, das zur IBAN der Datei;
 * fehlt es, wird es angelegt. Ein ausgeschlossenes Konto nimmt nichts an.
 */
export async function importAccount(tx: Tx, statement: ParsedStatement, filename: string, accountId: string | null) {
  let account: typeof schema.bankAccounts.$inferSelect | undefined;
  const fileIban = statement.accountIban ? normalizeIban(statement.accountIban) : null;
  if (accountId) {
    [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId));
    if (!account) throw new BankError("Konto nicht gefunden.");
    if (fileIban && fileIban !== account.iban) {
      throw new BankError(`Die Datei gehört zum Konto ${fileIban}, nicht zu ${account.name}.`);
    }
    // Export eines Zahlungsdienstleisters nur in dessen Konto, ein Kontoauszug nie dorthin
    const providerFile = PSP_FORMATS.includes(statement.format);
    if (providerFile !== (account.purpose === "zahlungsdienstleister")) {
      // Falsches Konto gewählt: Die Meldung auf der Bankseite fragt nach dem richtigen (#1951)
      throw new KontoWaehlenError(
        providerFile
          ? `${filename}: Das ist der Export eines Zahlungsdienstleisters. Wähle das Konto des Dienstleisters.`
          : `${filename}: ${account.name} ist ein Zahlungsdienstleister; dorthin gehört nur dessen Export.`,
      );
    }
  } else if (fileIban) {
    account = await accountForIban(tx, fileIban, statement.accountName);
  } else if (PSP_FORMATS.includes(statement.format)) {
    throw new KontoWaehlenError(`${filename}: Export eines Zahlungsdienstleisters. Wähle das Konto des Dienstleisters.`);
  } else {
    throw new KontoWaehlenError(`${filename}: Die Datei nennt keine IBAN. Wähle das Konto, zu dem sie gehört.`);
  }
  // Ein Konto, das nicht zu dieser Firma gehört (#462), nimmt nichts mehr an: weder eine Datei noch der Abruf
  if (account.excludedAt) {
    throw new BankError(`${filename}: Das Konto ${account.name} ist ausgeschlossen. Bitte erst unter „Ausgeschlossene Konten“ wieder aufnehmen.`);
  }
  // Marktplatzprüfung: eine Amazon-Abrechnung gehört nur in das Konto ihres Marktplatzes. Nennt die Datei einen
  // Marktplatz, muss er zum Konto passen; sonst wird nichts geschrieben, statt im falschen Verrechnungskonto zu landen.
  if (statement.marketplace) {
    if (!account.marketplace) {
      throw new BankError(`${filename}: Das Konto ${account.name} ist kein Amazon-Konto. Wähle das Amazon-Konto für ${statement.marketplace}.`);
    }
    if (account.marketplace.toLowerCase() !== statement.marketplace.toLowerCase()) {
      throw new BankError(
        `${filename}: Diese Abrechnung gehört zu ${statement.marketplace}; das Konto ${account.name} ist für ${account.marketplace} eingerichtet.`,
      );
    }
  } else if (statement.format === "amazon-settlement" && account.provider !== "amazon") {
    // Nennt die Abrechnung keinen Marktplatz (etwa nur Sonderzeilen ohne marketplace-name), darf sie trotzdem nicht in
    // ein fremdes Verrechnungskonto; sonst umginge ein solcher Report die Prüfung.
    throw new KontoWaehlenError(`${filename}: Das ist eine Amazon-Abrechnung. Wähle das Amazon-Konto.`);
  }
  return account;
}
