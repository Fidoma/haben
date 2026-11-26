import { billableAmount, billableMinutes, formatDuration, formatEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { serviceEntryNote } from "../lib/zeiteintrag.ts";
import type { getServiceEntries } from "../server/functions/leistungen.ts";
import { Field } from "./Field.tsx";
import type { ServiceEntryRow } from "./ServiceEntryForm.tsx";

type Customers = Awaited<ReturnType<typeof getServiceEntries>>["customers"];

/** Der Filter der Liste, wie er in der Adresse steht */
export type ServiceEntrySearch = {
  kunde?: string | undefined;
  von?: string | undefined;
  bis?: string | undefined;
  stand?: "offen" | "abgerechnet" | "nicht-abrechenbar" | undefined;
  projekt?: string | undefined;
  taetigkeit?: string | undefined;
};

/** Textfilter: schreibt erst kurz nach dem letzten Tastendruck in die Adresse, damit nicht jeder Buchstabe die Liste neu lädt */
function TextFilter({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string | undefined) => void }) {
  const [text, setText] = useState(value ?? "");
  const sent = useRef(value ?? "");
  useEffect(() => {
    if ((value ?? "") !== sent.current) {
      sent.current = value ?? "";
      setText(value ?? "");
    }
  }, [value]);
  useEffect(() => {
    if (text.trim() === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = text.trim();
      onChange(text.trim() || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [text, onChange]);
  return (
    <Field label={label}>{(control) => <input {...control} type="search" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />}</Field>
  );
}

/** Filter der Liste nach Kunde, Stand, Zeitraum, Projekt und Tätigkeit; sie stehen in der Adresse. Beim Abrechnen ist der Stand fest „offen“. */
export function LeistungsFilter({
  search,
  customers,
  filter,
  standFest,
}: {
  search: ServiceEntrySearch;
  customers: Customers;
  filter: (patch: Partial<ServiceEntrySearch>) => void;
  standFest: boolean;
}) {
  return (
    <div className="stack" style={{ gap: 16 }} role="group" aria-label="Filter">
      <div className="form-row cols-4">
        <Field label="Kunde">
          {(control) => (
            <select {...control} value={search.kunde ?? ""} onChange={(e) => filter({ kunde: e.target.value || undefined })}>
              <option value="">Alle Kunden</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.inactive ? `${c.name} (inaktiv)` : c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Stand">
          {(control) => (
            <select
              {...control}
              value={search.stand ?? ""}
              disabled={standFest}
              onChange={(e) => filter({ stand: (e.target.value || undefined) as typeof search.stand })}
            >
              <option value="">Alle</option>
              <option value="offen">Offen</option>
              <option value="abgerechnet">Abgerechnet</option>
              <option value="nicht-abrechenbar">Nicht abrechenbar</option>
            </select>
          )}
        </Field>
        <Field label="Von">
          {(control) => <input {...control} type="date" value={search.von ?? ""} onChange={(e) => filter({ von: e.target.value || undefined })} />}
        </Field>
        <Field label="Bis">
          {(control) => <input {...control} type="date" value={search.bis ?? ""} onChange={(e) => filter({ bis: e.target.value || undefined })} />}
        </Field>
      </div>
      <div className="form-row cols-2">
        <TextFilter label="Projekt" value={search.projekt} onChange={(projekt) => filter({ projekt })} />
        <TextFilter label="Tätigkeit" value={search.taetigkeit} onChange={(taetigkeit) => filter({ taetigkeit })} />
      </div>
    </div>
  );
}

/**
 * Beim Abrechnen (#1933): Die Liste mit einem aktiven Kunden und Stand „offen“ zeigt genau die Kandidaten, alle zunächst
 * gewählt. `abgewaehlt` sind die, deren Kästchen jemand abgehakt hat; `zuruecksetzen` wählt wieder alle (neuer Filter).
 */
export function useAbrechnenAuswahl(billing: boolean, stand: ServiceEntrySearch["stand"], kunde: Customers[number] | undefined, entries: ServiceEntryRow[]) {
  const [abgewaehlt, setAbgewaehlt] = useState<ReadonlySet<string>>(new Set());
  const waehlbar = billing && stand === "offen" && kunde !== undefined && !kunde.inactive;
  const kandidaten = waehlbar ? entries : [];
  return {
    kunde,
    waehlbar,
    kandidaten,
    gewaehlt: kandidaten.filter((e) => !abgewaehlt.has(e.id)),
    abgewaehlt,
    zuruecksetzen: () => setAbgewaehlt(new Set()),
    alle: (an: boolean) => setAbgewaehlt(an ? new Set() : new Set(kandidaten.map((e) => e.id))),
    umschalten: (id: string) => setAbgewaehlt((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : new Set(prev).add(id))),
  };
}

/** Kästchen „alle wählen“ über der Liste beim Abrechnen; teilweise gewählt zeigt es den Zwischenzustand */
export function AlleWaehlen({ gewaehlt, gesamt, onChange }: { gewaehlt: number; gesamt: number; onChange: (alle: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <input
        type="checkbox"
        className="row-check"
        ref={(el) => {
          if (el) el.indeterminate = gewaehlt > 0 && gewaehlt < gesamt;
        }}
        checked={gesamt > 0 && gewaehlt === gesamt}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{gewaehlt === gesamt ? `Alle ${gesamt} Einträge gewählt` : `${gewaehlt} von ${gesamt} Einträgen gewählt`}</span>
    </label>
  );
}

/** Kopfzeile der Liste; `wahl` lässt vorn Platz für die Kästchen */
export function LeistungsKopf({ wahl }: { wahl: boolean }) {
  return (
    <div className={wahl ? "table-row head service-cols service-pick" : "table-row head service-cols"}>
      {wahl && <div />}
      <div>Tag</div>
      <div>Kunde und Tätigkeit</div>
      <div className="num">Dauer</div>
      <div className="num">Satz</div>
      <div className="num">Betrag</div>
      <div />
    </div>
  );
}

/** Ein Zeiteintrag; auf einer Rechnung lässt er sich weder bearbeiten noch löschen. `wahl` zeigt vorn das Kästchen zum Abrechnen. */
export function LeistungsZeile({
  e,
  kunde,
  bearbeiten,
  loeschen,
  wahl,
}: {
  e: ServiceEntryRow;
  kunde: string;
  bearbeiten: () => void;
  loeschen: () => void;
  wahl?: { gewaehlt: boolean; onChange: () => void };
}) {
  return (
    <div className={wahl ? "table-row service-cols service-pick" : "table-row service-cols"}>
      {wahl && (
        <div>
          <input
            type="checkbox"
            className="row-check"
            checked={wahl.gewaehlt}
            onChange={wahl.onChange}
            aria-label={`Eintrag vom ${formatDate(e.workedOn)} abrechnen`}
          />
        </div>
      )}
      <div>{formatDate(e.workedOn)}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflowWrap: "anywhere" }}>
          <span style={{ fontWeight: 500 }}>{kunde}</span>
          {e.description && <span className="muted"> · {e.description}</span>}
        </div>
        {serviceEntryNote(e) && (
          <div className="small muted" style={{ overflowWrap: "anywhere" }}>
            {serviceEntryNote(e)}
          </div>
        )}
        {e.invoiceId && (
          <div className="small">
            <Link to="/rechnungen/$id" params={{ id: e.invoiceId }}>
              {e.invoiceNumber ? `Rechnung ${e.invoiceNumber}` : "Rechnungsentwurf"}
            </Link>
          </div>
        )}
      </div>
      <div className="num">
        {formatDuration(e.minutes)} Std.
        {!e.nonBillable && e.billableMinutes !== null && (
          <div className="small muted">
            <abbr title="abrechenbar">abr.</abbr> {formatDuration(e.billableMinutes)}
          </div>
        )}
      </div>
      <div className="num">{e.hourlyRateCents === null ? <span className="muted">fehlt</span> : formatEuro(e.hourlyRateCents)}</div>
      <div className="num">{e.hourlyRateCents === null || e.nonBillable ? "" : formatEuro(billableAmount(e))}</div>
      <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={e.invoiceId !== null}
          title={e.invoiceId ? "Auf einer Rechnung: erst den Entwurf löschen oder die Rechnung stornieren" : undefined}
          aria-label={`Eintrag vom ${formatDate(e.workedOn)} bearbeiten`}
          onClick={bearbeiten}
        >
          Bearbeiten
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={e.invoiceId !== null}
          title={e.invoiceId ? "Auf einer Rechnung: erst den Entwurf löschen oder die Rechnung stornieren" : undefined}
          aria-label={`Eintrag vom ${formatDate(e.workedOn)} löschen`}
          onClick={loeschen}
        >
          Löschen
        </button>
      </div>
    </div>
  );
}

/** Summe der gezeigten Einträge: Dauer, davon abrechenbar und Betrag; Einträge ohne Stundensatz zählen beim Betrag nicht */
export function LeistungsSumme({ entries }: { entries: ServiceEntryRow[] }) {
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const totalBillable = entries.reduce((sum, e) => sum + billableMinutes(e), 0);
  const totalCents = entries.reduce((sum, e) => sum + billableAmount(e), 0);
  const withoutRate = entries.filter((e) => e.hourlyRateCents === null && !e.nonBillable).length;
  return (
    <p className="muted small" style={{ margin: 0 }}>
      {entries.length} {entries.length === 1 ? "Eintrag" : "Einträge"}, {formatDuration(totalMinutes)} Std., davon abrechenbar {formatDuration(totalBillable)}{" "}
      Std. mit {formatEuro(totalCents)}
      {withoutRate > 0 && ` (${withoutRate} ohne Stundensatz nicht gerechnet)`}.
    </p>
  );
}
