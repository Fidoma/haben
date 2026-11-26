import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AMAZON_MARKETPLACES } from "@haben/core";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { errorMessage } from "../../lib/format.ts";
import { PURPOSE_SHORT } from "../../lib/kontozweck.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { importStatements, updateBankAccount } from "../../server/functions/bank.ts";
import { FormDialog } from "../../components/FormDialog.tsx";
import { Field } from "../../components/Field.tsx";
import { UploadButton } from "../../components/UploadButton.tsx";
import { ImportMeldungen, importMessages, type ImportMessage } from "../../components/BankImportMeldungen.tsx";
import type { FintsZustand } from "../../components/FintsAbruf.tsx";
import { NeuesKontoForm } from "./-bank-konto-neu.tsx";
import { type BankWeg, KontoVerbinden, type VerbindenDialog } from "./-bank-verbinden.tsx";
import { type Data, offenerEntwurf, suchziel } from "./-bank-daten.ts";

/** Name und Zweck eines Kontos im Dialog (#1951), etwa „Geschäftskonto“ und „Steuerkonto“ bei derselben Bank */
export function NameUndZweckDialog({
  account,
  purposes,
  ledger,
  onClose,
}: {
  account: Data["accounts"][number];
  purposes: Data["purposes"];
  ledger: string | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const updateFn = useServerFn(updateBankAccount);
  const [name, setName] = useState(account.name);
  const [purpose, setPurpose] = useState(account.purpose);
  const [marketplace, setMarketplace] = useState(account.marketplace ?? "");
  const { busy, notice, run } = useAction();
  const { form, error, check } = useSubmitCheck({ name: name.trim() === "" ? "Trag einen Namen ein." : null });

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
      await router.invalidate();
      onClose();
    });
  }

  return (
    <FormDialog open title="Name und Zweck" onClose={onClose}>
      <form ref={form} onSubmit={onSubmit} aria-label="Name und Zweck des Kontos" noValidate>
        <p className="small muted" style={{ margin: 0 }}>
          {PURPOSE_SHORT[account.purpose]} · {account.iban ? account.iban.replace(/(.{4})/g, "$1 ").trim() : `Verrechnungskonto ${ledger ?? ""}`}
        </p>
        <Field label="Name des Kontos" error={error("name")}>
          {(control) => <input {...control} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />}
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
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>
    </FormDialog>
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
      ? [
          {
            tone: "danger" as const,
            text: r.error,
            datei: r.zuordnen ? { file: files[i]!, aktion: "Spalten zuordnen" as const } : undefined,
            kontoWaehlen: r.kontoWaehlen ? files[i] : undefined,
          },
        ]
      : "added" in r
        ? importMessages(r, files[i])
        : [],
  );
}

/** Was Kopf und „Konto hinzufügen“ von der Seite brauchen */
type KopfDaten = Pick<Data, "accounts" | "providers" | "sync" | "fints" | "zahlungsdienstleister">;

const DATEIEN = ".csv,.xml,.txt,text/csv,application/xml,text/xml";

/**
 * Import von Kontoauszügen (#1951): „Datei importieren“ im Kopf nimmt das Konto aus der Datei (IBAN); nennt sie keins,
 * fragt die Meldung danach. „Datei importieren“ im Menü einer Karte importiert in dieses Konto (oeffnenFuer). Die Seite
 * stellt `meldungen` unter die Kartenleiste.
 */
export function useDateiImport(data: Pick<Data, "accounts" | "allAccounts" | "accountId">) {
  const router = useRouter();
  const importFiles = useServerFn(importStatements);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ImportMessage[]>([]);
  /** Konto für die nächste Wahl über das Menü einer Karte */
  const [ziel, setZiel] = useState<string | null>(null);
  const zielEingabe = useRef<HTMLInputElement>(null);

  async function importieren(files: File[], accountId: string | null) {
    if (files.length === 0) return;
    setBusy(true);
    setMessages([]);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      if (accountId) form.append("accountId", accountId);
      const results = await importFiles({ data: form });
      setMessages(importErgebnisse(results, files));
      await router.invalidate();
    } catch (error) {
      setMessages([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(false);
    }
  }

  // Das gewählte Konto steht in der Nachfrage zuerst
  const gewaehlt = data.allAccounts ? null : data.accountId;
  const alleKonten = [...data.accounts].sort((a, b) => Number(b.id === gewaehlt) - Number(a.id === gewaehlt)).map((a) => ({ id: a.id, name: a.name }));

  return {
    busy,
    setMessages,
    hatMeldungen: messages.length > 0,
    importieren,
    /** Dateiauswahl für ein bestimmtes Konto, aus dem Menü seiner Karte oder dem Hinweis „Veraltet“ */
    oeffnenFuer: (kontoId: string) => {
      setZiel(kontoId);
      zielEingabe.current?.click();
    },
    /** Knopf „Datei importieren“ im Kopf, mit seinem Eingabefeld */
    knopf: (
      <UploadButton multiple accept={DATEIEN} disabled={busy} inputLabel="Kontoauszugsdateien" onFiles={(files) => importieren(files, null)}>
        {busy ? "Importiere …" : "Datei importieren"}
      </UploadButton>
    ),
    /** Unsichtbares Eingabefeld für den Import in ein gewähltes Konto; kein Knopf, die Menüs öffnen es */
    zielFeld: (
      <input
        ref={zielEingabe}
        type="file"
        multiple
        accept={DATEIEN}
        className="visually-hidden"
        aria-label="Dateien für das gewählte Konto"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0 && ziel) void importieren(files, ziel);
        }}
      />
    ),
    meldungen: (
      <ImportMeldungen
        messages={messages}
        accounts={data.accounts.filter((a) => a.purpose !== "zahlungsdienstleister")}
        accountId={gewaehlt ?? ""}
        alleKonten={alleKonten}
        onKontoGewaehlt={(file, accountId) => void importieren([file], accountId)}
        onImported={(result, file) => {
          setMessages(importMessages(result, file));
          void router.invalidate();
        }}
      />
    ),
  };
}
export type DateiImport = ReturnType<typeof useDateiImport>;

/**
 * Kopf der Bankseite und der Seite Verbindungen: „Konto verbinden ▾“; Enable Banking und FinTS öffnet die Seite über
 * onBankWeg, „Kontoauszüge als Datei“ und „Konto ohne Abruf anlegen“ hier das Formular „Konto hinzufügen“. Ein neues Konto
 * wird danach gewählt (onCreated)
 */
export function KontoVerbindenKopf({
  data,
  fintsZustand,
  onBankWeg,
  onCreated,
  onMessage,
  davor,
  dialog,
  setDialog,
}: {
  data: KopfDaten;
  fintsZustand: Pick<FintsZustand, "offen" | "busy">;
  onBankWeg: (weg: Exclude<BankWeg, "datei">) => void;
  onCreated: (id: string) => void;
  onMessage: (messages: ImportMessage[]) => void;
  /** Knöpfe vor „Konto verbinden“, etwa „Datei importieren“ */
  davor?: ReactNode;
  dialog?: VerbindenDialog;
  setDialog?: (d: VerbindenDialog) => void;
}) {
  /** Formular „Konto hinzufügen“: über den Weg „Datei“ mit Hinweis auf den Import */
  const [showAccount, setShowAccount] = useState<"datei" | "ohne" | null>(null);
  return (
    <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
      <div className="actions">
        {davor}
        <KontoVerbinden
          data={data}
          fintsZustand={fintsZustand}
          onBankWeg={(weg) => (weg === "datei" ? setShowAccount("datei") : onBankWeg(weg))}
          onOhneAbruf={() => setShowAccount("ohne")}
          primary
          {...(setDialog ? { dialog, setDialog } : {})}
        />
      </div>
      {showAccount && (
        <NeuesKontoForm data={data} datei={showAccount === "datei"} onClose={() => setShowAccount(null)} onCreated={onCreated} onMessage={onMessage} />
      )}
    </div>
  );
}
