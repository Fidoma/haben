import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { saveReservation, type getReservationFormOptions, type getReservations } from "../../server/functions/pms.ts";

type Reservation = Awaited<ReturnType<typeof getReservations>>[number];
type Options = Awaited<ReturnType<typeof getReservationFormOptions>>;

export function ReservationForm({ reservation, options, onDone }: { reservation: Reservation | null; options: Options; onDone: (notice: Notice) => void }) {
  const router = useRouter();
  const save = useServerFn(saveReservation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const arrivalDate = String(form.get("arrivalDate") ?? "");
    const departureDate = String(form.get("departureDate") ?? "");
    if (departureDate <= arrivalDate) {
      setError("Die Abreise muss nach der Anreise liegen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save({
        data: {
          id: reservation?.id ?? null,
          reservation: {
            contactId: String(form.get("contactId") ?? ""),
            roomId: String(form.get("roomId") ?? ""),
            arrivalDate,
            departureDate,
            note: String(form.get("note") ?? "").trim(),
          },
        },
      });
      await router.invalidate();
      onDone({ tone: "ok", text: reservation ? "Reservierung gespeichert." : "Reservierung angelegt." });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const formName = reservation ? "Reservierung bearbeiten" : "Neue Reservierung";
  return (
    <form className="card reservation-form" onSubmit={onSubmit} aria-label={formName}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{formName}</h2>
      <div className="form-row cols-2">
        <label className="field">
          Kunde
          <select name="contactId" defaultValue={reservation?.contactId ?? ""} required disabled={busy}>
            <option value="">Bitte auswählen</option>
            {options.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Zimmer
          <select name="roomId" defaultValue={reservation?.roomId ?? ""} required disabled={busy}>
            <option value="">Bitte auswählen</option>
            {options.rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.number}
                {room.name ? ` · ${room.name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Anreise
          <input name="arrivalDate" type="date" defaultValue={reservation?.arrivalDate ?? ""} required disabled={busy} />
        </label>
        <label className="field">
          Abreise
          <input name="departureDate" type="date" defaultValue={reservation?.departureDate ?? ""} required disabled={busy} />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Interne Notiz (optional)
          <textarea name="note" defaultValue={reservation?.note ?? ""} maxLength={2000} rows={3} disabled={busy} />
        </label>
      </div>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {reservation ? "Speichern" : "Anlegen"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDone(null)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
