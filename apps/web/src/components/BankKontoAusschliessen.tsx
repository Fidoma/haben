import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "../lib/use-action.ts";
import { formatDate } from "../lib/format.ts";
import { excludeBankAccount, includeBankAccount } from "../server/functions/bank.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/**
 * Fremdes Bankkonto ausschließen (#462): ein Konto, das nicht zu dieser Firma gehört, etwa das Konto einer zweiten Firma
 * aus demselben Bankzugang. Es verschwindet aus Abgleich, Vorschlägen und Export und wird nicht mehr abgerufen; gelöscht
 * wird nichts. Geht nur, solange kein Umsatz zugeordnet oder verrechnet ist.
 */

const iban = (value: string | null) => (value ? value.replace(/(.{4})/g, "$1 ").trim() : "");

/** Rückfrage vor dem Ausschluss, aus `⋯` an der Zeile des Kontos auf der Seite Verbindungen (#1951) */
export function KontoAusschliessenDialog({ account, onClose }: { account: { id: string; name: string; iban: string | null }; onClose: () => void }) {
  const router = useRouter();
  const excludeFn = useServerFn(excludeBankAccount);
  const { run } = useAction();
  return (
    <ConfirmDialog
      open
      title={`Konto „${account.name}“ ausschließen?`}
      confirmLabel="Konto ausschließen"
      onConfirm={() => {
        void run(async () => {
          await excludeFn({ data: { id: account.id } });
          await router.invalidate();
        });
      }}
      onClose={onClose}
    >
      <p>
        {account.name}
        {account.iban ? ` (${iban(account.iban)})` : ""} gehört nicht zu dieser Firma, etwa weil es zum Konto einer zweiten Firma aus demselben Bankzugang
        gehört. Das Konto verschwindet aus Bankabgleich, Vorschlägen, Übersicht und Export und wird nicht mehr abgerufen. Ein Import in dieses Konto wird
        abgelehnt.
      </p>
      <p>
        Gelöscht wird nichts: Die Umsätze bleiben in der Datenbank, der Schritt steht im Änderungsprotokoll, und unter „Ausgeschlossene Konten“ nimmst du das
        Konto wieder auf.
      </p>
    </ConfirmDialog>
  );
}

export type ExcludedAccount = { id: string; name: string; iban: string | null; excludedAt: string | null; transactionCount: number };

/** Liste der ausgeschlossenen Konten zum Wiederaufnehmen; ohne ausgeschlossene Konten gibt es sie nicht */
export function ExcludedAccounts({ accounts }: { accounts: ExcludedAccount[] }) {
  const router = useRouter();
  const includeFn = useServerFn(includeBankAccount);
  const { busy, notice, run } = useAction();
  if (accounts.length === 0) return null;
  return (
    <section className="card" aria-labelledby="ausgeschlossene-konten">
      <h2 id="ausgeschlossene-konten">Ausgeschlossene Konten</h2>
      <p className="small muted" style={{ margin: "0 0 8px" }}>
        Diese Konten gehören nicht zu dieser Firma. Sie fehlen in Bankabgleich, Vorschlägen und Export und werden nicht abgerufen; ihre Umsätze sind weiter
        gespeichert.
      </p>
      <NoticeBanner notice={notice} />
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {accounts.map((account) => (
          <li
            key={account.id}
            className="table-row"
            style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
          >
            <span>
              {account.name}
              <span className="small muted">
                {" "}
                · {iban(account.iban)} · {account.transactionCount} {account.transactionCount === 1 ? "Umsatz" : "Umsätze"}
                {account.excludedAt ? ` · ausgeschlossen am ${formatDate(account.excludedAt)}` : ""}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await includeFn({ data: { id: account.id } });
                  await router.invalidate();
                })
              }
            >
              {`${account.name} wieder aufnehmen`}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
