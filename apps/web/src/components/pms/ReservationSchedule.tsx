import { useEffect, useRef, useState } from "react";
import type { ReservationScheduleData, ScheduleEvent, ScheduleRoom } from "../../server/modules/pms/index.ts";
import { loadDayPilot, type DayPilotApi, type DayPilotSchedulerInstance } from "./daypilot-loader.ts";

export interface ScheduleSelection {
  roomId: string;
  arrivalDate: string;
  departureDate: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function dayPilotResources(rooms: ScheduleRoom[]) {
  return rooms.map((room) => ({
    id: `room-${room.id}`,
    name: room.number,
    html: `<span class="reservation-room-header"><span>${escapeHtml(room.number)}</span>${room.archived ? '<span class="reservation-room-archived">Archiviert</span>' : ""}</span>`,
  }));
}

export function dayPilotEvents(events: ScheduleEvent[]) {
  return events.map((event) => ({
    id: `reservation-item-${event.id}`,
    reservationId: event.reservationId,
    resource: `room-${event.roomId}`,
    start: `${event.arrivalDate}T14:00:00`,
    end: `${event.departureDate}T11:00:00`,
    text: event.contactName,
    status: event.reservationStatusLabel,
    billingStatus: event.billingStatusLabel,
    billingClass: event.billingStatus === "paid" ? "paid" : "open",
    invoiceNumber: event.invoiceNumber,
    cssClass: `reservation-event-${event.reservationStatus}`,
  }));
}

function schedulerConfig(
  DayPilot: DayPilotApi,
  data: ReservationScheduleData,
  onEvent: (reservationId: string) => void,
  onSelect: (selection: ScheduleSelection) => void,
): Record<string, unknown> {
  return {
    locale: "de-de",
    startDate: data.startDate,
    days: data.days,
    scale: "Day",
    cornerHtml: "",
    cellWidthSpec: "Fixed",
    cellWidth: 90,
    timeHeaders: [
      { groupBy: "Month", format: "MMMM yyyy" },
      { groupBy: "Day", format: "ddd d" },
    ],
    resources: dayPilotResources(data.rooms),
    events: dayPilotEvents(data.events),
    eventHeight: 56,
    eventTextWrappingEnabled: false,
    durationBarVisible: false,
    rowHeaderWidth: 110,
    useEventBoxes: "Never",
    eventMoveHandling: "Disabled",
    eventResizeHandling: "Disabled",
    eventDeleteHandling: "Disabled",
    timeRangeSelectedHandling: "Enabled",
    onEventClicked: (args: { e: { data: { reservationId: string } } }) => onEvent(args.e.data.reservationId),
    onBeforeCellRender: (args: { cell: { start: { getDayOfWeek(): number }; cssClass?: string } }) => {
      const day = args.cell.start.getDayOfWeek();
      if (day === 0 || day === 6) args.cell.cssClass = "reservation-scheduler-weekend";
    },
    onBeforeTimeHeaderRender: (args: {
      header: { level: number; start: { toString(format: string): string }; cssClass?: string; html?: string; text: string };
    }) => {
      if (args.header.level !== 1) return;
      const day = args.header.start.toString("yyyy-MM-dd");
      if (day !== DayPilot.Date.today().toString("yyyy-MM-dd")) return;
      args.header.cssClass = "reservation-scheduler-today-header";
      args.header.html = `<span class="reservation-scheduler-today-label"><span class="reservation-scheduler-today-dot" title="Heute" aria-hidden="true"></span>${escapeHtml(args.header.text)}</span>`;
    },
    onBeforeEventRender: (args: {
      data: {
        text: string;
        status: string;
        billingStatus: string;
        billingClass: string;
        invoiceNumber: string | null;
        html?: string;
        toolTip?: string;
        areas?: unknown[];
      };
    }) => {
      const invoice = args.data.invoiceNumber ? ` #${args.data.invoiceNumber}` : "";
      args.data.toolTip = `${args.data.text}\n${args.data.status}\n${args.data.billingStatus}${invoice}`;
      args.data.html = `<div class="reservation-event-content"><strong>${escapeHtml(args.data.text)}</strong><span>${escapeHtml(`${args.data.status} · ${args.data.billingStatus}${invoice}`)}</span></div>`;
      args.data.areas = [
        {
          left: 0,
          right: 0,
          top: 0,
          height: 5,
          cssClass: `reservation-billing-stripe reservation-billing-stripe-${args.data.billingClass}`,
          toolTip: `${args.data.billingStatus}${invoice}`,
        },
      ];
    },
    onTimeRangeSelected: (args: { resource: string; start: { toString(format: string): string }; end: { toString(format: string): string } }) => {
      onSelect({
        roomId: String(args.resource).replace(/^room-/, ""),
        arrivalDate: args.start.toString("yyyy-MM-dd"),
        departureDate: args.end.toString("yyyy-MM-dd"),
      });
    },
  };
}

export function ReservationSchedule({
  data,
  onEvent,
  onSelect,
}: {
  data: ReservationScheduleData;
  onEvent: (reservationId: string) => void;
  onSelect: (selection: ScheduleSelection) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const scheduler = useRef<DayPilotSchedulerInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    void loadDayPilot()
      .then((DayPilot) => {
        if (!active || !container.current) return;
        scheduler.current?.dispose?.();
        container.current.replaceChildren();
        const instance = new DayPilot.Scheduler(
          container.current,
          schedulerConfig(DayPilot, data, onEvent, (selection) => {
            onSelect(selection);
            instance.clearSelection();
          }),
        );
        scheduler.current = instance;
        instance.init();
        instance.scrollTo(DayPilot.Date.today().addDays(-5));
      })
      .catch(() => active && setError("Der grafische Belegungsplan konnte nicht geladen werden."));
    return () => {
      active = false;
      scheduler.current?.dispose?.();
      scheduler.current = null;
      container.current?.replaceChildren();
    };
  }, [data, onEvent, onSelect]);

  return (
    <>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="reservation-scheduler-card">
        <div ref={container} aria-label="Belegungsplan" />
      </div>
    </>
  );
}
