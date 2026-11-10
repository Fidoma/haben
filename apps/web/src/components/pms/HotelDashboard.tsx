import { formatEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import { getHotelStatistics } from "../../server/functions/pms.ts";

type Statistics = Awaited<ReturnType<typeof getHotelStatistics>>;
type Period = "current-year" | "last-year" | "current-month" | "last-month" | "all";

const periodLabels: Record<Period, string> = {
  "current-year": "Dieses Jahr",
  "last-year": "Letztes Jahr",
  "current-month": "Dieser Monat",
  "last-month": "Letzter Monat",
  all: "Gesamter Zeitraum",
};

const percent = (basisPoints: number) => `${(basisPoints / 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
const decimal = (value: number) => value.toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Betriebswirtschaftliche Gesamtsicht über alle aktiven Zimmer. */
export function HotelDashboard() {
  const loadStatistics = useServerFn(getHotelStatistics);
  const [period, setPeriod] = useState<Period>("current-year");
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void loadStatistics({ data: { period } })
      .then((value) => {
        if (current) setStatistics(value);
      })
      .catch(() => {
        if (current) setError("Die Hotelstatistik konnte nicht geladen werden.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [loadStatistics, period]);

  return (
    <div className="hotel-dashboard">
      <label className="room-period">
        Zeitraum
        <select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
          {Object.entries(periodLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {loading && <p className="muted room-dashboard-loading">Hotelstatistik wird geladen …</p>}
      {error && <p className="notice danger">{error}</p>}
      {!loading && statistics && <StatisticsContent statistics={statistics} />}
    </div>
  );
}

function StatisticsContent({ statistics }: { statistics: Statistics }) {
  const maxRevenue = Math.max(0, ...statistics.revenueSeries.map((point) => point.revenue));
  const maxRoomRevenue = Math.max(0, ...statistics.topRooms.map((room) => room.revenue));
  const maxCustomerRevenue = Math.max(0, ...statistics.topCustomers.map((customer) => customer.revenue));
  return (
    <>
      <div className="room-kpis">
        <article>
          <span>Hotelumsatz</span>
          <strong>{formatEuro(statistics.revenue)}</strong>
          <small>netto, festgeschrieben</small>
        </article>
        <article>
          <span>Zimmernächte</span>
          <strong>{statistics.occupiedNights}</strong>
          <small>{statistics.futureNights} weitere geplant</small>
        </article>
        <article>
          <span>Auslastung</span>
          <strong>{percent(statistics.occupancyBasisPoints)}</strong>
          <small>{statistics.availableNights} verfügbare Zimmernächte</small>
        </article>
        <article>
          <span>Stornierungen</span>
          <strong>{statistics.canceledReservations}</strong>
          <small>Quote {percent(statistics.cancellationBasisPoints)}</small>
        </article>
      </div>
      <div className="room-micro-kpis" aria-label="Weitere Kennzahlen">
        <span>
          Aktive Zimmer <strong>{statistics.activeRooms}</strong>
        </span>
        <span>
          ADR <strong>{statistics.adr === null ? "–" : formatEuro(statistics.adr)}</strong>
        </span>
        <span>
          RevPAR <strong>{statistics.revPar === null ? "–" : formatEuro(statistics.revPar)}</strong>
        </span>
        <span>
          Ø Aufenthalt <strong>{statistics.averageStay === null ? "–" : `${decimal(statistics.averageStay)} Nächte`}</strong>
        </span>
      </div>
      {statistics.unattributedReservations > 0 && (
        <p className="small muted room-revenue-note">
          {statistics.unattributedReservations} {statistics.unattributedReservations === 1 ? "Rechnung ist" : "Rechnungen sind"} wegen abweichender Positionen
          nicht eindeutig Zimmern zuordenbar.
        </p>
      )}

      <section className="room-dashboard-section" aria-labelledby="hotel-revenue-title">
        <div className="room-dashboard-section-head">
          <h3 id="hotel-revenue-title">Umsatzentwicklung</h3>
          <span className="small muted">Netto</span>
        </div>
        {maxRevenue === 0 ? (
          <p className="muted room-empty">Noch kein zuordenbarer, festgeschriebener Umsatz.</p>
        ) : (
          <div className="room-revenue-chart" role="img" aria-label="Hotelumsatz nach Zeitraum">
            {statistics.revenueSeries.map((point) => (
              <div key={point.key} title={`${point.label}: ${formatEuro(point.revenue)}`}>
                <span className="room-revenue-bar" style={{ height: `${Math.max(2, (Math.max(0, point.revenue) / maxRevenue) * 100)}%` }} />
                <small>{point.label.split(".")[0]}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="hotel-ranking-grid">
        <Ranking title="Top 5 Zimmer" subtitle="nach Umsatz" empty="Noch keine Zimmerumsätze.">
          {statistics.topRooms.map((room) => (
            <li key={room.id}>
              <div>
                <strong>Zimmer {room.number}</strong>
                <span className="small muted">
                  {room.nights} {room.nights === 1 ? "Nacht" : "Nächte"}
                </span>
              </div>
              <span className="mono">{formatEuro(room.revenue)}</span>
              <i style={{ width: `${maxRoomRevenue === 0 ? 0 : (room.revenue / maxRoomRevenue) * 100}%` }} />
            </li>
          ))}
        </Ranking>
        <Ranking title="Top 5 Kunden" subtitle="nach Umsatz" empty="In diesem Zeitraum gibt es keine Aufenthalte.">
          {statistics.topCustomers.map((customer) => (
            <li key={customer.id}>
              <div>
                <strong>{customer.name}</strong>
                <span className="small muted">
                  {customer.nights} {customer.nights === 1 ? "Zimmernacht" : "Zimmernächte"}
                </span>
              </div>
              <span className="mono">{formatEuro(customer.revenue)}</span>
              <i style={{ width: `${maxCustomerRevenue === 0 ? 0 : (customer.revenue / maxCustomerRevenue) * 100}%` }} />
            </li>
          ))}
        </Ranking>
      </div>
    </>
  );
}

function Ranking({ title, subtitle, empty, children }: { title: string; subtitle: string; empty: string; children: ReactNode }) {
  const hasEntries = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="room-dashboard-section">
      <div className="room-dashboard-section-head">
        <h3>{title}</h3>
        <span className="small muted">{subtitle}</span>
      </div>
      {hasEntries ? <ol className="room-customer-list">{children}</ol> : <p className="muted room-empty">{empty}</p>}
    </section>
  );
}
