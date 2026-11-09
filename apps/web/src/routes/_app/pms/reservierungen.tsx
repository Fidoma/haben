import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { ReservationForm } from "../../../components/pms/ReservationForm.tsx";
import { errorMessage, formatDate } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { cancelPmsReservation, getReservationFormOptions, getReservations } from "../../../server/functions/pms.ts";

export const Route = createFileRoute("/_app/pms/reservierungen")({
  loader: async () => {
    const [reservations, options] = await Promise.all([getReservations(), getReservationFormOptions()]);
    return { reservations, options };
  },
  head: () => ({ meta: [{ title: "Reservierungen · Haben" }] }),
  component: ReservationsPage,
});

type Reservation = Awaited<ReturnType<typeof getReservations>>[number];
const nights = (arrival: string, departure: string) => Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86_400_000);

function ReservationsPage() {
  const { reservations, options } = Route.useLoaderData();
  const router = useRouter();
  const cancel = useServerFn(cancelPmsReservation);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Reservation | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [showCanceled, setShowCanceled] = useState(false);
  const active = reservations.filter((reservation) => reservation.status === "confirmed");
  const canceled = reservations.filter((reservation) => reservation.status === "canceled");
  const shown = showCanceled ? canceled : active;
  const formOpen = creating || editing !== null;

  async function cancelReservation(id: string) {
    try {
      await cancel({ data: { id } });
      await router.invalidate();
      setNotice({ tone: "ok", text: "Reservierung storniert." });
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">PMS</div>
          <h1>Reservierungen</h1>
        </div>
        {!formOpen && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
              setNotice(null);
            }}
          >
            Neue Reservierung
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Aufenthalte einem Kunden und einem Zimmer zuordnen. Stornierte Reservierungen bleiben nachvollziehbar erhalten.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {formOpen && (
          <ReservationForm
            key={editing?.id ?? "neu"}
            reservation={editing}
            options={options}
            onDone={(nextNotice) => {
              setEditing(null);
              setCreating(false);
              setNotice(nextNotice);
            }}
          />
        )}
        <NoticeBanner notice={notice} />
        <section className="card" aria-label="Reservierungsliste">
          <div className="chip-row" role="group" aria-label="Filter">
            <button type="button" className={`chip${showCanceled ? "" : " active"}`} aria-pressed={!showCanceled} onClick={() => setShowCanceled(false)}>
              Aktiv ({active.length})
            </button>
            <button type="button" className={`chip${showCanceled ? " active" : ""}`} aria-pressed={showCanceled} onClick={() => setShowCanceled(true)}>
              Storniert ({canceled.length})
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {showCanceled ? "Keine stornierten Reservierungen." : "Noch keine Reservierungen. Lege die erste mit „Neue Reservierung“ an."}
            </p>
          ) : (
            <div className="table">
              <div className="table-row head reservation-cols">
                <div>Aufenthalt</div>
                <div>Zimmer</div>
                <div>Kunde</div>
                <div className="num">Nächte</div>
                <div />
              </div>
              {shown.map((reservation) => (
                <ReservationRow
                  key={reservation.id}
                  reservation={reservation}
                  onEdit={() => {
                    setCreating(false);
                    setEditing(reservation);
                    setNotice(null);
                  }}
                  onCancel={() => setConfirming(reservation)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={confirming !== null}
        title={`Reservierung für Zimmer ${confirming?.roomNumber ?? ""} stornieren?`}
        confirmLabel="Stornieren"
        danger
        facts={
          confirming
            ? [
                { label: "Zimmer", value: `${confirming.roomNumber}${confirming.roomName ? ` · ${confirming.roomName}` : ""}` },
                { label: "Zeitraum", value: `${formatDate(confirming.arrivalDate)} – ${formatDate(confirming.departureDate)}` },
              ]
            : undefined
        }
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && void cancelReservation(confirming.id)}
      >
        <p>Die Stornierung ist dauerhaft. Der Zeitraum wird für neue Reservierungen wieder freigegeben.</p>
      </ConfirmDialog>
    </>
  );
}

function ReservationRow({ reservation, onEdit, onCancel }: { reservation: Reservation; onEdit: () => void; onCancel: () => void }) {
  return (
    <div className="table-row reservation-cols">
      <div className="reservation-period">
        {formatDate(reservation.arrivalDate)} – {formatDate(reservation.departureDate)}
        {reservation.status === "canceled" && <span className="reservation-status">Storniert</span>}
      </div>
      <div>
        <span className="mono">{reservation.roomNumber}</span>
        {reservation.roomName && <span className="muted small"> · {reservation.roomName}</span>}
      </div>
      <div>{reservation.contactName}</div>
      <div className="num">{nights(reservation.arrivalDate, reservation.departureDate)}</div>
      <div className="actions reservation-actions">
        {reservation.status === "confirmed" && (
          <>
            <button type="button" className="btn btn-sm" aria-label={`Reservierung für Zimmer ${reservation.roomNumber} bearbeiten`} onClick={onEdit}>
              Bearbeiten
            </button>
            <button type="button" className="btn btn-sm" aria-label={`Reservierung für Zimmer ${reservation.roomNumber} stornieren`} onClick={onCancel}>
              Stornieren
            </button>
          </>
        )}
      </div>
    </div>
  );
}
