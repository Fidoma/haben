import { formatEuro } from "@haben/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { ReservationForm } from "../../../components/pms/ReservationForm.tsx";
import { errorMessage, formatDate } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { cancelPmsReservation, createPmsReservationInvoice, getReservationFormOptions, getReservations } from "../../../server/functions/pms.ts";

export const Route = createFileRoute("/_app/pms/reservierungen")({
  validateSearch: z.object({
    edit: z.uuid().optional(),
    q: z.string().optional(),
    status: z.enum(["confirmed", "canceled", "all"]).optional(),
    room: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
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
  const search = Route.useSearch();
  const { edit } = search;
  const router = useRouter();
  const cancel = useServerFn(cancelPmsReservation);
  const createInvoice = useServerFn(createPmsReservationInvoice);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Reservation | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [creatingInvoiceId, setCreatingInvoiceId] = useState<string | null>(null);
  const active = reservations.filter((reservation) => reservation.status === "confirmed");
  const canceled = reservations.filter((reservation) => reservation.status === "canceled");
  const statusFilter = search.status ?? "confirmed";
  const fromFilter = search.from ?? "";
  const toFilter = search.to ?? "";
  const query = (search.q ?? "").trim().toLocaleLowerCase("de");
  const shown = reservations.filter((reservation) => {
    if (statusFilter !== "all" && reservation.status !== statusFilter) return false;
    if (
      query &&
      !`${reservation.contactName} ${reservation.items.map((item) => `${item.roomNumber} ${item.roomName} ${item.description}`).join(" ")}`
        .toLocaleLowerCase("de")
        .includes(query)
    )
      return false;
    if (search.room && !reservation.items.some((item) => item.roomId === search.room)) return false;
    if (fromFilter && !reservation.items.some((item) => item.departureDate > fromFilter)) return false;
    if (toFilter && !reservation.items.some((item) => item.arrivalDate < toFilter)) return false;
    return true;
  });
  const formOpen = creating || editing !== null;

  useEffect(() => {
    if (!edit) return;
    const reservation = reservations.find((candidate) => candidate.id === edit);
    if (!reservation) {
      setNotice({ tone: "danger", text: "Reservierung nicht gefunden." });
      return;
    }
    if (reservation.status === "canceled") {
      setNotice({ tone: "danger", text: "Eine stornierte Reservierung kann nicht bearbeitet werden." });
      return;
    }
    setCreating(false);
    setEditing(reservation);
    setNotice(null);
  }, [edit, reservations]);

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
              if (edit) void router.navigate({ to: "/pms/reservierungen", search: {} });
            }}
          />
        )}
        <NoticeBanner notice={notice} />
        <section className="card" aria-label="Reservierungsliste">
          <form
            className="reservation-filters"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void router.navigate({
                to: "/pms/reservierungen",
                search: {
                  q: String(data.get("q") ?? ""),
                  status: String(data.get("status") ?? "confirmed") as "confirmed" | "canceled" | "all",
                  room: String(data.get("room") ?? ""),
                  from: String(data.get("from") ?? ""),
                  to: String(data.get("to") ?? ""),
                },
              });
            }}
          >
            <label>
              Suche
              <input name="q" type="search" defaultValue={search.q ?? ""} placeholder="Kunde, Zimmer, Notiz" />
            </label>
            <label>
              Status
              <select name="status" defaultValue={statusFilter}>
                <option value="confirmed">Aktiv ({active.length})</option>
                <option value="canceled">Storniert ({canceled.length})</option>
                <option value="all">Alle</option>
              </select>
            </label>
            <label>
              Zimmer
              <select name="room" defaultValue={search.room ?? ""}>
                <option value="">Alle Zimmer</option>
                {options.rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.number}
                    {room.name ? ` · ${room.name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Von
              <input name="from" type="date" defaultValue={search.from ?? ""} />
            </label>
            <label>
              Bis
              <input name="to" type="date" defaultValue={search.to ?? ""} />
            </label>
            <button type="submit" className="btn">
              Filtern
            </button>
          </form>
          {shown.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Keine Reservierungen für diese Filter.
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
