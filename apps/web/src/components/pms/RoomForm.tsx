import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { saveRoom, type getRooms } from "../../server/functions/pms.ts";
import { Field } from "../Field.tsx";

type Room = Awaited<ReturnType<typeof getRooms>>[number];

export function RoomForm({ room, inDialog = false, onDone }: { room: Room | null; inDialog?: boolean; onDone: (notice: Notice) => void }) {
  const router = useRouter();
  const save = useServerFn(saveRoom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const capacity = Number(form.get("capacity"));
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
      setError("Die Kapazität muss eine ganze Zahl zwischen 1 und 100 sein.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save({
        data: {
          id: room?.id ?? null,
          room: {
            number: String(form.get("number") ?? "").trim(),
            name: String(form.get("name") ?? "").trim(),
            capacity,
          },
        },
      });
      await router.invalidate();
      onDone({ tone: "ok", text: room ? "Zimmer gespeichert." : "Zimmer angelegt." });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const formName = room ? "Zimmer bearbeiten" : "Neues Zimmer";
  return (
    <form className={`card room-form${inDialog ? " contact-form" : ""}`} onSubmit={onSubmit} aria-label={formName}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{formName}</h2>
      <div className="form-row cols-2">
        <Field label="Zimmernummer">
          {(control) => <input {...control} name="number" defaultValue={room?.number ?? ""} maxLength={50} required autoFocus />}
        </Field>
        <Field label="Kapazität">
          {(control) => <input {...control} name="capacity" type="number" defaultValue={room?.capacity ?? 1} min={1} max={100} step={1} required />}
        </Field>
        <Field label="Bezeichnung (optional)" style={{ gridColumn: "1 / -1" }}>
          {(control) => <input {...control} name="name" defaultValue={room?.name ?? ""} maxLength={100} />}
        </Field>
      </div>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className={`actions${inDialog ? " form-footer" : ""}`}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {room ? "Speichern" : "Anlegen"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDone(null)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
