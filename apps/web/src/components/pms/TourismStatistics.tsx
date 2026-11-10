import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { errorMessage } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { exportPmsTourismReport, getPmsTourismReport, savePmsTourismReport } from "../../server/functions/pms.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";

type LoadedReport = Awaited<ReturnType<typeof getPmsTourismReport>>;

/** Monatsbericht mit Laden, Speichern und HOTE-Export für Seite und PMS-Dialog. */
export function TourismStatistics({ initial, year, month }: { initial: LoadedReport; year: number; month: number }) {
  const load = useServerFn(getPmsTourismReport);
  const save = useServerFn(savePmsTourismReport);
  const exportReport = useServerFn(exportPmsTourismReport);
  const [loaded, setLoaded] = useState(initial);
  const [period, setPeriod] = useState({ year, month });
  const [report, setReport] = useState(() => ({ ...initial.report, values: initial.report.values.map((row) => ({ ...row })) }));
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const total = (key: "arrivals" | "overnightStays") => report.values.reduce((sum, row) => sum + row[key], 0);

  async function loadPeriod(next: { year: number; month: number }) {
    setPending(true);
    setNotice(null);
    try {
      const result = await load({ data: next });
      setLoaded(result);
      setReport({ ...result.report, values: result.report.values.map((row) => ({ ...row })) });
      setPeriod(next);
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    } finally {
      setPending(false);
    }
  }

  async function submit() {
    setPending(true);
    try {
      await save({ data: report });
      setNotice({ tone: "ok", text: "Monatsbericht gespeichert." });
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    } finally {
      setPending(false);
    }
  }

  async function download() {
    try {
      const result = await exportReport({ data: { report, includeHeader: true } });
      const bytes = Uint8Array.from(atob(result.content), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "text/csv;charset=windows-1252" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    }
  }

  function value(key: keyof typeof report, next: string) {
    setReport((current) => ({ ...current, [key]: key === "remarks" ? next : Number(next) }));
  }

  return (
    <div className="tourism-dialog-content">
      <form
        className="card tourism-period"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void loadPeriod({ year: Number(data.get("year")), month: Number(data.get("month")) });
        }}
      >
        <label>
          Jahr
          <input name="year" type="number" min="2000" max="2200" defaultValue={period.year} />
        </label>
        <label>
          Monat
          <input name="month" type="number" min="1" max="12" defaultValue={period.month} />
        </label>
        <button className="btn" type="submit" disabled={pending}>
          Monat laden
        </button>
      </form>
      <NoticeBanner notice={notice} />
      <section className="card tourism-summary">
        <h2>Monatswerte</h2>
        <div className="form-grid cols-3">
          <label>
            Angebotene Betten
            <input type="number" min="0" value={report.bedsOffered} onChange={(event) => value("bedsOffered", event.target.value)} />
          </label>
          <label>
            Angebotene Gästezimmertage
            <input type="number" min="0" value={report.availableGuestRoomDays} onChange={(event) => value("availableGuestRoomDays", event.target.value)} />
          </label>
          <label>
            Belegte Gästezimmertage
            <input type="number" min="0" value={report.occupiedGuestRoomDays} onChange={(event) => value("occupiedGuestRoomDays", event.target.value)} />
          </label>
        </div>
        <label>
          Bemerkungen
          <textarea value={report.remarks} maxLength={1000} onChange={(event) => value("remarks", event.target.value)} />
        </label>
      </section>
      <section className="card tourism-countries">
        <h2>Wohnsitzländer</h2>
        <p className="muted small">Vorbelegt aus dem Wohnsitzland des Rechnungskontakts. Gast und Rechnungskontakt sind in dieser ersten Stufe identisch.</p>
        <div className="table">
          <div className="table-row head tourism-cols">
            <div>Land</div>
            <div>Ankünfte</div>
            <div>Übernachtungen</div>
          </div>
          {loaded.countries.map((country) => {
            const index = report.values.findIndex((row) => row.countryKey === country.key);
            const row = report.values[index]!;
            return (
              <div className="table-row tourism-cols" key={country.key}>
                <div>
                  {country.label} <span className="muted small">({country.code})</span>
                </div>
                <input
                  aria-label={`Ankünfte ${country.label}`}
                  type="number"
                  min="0"
                  value={row.arrivals}
                  onChange={(event) =>
                    setReport((current) => ({
                      ...current,
                      values: current.values.map((item, itemIndex) => (itemIndex === index ? { ...item, arrivals: Number(event.target.value) } : item)),
                    }))
                  }
                />
                <input
                  aria-label={`Übernachtungen ${country.label}`}
                  type="number"
                  min="0"
                  value={row.overnightStays}
                  onChange={(event) =>
                    setReport((current) => ({
                      ...current,
                      values: current.values.map((item, itemIndex) => (itemIndex === index ? { ...item, overnightStays: Number(event.target.value) } : item)),
                    }))
                  }
                />
              </div>
            );
          })}
        </div>
        <p>
          <strong>Gesamt:</strong> {total("arrivals")} Ankünfte · {total("overnightStays")} Übernachtungen
        </p>
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void submit()}>
            Speichern
          </button>
          <button type="button" className="btn" onClick={() => void download()}>
            HOTE-CSV exportieren
          </button>
        </div>
      </section>
    </div>
  );
}
