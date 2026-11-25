import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AMAZON_MARKETPLACES } from "@haben/core";
import { useEffect, useState, type FormEvent } from "react";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { errorMessage } from "../../lib/format.ts";
import { PURPOSE_SHORT } from "../../lib/kontozweck.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { importStatements, updateBankAccount } from "../../server/functions/bank.ts";
import { ExcludeAccountButton } from "../../components/BankKontoAusschliessen.tsx";
import { Field } from "../../components/Field.tsx";
import { UploadButton } from "../../components/UploadButton.tsx";
import { ImportMeldungen, importMessages, type ImportMessage } from "../../components/BankImportMeldungen.tsx";
import { NeuesKontoForm } from "./-bank-konto-neu.tsx";
import { type Data, offenerEntwurf, suchziel } from "./-bank-daten.ts";

/** Name und Zweck des gewählten Kontos, etwa „Geschäftskonto“ und „Steuerkonto“ bei derselben Bank */
export function AccountSettings({
  account,
  purposes,
  ledger,
  excludeBlockedBy,
}: {
  account: Data["accounts"][number];
  purposes: Data["purposes"];
  ledger: string | undefined;
  excludeBlockedBy: string | null;
}) {
  const router = useRouter();
  const navigate = useNavigate({ from: "/bank" });
  const updateFn = useServerFn(updateBankAccount);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [purpose, setPurpose] = useState(account.purpose);
  const [marketplace, setMarketplace] = useState(account.marketplace ?? "");
  const { busy, notice, run } = useAction();
  const { form, error, check } = useSubmitCheck({ name: name.trim() === "" ? "Trag einen Namen ein." : null });

  if (!editing) {
    return (
      <div className="small muted" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0 16px" }}>
        <span>
          {account.name} · {PURPOSE_SHORT[account.purpose]} ·{" "}
          {account.iban ? account.iban.replace(/(.{4})/g, "$1 ").trim() : `Verrechnungskonto ${ledger ?? ""}`}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          Name und Zweck
        </button>
        <ExcludeAccountButton account={account} blockedBy={excludeBlockedBy} />
      </div>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    void run(async () => {
      await updateFn({
        data: {
          id: account.id,
          name,
          purpose: purpose === "zahlungsdienstleister" ? undefined : purpose,
          marketplace: account.provider === "amazon" ? marketplace : undefined,
        },
      });
      // Konto fest in die Adresse: ohne „konto“ zeigt die Seite das alphabetisch erste, nach dem Umbenennen ein anderes
      await navigate({ search: (prev) => ({ ...prev, konto: account.id }), replace: true });
      await router.invalidate();
      setEditing(false);
    });
  }

  return (
    <form
      ref={form}
      onSubmit={onSubmit}
      className="stack"
      style={{ gap: 8, margin: "8px 0 16px", maxWidth: 480 }}
      aria-label="Name und Zweck des Kontos"
      noValidate
    >
      <Field label="Name des Kontos" error={error("name")}>
        {(control) => <input {...control} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />}
      </Field>
      {account.purpose !== "zahlungsdienstleister" && (
        <Field label="Zweck">
          {(control) => (
            <select {...control} value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
              {purposes.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {account.provider === "amazon" && (
        <Field label="Marktplatz">
          {(control) => (
            <select
              {...control}
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
              disabled={account.hasTransactions}
              aria-describedby="marktplatz-hinweis"
            >
              {AMAZON_MARKETPLACES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {account.provider === "amazon" && (
        <span className="small muted" id="marktplatz-hinweis">
          {account.hasTransactions
            ? "Der Marktplatz lässt sich nach dem ersten Import nicht mehr ändern, damit kein Report in das falsche Konto läuft."
            : "Jede Amazon-Abrechnung gehört zu ihrem Marktplatz; ein Report für einen anderen Marktplatz wird abgelehnt."}
        </span>
      )}
      <span className="small muted">
        Der Name ist nur Anzeige; Umsätze und Import über die IBAN bleiben, wie sie sind. Der Zweck steuert Vorschläge im Bankabgleich (Geldtransit zwischen
        eigenen Konten, Umsatzsteuer auf dem Steuerkonto, Privat beim Privatkonto), die IBAN für „Bankverbindung ändern“ beim Finanzamt und die Deckung der
        Zahllast in der Übersicht. Gebucht wird weiter auf das eine Bankkonto.
      </span>
      <NoticeBanner notice={notice} />
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setName(account.name);
            setPurpose(account.purpose);
            setMarketplace(account.marketplace ?? "");
            setEditing(false);
          }}
          disabled={busy}
        >
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
    </form>
  );
}

export function SearchBox({ initial }: { initial: string }) {
  const navigate = useNavigate({ from: "/bank" });
  const suche = useRouterState({ select: (state) => suchziel(state, initial) });
  const [entwurf, setEntwurf] = useState<string | null>(null);
  useEffect(() => {
    const offen = offenerEntwurf(entwurf, suche);
    if (offen === null) return setEntwurf(null);
    const timer = setTimeout(() => void navigate({ search: (prev) => ({ ...prev, suche: offen || undefined, umsatz: undefined }), replace: true }), 300);
    return () => clearTimeout(timer);
  }, [entwurf, suche, navigate]);
  return (
    <label className="search-box">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <span className="visually-hidden">Umsätze durchsuchen</span>
      <input type="search" placeholder="Suchen" value={entwurf ?? suche} onChange={(e) => setEntwurf(e.target.value)} />
    </label>
  );
}

/** Meldungen zu den hochgeladenen Kontoauszügen, je Datei */
function importErgebnisse(results: Awaited<ReturnType<typeof importStatements>>, files: File[]): ImportMessage[] {
  return results.flatMap((r, i) =>
    "error" in r && r.error
      ? [{ tone: "danger" as const, text: r.error, datei: r.zuordnen ? { file: files[i]!, aktion: "Spalten zuordnen" as const } : undefined }]
      : "added" in r
        ? importMessages(r, files[i])
        : [],
  );
}

export function ImportControls({ data }: { data: Data }) {
  const router = useRouter();
  const importFiles = useServerFn(importStatements);
  const [busy, setBusy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [targetAccount, setTargetAccount] = useState("");
  const [messages, setMessages] = useState<ImportMessage[]>([]);

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setMessages([]);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      if (targetAccount) form.append("accountId", targetAccount);
      const results = await importFiles({ data: form });
      setMessages(importErgebnisse(results, files));
      await router.invalidate();
    } catch (error) {
      setMessages([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
      <div className="actions">
        {data.accounts.length > 0 && (
          <Field label="Konto" className="field-inline">
            {(control) => (
              <select {...control} value={targetAccount} onChange={(e) => setTargetAccount(e.target.value)} style={{ minHeight: 44 }}>
                <option value="">aus der Datei</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <button type="button" className="btn" onClick={() => setShowAccount((v) => !v)} disabled={busy}>
          Konto hinzufügen
        </button>
        <UploadButton
          className="btn btn-primary"
          multiple
          accept=".csv,.xml,.txt,text/csv,application/xml,text/xml"
          disabled={busy}
          inputLabel="Kontoauszugsdateien"
          onFiles={onFiles}
        >
          {busy ? "Importiere …" : "CSV / CAMT importieren"}
        </UploadButton>
      </div>
      {showAccount && <NeuesKontoForm data={data} onClose={() => setShowAccount(false)} onCreated={setTargetAccount} onMessage={setMessages} />}
      <ImportMeldungen
        messages={messages}
        accounts={data.accounts.filter((a) => a.purpose !== "zahlungsdienstleister")}
        accountId={targetAccount}
        onImported={(result, file) => {
          setTargetAccount(result.accountId);
          setMessages(importMessages(result, file));
          void router.invalidate();
        }}
      />
    </div>
  );
}
