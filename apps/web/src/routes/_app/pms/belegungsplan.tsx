import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { z } from "zod";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { FormDialog } from "../../../components/pms/FormDialog.tsx";
import { HotelDashboard } from "../../../components/pms/HotelDashboard.tsx";
import { PmsSettingsForm } from "../../../components/pms/PmsSettingsForm.tsx";
import { ReservationDetails } from "../../../components/pms/ReservationDetails.tsx";
import { ReservationForm } from "../../../components/pms/ReservationForm.tsx";
import { ReservationSchedule, type ScheduleSelection } from "../../../components/pms/ReservationSchedule.tsx";
import { RoomDashboard } from "../../../components/pms/RoomDashboard.tsx";
import { RoomForm } from "../../../components/pms/RoomForm.tsx";
import { ScheduleToolbar, reservationReference } from "../../../components/pms/ScheduleToolbar.tsx";
import { SideDialog } from "../../../components/pms/SideDialog.tsx";
import { TourismStatistics } from "../../../components/pms/TourismStatistics.tsx";
import { errorMessage } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import {
  archiveRoom,
  cancelPmsReservation,
  createPmsReservationInvoice,
  getReservationFormOptions,
  getReservationSchedule,
  getReservations,
  getPmsInvoices,
  getRooms,
  getPmsTourismReport,
  updateRoomCleaningStatus,
} from "../../../server/functions/pms.ts";
import styles from "../../../styles/pms-schedule.css?url";
const searchSchema = z.object({ start: z.string().optional(), end: z.string().optional() });
export const Route = createFileRoute("/_app/pms/belegungsplan")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const now = new Date();
    const tourismPeriod = { year: now.getFullYear(), month: now.getMonth() + 1 };
    const [schedule, options, reservations, rooms, invoices, tourism] = await Promise.all([
      getReservationSchedule({ data: { start: deps.start, end: deps.end } }),
      getReservationFormOptions(),
      getReservations(),
      getRooms(),
      getPmsInvoices(),
      getPmsTourismReport({ data: tourismPeriod }),
    ]);
    return { schedule, options, reservations, rooms, invoices, tourism, tourismPeriod };
  },
  head: () => ({ meta: [{ title: "Belegungsplan · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: SchedulePage,
});
type Reservation = Awaited<ReturnType<typeof getReservations>>[number];
function SchedulePage() {
  const { schedule, options, reservations, rooms: allRooms, invoices, tourism, tourismPeriod } = Route.useLoaderData();
  const router = useRouter();
  const cancel = useServerFn(cancelPmsReservation);
  const createInvoice = useServerFn(createPmsReservationInvoice);
  const setRoomArchived = useServerFn(archiveRoom);
  const setRoomStatus = useServerFn(updateRoomCleaningStatus);
  const [selection, setSelection] = useState<ScheduleSelection | null>(null);
  const [creatingReservation, setCreatingReservation] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const [editingReservation, setEditingReservation] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [editingRoom, setEditingRoom] = useState(false);
  const [showingSettings, setShowingSettings] = useState(false);
  const [showingHotelStatistics, setShowingHotelStatistics] = useState(false);
  const [showingTourismStatistics, setShowingTourismStatistics] = useState(false);
  const [pendingRoomStatus, setPendingRoomStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Reservation | null>(null);
  const [creatingInvoiceId, setCreatingInvoiceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const selectedReservation = reservations.find((reservation) => reservation.id === selectedReservationId) ?? null;
  const selectedInvoice = selectedReservation?.invoiceId ? invoices.find((invoice) => invoice.id === selectedReservation.invoiceId) : undefined;
  const selectedRoom = allRooms.find((room) => room.id === selectedRoomId) ?? null;
  const openReservation = useCallback((reservationId: string) => {
    setEditingReservation(false);
    setSelectedReservationId(reservationId);
  }, []);
  const openRoom = useCallback((roomId: string) => {
    setEditingRoom(false);
    setSelectedRoomId(roomId);
  }, []);
  const selectRange = useCallback((next: ScheduleSelection) => {
    setCreatingReservation(false);
    setSelection(next);
    setNotice(null);
  }, []);
  async function cancelReservation(reservation: Reservation) {
    try {
      await cancel({ data: { id: reservation.id } });
      await router.invalidate();
      setConfirming(null);
      setSelectedReservationId(null);
      setNotice({ tone: "ok", text: "Reservierung storniert." });
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    }
  }
  async function invoiceReservation(reservation: Reservation) {
    if (reservation.invoiceId) {
      await router.navigate({ to: "/rechnungen/$id", params: { id: reservation.invoiceId } });
      return;
    }
    setCreatingInvoiceId(reservation.id);
    try {
      const invoice = await createInvoice({ data: { id: reservation.id } });
      await router.navigate({ to: "/rechnungen/$id", params: { id: invoice.id } });
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
      setCreatingInvoiceId(null);
    }
  }
  async function changeRoomArchive(roomId: string, archived: boolean) {
    try {
      await setRoomArchived({ data: { id: roomId, archived } });
      await router.invalidate();
      setSelectedRoomId(null);
      setNotice({ tone: "ok", text: archived ? "Zimmer archiviert." : "Zimmer wiederhergestellt." });
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    }
  }
  async function changeRoomStatus(roomId: string, status: "clean" | "dirty") {
    setPendingRoomStatus(roomId);
    try {
      await setRoomStatus({ data: { id: roomId, status } });
      await router.invalidate();
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    } finally {
      setPendingRoomStatus(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">PMS</div>
          <h1>Belegungsplan</h1>
        </div>
      </div>
      <ScheduleToolbar
        reservations={reservations}
        query={query}
        onQuery={setQuery}
        onReservation={openReservation}
        onCreateReservation={() => {
          setSelection(null);
          setCreatingReservation(true);
          setNotice(null);
        }}
        onCreateRoom={() => setCreatingRoom(true)}
        onSettings={() => setShowingSettings(true)}
        onHotelStatistics={() => setShowingHotelStatistics(true)}
        onTourismStatistics={() => setShowingTourismStatistics(true)}
      />
      <NoticeBanner notice={notice} />
      {schedule.rooms.length === 0 ? (
        <section className="card schedule-empty">
          <h2>Noch keine Zimmer</h2>
          <p className="muted">Lege zuerst ein Zimmer an, damit es im Belegungsplan erscheint.</p>
          <button type="button" className="btn" onClick={() => setCreatingRoom(true)}>
            + Zimmer
          </button>
        </section>
      ) : (
        <ReservationSchedule data={schedule} onEvent={openReservation} onSelect={selectRange} onRoom={openRoom} />
      )}
      <div className="schedule-legend" aria-label="Legende">
        <span>
          <i className="schedule-legend-mark confirmed" aria-hidden="true" /> Bestätigt
        </span>
        <span>
          <i className="schedule-legend-mark canceled" aria-hidden="true" /> Storniert
        </span>
        <span>
          <i className="schedule-legend-mark paid" aria-hidden="true" /> Bezahlt
        </span>
        <span>
          <i className="schedule-legend-today" aria-hidden="true" /> Heute
        </span>
      </div>
      <section className="room-status" aria-labelledby="room-status-title">
        <h2 id="room-status-title">Zimmerstatus</h2>
        <div className="room-status-columns">
          {[
            { title: "Sauber", status: "clean" as const, next: "dirty" as const, action: "Zu reinigen" },
            { title: "Zu reinigen", status: "dirty" as const, next: "clean" as const, action: "Sauber" },
          ].map((group) => {
            const groupedRooms = allRooms.filter((room) => !room.archivedAt && room.cleaningStatus === group.status);
            return (
              <div className="room-status-group" key={group.status}>
                <h3>
                  {group.title} <span>{groupedRooms.length}</span>
                </h3>
                <div className="room-status-list">
                  {groupedRooms.map((room) => (
                    <button
                      type="button"
                      key={room.id}
                      disabled={pendingRoomStatus === room.id}
                      title={`Als „${group.action}“ markieren`}
                      onClick={() => void changeRoomStatus(room.id, group.next)}
                    >
                      <span>Zimmer {room.number}</span>
                      <span aria-hidden="true">{group.status === "clean" ? "→" : "←"}</span>
                    </button>
                  ))}
                  {groupedRooms.length === 0 && <p className="muted small">Keine Zimmer</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <FormDialog
        open={creatingReservation || selection !== null}
        title="Neue Reservierung"
        onClose={() => {
          setCreatingReservation(false);
          setSelection(null);
        }}
      >
        <ReservationForm
          key={selection ? `${selection.roomId}-${selection.arrivalDate}-${selection.departureDate}` : "neu"}
          reservation={null}
          options={options}
          prefill={selection ?? undefined}
          inDialog
          onDone={(nextNotice) => {
            setCreatingReservation(false);
            setSelection(null);
            setNotice(nextNotice);
          }}
        />
      </FormDialog>
      <FormDialog open={creatingRoom} title="Neues Zimmer" onClose={() => setCreatingRoom(false)}>
        <RoomForm
          room={null}
          inDialog
          onDone={(nextNotice) => {
            setCreatingRoom(false);
            setNotice(nextNotice);
          }}
        />
      </FormDialog>
      <SideDialog
        open={selectedReservation !== null}
        title={editingReservation ? "Reservierung bearbeiten" : (selectedReservation?.contactName ?? "Reservierung")}
        caption={
          selectedReservation
            ? `${reservationReference(selectedReservation.id)} · ${selectedReservation.status === "canceled" ? "Storniert" : "Bestätigt"}`
            : undefined
        }
        onClose={() => {
          setEditingReservation(false);
          setSelectedReservationId(null);
        }}
      >
        {selectedReservation &&
          (editingReservation ? (
            <ReservationForm
              key={selectedReservation.id}
              reservation={selectedReservation}
              options={options}
              inDialog
              onDone={(nextNotice) => {
                setEditingReservation(false);
                if (nextNotice === null) setSelectedReservationId(null);
                setNotice(nextNotice);
              }}
            />
          ) : (
            <ReservationDetails
              reservation={selectedReservation}
              billingStatus={selectedInvoice?.listStatus ?? null}
              busy={creatingInvoiceId === selectedReservation.id}
              onEdit={() => setEditingReservation(true)}
              onInvoice={() => void invoiceReservation(selectedReservation)}
              onCancel={() => setConfirming(selectedReservation)}
            />
          ))}
      </SideDialog>
      <SideDialog
        open={selectedRoom !== null}
        title={editingRoom ? "Zimmer bearbeiten" : `Zimmer ${selectedRoom?.number ?? ""}`}
        caption={selectedRoom?.archivedAt ? "Archiviert" : "Aktiv"}
        onClose={() => {
          setEditingRoom(false);
          setSelectedRoomId(null);
        }}
      >
        {selectedRoom &&
          (editingRoom ? (
            <RoomForm
              key={selectedRoom.id}
              room={selectedRoom}
              inDialog
              onDone={(nextNotice) => {
                setEditingRoom(false);
                if (nextNotice === null) setSelectedRoomId(null);
                setNotice(nextNotice);
              }}
            />
          ) : (
            <RoomDashboard
              room={selectedRoom}
              busy={pendingRoomStatus === selectedRoom.id}
              onEdit={() => setEditingRoom(true)}
              onArchive={() => void changeRoomArchive(selectedRoom.id, true)}
              onCleaningStatus={(status) => void changeRoomStatus(selectedRoom.id, status)}
              onReservation={(reservationId) => {
                setSelectedRoomId(null);
                openReservation(reservationId);
              }}
            />
          ))}
      </SideDialog>
      <FormDialog open={showingSettings} title="PMS-Einstellungen" onClose={() => setShowingSettings(false)}>
        <PmsSettingsForm
          options={options}
          archivedRooms={allRooms.filter((room) => room.archivedAt)}
          onRestoreRoom={(roomId) => changeRoomArchive(roomId, false)}
          onDone={(nextNotice) => {
            setShowingSettings(false);
            setNotice(nextNotice);
          }}
        />
      </FormDialog>
      <FormDialog open={showingHotelStatistics} title="Hotelstatistik" onClose={() => setShowingHotelStatistics(false)}>
        <div className="hotel-dialog-content">
          <HotelDashboard />
          <div className="actions form-footer">
            <button type="button" className="btn" onClick={() => setShowingHotelStatistics(false)}>
              Schließen
            </button>
          </div>
        </div>
      </FormDialog>
      <FormDialog open={showingTourismStatistics} title="Tourismusstatistik" onClose={() => setShowingTourismStatistics(false)}>
        <div className="tourism-dialog-content">
          <TourismStatistics initial={tourism} year={tourismPeriod.year} month={tourismPeriod.month} />
          <div className="actions form-footer">
            <button type="button" className="btn" onClick={() => setShowingTourismStatistics(false)}>
              Schließen
            </button>
          </div>
        </div>
      </FormDialog>
      <ConfirmDialog
        open={confirming !== null}
        title="Reservierung stornieren?"
        confirmLabel="Stornieren"
        danger
        facts={
          confirming
            ? [
                { label: "Kunde", value: confirming.contactName },
                { label: "Zimmer", value: confirming.items.map((item) => item.roomNumber).join(", ") },
              ]
            : undefined
        }
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && void cancelReservation(confirming)}
      >
        <p>Die Stornierung ist dauerhaft. Der Zeitraum wird für neue Reservierungen wieder freigegeben.</p>
      </ConfirmDialog>
    </>
  );
}
