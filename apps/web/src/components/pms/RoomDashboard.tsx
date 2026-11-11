import { formatEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { formatDate } from "../../lib/format.ts";
import { getRoomStatistics } from "../../server/functions/pms.ts";

type Room = {
  id: string;
  number: string;
  name: string;
  capacity: number;
  cleaningStatus: "clean" | "dirty";
  archivedAt: Date | null;
};
type Statistics = NonNullable<Awaited<ReturnType<typeof getRoomStatistics>>>;
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

export function RoomDashboard({
  room,
  busy,
  onEdit,
  onArchive,
  onReservation,
  onCleaningStatus,
}: {
  room: Room;
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onReservation: (id: string) => void;
  onCleaningStatus: (status: "clean" | "dirty") => void;
}) {
  const loadStatistics = useServerFn(getRoomStatistics);
  const [period, setPeriod] = useState<Period>("current-year");
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void loadStatistics({ data: { roomId: room.id, period } })
      .then((value) => {
        if (current) setStatistics(value);
      })
      .catch(() => {
        if (current) setError("Die Zimmerstatistik konnte nicht geladen werden.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [loadStatistics, period, room.id]);

  return (
    <div className="room-dashboard">
      <div className="room-dashboard-summary">
        <div>
          <strong>{room.name || "Ohne Bezeichnung"}</strong>
          <span className="small muted">
            Kapazität {room.capacity} · {room.archivedAt ? "Archiviert" : "Aktiv"}
          </span>
        </div>
        {!room.archivedAt && (
          <div className="room-dashboard-actions">
            <button type="button" className="btn btn-primary" onClick={onEdit}>
              Bearbeiten
            </button>
            <details className="room-more-actions">
              <summary className="icon-btn" aria-label="Weitere Aktionen">
                •••
              </summary>
              <div>
                <button type="button" onClick={onArchive}>
                  Archivieren
                </button>
              </div>
            </details>
          </div>
        )}
      </div>

      <label className="room-period">
        Zeitraum
        {/* biome-ignore lint/plugin: Kompakter Filter der Statistik, kein Formularfeld. */}
        <select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
          {Object.entries(periodLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {loading && <p className="muted room-dashboard-loading">Zimmerstatistik wird geladen …</p>}
      {error && <p className="notice danger">{error}</p>}
      {!loading && statistics && <StatisticsContent statistics={statistics} onReservation={onReservation} />}

      <section className="room-dashboard-section" aria-labelledby="room-cleaning-title">
        <div className="room-dashboard-section-head">
          <div>
            <h3 id="room-cleaning-title">Zimmerstatus</h3>
            <p className="small muted">Housekeeping-Status direkt aktualisieren.</p>
          </div>
          <div className="segmented room-cleaning-actions">
            <button
              type="button"
              disabled={busy || room.archivedAt !== null}
              aria-pressed={room.cleaningStatus === "clean"}
              onClick={() => onCleaningStatus("clean")}
            >
              Sauber
            </button>
            <button
              type="button"
              disabled={busy || room.archivedAt !== null}
              aria-pressed={room.cleaningStatus === "dirty"}
              onClick={() => onCleaningStatus("dirty")}
            >
              Zu reinigen
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatisticsContent({ statistics, onReservation }: { statistics: Statistics; onReservation: (id: string) => void }) {
  const maxRevenue = Math.max(0, ...statistics.revenueSeries.map((point) => point.revenue));
  const maxCustomerRevenue = Math.max(0, ...statistics.topCustomers.map((customer) => customer.revenue));
  return (
    <>
      <div className="room-kpis">
        <article>
          <span>Zimmerumsatz</span>
          <strong>{formatEuro(statistics.revenue)}</strong>
          <small>netto, festgeschrieben</small>
        </article>
        <article>
          <span>Übernachtungen</span>
          <strong>{statistics.occupiedNights}</strong>
          <small>{statistics.futureNights} weitere geplant</small>
        </article>
        <article>
          <span>Auslastung</span>
          <strong>{percent(statistics.occupancyBasisPoints)}</strong>
          <small>{statistics.availableNights} verfügbare Nächte</small>
        </article>
        <article>
          <span>Stornierungen</span>
          <strong>{statistics.canceledReservations}</strong>
          <small>Quote {percent(statistics.cancellationBasisPoints)}</small>
        </article>
      </div>
      <div className="room-micro-kpis" aria-label="Weitere Kennzahlen">
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
          nicht eindeutig einem Zimmer zuordenbar.
        </p>
      )}

      <section className="room-dashboard-section" aria-labelledby="room-revenue-title">
        <div className="room-dashboard-section-head">
          <h3 id="room-revenue-title">Umsatzentwicklung</h3>
          <span className="small muted">Netto</span>
        </div>
        {maxRevenue === 0 ? (
          <p className="muted room-empty">Noch kein zuordenbarer, festgeschriebener Umsatz.</p>
        ) : (
          <div className="room-revenue-chart" role="img" aria-label="Zimmerumsatz nach Zeitraum">
            {statistics.revenueSeries.map((point) => (
              <div key={point.key} title={`${point.label}: ${formatEuro(point.revenue)}`}>
                <span className="room-revenue-bar" style={{ height: `${Math.max(2, (Math.max(0, point.revenue) / maxRevenue) * 100)}%` }} />
                <small>{point.label.split(".")[0]}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="room-dashboard-section" aria-labelledby="room-customers-title">
        <div className="room-dashboard-section-head">
          <h3 id="room-customers-title">Top 5 Kunden</h3>
          <span className="small muted">nach Umsatz</span>
        </div>
        {statistics.topCustomers.length === 0 ? (
          <p className="muted room-empty">In diesem Zeitraum gibt es keine Aufenthalte.</p>
        ) : (
          <ol className="room-customer-list">
            {statistics.topCustomers.map((customer) => (
              <li key={customer.id}>
                <div>
                  <strong>{customer.name}</strong>
                  <span className="small muted">
                    {customer.nights} {customer.nights === 1 ? "Nacht" : "Nächte"}
                  </span>
                </div>
                <span className="mono">{formatEuro(customer.revenue)}</span>
                <i style={{ width: `${maxCustomerRevenue === 0 ? 0 : (customer.revenue / maxCustomerRevenue) * 100}%` }} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="room-dashboard-section" aria-labelledby="room-history-title">
        <div className="room-dashboard-section-head">
          <h3 id="room-history-title">Letzte Reservierungen</h3>
          <span className="small muted">{statistics.completedReservations} abgeschlossen</span>
        </div>
        {statistics.recentReservations.length === 0 ? (
          <p className="muted room-empty">Für dieses Zimmer gibt es noch keine Reservierungen.</p>
        ) : (
          <div className="room-reservation-list">
            {statistics.recentReservations.map((reservation) => (
              <button type="button" key={reservation.id} onClick={() => onReservation(reservation.id)}>
                <span>
                  <strong>{reservation.contactName}</strong>
                  <small>
                    {formatDate(reservation.arrival)} – {formatDate(reservation.departure)}
                  </small>
                </span>
                <span className={`pill ${reservation.status === "canceled" ? "danger" : ""}`}>
                  {reservation.status === "canceled" ? "Storniert" : "Bestätigt"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
