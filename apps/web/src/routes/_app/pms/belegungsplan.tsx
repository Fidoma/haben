import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { z } from "zod";
import { FormDialog } from "../../../components/FormDialog.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { ReservationForm } from "../../../components/pms/ReservationForm.tsx";
import { ReservationSchedule, type ScheduleSelection } from "../../../components/pms/ReservationSchedule.tsx";
import { errorMessage, formatDate } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { getHousekeepingRooms, getReservationFormOptions, getReservationSchedule, updateCleaningStatus } from "../../../server/functions/pms.ts";
import styles from "../../../styles/pms-schedule.css?url";

const searchSchema = z.object({ start: z.string().optional(), end: z.string().optional() });

export const Route = createFileRoute("/_app/pms/belegungsplan")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [schedule, options, housekeepingRooms] = await Promise.all([
      getReservationSchedule({ data: { start: deps.start, end: deps.end } }),
      getReservationFormOptions(),
      getHousekeepingRooms(),
    ]);
    return { schedule, options, housekeepingRooms };
  },
  head: () => ({ meta: [{ title: "Belegungsplan · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: SchedulePage,
});

function SchedulePage() {
  const { schedule, options, housekeepingRooms } = Route.useLoaderData();
  const router = useRouter();
  const saveCleaningStatus = useServerFn(updateCleaningStatus);
  const [selection, setSelection] = useState<ScheduleSelection | null>(null);
  const [creating, setCreating] = useState(false);
  const [rooms, setRooms] = useState(housekeepingRooms);
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const formOpen = creating || selection !== null;

  const openReservation = useCallback(
    (reservationId: string) => void router.navigate({ to: "/pms/reservierungen", search: { edit: reservationId } }),
    [router],
  );
  const selectRange = useCallback((next: ScheduleSelection) => {
    setCreating(false);
    setSelection(next);
    setNotice(null);
  }, []);

  async function changeCleaningStatus(roomId: string, status: "clean" | "dirty") {
    setPendingRoom(roomId);
    setNotice(null);
    try {
      await saveCleaningStatus({ data: { roomId, status } });
      setRooms((current) => current.map((room) => (room.id === roomId ? { ...room, cleaningStatus: status } : room)));
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    } finally {
      setPendingRoom(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">PMS</div>
          <h1>Belegungsplan</h1>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setSelection(null);
            setCreating(true);
            setNotice(null);
          }}
        >
          Neue Reservierung
        </button>
      </div>
      <p className="muted small schedule-intro">
        Zimmer und Reservierungen vom {formatDate(schedule.startDate)} bis {formatDate(schedule.endDate)}. Wähle einen freien Zeitraum oder öffne eine Belegung.
      </p>
      <NoticeBanner notice={notice} />
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
      {schedule.rooms.length === 0 ? (
        <section className="card schedule-empty">
          <h2>Noch keine Zimmer</h2>
          <p className="muted">Lege zuerst ein Zimmer an, damit es im Belegungsplan erscheint.</p>
          <Link to="/pms/zimmer" className="btn">
            Zimmer verwalten
          </Link>
        </section>
      ) : (
        <ReservationSchedule data={schedule} onEvent={openReservation} onSelect={selectRange} />
      )}
      <div className="housekeeping-columns schedule-housekeeping" aria-label="Zimmerstatus">
        {[
          { title: "Saubere Zimmer", status: "clean" as const, nextStatus: "dirty" as const, arrow: "→", action: "Als schmutzig markieren" },
          { title: "Schmutzige Zimmer", status: "dirty" as const, nextStatus: "clean" as const, arrow: "←", action: "Als sauber markieren" },
        ].map((group) => {
          const groupedRooms = rooms.filter((room) => room.cleaningStatus === group.status);
          return (
            <section className="card housekeeping-group" key={group.status}>
              <h2>
                {group.title} ({groupedRooms.length})
              </h2>
              {groupedRooms.length === 0 ? (
                <p className="muted">Keine Zimmer.</p>
              ) : (
                <div className="housekeeping-list">
                  {groupedRooms.map((room) => (
                    <article className={`housekeeping-room ${group.status}`} key={room.id}>
                      <strong className="mono">Zimmer {room.number}</strong>
                      <button
                        type="button"
                        className="btn housekeeping-transfer"
                        aria-label={`Zimmer ${room.number}: ${group.action}`}
                        title={group.action}
                        disabled={pendingRoom === room.id}
                        onClick={() => void changeCleaningStatus(room.id, group.nextStatus)}
                      >
                        <span aria-hidden="true">{pendingRoom === room.id ? "…" : group.arrow}</span>
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <FormDialog
        open={formOpen}
        title="Neue Reservierung"
        onClose={() => {
          setCreating(false);
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
            setCreating(false);
            setSelection(null);
            setNotice(nextNotice);
          }}
        />
      </FormDialog>
    </>
  );
}
