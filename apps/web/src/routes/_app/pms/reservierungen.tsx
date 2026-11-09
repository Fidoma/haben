import { formatEuro } from "@haben/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { ReservationForm } from "../../../components/pms/ReservationForm.tsx";
import { errorMessage, formatDate } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { cancelPmsReservation, createPmsReservationInvoice, getReservationFormOptions, getReservations } from "../../../server/functions/pms.ts";

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
  const createInvoice = useServerFn(createPmsReservationInvoice);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Reservation | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [showCanceled, setShowCanceled] = useState(false);
  const [creatingInvoiceId, setCreatingInvoiceId] = useState<string | null>(null);
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

  async function invoiceReservation(id: string) {
    setCreatingInvoiceId(id);
    setNotice(null);
    try {
      const invoice = await createInvoice({ data: { id } });
      await router.navigate({ to: "/rechnungen/$id", params: { id: invoice.id } });
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
      setCreatingInvoiceId(null);
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
        Einen oder mehrere Zimmeraufenthalte einem Kunden zuordnen. Stornierte Reservierungen bleiben nachvollziehbar erhalten.
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
                  onInvoice={() =>
                    reservation.invoiceId
                      ? void router.navigate({ to: "/rechnungen/$id", params: { id: reservation.invoiceId } })
                      : void invoiceReservation(reservation.id)
                  }
                  creatingInvoice={creatingInvoiceId === reservation.id}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={confirming !== null}
        title="Reservierung stornieren?"
        confirmLabel="Stornieren"
        danger
        facts={
          confirming
            ? [
                { label: "Kunde", value: confirming.contactName },
                { label: "Positionen", value: String(confirming.items.length) },
                { label: "Zimmer", value: confirming.items.map((item) => item.roomNumber).join(", ") },
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

function ReservationRow({
  reservation,
  onEdit,
  onCancel,
  onInvoice,
  creatingInvoice,
}: {
  reservation: Reservation;
  onEdit: () => void;
  onCancel: () => void;
  onInvoice: () => void;
  creatingInvoice: boolean;
}) {
  return (
    <div className="table-row reservation-cols">
      <div className="reservation-period">
        {reservation.items.map((item) => (
          <span key={item.id}>
            {formatDate(item.arrivalDate)} – {formatDate(item.departureDate)}
          </span>
        ))}
        {reservation.status === "canceled" && <span className="reservation-status">Storniert</span>}
      </div>
      <div className="reservation-room-list">
        {reservation.items.map((item) => (
          <span key={item.id}>
            <span className="mono">{item.roomNumber}</span>
            {item.roomName && <span className="muted small"> · {item.roomName}</span>}
            {item.articleDescription && (
              <span className="muted small">
                {" · "}
                {item.articleNumber ? `${item.articleNumber} · ` : ""}
                {item.articleDescription} · {formatEuro(item.unitPrice)}
              </span>
            )}
            {item.description && <span className="muted small"> · {item.description}</span>}
          </span>
        ))}
      </div>
      <div>{reservation.contactName}</div>
      <div className="num">{reservation.items.reduce((sum, item) => sum + nights(item.arrivalDate, item.departureDate), 0)}</div>
      <div className="actions reservation-actions">
        {reservation.status === "confirmed" && (
          <>
            <button type="button" className="btn btn-sm btn-primary" disabled={creatingInvoice} onClick={onInvoice}>
              {creatingInvoice ? "Erstelle …" : reservation.invoiceId ? "Rechnung anzeigen" : "Rechnung erstellen"}
            </button>
            <button type="button" className="btn btn-sm" aria-label={`Reservierung für ${reservation.contactName} bearbeiten`} onClick={onEdit}>
              Bearbeiten
            </button>
            <button type="button" className="btn btn-sm" aria-label={`Reservierung für ${reservation.contactName} stornieren`} onClick={onCancel}>
              Stornieren
            </button>
          </>
        )}
      </div>
    </div>
  );
}
