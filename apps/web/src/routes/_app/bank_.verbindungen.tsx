import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { ExcludedAccounts, KontoAusschliessenDialog } from "../../components/BankKontoAusschliessen.tsx";
import { EtsyPaymentsCard } from "../../components/EtsyPaymentsCard.tsx";
import { EinklappAbschnitt } from "../../components/firma/EinklappAbschnitt.tsx";
import { QuelleFreigebenDialog } from "../../components/ExterneQuelle.tsx";
import { useFintsZustand } from "../../components/FintsAbruf.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { StoreReportsCard } from "../../components/StoreReportsCard.tsx";
import type { Notice } from "../../lib/use-action.ts";
import { menueGruppe } from "../../lib/menue-gruppe.ts";
import { getExternalBankSources } from "../../server/functions/bank-quellen.ts";
import { getBankVerbindungen } from "../../server/functions/bank-verbindungen.ts";
import { getEtsySettings } from "../../server/functions/etsy.ts";
import { getStoreConnections } from "../../server/functions/stores.ts";
import bankStyles from "../../styles/bank.css?url";
import { useKontoAbruf } from "./-bank-abruf.tsx";
import { KontoVerbindenKopf, NameUndZweckDialog, useDateiImport } from "./-bank-konto.tsx";
import type { VerbindenDialog } from "./-bank-verbinden.tsx";
import { VerbindungsGruppe, type Zeile, zeilenDerGruppe, zeilenMenue } from "./-verbindungen-zeilen.tsx";

/*
 * Seite Verbindungen (#1951): alle Konten der Banken und Zahlungsdienstleister mit Weg, Stand und Status. Hier liegen
 * Abruf, Zugänge, Trennen, Name und Zweck und der Ausschluss; Store-Berichte und Etsy Payments kamen aus den Einstellungen
 * hierher. Die Bankseite zeigt dieselben Konten als Karten über den Umsätzen.
 */

export const Route = createFileRoute("/_app/bank_/verbindungen")({
  validateSearch: z.object({
    /** Ergebnis der Rückleitung von der Bank */
    abruf: z.optional(z.enum(["ok", "fehler"])),
    meldung: z.optional(z.string().check(z.maxLength(500))),
  }),
  loader: async () => {
    const [seite, quellen, stores, etsy] = await Promise.all([getBankVerbindungen(), getExternalBankSources(), getStoreConnections(), getEtsySettings()]);
    return { ...seite, ...quellen, stores, etsy };
  },
  head: () => ({ meta: [{ title: "Verbindungen · Haben" }], links: [{ rel: "stylesheet", href: bankStyles }] }),
  component: VerbindungenPage,
});

function VerbindungenPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/bank/verbindungen" });
  const [connecting, setConnecting] = useState(false);
  const fintsZustand = useFintsZustand();
  const abruf = useKontoAbruf(data, {
    fintsZustand,
    connecting,
    setConnecting,
    result: search.abruf ? { ok: search.abruf === "ok", message: search.meldung ?? "" } : null,
    von: "/bank/verbindungen",
  });
  // Ohne gewähltes Konto: der Kopf importiert nichts, aber „Datei importieren“ einer veralteten Zeile geht in ihr Konto
  const datei = useDateiImport({ accounts: data.accounts, allAccounts: true, accountId: null });
  const [dialog, setDialog] = useState<{ art: "name" | "quelle" | "ausschliessen"; id: string } | null>(null);
  const [hinweis, setHinweis] = useState<Notice>(null);
  const [verbinden, setVerbinden] = useState<VerbindenDialog>(null);
  const konto = data.accounts.find((a) => a.id === dialog?.id);

  const ausschliessen = (id: string) => {
    const blocker = data.excludeBlockedBy[id];
    if (blocker) setHinweis({ tone: "info", text: blocker });
    else setDialog({ art: "ausschliessen", id });
  };
  const menue = (zeile: Zeile) =>
    zeilenMenue(zeile, {
      abruf,
      nameUndZweck: (id) => setDialog({ art: "name", id }),
      quelleFreigeben: (id) => setDialog({ art: "quelle", id }),
      ausschliessen,
      kannQuelle: zeile.kontoId !== null && !data.gebundeneKonten.includes(zeile.kontoId) && !data.quellen.some((q) => q.accountId === zeile.kontoId),
      istBank: data.accounts.some((a) => a.id === zeile.kontoId && a.purpose !== "zahlungsdienstleister"),
    });
  // Der Name öffnet, was die Verbindung einrichtet: Zugang und Zeitraum, ohne Verbindung Name und Zweck
  const onName = (zeile: Zeile) => {
    if (zeile.zugang && zeile.zugang.art !== "enablebanking") abruf.zugangAendern(zeile.zugang);
    else if (zeile.kontoId) setDialog({ art: "name", id: zeile.kontoId });
  };
  const gruppe = { data, abruf, dateiFuer: datei.oeffnenFuer, menue, onName };
  const bankWeg = (weg: "enablebanking" | "fints") => (weg === "enablebanking" ? setConnecting(true) : fintsZustand.neuVerbinden());

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{menueGruppe("/bank/verbindungen")}</div>
          <h1>Verbindungen</h1>
        </div>
        <KontoVerbindenKopf
          data={data}
          fintsZustand={fintsZustand}
          onBankWeg={bankWeg}
          onCreated={(id) => void navigate({ to: "/bank", search: { konto: id } })}
          onMessage={datei.setMessages}
          dialog={verbinden}
          setDialog={setVerbinden}
          davor={
            <button type="button" className="btn" disabled={abruf.beschaeftigt} onClick={() => void abruf.alleAbrufen()}>
              Alle abrufen
            </button>
          }
        />
      </div>
      {datei.zielFeld}
      <section className="bank-abruf" aria-label="Automatischer Abruf">
        {abruf.bereich}
        {datei.meldungen}
        <NoticeBanner notice={hinweis} />
      </section>

      <VerbindungsGruppe
        titel="Banken"
        hinzufuegen={
          <button type="button" className="btn btn-sm" onClick={() => setVerbinden("bank")}>
            Bank hinzufügen
          </button>
        }
        leer="Noch keine Bank. Verbinde ein Konto oder importiere einen Kontoauszug."
        zeilen={zeilenDerGruppe(data, "banken")}
        {...gruppe}
      />
      <VerbindungsGruppe
        titel="Zahlungsdienstleister"
        hinzufuegen={
          <button type="button" className="btn btn-sm" onClick={() => setVerbinden("anbieter")}>
            Zahlungsdienstleister hinzufügen
          </button>
        }
        leer="Noch kein Zahlungsdienstleister."
        zeilen={zeilenDerGruppe(data, "zahlungsdienstleister")}
        {...gruppe}
      />
      <StoresUndMarktplaetze stores={data.stores} etsy={data.etsy} />
      <ExcludedAccounts accounts={data.excludedAccounts} />

      {dialog?.art === "name" && konto && (
        <NameUndZweckDialog account={konto} purposes={data.purposes} ledger={data.ledgers[konto.id]} onClose={() => setDialog(null)} />
      )}
      {dialog?.art === "quelle" && konto && <QuelleFreigebenDialog account={konto} onClose={() => setDialog(null)} />}
      {dialog?.art === "ausschliessen" && konto && <KontoAusschliessenDialog account={konto} onClose={() => setDialog(null)} />}
    </>
  );
}

/**
 * Store-Berichte und Etsy Payments (#1951, aus den Einstellungen hierher): je ein eingeklappter Abschnitt mit dem Stand
 * in der Überschrift, weil ihre Formulare lang sind und die meisten Firmen keins von beiden nutzen. Offen steht ein
 * Abschnitt, solange sein Abruf fehlschlägt oder ein Anker ihn anspringt.
 */
function StoresUndMarktplaetze({
  stores,
  etsy,
}: {
  stores: Awaited<ReturnType<typeof getStoreConnections>>;
  etsy: Awaited<ReturnType<typeof getEtsySettings>>;
}) {
  const store = (art: "googleplay" | "appstore") => stores.connections.find((c) => c.store === art);
  const storeFehler = stores.connections.some((c) => c.lastError);
  const [offen, setOffen] = useState({ stores: storeFehler, etsy: Boolean(etsy.lastError) });
  // Die Rückleitung von Etsy und Links mit Anker (`#etsy`, `#stores`) klappen ihren Abschnitt auf; erst im Browser, der Server kennt den Anker nicht
  const anker = useLocation({ select: (l) => l.hash });
  useEffect(() => {
    if (anker === "etsy" || anker === "stores") setOffen((o) => ({ ...o, [anker]: true }));
  }, [anker]);
  const storesKurz = [
    `Google Play ${store("googleplay") ? "verbunden" : "nicht verbunden"}`,
    `App Store ${store("appstore") ? "verbunden" : "nicht verbunden"}`,
  ].join(" · ");
  return (
    <section className="card verbindungen-weitere" aria-labelledby="weitere-heading">
      <h2 id="weitere-heading">Stores und Marktplätze</h2>
      <EinklappAbschnitt
        id="stores"
        titel="Google Play und App Store"
        kurz={storesKurz}
        offen={offen.stores}
        onOffen={(neu) => setOffen((o) => ({ ...o, stores: neu }))}
      >
        <StoreReportsCard connections={stores.connections} contacts={stores.contacts} />
      </EinklappAbschnitt>
      <EinklappAbschnitt
        id="etsy"
        titel="Etsy Payments"
        kurz={etsy.connected ? `verbunden mit ${etsy.shopName || "dem Shop"}` : "nicht verbunden"}
        offen={offen.etsy}
        onOffen={(neu) => setOffen((o) => ({ ...o, etsy: neu }))}
      >
        <EtsyPaymentsCard data={etsy} />
      </EinklappAbschnitt>
    </section>
  );
}
