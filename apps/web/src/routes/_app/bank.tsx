import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { TransactionStatus } from "../../components/BankStatus.tsx";
import { UmsatzBetrag, useGebuehrZeilen } from "../../components/BankGebuehr.tsx";
import { formatDate } from "../../lib/format.ts";
import { getBankOverview } from "../../server/functions/bank.ts";
import { isDialogOpen } from "../../components/ConfirmDialog.tsx";
import { BestaetigenLeiste, useBestaetigen, useLeertasteMarkiert, ZeilenMarkierung } from "../../components/BankBestaetigen.tsx";
import { BankSortierKopf } from "../../components/BankSortierKopf.tsx";
import { type Data, gezeigteKonten, nextOpenAfter } from "./-bank-daten.ts";
import { Fortschritt, LeereListe } from "./-bank-fortschritt.tsx";
import { AllocationPanel } from "./-bank-zuordnung.tsx";
import { useFintsZustand } from "../../components/FintsAbruf.tsx";
import { Icon } from "../../components/Icon.tsx";
import type { ActionMenuItem } from "../../components/MoreActionsMenu.tsx";
import type { Kontokarte } from "../../lib/kontenkarten.ts";
import { KontoVerbindenKopf, NameUndZweckDialog, SearchBox, useDateiImport } from "./-bank-konto.tsx";
import { menueGruppe } from "../../lib/menue-gruppe.ts";
import bankStyles from "../../styles/bank.css?url";
import { type KontoAbruf, KontoHinweis, useKontoAbruf } from "./-bank-abruf.tsx";
import { Kartenleiste } from "./-bank-kartenleiste.tsx";

const searchSchema = z.object({
  /** Ein Konto oder „alle“ (#617) */
  konto: z.optional(z.union([z.uuid(), z.literal("alle")])),
  filter: z.optional(z.enum(["offen", "zugeordnet", "alle", "vorschlag"])),
  suche: z.optional(z.string()),
  umsatz: z.optional(z.uuid()),
  /** Sortierung der Umsatzliste: Spalte und Richtung (#681) */
  sort: z.optional(z.enum(["datum", "gegenpartei", "betrag", "status"])),
  dir: z.optional(z.enum(["auf", "ab"])),
  /** Ergebnis der Rückleitung von der Bank */
  abruf: z.optional(z.enum(["ok", "fehler"])),
  meldung: z.optional(z.string().check(z.maxLength(500))),
});

export const Route = createFileRoute("/_app/bank")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    konto: search.konto,
    filter: search.filter,
    suche: search.suche,
    umsatz: search.umsatz,
    sort: search.sort,
    dir: search.dir,
  }),
  loader: ({ deps }) =>
    getBankOverview({
      data: {
        konto: deps.konto,
        filter: deps.filter ?? "offen",
        suche: deps.suche ?? "",
        umsatz: deps.umsatz,
        sort: deps.sort ?? "datum",
        dir: deps.dir ?? "ab",
      },
    }),
  head: () => ({ meta: [{ title: "Bank · Haben" }], links: [{ rel: "stylesheet", href: bankStyles }] }),
  component: BankPage,
});

/** J/K springen zum nächsten bzw. vorigen Umsatz */
function useUmsatzTasten(transactions: Data["transactions"], index: number) {
  const navigate = useNavigate({ from: "/bank" });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (isDialogOpen() || target.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
      if (!step) return;
      const next = transactions[index + step];
      if (next) {
        event.preventDefault();
        void navigate({ search: (prev) => ({ ...prev, umsatz: next.id }), replace: true });
        document.getElementById(`tx-${next.id}`)?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transactions, index, navigate]);
}

/** Punkte im Menü `⋯` einer Karte (#1951): Abruf oder Datei, Name und Zweck, die Verbindung, zuletzt alle Verbindungen */
function kartenAktionen(
  karte: Kontokarte | "alle",
  {
    abruf,
    dateiFuer,
    nameUndZweck,
    zuVerbindungen,
    hatVerbindungen,
  }: { abruf: KontoAbruf; dateiFuer: (id: string) => void; nameUndZweck: (id: string) => void; zuVerbindungen: () => void; hatVerbindungen: boolean },
): ActionMenuItem[] {
  const alle: ActionMenuItem = { key: "verbindungen", label: "Alle Verbindungen", trenner: true, onSelect: zuVerbindungen };
  if (karte === "alle")
    return [
      ...(hatVerbindungen ? [{ key: "abrufen", label: "Alle abrufen", disabled: abruf.beschaeftigt, onSelect: () => void abruf.alleAbrufen() }] : []),
      { ...alle, trenner: hatVerbindungen },
    ];
  const z = karte.zugang;
  return [
    z
      ? { key: "abrufen", label: "Jetzt abrufen", disabled: !abruf.abrufbar(z).geht, onSelect: () => void abruf.abrufen(z) }
      : { key: "datei", label: "Datei importieren", onSelect: () => dateiFuer(karte.id) },
    { key: "name", label: "Name und Zweck …", onSelect: () => nameUndZweck(karte.id) },
    ...(z ? [{ key: "zugang", label: "Verbindung bearbeiten", onSelect: () => (z.art === "enablebanking" ? zuVerbindungen() : abruf.zugangAendern(z)) }] : []),
    alle,
  ];
}

function BankPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/bank" });
  const filter = search.filter ?? "offen";
  const { zeilen, sichtbar, index } = useGebuehrZeilen(data.transactions, data.accounts, data.detail?.transaction.id);
  const karte = data.allAccounts ? null : (data.karten.karten.find((k) => k.id === data.accountId) ?? null);

  // Formulare zum Verbinden (Enable Banking, FinTS) öffnen unter der Leiste im Bereich „Automatischer Abruf“
  const [connecting, setConnecting] = useState(false);
  const fintsZustand = useFintsZustand();
  const abruf = useKontoAbruf(data, {
    fintsZustand,
    connecting,
    setConnecting,
    result: search.abruf ? { ok: search.abruf === "ok", message: search.meldung ?? "" } : null,
    von: "/bank",
  });
  const datei = useDateiImport(data);
  const [nameFuer, setNameFuer] = useState<string | null>(null);
  const nameKonto = data.accounts.find((a) => a.id === nameFuer);
  const zuVerbindungen = () => void navigate({ to: "/bank/verbindungen" });
  const hatVerbindungen = data.karten.karten.some((k) => k.zugang);
  const aktionen = (k: Kontokarte | "alle") =>
    kartenAktionen(k, { abruf, dateiFuer: datei.oeffnenFuer, nameUndZweck: setNameFuer, zuVerbindungen, hatVerbindungen });

  const bestaetigen = useBestaetigen(sichtbar);
  useLeertasteMarkiert(bestaetigen);
  useUmsatzTasten(sichtbar, index);

  // Derselbe Bereich in beiden Zweigen unten: Mit dem ersten Konto, etwa nach dem Verbinden über FinTS, bleibt er stehen,
  // samt seiner Meldungen
  const bereich = (
    <section key="abruf" className="bank-abruf" aria-label="Automatischer Abruf">
      {abruf.bereich}
      {datei.meldungen}
    </section>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{menueGruppe("/bank")}</div>
          <h1>Bank</h1>
        </div>
        <KontoVerbindenKopf
          data={data}
          fintsZustand={fintsZustand}
          onBankWeg={(weg) => (weg === "enablebanking" ? setConnecting(true) : fintsZustand.neuVerbinden())}
          onCreated={(id) => void navigate({ search: (prev) => ({ ...prev, konto: id, umsatz: undefined }) })}
          onMessage={datei.setMessages}
          davor={datei.knopf}
        />
      </div>
      {datei.zielFeld}

      {data.accounts.length === 0 ? (
        <>
          {bereich}
          <section className="card">
            <h2>Noch kein Konto</h2>
            <p className="muted" style={{ margin: 0 }}>
              Verbinde dein Konto für den automatischen Abruf oder exportiere bei deiner Bank die Umsätze als CSV oder CAMT.053 und importiere die Datei.
              DKB-Dateien und CAMT nennen die IBAN, das Konto wird dann automatisch angelegt; für N26 lege das Konto vorher an.
            </p>
          </section>
        </>
      ) : (
        <>
          <Kartenleiste data={data} filter={filter} aktionen={aktionen} />
          <KontoHinweis
            karte={karte}
            alle={data.allAccounts ? data.karten.karten : null}
            data={data}
            abruf={abruf}
            dateiFuer={datei.oeffnenFuer}
            zuVerbindungen={zuVerbindungen}
          />
          {bereich}

          <UmsatzListe
            data={data}
            search={search}
            abruf={abruf}
            dateiFuer={datei.oeffnenFuer}
            karte={karte}
            hatVerbindungen={hatVerbindungen}
            gebuehrZeilen={{ zeilen, sichtbar }}
            bestaetigen={bestaetigen}
          />
        </>
      )}

      {nameKonto && <NameUndZweckDialog account={nameKonto} purposes={data.purposes} ledger={data.ledgers[nameKonto.id]} onClose={() => setNameFuer(null)} />}
    </>
  );
}

/** Umsätze links mit Filter, Suche und Stand des Abrufs, Zuordnung rechts */
function UmsatzListe({
  data,
  search,
  abruf,
  dateiFuer,
  karte,
  hatVerbindungen,
  gebuehrZeilen: { zeilen, sichtbar },
  bestaetigen,
}: {
  data: Data;
  search: ReturnType<typeof Route.useSearch>;
  abruf: KontoAbruf;
  dateiFuer: (id: string) => void;
  karte: Kontokarte | null;
  hatVerbindungen: boolean;
  gebuehrZeilen: Pick<ReturnType<typeof useGebuehrZeilen<Data["transactions"][number]>>, "zeilen" | "sichtbar">;
  bestaetigen: ReturnType<typeof useBestaetigen>;
}) {
  // Spaltenkopf sortiert: erster Klick absteigend, derselbe Kopf nochmal dreht die Richtung (#681)
  const sortierung = search.sort ?? "datum";
  const richtung = search.dir ?? "ab";
  const filter = search.filter ?? "offen";
  const selectedId = data.detail?.transaction.id;
  // „Alle Konten“ zeigt die Umsätze aller Konten, etwa für „Alle anzeigen“ der Schnellsuche (#617)
  const konto = data.allAccounts ? ("alle" as const) : (data.accountId ?? undefined);
  const openCount = gezeigteKonten(data).reduce((sum, a) => sum + a.openCount, 0);
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  return (
    <div className="grid-main">
      <section className="card" style={{ padding: "8px 0 12px" }} aria-label="Umsätze">
        <AbrufStand karte={karte} alle={data.allAccounts} hatVerbindungen={hatVerbindungen} abruf={abruf} dateiFuer={dateiFuer} />
        <div className="tx-toolbar">
          <div role="group" aria-label="Filter" className="tx-filter">
            {(["alle", "offen", "zugeordnet", "vorschlag"] as const).map((f) => (
              <Link
                key={f}
                to="/bank"
                search={{ konto, filter: f, suche: search.suche, sort: search.sort, dir: search.dir }}
                className={`chip${filter === f ? " active" : ""}`}
                aria-current={filter === f ? "page" : undefined}
              >
                {f === "alle" ? "Alle" : f === "offen" ? `Offen · ${openCount}` : f === "zugeordnet" ? "Zugeordnet" : "Vorschlag"}
              </Link>
            ))}
          </div>
          {/* key: beim Kontowechsel leer neu aufsetzen, sonst trägt die Suche ins neue Konto */}
          <SearchBox key={konto ?? ""} initial={search.suche ?? ""} />
        </div>
        <Fortschritt data={data} sichtbar={sichtbar} selectedId={selectedId} />
        <BestaetigenLeiste b={bestaetigen} />
        <BankSortierKopf sort={sortierung} dir={richtung} />
        <LeereListe data={data} filter={filter} />
        {zeilen.map(({ umsatz: tx, gebuehr }) => (
          <div key={tx.id} className="tx-wrap">
            {bestaetigen.markierbar.length > 0 && <ZeilenMarkierung id={tx.id} b={bestaetigen} label={tx.counterpartyName || "Umsatz"} />}
            <Link
              id={`tx-${tx.id}`}
              to="/bank"
              search={{ ...search, umsatz: tx.id }}
              replace
              className={`table-row tx-cols tx-row${tx.id === selectedId ? " selected" : ""}`}
              aria-current={tx.id === selectedId ? "true" : undefined}
            >
              <div className="muted small">{formatDate(tx.bookingDate)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="ellipsis" style={{ fontWeight: 500 }}>
                  {tx.counterpartyName || "–"}
                </span>
                <span className="small muted ellipsis">
                  {data.allAccounts ? [accountName.get(tx.bankAccountId), tx.purpose].filter(Boolean).join(" · ") : tx.purpose}
                </span>
                {tx.bestaetigung && (
                  <span className="small" style={{ color: "var(--accent-ink)" }}>
                    Vorschlag: {tx.bestaetigung.text}
                  </span>
                )}
              </div>
              <UmsatzBetrag betrag={tx.amount} gebuehr={gebuehr?.amount ?? null} />
              <div>
                <TransactionStatus tx={tx} />
              </div>
            </Link>
          </div>
        ))}
      </section>
      {data.detail ? (
        <AllocationPanel
          key={`${data.detail.transaction.id}-${data.detail.transaction.open}`}
          detail={data.detail}
          directKinds={data.directKinds}
          steuerOptionen={{ steuerarten: data.steuerarten, steuerPosten: data.steuerPosten }}
          darlehenOptionen={{ loans: data.loans, loanParts: data.loanParts }}
          kategorieOptionen={{ kategorien: data.kategorien, kleinunternehmer: data.kleinunternehmer }}
          nextOpenId={nextOpenAfter(sichtbar, data.detail.transaction.id)}
          gebuehr={zeilen.find((z) => z.umsatz.id === selectedId)?.gebuehr ?? null}
        />
      ) : (
        <aside className="card" aria-label="Zuordnung">
          <p className="muted" style={{ margin: 0 }}>
            Umsatz links auswählen.
          </p>
        </aside>
      )}
    </div>
  );
}

/**
 * Erste Zeile der Liste, über Filter und Suche: links Weg und Stand des gewählten Kontos, rechts sein Abruf, bei einem Konto ohne Verbindung der
 * Import einer Datei, bei „Alle Konten“ „Alle abrufen“
 */
function AbrufStand({
  karte,
  alle,
  hatVerbindungen,
  abruf,
  dateiFuer,
}: {
  karte: Kontokarte | null;
  alle: boolean;
  hatVerbindungen: boolean;
  abruf: KontoAbruf;
  dateiFuer: (id: string) => void;
}) {
  if (alle)
    return hatVerbindungen ? (
      <div className="tx-stand">
        <button type="button" className="btn btn-ghost btn-sm" disabled={abruf.beschaeftigt} onClick={() => void abruf.alleAbrufen()}>
          <Icon name="refresh" size={16} />
          Alle abrufen
        </button>
      </div>
    ) : null;
  if (!karte) return null;
  const z = karte.zugang;
  const geht = z ? abruf.abrufbar(z) : null;
  return (
    <div className="tx-stand">
      {geht?.grund && (
        <span id={geht.grund.id} className="small muted tx-stand-grund">
          {geht.grund.text}
        </span>
      )}
      <span className="small muted">{karte.quelle}</span>
      {z ? (
        <button type="button" className="btn btn-ghost btn-sm" disabled={!geht?.geht} aria-describedby={geht?.grund?.id} onClick={() => void abruf.abrufen(z)}>
          <Icon name="refresh" size={16} />
          {abruf.laeuft(z) ? "Rufe ab …" : "Jetzt abrufen"}
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dateiFuer(karte.id)}>
          Datei importieren
        </button>
      )}
    </div>
  );
}
