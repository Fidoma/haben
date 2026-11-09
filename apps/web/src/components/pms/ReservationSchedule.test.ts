import { describe, expect, it } from "vitest";
import { dayPilotEvents, dayPilotResources } from "./ReservationSchedule.tsx";

describe("DayPilot-Mapping", () => {
  it("bildet Zimmer und archivierte Kennzeichnung ab und escaped fremde Texte", () => {
    expect(dayPilotResources([{ id: "zimmer", number: "<101>", name: "", archived: true }])).toEqual([
      {
        id: "room-zimmer",
        name: "<101>",
        html: '<span class="reservation-room-header"><span>&lt;101&gt;</span><span class="reservation-room-archived">Archiviert</span></span>',
      },
    ]);
  });

  it("setzt die visuellen Check-in- und Check-out-Zeiten und Statusklassen", () => {
    expect(
      dayPilotEvents([
        {
          id: "position",
          reservationId: "reservierung",
          roomId: "zimmer",
          arrivalDate: "2027-01-10",
          departureDate: "2027-01-12",
          contactName: "Gast",
          reservationStatus: "confirmed",
          reservationStatusLabel: "Bestätigt",
          billingStatus: "paid",
          billingStatusLabel: "Bezahlt",
          invoiceNumber: "2027-1",
        },
      ]),
    ).toMatchObject([
      {
        id: "reservation-item-position",
        reservationId: "reservierung",
        resource: "room-zimmer",
        start: "2027-01-10T14:00:00",
        end: "2027-01-12T11:00:00",
        billingClass: "paid",
        cssClass: "reservation-event-confirmed",
      },
    ]);
  });
});
