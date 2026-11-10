import { formatEuro } from "@haben/core";
import { formatDate } from "../../lib/format.ts";
import type { getReservations } from "../../server/functions/pms.ts";

type Reservation = Awaited<ReturnType<typeof getReservations>>[number];

const nights = (arrival: string, departure: string) => Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86_400_000);

/** Schreibgeschützte Reservierungsübersicht mit den vorhandenen PMS-Aktionen. */
export function ReservationDetails({
  reservation,
  billingStatus,
  busy,
  onEdit,
  onInvoice,
  onCancel,
}: {
  reservation: Reservation;
  billingStatus: string | null;
  busy: boolean;
  onEdit: () => void;
  onInvoice: () => void;
  onCancel: () => void;
}) {
  const totalNights = reservation.items.reduce((sum, item) => sum + nights(item.arrivalDate, item.departureDate), 0);
  const total = reservation.items.reduce((sum, item) => sum + nights(item.arrivalDate, item.departureDate) * item.unitPrice, 0);
  return (
    <div className="side-dialog-stack">
      <div className="side-dialog-section-head">
        <h3>Übersicht</h3>
      </div>
      <dl className="detail-list">
        <div>
          <dt>Gast</dt>
          <dd>{reservation.contactName}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{reservation.status === "canceled" ? "Storniert" : "Bestätigt"}</dd>
        </div>
        <div>
          <dt>Nächte</dt>
          <dd>{totalNights}</dd>
        </div>
        <div>
          <dt>Gesamtbetrag</dt>
          <dd>{formatEuro(total)}</dd>
        </div>
        <div>
          <dt>Zahlungsstatus</dt>
          <dd>{billingStatus ?? (reservation.invoiceId ? "Entwurf" : "Nicht berechnet")}</dd>
        </div>
      </dl>
      <div className="reservation-detail-items">
        {reservation.items.map((item) => (
          <article key={item.id}>
            <strong>
              Zimmer {item.roomNumber}
              {item.roomName ? ` · ${item.roomName}` : ""}
            </strong>
            <span>
              {formatDate(item.arrivalDate)} – {formatDate(item.departureDate)} · {nights(item.arrivalDate, item.departureDate)} Nächte
            </span>
            {item.articleDescription && (
              <span>
                {item.articleDescription} · {formatEuro(item.unitPrice)}
              </span>
            )}
            {item.description && <span>{item.description}</span>}
          </article>
        ))}
      </div>
      {reservation.status === "confirmed" && (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onEdit}>
            Bearbeiten
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onInvoice}>
            {busy ? "Erstelle …" : reservation.invoiceId ? "Rechnung anzeigen" : "Rechnung erstellen"}
          </button>
          <button type="button" className="btn btn-danger" onClick={onCancel}>
            Stornieren
          </button>
        </div>
      )}
    </div>
  );
}
