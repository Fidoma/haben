import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useId, useState, type FormEvent } from "react";
import { defaultFetchFrom, fetchFromForConnect } from "../lib/bank-connect.ts";
import { errorMessage, formatDate, formatDateTime } from "../lib/format.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import type { getBankOverview } from "../server/functions/bank.ts";
import { cancelFints, connectFints, disconnectFints, syncFints } from "../server/functions/fints.ts";
import { today as todayInGermany } from "../server/today.ts";
import { FintsStatus } from "./BankStatus.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { type Offen, type Schritt, SchrittForm, useAntwort } from "./FintsSchritt.tsx";

/*
 * Kontoabruf über FinTS (#654) auf der Bankseite: Verbinden mit Bankleitzahl, FinTS-Adresse, Anmeldename und PIN,
 * dann die Schritte aus FintsSchritt.tsx, die Verbindungen mit „Jetzt abrufen“, „Zugang ändern“ und „Trennen“.
 */

type Fints = Awaited<ReturnType<typeof getBankOverview>>["fints"];
type Verbindung = Fints["connections"][number];
type Meldung = { tone: "ok" | "danger" | "info"; text: string };
/** Offener Schritt der Bank beim Verbinden („neu“) oder an der Zeile einer Verbindung (ihre ID); die Bankseite führt ihn */
export type FintsOffen = { fuer: string; schritt: Offen } | null;

/**
 * Was die Bankseite für FinTS führt, damit der Kopf des Bereichs es kennt: Formular „Über FinTS verbinden“ offen
 * (verbinden), offener Schritt der Bank und die Zeile mit laufender Anfrage (busy: ihre ID beim Abruf, `x-<ID>` beim Trennen)
 */
export function useFintsZustand() {
  const [verbinden, setVerbinden] = useState(false);
  const [offen, setOffen] = useState<FintsOffen>(null);
  const [busy, setBusy] = useState<string | null>(null);
  return { verbinden, setVerbinden, offen, setOffen, busy, setBusy };
}
export type FintsZustand = ReturnType<typeof useFintsZustand>;

export const FINTS_ANLEITUNG = "https://github.com/Speicherstadt/haben/blob/main/docs/installation-anbindungen.md#kontoabruf-über-fints";

/** Name mit den letzten vier Ziffern der IBAN; neue Konten tragen sie schon im Namen („Testbank Girokonto …2051“) */
const kontoName = (a: { name: string; iban: string }) => (a.name.endsWith(a.iban.slice(-4)) ? a.name : `${a.name} …${a.iban.slice(-4)}`);

/**
 * Name einer Verbindung im Grund gesperrter Knöpfe. Heißt eine andere Bank genauso, etwa bei zwei Zugängen zur selben
 * Bank, mit der Endung der IBAN ihres ersten Kontos, wie sie an der Zeile steht: „Testbank …2051“ (#1677)
 */
function nameImGrund(c: Verbindung, connections: readonly Verbindung[]): string {
  const konto = c.accounts[0];
  const gleich = connections.some((d) => d.id !== c.id && d.bankName === c.bankName);
  return gleich && konto ? `${c.bankName} …${konto.iban.slice(-4)}` : c.bankName;
}

/**
 * Worauf die Knöpfe für FinTS warten, solange an der Zeile einer Verbindung ein Schritt der Bank offen ist oder ein Abruf
 * läuft: das Satzende nach „sobald“, sonst null. Die Zeile ausser zählt nicht mit; an ihr steht der Schritt direkt
 * darunter, und ihr Knopf zeigt „Rufe ab …“ (#1662)
 */
export function wartetAuf(connections: readonly Verbindung[], { offen, busy }: Pick<FintsZustand, "offen" | "busy">, ausser?: string): string | null {
  const schritt = connections.find((c) => c.id === offen?.fuer && c.id !== ausser);
  if (schritt) return `die Freigabe für ${nameImGrund(schritt, connections)} gesendet oder abgebrochen ist`;
  const abruf = connections.find((c) => c.id === busy && c.id !== ausser);
  return abruf ? `der Abruf für ${nameImGrund(abruf, connections)} fertig ist` : null;
}

/**
 * Satzende, solange „Trennen“ an einer anderen Zeile als ausser läuft (busy `x-<ID>`); ihr Knopf zeigt „Trenne …“. Nur die
 * Zeilen warten darauf, „Über FinTS verbinden“ nicht (#1677)
 */
function trenntAndere(connections: readonly Verbindung[], busy: string | null, ausser: string): string | null {
  const c = connections.find((d) => busy === `x-${d.id}` && d.id !== ausser);
  return c ? `die Verbindung zu ${nameImGrund(c, connections)} getrennt ist` : null;
}

/** Gesperrte Knöpfe einer Zeile, „Trennen“ nur mit trennen; ohne FINTS_PRODUKT_ID nur „Trennen“ */
const knoepfe = (trennen: boolean, configured: boolean) => [...(trennen ? ["Trennen"] : []), ...(configured ? ["Zugang ändern", "Jetzt abrufen"] : [])];

function sperrSatz(namen: string[], sobald: string): string {
  const liste = new Intl.ListFormat("de").format(namen.map((k) => `„${k}“`));
  return `${liste} ${namen.length > 1 ? "gehen" : "geht"} wieder, sobald ${sobald}.`;
}

/**
 * Grund an einer Zeile mit gesperrten Knöpfen, mit trennen, wenn er auch „Trennen“ nennt. Solange oben „Über FinTS
 * verbinden“ offen ist, stünde ein Schritt der Bank an der Zeile sonst neben dem Formular, und dessen Schritt ersetzte ihn,
 * ohne dass Haben den Vorgang bei der Bank verwirft (#1660); „Trennen“ nur, solange die Bank beim Verbinden auf einen
 * Schritt wartet. Ebenso ersetzte ein Schritt an der Zeile den offenen an einer anderen oder den, mit dem die Bank auf
 * deren Abruf antwortet (#1662). Während „Trennen“ an einer anderen Zeile sind alle Knöpfe kurz gesperrt (#1677); bei
 * offenem Formular nennt ein zweiter Satz dann „Trennen“
 */
export function zeilenGrund(c: Verbindung, connections: readonly Verbindung[], z: Pick<FintsZustand, "verbinden" | "offen" | "busy">, configured = true) {
  const getrennt = trenntAndere(connections, z.busy, c.id);
  if (z.verbinden) {
    const schritt = z.offen?.fuer === "neu";
    const text = sperrSatz(knoepfe(schritt, configured), "das Verbinden über FinTS oben fertig oder abgebrochen ist");
    if (getrennt && !schritt) return { text: `${text} ${sperrSatz(["Trennen"], getrennt)}`, trennen: true };
    return { text, trennen: schritt };
  }
  const sobald = wartetAuf(connections, z, c.id) ?? getrennt;
  return sobald ? { text: sperrSatz(knoepfe(true, configured), sobald), trennen: true } : null;
}

const meldungenAus = (s: Extract<Schritt, { art: "fertig" }>): Meldung[] => [
  { tone: s.ok ? "ok" : "danger", text: s.meldung },
  ...s.hinweise.map((text) => ({ tone: "info" as const, text })),
];

/** Zugang zum Online-Banking; mit vorlage für „Zugang ändern“ schon ausgefüllt, nur die PIN fehlt */
function VerbindenForm({ vorlage, onSchritt, onAbbrechen }: { vorlage: Verbindung | null; onSchritt: (s: Schritt) => Promise<void>; onAbbrechen: () => void }) {
  const connect = useServerFn(connectFints);
  const antwort = useAntwort(onSchritt);
  const today = todayInGermany();
  const [blz, setBlz] = useState(vorlage?.bankCode ?? "");
  const [url, setUrl] = useState(vorlage?.url ?? "");
  const [benutzer, setBenutzer] = useState(vorlage?.login ?? "");
  const [kundenId, setKundenId] = useState(vorlage?.customerId ?? "");
  const [pin, setPin] = useState("");
  const [fetchFrom, setFetchFrom] = useState(defaultFetchFrom(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    form,
    error: fehler,
    check,
  } = useSubmitCheck({
    blz: /^\d{8}$/.test(blz.replace(/\s/g, "")) ? null : "Die Bankleitzahl hat acht Ziffern.",
    url: /^https:\/\/\S+$/i.test(url.trim()) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url.trim()) ? null : "Die FinTS-Adresse beginnt mit https://.",
    benutzer: benutzer.trim() ? null : "Der Anmeldename fehlt.",
    pin: pin ? null : "Die PIN fehlt.",
    fetchFrom: fetchFrom > today ? `Wähle einen Tag bis ${formatDate(today)} oder lass das Feld leer.` : null,
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !check()) return;
    setBusy(true);
    setError(null);
    try {
      const data = {
        blz: blz.replace(/\s/g, ""),
        url: url.trim(),
        benutzer,
        kundenId: kundenId.trim() || undefined,
        pin,
        fetchFrom: fetchFromForConnect(fetchFrom, today),
      };
      await antwort(await connect({ data }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="stack" style={{ gap: 12, maxWidth: 560 }} aria-label="Über FinTS verbinden" noValidate>
      <Field label="Bankleitzahl" error={fehler("blz")} hint="Acht Ziffern; in deiner IBAN die Stellen 5 bis 12.">
        {(control) => <input {...control} value={blz} onChange={(e) => setBlz(e.target.value)} inputMode="numeric" required autoFocus />}
      </Field>
      <Field
        label="FinTS-Adresse der Bank"
        error={fehler("url")}
        hint={
          <>
            Steht bei deiner Bank unter HBCI oder FinTS, etwa für Banking-Programme.{" "}
            <a href={FINTS_ANLEITUNG} target="_blank" rel="noreferrer">
              Anleitung
            </a>
          </>
        }
      >
        {(control) => <input {...control} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required spellCheck={false} />}
      </Field>
      <Field label="Anmeldename" error={fehler("benutzer")} hint="Wie im Online-Banking, auch Benutzerkennung, Legitimations-ID oder Zugangsnummer.">
        {(control) => <input {...control} value={benutzer} onChange={(e) => setBenutzer(e.target.value)} autoComplete="off" required spellCheck={false} />}
      </Field>
      <Field label="Kunden-ID (optional)" hint="Nur, wenn deine Bank sie getrennt vom Anmeldenamen nennt.">
        {(control) => <input {...control} value={kundenId} onChange={(e) => setKundenId(e.target.value)} autoComplete="off" spellCheck={false} />}
      </Field>
      <Field label="PIN" error={fehler("pin")} hint="Haben speichert die PIN verschlüsselt, damit der tägliche Abruf ohne dich läuft.">
        {(control) => <input {...control} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />}
      </Field>
      <Field
        label="Umsätze abrufen ab"
        error={fehler("fetchFrom")}
        hint="Gilt für Konten, die Haben noch nicht abruft, auch für ein wieder angehaktes. Mit der Vorgabe holt Haben ab Jahresbeginn oder schließt an Umsätze an, die schon da sind."
      >
        {(control) => <input {...control} type="date" value={fetchFrom} max={today} onChange={(e) => setFetchFrom(e.target.value)} />}
      </Field>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onAbbrechen} disabled={busy}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Verbinde …" : "Verbinden"}
        </button>
      </div>
    </form>
  );
}

/** Rückfrage vor „Trennen“ an der Zeile einer Verbindung */
function TrennenDialog({ verbindung, onTrennen, onClose }: { verbindung: Verbindung | null; onTrennen: (id: string) => void; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={verbindung !== null}
      title={`FinTS-Verbindung zu ${verbindung?.bankName} trennen?`}
      confirmLabel="Trennen"
      danger
      onConfirm={() => verbindung && onTrennen(verbindung.id)}
      onClose={onClose}
    >
      <p>Haben löscht die gespeicherte PIN. Die abgerufenen Umsätze bleiben erhalten.</p>
    </ConfirmDialog>
  );
}

/** Angaben einer Verbindung links in ihrer Zeile; als letzte Zeile der Grund gesperrter Knöpfe (grundId für aria-describedby) */
function Angaben({ c, grund, grundId }: { c: Verbindung; grund: string | undefined; grundId: string | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 260px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>{c.bankName}</span>
        <FintsStatus status={c.status} />
        <span className="small muted">FinTS</span>
      </div>
      <span className="small muted">{c.accounts.map(kontoName).join(" · ") || "Keine Konten"}</span>
      <span className="small muted">{c.lastSyncAt ? `Zuletzt abgerufen ${formatDateTime(c.lastSyncAt)}` : "Noch nicht abgerufen"}</span>
      {c.lastError && <span className="field-error">{c.lastError}</span>}
      {grund && (
        <span id={grundId} className="small muted">
          {grund}
        </span>
      )}
    </div>
  );
}

/** FinTS im Bereich „Automatischer Abruf“: Formular zum Verbinden (verbinden), die Verbindungen und der offene Schritt der Bank */
export function FintsAbruf({
  fints,
  verbinden,
  setVerbinden,
  offen,
  setOffen,
  busy,
  setBusy,
}: {
  fints: Fints;
  verbinden: boolean;
  setVerbinden: (v: boolean) => void;
  offen: FintsOffen;
  setOffen: (o: FintsOffen) => void;
  busy: string | null;
  setBusy: (b: string | null) => void;
}) {
  const router = useRouter();
  const sync = useServerFn(syncFints);
  const disconnect = useServerFn(disconnectFints);
  const verwerfen = useServerFn(cancelFints);
  const [vorlage, setVorlage] = useState<Verbindung | null>(null);
  const grundId = useId();
  const grundVon = (c: Verbindung) => zeilenGrund(c, fints.connections, { verbinden, offen, busy }, fints.configured);
  // ID des Grundes an der Zeile für aria-describedby; mitTrennen für „Trennen“, das nicht jeder Grund nennt
  const grundZeile = (c: Verbindung, mitTrennen = false) => {
    const grund = grundVon(c);
    return grund && (grund.trennen || !mitTrennen) ? `${grundId}-${c.id}` : undefined;
  };
  const gesperrt = busy !== null || offen !== null;
  const [meldungen, setMeldungen] = useState<Meldung[]>([]);
  const [trennt, setTrennt] = useState<Verbindung | null>(null);

  async function ergebnis(fuer: string, s: Schritt) {
    if (s.art !== "fertig") {
      setOffen({ fuer, schritt: s });
      return;
    }
    // Erst neu laden, dann Formular schließen und melden: Nach dem ersten Verbinden steht die Verbindung erst dann auf der
    // Seite. Ohne sync endete invalidate schon mit den alten Daten und lüde im Hintergrund nach
    await router.invalidate({ sync: true });
    setOffen(null);
    if (fuer === "neu") setVerbinden(false);
    setMeldungen(meldungenAus(s));
  }

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    setMeldungen([]);
    try {
      await work();
    } catch (e) {
      setMeldungen([{ tone: "danger", text: errorMessage(e) }]);
    } finally {
      setBusy(null);
    }
  }

  const trennen = (id: string) =>
    void run(`x-${id}`, async () => {
      await disconnect({ data: id });
      await router.invalidate();
    });

  const schliessen = () => {
    setVerbinden(false);
    setOffen(null);
  };

  // „Abbrechen“ bei einem Schritt der Bank: Ab dem Abruf der Umsätze hat Verbinden den Zugang schon gespeichert, beim
  // ersten Verbinden als neue Verbindung.
  // Erst neu laden, dann schließen; solange ein Schritt offen ist, sind die Knöpfe an den Zeilen gesperrt
  const schrittAbbrechen = () => void router.invalidate({ sync: true }).then(schliessen);

  // Jedes Zuklappen des Formulars setzt hier die Vorlage zurück, auch oben über „Über FinTS verbinden“: Nach „Zugang ändern“
  // öffnet der Knopf danach ein leeres Formular. Wartet die Bank beim Verbinden auf einen Schritt, gilt das Zuklappen oben
  // wie „Abbrechen“ und verwirft den Vorgang; sonst blieben die Knöpfe an den Zeilen gesperrt, ohne dass ein Schritt zu
  // sehen ist
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur, wenn das Formular zuklappt oder ein Schritt kommt
  useEffect(() => {
    if (!verbinden) setVorlage(null);
    if (verbinden || offen?.fuer !== "neu") return;
    void verwerfen({ data: offen.schritt.vorgang }).catch(() => undefined);
    schrittAbbrechen();
  }, [verbinden, offen]);

  return (
    <>
      {verbinden &&
        (offen?.fuer === "neu" ? (
          <SchrittForm key={offen.schritt.vorgang} schritt={offen.schritt} onSchritt={(s) => ergebnis("neu", s)} onAbbrechen={schrittAbbrechen} />
        ) : (
          // Nicht die ID der Verbindung allein: Die trägt schon ihre Zeile unten, und mit demselben Schlüssel blieb das
          // Formular nach „Zugang ändern“ im DOM stehen
          <VerbindenForm key={vorlage ? `zugang-${vorlage.id}` : "neu"} vorlage={vorlage} onSchritt={(s) => ergebnis("neu", s)} onAbbrechen={schliessen} />
        ))}

      <TrennenDialog verbindung={trennt} onTrennen={trennen} onClose={() => setTrennt(null)} />

      {fints.connections.map((c) => (
        <div key={c.id} className="history-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <Angaben c={c} grund={grundVon(c)?.text} grundId={grundZeile(c)} />
          <div className="actions">
            <button type="button" className="btn btn-danger" disabled={gesperrt} aria-describedby={grundZeile(c, true)} onClick={() => setTrennt(c)}>
              {busy === `x-${c.id}` ? "Trenne …" : "Trennen"}
            </button>
            {fints.configured && (
              <button
                type="button"
                className="btn"
                disabled={gesperrt || verbinden}
                aria-describedby={grundZeile(c)}
                onClick={() => {
                  setVorlage(c);
                  setVerbinden(true);
                }}
              >
                Zugang ändern
              </button>
            )}
            {fints.configured && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={gesperrt || verbinden}
                aria-describedby={grundZeile(c)}
                onClick={() => void run(c.id, async () => ergebnis(c.id, await sync({ data: c.id })))}
              >
                {busy === c.id ? "Rufe ab …" : "Jetzt abrufen"}
              </button>
            )}
          </div>
          {offen?.fuer === c.id && (
            <div style={{ flexBasis: "100%" }}>
              <SchrittForm key={offen.schritt.vorgang} schritt={offen.schritt} onSchritt={(s) => ergebnis(c.id, s)} onAbbrechen={() => setOffen(null)} />
            </div>
          )}
        </div>
      ))}

      {meldungen.length > 0 && (
        <ul className="upload-messages" role="status">
          {meldungen.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
