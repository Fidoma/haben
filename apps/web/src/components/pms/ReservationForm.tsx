import { formatDecimal, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { saveReservation, type getReservationFormOptions, type getReservations } from "../../server/functions/pms.ts";
import { ContactDialog } from "../ContactDialog.tsx";
import { CustomerCombobox } from "../CustomerCombobox.tsx";
import { ReservationPositions, type ReservationPositionDraft } from "./ReservationPositions.tsx";

type Reservation = Awaited<ReturnType<typeof getReservations>>[number];
type Options = Awaited<ReturnType<typeof getReservationFormOptions>>;

export function ReservationForm({
  reservation,
  options,
  prefill,
  inDialog = false,
  onDone,
}: {
  reservation: Reservation | null;
  options: Options;
  prefill?: Partial<Pick<ReservationPositionDraft, "roomId" | "arrivalDate" | "departureDate">>;
  inDialog?: boolean;
  onDone: (notice: Notice) => void;
}) {
  const router = useRouter();
  const save = useServerFn(saveReservation);
  const defaultArticle = options.articles.find((article) => article.id === options.defaultArticleId);
  const [contactId, setContactId] = useState(reservation?.contactId ?? "");
  const [newContactName, setNewContactName] = useState<string | null>(null);
  const [positions, setPositions] = useState<ReservationPositionDraft[]>(() =>
    reservation
      ? reservation.items.map((item, index) => ({
          key: index + 1,
          roomId: item.roomId,
          articleId: item.articleId ?? "",
          unitPrice: formatDecimal(item.unitPrice),
          arrivalDate: item.arrivalDate,
          departureDate: item.departureDate,
          description: item.description,
        }))
      : [
          {
            key: 1,
            roomId: prefill?.roomId ?? "",
            articleId: defaultArticle?.id ?? "",
            unitPrice: defaultArticle ? formatDecimal(defaultArticle.unitPrice) : "",
            arrivalDate: prefill?.arrivalDate ?? "",
            departureDate: prefill?.departureDate ?? "",
            description: "",
          },
        ],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalidPosition = positions.findIndex((position) => position.departureDate <= position.arrivalDate);
    if (invalidPosition >= 0) {
      setError(`In Position ${invalidPosition + 1} muss die Abreise nach der Anreise liegen.`);
      return;
    }
    const invalidPrice = positions.findIndex((position) => {
      const price = parseEuro(position.unitPrice);
      return price === null || price < 0;
    });
    if (invalidPrice >= 0) {
      setError(`In Position ${invalidPrice + 1} muss der Preis ein gültiger, nicht negativer Betrag sein.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save({
        data: {
          id: reservation?.id ?? null,
          reservation: {
            contactId,
            items: positions.map(({ roomId, articleId, unitPrice, arrivalDate, departureDate, description }) => ({
              roomId,
              articleId: articleId || null,
              unitPrice: parseEuro(unitPrice)!,
              arrivalDate,
              departureDate,
              description: description.trim(),
            })),
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
    <>
      <ContactDialog
        open={newContactName !== null}
        title="Neuen Kunden anlegen"
        prefill={{ isCustomer: true, isSupplier: false, name: newContactName ?? "" }}
        existing={options.contacts}
        onSaved={(saved) => {
          setContactId(saved.id);
          void router.invalidate();
        }}
        onPickExisting={setContactId}
        onClose={() => setNewContactName(null)}
      />
      <form className={`card reservation-form${inDialog ? " contact-form" : ""}`} onSubmit={onSubmit} aria-label={formName}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{formName}</h2>
        <div className="form-row">
          <div className="field">
            <label className="field-label" htmlFor="reservation-customer">
              Kunde
            </label>
            <CustomerCombobox
              id="reservation-customer"
              contacts={options.contacts}
              contactId={contactId}
              disabled={busy}
              onChoose={setContactId}
              onCreate={setNewContactName}
            />
            <input type="hidden" name="contactId" value={contactId} />
          </div>
          <ReservationPositions
            positions={positions}
            rooms={options.rooms}
            articles={options.articles}
            defaultArticle={defaultArticle}
            disabled={busy}
            onChange={setPositions}
          />
        </div>
        {error && (
          <div className="banner banner-danger" role="alert">
            {error}
          </div>
        )}
        <div className={`actions${inDialog ? " form-footer" : ""}`}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {reservation ? "Speichern" : "Anlegen"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => onDone(null)}>
            Abbrechen
          </button>
        </div>
      </form>
    </>
  );
}
