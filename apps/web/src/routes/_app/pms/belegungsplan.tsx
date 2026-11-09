import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { z } from "zod";
import { FormDialog } from "../../../components/FormDialog.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { ReservationForm } from "../../../components/pms/ReservationForm.tsx";
import { ReservationSchedule, type ScheduleSelection } from "../../../components/pms/ReservationSchedule.tsx";
import { formatDate } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { getReservationFormOptions, getReservationSchedule } from "../../../server/functions/pms.ts";
import styles from "../../../styles/pms-schedule.css?url";

const searchSchema = z.object({ start: z.string().optional(), end: z.string().optional() });

export const Route = createFileRoute("/_app/pms/belegungsplan")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [schedule, options] = await Promise.all([getReservationSchedule({ data: { start: deps.start, end: deps.end } }), getReservationFormOptions()]);
    return { schedule, options };
  },
  head: () => ({ meta: [{ title: "Belegungsplan · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: SchedulePage,
});

function SchedulePage() {
  const { schedule, options } = Route.useLoaderData();
  const router = useRouter();
  const [selection, setSelection] = useState<ScheduleSelection | null>(null);
  const [creating, setCreating] = useState(false);
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
      <section className="card schedule-list" aria-labelledby="schedule-list-heading">
        <h2 id="schedule-list-heading">Belegungen im Zeitraum</h2>
        {schedule.events.length === 0 ? (
          <p className="muted">In diesem Zeitraum gibt es keine Reservierungen.</p>
        ) : (
          <ul>
            {schedule.events.map((event) => {
              const room = schedule.rooms.find((candidate) => candidate.id === event.roomId);
              return (
                <li key={event.id}>
                  <Link to="/pms/reservierungen" search={{ edit: event.reservationId }}>
                    <strong>{event.contactName}</strong>
                    <span>
                      Zimmer {room?.number ?? "–"} · {formatDate(event.arrivalDate)} – {formatDate(event.departureDate)}
                    </span>
                    <span>
                      {event.reservationStatusLabel} · {event.billingStatusLabel}
                      {event.invoiceNumber ? ` #${event.invoiceNumber}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
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
