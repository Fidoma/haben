import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AMAZON_MARKETPLACES } from "@haben/core";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Field } from "../../components/Field.tsx";
import type { ImportMessage } from "../../components/BankImportMeldungen.tsx";
import { errorMessage } from "../../lib/format.ts";
import { addBankAccount, addProviderAccount } from "../../server/functions/bank.ts";
import { hatMarktplatzKonto, type Data } from "./-bank-daten.ts";

/**
 * Formular „Konto hinzufügen“: Bankkonto oder Zahlungsdienstleister, ohne Abruf; über „Bank hinzufügen › Kontoauszüge als
 * Datei“ (datei) mit dem Hinweis auf den Import. Für einen Marktplatz, für den es schon ein Amazon-
 * Konto gibt, fragt es vorher nach (zwei Verkäuferkonten am selben Marktplatz sind möglich, aber dann sieht die
 * Marktplatzprüfung beide als passend an).
 */
export function NeuesKontoForm({
  data,
  datei = false,
  onClose,
  onCreated,
  onMessage,
}: {
  data: Pick<Data, "accounts" | "providers">;
  datei?: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  onMessage: (messages: ImportMessage[]) => void;
}) {
  const router = useRouter();
  const addAccount = useServerFn(addBankAccount);
  const addProvider = useServerFn(addProviderAccount);
  const [accountType, setAccountType] = useState<"bank" | "provider">("bank");
  const [provider, setProvider] = useState("paypal");
  const [marketplace, setMarketplace] = useState("");
  const [busy, setBusy] = useState(false);
  /** Das Anlegen eines zweiten Kontos für denselben Marktplatz wartet auf die Rückfrage */
  const [pending, setPending] = useState<{ name: string; provider: string; marketplace?: string } | null>(null);

  /** Konto anlegen (Bank oder Zahlungsdienstleister), das Formular schließen und die Seite darauf umstellen */
  async function anlegen(p: { name: string; provider: string; marketplace?: string } | { name: string; iban: string }) {
    const { id } =
      "iban" in p
        ? await addAccount({ data: { name: p.name, iban: p.iban } })
        : await addProvider({ data: { name: p.name, provider: p.provider as "amazon", marketplace: p.marketplace } });
    onClose();
    onCreated(id);
    await router.invalidate();
    onMessage([{ tone: "ok", text: "Konto angelegt. Jetzt die Umsätze importieren." }]);
  }

  async function mitBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      onMessage([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(false);
    }
  }

  function onAddAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    if (accountType === "bank") {
      void mitBusy(() => anlegen({ name, iban: String(form.get("iban")) }));
      return;
    }
    const marketplaceWahl = provider === "amazon" ? String(form.get("marketplace")) : undefined;
    // Für denselben Marktplatz gibt es schon ein Konto: erst fragen, dann anlegen
    if (hatMarktplatzKonto(data.accounts, provider, marketplaceWahl)) {
      setPending({ name, provider, marketplace: marketplaceWahl });
      return;
    }
    void mitBusy(() => anlegen({ name, provider, marketplace: marketplaceWahl }));
  }

  return (
    <>
      <form className="card" onSubmit={onAddAccount} style={{ width: "100%", maxWidth: 420 }} aria-label="Konto hinzufügen">
        {datei && (
          <p className="small muted" style={{ margin: 0 }}>
            Danach importierst du die Kontoauszüge mit „CSV / CAMT importieren“. DKB-Dateien und CAMT nennen die IBAN; dafür legt der Import das Konto auch
            selbst an.
          </p>
        )}
        <Field label="Art">
          {(control) => (
            <select
              {...control}
              style={{ width: "100%", minWidth: 0 }}
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as "bank" | "provider")}
            >
              <option value="bank">Bankkonto (mit IBAN)</option>
              <option value="provider">Zahlungsdienstleister (PayPal, Stripe, Shopify …)</option>
            </select>
          )}
        </Field>
        {accountType === "provider" && (
          <DienstleisterFelder
            providers={data.providers}
            provider={provider}
            setProvider={setProvider}
            marketplace={marketplace}
            setMarketplace={setMarketplace}
          />
        )}
        <Field label="Name">
          {(control) => (
            <input
              {...control}
              style={{ width: "100%", minWidth: 0 }}
              name="name"
              required
              placeholder={accountType === "provider" ? "PayPal Geschäftskonto" : "N26 Business"}
            />
          )}
        </Field>
        {accountType === "bank" ? (
          <Field label="IBAN">{(control) => <input {...control} style={{ width: "100%", minWidth: 0 }} name="iban" required />}</Field>
        ) : (
          <span className="small muted">
            Bekommt ein eigenes Verrechnungskonto (SKR03 1361 …, SKR04 1461 …). Importiere den CSV-Export des Dienstleisters und wähle dabei dieses Konto unter
            „Konto“.
          </span>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Konto anlegen
          </button>
        </div>
      </form>
      <MarktplatzRueckfrage
        marketplace={pending?.marketplace}
        onConfirm={() => {
          const daten = pending;
          setPending(null);
          if (daten) void mitBusy(() => anlegen(daten));
        }}
        onClose={() => setPending(null)}
      />
    </>
  );
}

/** Anbieter und, bei Amazon, Marktplatz eines Kontos der Art Zahlungsdienstleister */
function DienstleisterFelder({
  providers,
  provider,
  setProvider,
  marketplace,
  setMarketplace,
}: {
  providers: Data["providers"];
  provider: string;
  setProvider: (p: string) => void;
  marketplace: string;
  setMarketplace: (m: string) => void;
}) {
  return (
    <>
      <Field label="Dienstleister">
        {(control) => (
          <select {...control} style={{ width: "100%", minWidth: 0 }} name="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {provider === "amazon" && (
        <Field label="Marktplatz">
          {(control) => (
            <select
              {...control}
              style={{ width: "100%", minWidth: 0 }}
              name="marketplace"
              required
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
            >
              <option value="" disabled>
                Marktplatz wählen
              </option>
              {AMAZON_MARKETPLACES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </>
  );
}

/** Rückfrage vor einem zweiten Konto für denselben Marktplatz */
function MarktplatzRueckfrage({ marketplace, onConfirm, onClose }: { marketplace: string | undefined; onConfirm: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={marketplace !== undefined}
      title={marketplace ? `Noch ein Konto für ${marketplace} anlegen?` : ""}
      confirmLabel="Konto trotzdem anlegen"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        Für {marketplace} gibt es schon ein Konto. Ein zweites ist möglich, etwa für ein zweites Verkäuferkonto am selben Marktplatz. Die Marktplatzprüfung
        sieht dann beide als passend an — beim Import wählst du selbst das richtige Konto.
      </p>
    </ConfirmDialog>
  );
}
