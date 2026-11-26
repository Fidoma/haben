import { formatEuro, PAYMENT_PROVIDERS } from "@haben/core";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { quelleText } from "../../components/ExterneQuelle.tsx";
import { Icon } from "../../components/Icon.tsx";
import { stichtagText } from "../../components/ImportKonflikt.tsx";
import { type ActionMenuItem, MoreActionsMenu } from "../../components/MoreActionsMenu.tsx";
import { Status } from "../../components/Status.tsx";
import { RHYTHMUS_LABELS } from "../../components/ZahlungsdienstleisterFormular.tsx";
import type { KartenStatus, Kontokarte } from "../../lib/kontenkarten.ts";
import { ibanKurz, nachDringlichkeit } from "../../lib/verbindungen.ts";
import { type KontoAbruf, LoesungKnopf, type Zugang } from "./-bank-abruf.tsx";
import type { Data } from "./-bank-daten.ts";

/*
 * Tabellen der Seite Verbindungen (#1951): je Konto eine Zeile mit Weg und Kennung, Abruf, Saldo, offenen Umsätzen und
 * Status, danach die Knöpfe: der Knopf zum Status, „Jetzt abrufen“ als Symbol und `⋯` immer zuletzt (DESIGN.md, Tabellen).
 * Verbindungen ohne Konto in der Leiste stehen mit in ihrer Gruppe, sonst ließen sie sich weder sehen noch trennen.
 */

type Seite = Pick<Data, "accounts" | "sync" | "fints" | "zahlungsdienstleister" | "karten"> & {
  quellen: { accountId: string; provider: string; externalAccountId: string; cutoverDate: string | null; checkpoint: string | null; complete: boolean }[];
  gebundeneKonten: string[];
};

/** Was eine Zeile über das Konto oder die Verbindung zeigt, gleich ob mit Konto oder ohne */
export type Zeile = {
  key: string;
  name: string;
  kontoId: string | null;
  kennung: string;
  abruf: string;
  saldo: number | null;
  offen: number;
  status: KartenStatus | null;
  zugang: Zugang | null;
  fehler: string | null;
};

/** Zeit aus der leisen Zeile der Karte („FinTS · heute 06:00“ → „heute 06:00“) */
const zeitAus = (quelle: string) => quelle.split(" · ").slice(1).join(" · ");

/** Name der Verbindung als Weg: Bank bei Enable Banking und FinTS, Anbieter beim Zahlungsdienstleister, sonst „Datei“ */
function weg(data: Seite, karte: Kontokarte, iban: string | null, provider: string | null): { kennung: string; abruf: string } {
  const z = karte.zugang;
  const eb = z?.art === "enablebanking" ? data.sync.connections.find((c) => c.id === z.verbindungId) : undefined;
  const fints = z?.art === "fints" ? data.fints.connections.find((c) => c.id === z.verbindungId) : undefined;
  const psp = z?.art === "psp" ? data.zahlungsdienstleister.verbindungen.find((v) => v.id === z.verbindungId) : undefined;
  const quelle = data.quellen.find((q) => q.accountId === karte.id);
  const kurz = ibanKurz(iban);
  if (psp) {
    const anbieter = data.zahlungsdienstleister.anbieter.find((a) => a.provider === psp.provider)?.name ?? psp.provider;
    return { kennung: `${anbieter} · ${psp.accountId}`, abruf: [RHYTHMUS_LABELS[psp.rhythmus], zeitAus(karte.quelle) || "noch kein Abruf"].join(" · ") };
  }
  if (quelle) return { kennung: `Externe Quelle · ${quelle.provider}`, abruf: quelleText(quelle) };
  // Seit wann der Bankabruf das Konto füllt, davor Dateien oder FinTS (#306)
  if (eb)
    return { kennung: [`${eb.aspspName} (Abruf)`, kurz].filter(Boolean).join(" · "), abruf: `${karte.quelle}${stichtagText(data.sync.stichtage, karte.id)}` };
  const bank = fints ? `${fints.bankName} (FinTS)` : provider ? (PAYMENT_PROVIDERS[provider as keyof typeof PAYMENT_PROVIDERS]?.label ?? provider) : "Datei";
  return { kennung: [bank, kurz].filter(Boolean).join(" · "), abruf: karte.quelle };
}

/** Zeilen einer Gruppe: die Konten, dazu die Verbindungen ohne Karte; die mit Problem oben */
export function zeilenDerGruppe(data: Seite, gruppe: Kontokarte["gruppe"]): Zeile[] {
  const konten = new Map(data.accounts.map((a) => [a.id, a]));
  const mitKarte = new Set(data.karten.karten.map((k) => k.id));
  const zeilen: Zeile[] = data.karten.karten
    .filter((k) => k.gruppe === gruppe)
    .map((k) => {
      const konto = konten.get(k.id);
      return {
        key: k.id,
        name: k.name,
        kontoId: k.id,
        ...weg(data, k, konto?.iban ?? null, konto?.provider ?? null),
        saldo: k.saldo,
        offen: k.offen,
        status: k.status,
        zugang: k.zugang,
        fehler: k.fehler,
      };
    });
  const ohne = (ids: (string | null)[]) => !ids.some((id) => id !== null && mitKarte.has(id));
  const fehlgeschlagen = (fehler: string | null): KartenStatus | null =>
    fehler ? { text: "Fehlgeschlagen", tone: "danger", emphasis: "urgent", detail: null } : null;
  if (gruppe === "banken") {
    for (const c of data.sync.connections.filter((c) => ohne(c.accounts.map((a) => a.bankAccountId))))
      zeilen.push({
        key: c.id,
        name: c.aspspName,
        kontoId: null,
        kennung: "Abruf · kein Konto in Haben",
        abruf: "",
        saldo: null,
        offen: 0,
        status: c.status === "fehler" ? fehlgeschlagen(c.lastError ?? "Fehler") : null,
        zugang: { art: "enablebanking", verbindungId: c.id },
        fehler: c.status === "fehler" ? c.lastError : null,
      });
    for (const c of data.fints.connections.filter((c) => ohne(c.accounts.map((a) => a.bankAccountId))))
      zeilen.push({
        key: c.id,
        name: c.bankName,
        kontoId: null,
        kennung: "FinTS · kein Konto in Haben",
        abruf: "",
        saldo: null,
        offen: 0,
        status: c.status === "fehler" ? fehlgeschlagen(c.lastError ?? "Fehler") : null,
        zugang: { art: "fints", verbindungId: c.id },
        fehler: c.status === "fehler" ? c.lastError : null,
      });
  } else {
    for (const v of data.zahlungsdienstleister.verbindungen.filter((v) => ohne([v.bankAccountId])))
      zeilen.push({
        key: v.id,
        name: v.name,
        kontoId: null,
        kennung: `${data.zahlungsdienstleister.anbieter.find((a) => a.provider === v.provider)?.name ?? v.provider} · kein Konto in Haben`,
        abruf: RHYTHMUS_LABELS[v.rhythmus],
        saldo: null,
        offen: 0,
        status: fehlgeschlagen(v.lastError),
        zugang: { art: "psp", verbindungId: v.id },
        fehler: v.lastError,
      });
  }
  return nachDringlichkeit(zeilen);
}

/** Menü `⋯` einer Zeile: Name und Zweck, Bearbeiten oder Zugang, Quelle, Ausschließen, Trennen bzw. Entfernen */
export function zeilenMenue(
  zeile: Zeile,
  {
    abruf,
    nameUndZweck,
    quelleFreigeben,
    ausschliessen,
    kannQuelle,
    istBank,
  }: {
    abruf: KontoAbruf;
    nameUndZweck: (id: string) => void;
    quelleFreigeben: (id: string) => void;
    ausschliessen: (id: string) => void;
    kannQuelle: boolean;
    istBank: boolean;
  },
): ActionMenuItem[] {
  const z = zeile.zugang;
  const id = zeile.kontoId;
  const items: ActionMenuItem[] = [];
  // FinTS sperrt Zugang und Trennen, solange an einer Zeile ein Schritt der Bank offen ist oder eine Anfrage läuft; der
  // Grund steht in der Zeile (grundId)
  const f = z?.art === "fints" ? abruf.finde(z).fints : undefined;
  const grund = (mitTrennen: boolean) => (f && abruf.fints.grund(f, mitTrennen) ? grundId(f, zeile, abruf) : undefined);
  if (id) items.push({ key: "name", label: "Name und Zweck …", onSelect: () => nameUndZweck(id) });
  if (z) {
    const label = z.art === "psp" ? "Bearbeiten …" : z.art === "fints" ? "Zugang ändern" : "Neu anmelden";
    const gesperrt = f ? abruf.fints.gesperrt || abruf.fints.verbinden : false;
    items.push({ key: "zugang", label, disabled: gesperrt, beschreibung: grund(false), onSelect: () => abruf.zugangAendern(z) });
  }
  if (id && kannQuelle) items.push({ key: "quelle", label: "Externe Quelle hinzufügen …", onSelect: () => quelleFreigeben(id) });
  if (id && istBank) items.push({ key: "ausschliessen", label: "Gehört nicht zu dieser Firma …", onSelect: () => ausschliessen(id) });
  if (z) {
    const trennt = (f && abruf.fints.laeuft(f) === "trennen") || false;
    const label = z.art === "psp" ? "Verbindung entfernen" : trennt ? "Trenne …" : "Trennen";
    const gesperrt = f ? abruf.fints.gesperrt : z.art === "enablebanking" ? abruf.eb.gesperrt : false;
    items.push({ key: "trennen", label, trenner: true, disabled: gesperrt, beschreibung: grund(true), onSelect: () => abruf.trennen(z) });
  }
  return items;
}

/** ID des Satzes mit dem Grund gesperrter Knöpfe, je Zeile eigen: eine Verbindung kann mehrere Konten haben */
function grundId(f: NonNullable<ReturnType<KontoAbruf["finde"]>["fints"]>, zeile: Zeile, abruf: KontoAbruf): string | undefined {
  const g = abruf.fints.grund(f);
  return g ? `${g.id}-${zeile.key}` : undefined;
}

/** Eine Zeile; der Knopf zum Status, „Jetzt abrufen“ und `⋯` stehen am Ende */
function VerbindungsZeile({
  zeile,
  data,
  abruf,
  dateiFuer,
  menue,
  onName,
}: {
  zeile: Zeile;
  data: Seite;
  abruf: KontoAbruf;
  dateiFuer: (id: string) => void;
  menue: ActionMenuItem[];
  onName: () => void;
}) {
  const z = zeile.zugang;
  const geht = z ? abruf.abrufbar(z) : null;
  const f = z?.art === "fints" ? abruf.finde(z).fints : undefined;
  // Der Grund nennt auch „Trennen“, wenn es gesperrt ist; ihn liest jeder gesperrte Knopf der Zeile
  const grund = f ? (abruf.fints.grund(f, true) ?? abruf.fints.grund(f)) : null;
  const beschreibung = f && grund ? grundId(f, zeile, abruf) : undefined;
  const negativ = zeile.saldo !== null && zeile.saldo < 0;
  const status: ReactNode = zeile.status ? (
    <Status
      tone={zeile.status.tone}
      emphasis={zeile.status.emphasis}
      detail={(zeile.status.text === "Fehlgeschlagen" ? zeile.fehler : zeile.status.detail) ?? undefined}
    >
      {zeile.status.text}
    </Status>
  ) : z ? (
    <Status tone="ok">Aktiv</Status>
  ) : null;
  return (
    <tr>
      <td className="spalte-konto">
        <div className="verbindung-name">
          <span className="verbindung-kachel" aria-hidden="true">
            {zeile.name.slice(0, 1).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <button type="button" className="link-button verbindung-link" onClick={onName}>
              {zeile.name}
            </button>
            <div className="verbindung-kennung">{zeile.kennung}</div>
          </div>
        </div>
      </td>
      <td className="spalte-abruf">
        <span className="nw">{zeile.abruf}</span>
        {grund && (
          <span id={beschreibung} className="verbindung-grund">
            {grund.text}
          </span>
        )}
      </td>
      <td className={`num spalte-saldo${negativ ? " betrag-negativ" : ""}`}>{zeile.saldo === null ? "–" : formatEuro(zeile.saldo)}</td>
      <td className="num spalte-offen">
        {zeile.kontoId && zeile.offen > 0 ? (
          <Link to="/bank" search={{ konto: zeile.kontoId }} aria-label={`${zeile.offen} offene Umsätze von ${zeile.name}`}>
            {zeile.offen}
          </Link>
        ) : (
          <span className="muted">–</span>
        )}
      </td>
      <td className="spalte-status">{status}</td>
      <td className="spalte-aktionen">
        <div className="verbindung-aktionen">
          {zeile.kontoId && (
            <LoesungKnopf
              karte={{ id: zeile.kontoId, name: zeile.name, status: zeile.status, zugang: z }}
              data={data}
              abruf={abruf}
              dateiFuer={dateiFuer}
              klein
              beschreibung={beschreibung}
            />
          )}
          {!zeile.kontoId && zeile.status && z && (
            <button type="button" className="btn btn-sm" onClick={() => abruf.zugangAendern(z)}>
              {z.art === "enablebanking" ? "Neu anmelden" : "Zugang ändern"}
            </button>
          )}
          {/* Abruf und `⋯` zusammen: am Handy stehen sie rechts neben dem Namen, der Knopf zum Status unten (bank.css) */}
          <span className="verbindung-symbole">
            {z && (
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label={`${zeile.name} jetzt abrufen`}
                title={abruf.laeuft(z) ? "Rufe ab …" : undefined}
                aria-describedby={geht?.grund ? beschreibung : undefined}
                disabled={!geht?.geht || abruf.laeuft(z)}
                onClick={() => void abruf.abrufen(z)}
              >
                <Icon name="refresh" size={16} />
              </button>
            )}
            {menue.length > 0 && <MoreActionsMenu label={`Weitere Aktionen für ${zeile.name}`} items={menue} ghost schwebend />}
          </span>
        </div>
      </td>
    </tr>
  );
}

/** Karte einer Gruppe mit Überschrift, Knopf zum Hinzufügen und der Tabelle; ohne Zeilen ein Satz statt der Tabelle */
export function VerbindungsGruppe({
  titel,
  hinzufuegen,
  leer,
  zeilen,
  data,
  abruf,
  dateiFuer,
  menue,
  onName,
}: {
  titel: string;
  hinzufuegen: ReactNode;
  leer: string;
  zeilen: Zeile[];
  data: Seite;
  abruf: KontoAbruf;
  dateiFuer: (id: string) => void;
  menue: (zeile: Zeile) => ActionMenuItem[];
  onName: (zeile: Zeile) => void;
}) {
  const id = `gruppe-${titel.toLowerCase()}`;
  return (
    <section className="card verbindungen-gruppe" aria-labelledby={id}>
      <div className="verbindungen-kopf">
        <h2 id={id}>{titel}</h2>
        {hinzufuegen}
      </div>
      {zeilen.length === 0 ? (
        <p className="muted small" style={{ margin: "0 20px 16px" }}>
          {leer}
        </p>
      ) : (
        <table className="verbindungen-tabelle">
          <thead>
            <tr>
              <th className="spalte-konto">Konto</th>
              <th className="spalte-abruf">Abruf</th>
              <th className="num spalte-saldo">Saldo</th>
              <th className="num spalte-offen">Offen</th>
              <th className="spalte-status">Status</th>
              <th className="spalte-aktionen">
                <span className="visually-hidden">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <VerbindungsZeile key={z.key} zeile={z} data={data} abruf={abruf} dateiFuer={dateiFuer} menue={menue(z)} onName={() => onName(z)} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
