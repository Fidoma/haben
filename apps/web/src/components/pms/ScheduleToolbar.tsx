import { useMemo } from "react";
import { Icon } from "../Icon.tsx";
import type { getReservations } from "../../server/functions/pms.ts";

type Reservation = Awaited<ReturnType<typeof getReservations>>[number];

const reservationReference = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;

/** Zentrale Aktionen und globale Reservierungssuche des Belegungsplans. */
export function ScheduleToolbar({
  reservations,
  query,
  onQuery,
  onReservation,
  onCreateReservation,
  onCreateRoom,
  onArchivedRooms,
  onTourismStatistics,
}: {
  reservations: Reservation[];
  query: string;
  onQuery: (query: string) => void;
  onReservation: (id: string) => void;
  onCreateReservation: () => void;
  onCreateRoom: () => void;
  onArchivedRooms: () => void;
  onTourismStatistics: () => void;
}) {
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("de");
    if (!normalized) return [];
    return reservations
      .filter((reservation) =>
        `${reservation.contactName} ${reservation.id} ${reservationReference(reservation.id)}`.toLocaleLowerCase("de").includes(normalized),
      )
      .slice(0, 8);
  }, [query, reservations]);

  return (
    <div className="schedule-toolbar" aria-label="PMS-Aktionen">
      <div className="schedule-toolbar-actions">
        <button type="button" className="btn btn-primary" aria-label="+ Reservierung" title="Reservierung anlegen" onClick={onCreateReservation}>
          <Icon name="calendar" size={17} />
        </button>
        <button type="button" className="btn" aria-label="+ Zimmer" title="Zimmer anlegen" onClick={onCreateRoom}>
          <Icon name="room" size={17} />
        </button>
        <button type="button" className="btn" aria-label="Archivierte Zimmer" title="Archivierte Zimmer" onClick={onArchivedRooms}>
          <Icon name="archive" size={17} />
        </button>
        <button type="button" className="btn" aria-label="Tourismusstatistik" title="Tourismusstatistik" onClick={onTourismStatistics}>
          <Icon name="reports" size={17} />
        </button>
      </div>
      <div className="schedule-search">
        <label className="visually-hidden" htmlFor="schedule-search">
          Reservierungen suchen
        </label>
        <Icon name="search" size={16} />
        <input
          id="schedule-search"
          type="search"
          value={query}
          placeholder="Gast oder Reservierungsnummer …"
          autoComplete="off"
          onChange={(event) => onQuery(event.target.value)}
        />
        {query.trim() && (
          <div className="schedule-search-results" role="listbox" aria-label="Gefundene Reservierungen">
            {results.length === 0 ? (
              <div className="muted small">Keine Reservierung gefunden.</div>
            ) : (
              results.map((reservation) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  key={reservation.id}
                  onClick={() => {
                    onQuery("");
                    onReservation(reservation.id);
                  }}
                >
                  <strong>{reservation.contactName}</strong>
                  <span>
                    {reservationReference(reservation.id)} · {reservation.items.map((item) => item.roomNumber).join(", ")}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { reservationReference };
