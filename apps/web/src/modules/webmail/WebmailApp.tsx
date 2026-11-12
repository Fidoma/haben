import { LinkProvider, Toasty, TooltipProvider } from "@cloudflare/kumo";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from "react-router";
import { Field } from "../../components/Field.tsx";
import { saveWebmailAccountFn, testWebmailAccountFn } from "../../server/functions/webmail.ts";
import MailboxRoute from "../../../vendor/rotomail/app/routes/mailbox.tsx";
import EmailListRoute from "../../../vendor/rotomail/app/routes/email-list.tsx";
import SearchResultsRoute from "../../../vendor/rotomail/app/routes/search-results.tsx";
import SettingsRoute from "../../../vendor/rotomail/app/routes/settings.tsx";
import "../../../vendor/rotomail/app/index.css";

interface AccountSummary {
  id: string;
  email: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
}

interface Proposal {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  email: string;
}

const KumoLink = forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }>(function KumoLink({ href, ...props }, ref) {
  return href && !href.startsWith("http") ? <Link to={href} ref={ref} {...props} /> : <a href={href} ref={ref} {...props} />;
});

function MailProviders({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
        mutationCache: new MutationCache({ onError: () => undefined }),
      }),
    [],
  );
  return (
    <QueryClientProvider client={client}>
      <LinkProvider component={KumoLink}>
        <TooltipProvider>
          <Toasty>{children}</Toasty>
        </TooltipProvider>
      </LinkProvider>
    </QueryClientProvider>
  );
}

function AccountStart({ accounts, onAdd, onEdit }: { accounts: AccountSummary[]; onAdd: () => void; onEdit: (account: AccountSummary) => void }) {
  return (
    <div className="webmail-start">
      <div className="page-head">
        <div>
          <div className="eyebrow">Externe Dienste</div>
          <h1>Web-Mail</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={onAdd}>
          Konto hinzufügen
        </button>
      </div>
      <div className="card">
        <h2>E-Mail-Konten</h2>
        <div className="webmail-account-list">
          {accounts.map((account) => (
            <div key={account.id} className="webmail-account-row">
              <Link className="webmail-account" to={`/mailbox/${encodeURIComponent(account.email)}/emails/inbox`}>
                <strong>{account.displayName || account.email}</strong>
                <span>{account.email}</span>
              </Link>
              <button type="button" className="btn btn-sm" onClick={() => onEdit(account)}>
                Einrichten
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Setup({
  proposal,
  account,
  onSaved,
  onCancel,
}: {
  proposal: Proposal | null;
  account: AccountSummary | null;
  onSaved: (account: AccountSummary) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState({
    id: account?.id,
    email: account?.email ?? proposal?.email ?? "",
    displayName: account?.displayName ?? "",
    imapHost: account?.imapHost ?? "",
    imapPort: account?.imapPort ?? 993,
    imapSecure: account?.imapSecure ?? true,
    imapUsername: account?.imapUsername ?? proposal?.username ?? "",
    imapPassword: "",
    smtpHost: account?.smtpHost ?? proposal?.host ?? "",
    smtpPort: account?.smtpPort ?? proposal?.port ?? 587,
    smtpSecure: account?.smtpSecure ?? proposal?.secure ?? false,
    smtpUsername: account?.smtpUsername ?? proposal?.username ?? "",
    smtpPassword: "",
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (name: keyof typeof form, value: string | number | boolean) => setForm((current) => ({ ...current, [name]: value }));

  async function test() {
    setBusy(true);
    setMessage("");
    try {
      await testWebmailAccountFn({ data: form });
      setMessage("IMAP- und SMTP-Verbindung funktionieren.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Verbindung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await saveWebmailAccountFn({ data: form });
      onSaved({
        id: result.id,
        email: form.email,
        displayName: form.displayName,
        imapHost: form.imapHost,
        imapPort: form.imapPort,
        imapSecure: form.imapSecure,
        imapUsername: form.imapUsername,
        smtpHost: form.smtpHost,
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUsername: form.smtpUsername,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Konto konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    (name: keyof typeof form, type = "text") =>
    (control: Parameters<Parameters<typeof Field>[0]["children"]>[0]) => (
      <input
        {...control}
        type={type}
        value={String(form[name])}
        onChange={(event) => set(name, type === "number" ? Number(event.target.value) : event.target.value)}
        autoComplete={type === "password" ? "new-password" : undefined}
      />
    );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Externe Dienste</div>
          <h1>Web-Mail einrichten</h1>
        </div>
      </div>
      <form className="card webmail-setup" onSubmit={save}>
        <p className="muted">Die Zugangsdaten werden verschlüsselt gespeichert und ausschließlich serverseitig verwendet.</p>
        <div className="form-grid">
          <Field label="E-Mail-Adresse">{input("email", "email")}</Field>
          <Field label="Anzeigename">{input("displayName")}</Field>
        </div>
        <h2>IMAP</h2>
        <div className="form-grid">
          <Field label="Server">{input("imapHost")}</Field>
          <Field label="Port">{input("imapPort", "number")}</Field>
          <Field label="Benutzername">{input("imapUsername")}</Field>
          <Field label="Passwort" hint={account ? "Leer lassen, um das gespeicherte Passwort zu behalten." : undefined}>
            {input("imapPassword", "password")}
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.imapSecure} onChange={(event) => set("imapSecure", event.target.checked)} /> TLS/SSL
        </label>
        <h2>SMTP</h2>
        <div className="form-grid">
          <Field label="Server">{input("smtpHost")}</Field>
          <Field label="Port">{input("smtpPort", "number")}</Field>
          <Field label="Benutzername">{input("smtpUsername")}</Field>
          <Field label="Passwort" hint={account ? "Leer lassen, um das gespeicherte Passwort zu behalten." : undefined}>
            {input("smtpPassword", "password")}
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.smtpSecure} onChange={(event) => set("smtpSecure", event.target.checked)} /> TLS ab Verbindungsaufbau
        </label>
        {message && <p role="status">{message}</p>}
        <div className="actions">
          {onCancel && (
            <button type="button" className="btn" disabled={busy} onClick={onCancel}>
              Abbrechen
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => void test()}>
            Verbindung testen
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Speichern und öffnen
          </button>
        </div>
      </form>
    </>
  );
}

export function WebmailApp({ initialAccounts, smtpProposal }: { initialAccounts: AccountSummary[]; smtpProposal: Proposal | null }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [setup, setSetup] = useState(initialAccounts.length === 0);
  const [editing, setEditing] = useState<AccountSummary | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (setup)
    return (
      <Setup
        proposal={smtpProposal}
        account={editing}
        onCancel={
          accounts.length > 0
            ? () => {
                setEditing(null);
                setSetup(false);
              }
            : undefined
        }
        onSaved={(account) => {
          setAccounts((current) => [...current.filter(({ id }) => id !== account.id), account]);
          setEditing(null);
          setSetup(false);
        }}
      />
    );
  if (!mounted) return <p className="muted">Web-Mail wird geladen …</p>;
  return (
    <div className="webmail-module">
      <MailProviders>
        <BrowserRouter basename="/webmail">
          <Routes>
            <Route
              index
              element={
                <AccountStart
                  accounts={accounts}
                  onAdd={() => {
                    setEditing(null);
                    setSetup(true);
                  }}
                  onEdit={(account) => {
                    setEditing(account);
                    setSetup(true);
                  }}
                />
              }
            />
            <Route path="mailbox/:mailboxId" element={<MailboxRoute />}>
              <Route index element={<Navigate to="emails/inbox" replace />} />
              <Route path="emails/:folder" element={<EmailListRoute />} />
              <Route path="search" element={<SearchResultsRoute />} />
              <Route path="settings" element={<SettingsRoute />} />
            </Route>
            <Route path="*" element={<Outlet />} />
          </Routes>
        </BrowserRouter>
      </MailProviders>
    </div>
  );
}
