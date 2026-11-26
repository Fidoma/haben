import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { addExternalBankSource } from "../server/functions/bank-quellen.ts";
import { Field } from "./Field.tsx";
import { FormDialog } from "./FormDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/*
 * Externe Quelle am Konto (#306, Schritt 4): Ein Dienst außerhalb von Haben (etwa ein eigener eBay-Abgleich) liefert über
 * POST /api/v1/bankimporte nur in eine Quelle, die hier freigegeben ist. Auf der Seite Verbindungen (#1951) steht die
 * Quelle an der Zeile ihres Kontos; einen Konflikt klärt dort „Klären“, wie am Bankabruf.
 */

type Quelle = { provider: string; externalAccountId: string; cutoverDate: string | null; checkpoint: string | null; complete: boolean };

/** Stand einer externen Quelle in einer Zeile: Anbieter, Kennung, Stichtag und wie weit sie geliefert hat */
export function quelleText(quelle: Quelle): string {
  return [
    `${quelle.provider} · ${quelle.externalAccountId}`,
    quelle.cutoverDate ? ` · seit ${formatDate(quelle.cutoverDate)}` : "",
    ` · ${quelle.checkpoint ? `geliefert bis ${formatDate(quelle.checkpoint)}${quelle.complete ? "" : ", Zeitraum offen"}` : "noch keine Lieferung"}`,
  ].join("");
}

/** „Externe Quelle hinzufügen“ aus `⋯` an der Zeile eines Kontos ohne andere Quelle (#1951) */
export function QuelleFreigebenDialog({ account, onClose }: { account: { id: string; name: string }; onClose: () => void }) {
  return (
    <FormDialog open title="Externe Quelle hinzufügen" onClose={onClose}>
      <QuelleFreigeben account={account} onDone={onClose} />
    </FormDialog>
  );
}

function QuelleFreigeben({ account, onDone }: { account: { id: string; name: string }; onDone: () => void }) {
  const router = useRouter();
  const addFn = useServerFn(addExternalBankSource);
  const [provider, setProvider] = useState("");
  const [kennung, setKennung] = useState("");
  const [stichtag, setStichtag] = useState("");
  const { busy, notice, run } = useAction();
  const { form, error, check } = useSubmitCheck({
    provider: provider.trim() === "" ? "Trag den Anbieter ein, wie ihn der Dienst nennt." : null,
    kennung: kennung.trim() === "" ? "Trag die Kennung des Kontos beim Anbieter ein." : null,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    void run(async () => {
      await addFn({
        data: { accountId: account.id, provider: provider.trim(), externalAccountId: kennung.trim(), ...(stichtag ? { cutoverDate: stichtag } : {}) },
      });
      await router.invalidate();
      onDone();
    });
  }

  return (
    <form ref={form} onSubmit={onSubmit} noValidate>
      <p style={{ margin: 0 }}>
        Ein Dienst mit einem Token mit dem Recht <span className="mono">bank:importieren</span> darf danach Umsätze in {account.name} liefern. Haben ordnet
        nichts zu und bucht nichts; das machst du wie bei jedem Import im Bankabgleich.
      </p>
      <Field label="Anbieter" hint="So nennt der Dienst sich in jeder Lieferung (provider), z. B. haben-ebay" error={error("provider")}>
        {(control) => <input {...control} value={provider} onChange={(e) => setProvider(e.target.value)} required maxLength={50} autoFocus />}
      </Field>
      <Field label="Kennung des Kontos beim Anbieter" hint="externalAccountId in jeder Lieferung, z. B. der Name des Verkäuferkontos" error={error("kennung")}>
        {(control) => <input {...control} value={kennung} onChange={(e) => setKennung(e.target.value)} required maxLength={200} />}
      </Field>
      <Field label="Stichtag (optional)" hint="Erster Tag, den die Quelle liefert. Leer: der Tag nach dem letzten Umsatz des Kontos, ohne Umsatz heute.">
        {(control) => <input {...control} type="date" value={stichtag} onChange={(e) => setStichtag(e.target.value)} />}
      </Field>
      <NoticeBanner notice={notice} />
      <div className="actions">
        <button type="button" className="btn" onClick={onDone} disabled={busy}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Gebe frei …" : "Freigeben"}
        </button>
      </div>
    </form>
  );
}
