import type { ArticleOption } from "../ArticleCombobox.tsx";
import { Field } from "../Field.tsx";
import { Icon } from "../Icon.tsx";
import { ArticleSelectCombobox } from "./ArticleSelectCombobox.tsx";

export interface ReservationPositionDraft {
  key: number;
  roomId: string;
  articleId: string;
  unitPrice: string;
  arrivalDate: string;
  departureDate: string;
  description: string;
}

interface RoomOption {
  id: string;
  number: string;
  name: string;
}

/** Dynamische Aufenthaltspositionen nach dem Interaktionsmuster der Rechnungspositionen. */
export function ReservationPositions({
  positions,
  rooms,
  articles,
  defaultArticle,
  disabled,
  onChange,
}: {
  positions: ReservationPositionDraft[];
  rooms: RoomOption[];
  articles: ArticleOption[];
  defaultArticle?: ArticleOption;
  disabled: boolean;
  onChange: (positions: ReservationPositionDraft[]) => void;
}) {
  function update(key: number, patch: Partial<ReservationPositionDraft>) {
    onChange(positions.map((position) => (position.key === key ? { ...position, ...patch } : position)));
  }

  function add() {
    const last = positions[positions.length - 1];
    onChange([
      ...positions,
      {
        key: Math.max(0, ...positions.map((position) => position.key)) + 1,
        roomId: "",
        articleId: defaultArticle?.id ?? "",
        unitPrice: defaultArticle ? (defaultArticle.unitPrice / 100).toFixed(2).replace(".", ",") : "",
        arrivalDate: last?.arrivalDate ?? "",
        departureDate: last?.departureDate ?? "",
        description: "",
      },
    ]);
  }

  return (
    <section className="reservation-positions" aria-labelledby="reservation-positions-heading">
      <h3 id="reservation-positions-heading">Positionen</h3>
      <div className="reservation-position-row head" aria-hidden="true">
        <div>Zimmer</div>
        <div>Artikel</div>
        <div className="num">Preis</div>
        <div>Anreise</div>
        <div>Abreise</div>
        <div>Beschreibung</div>
        <div />
      </div>
      {positions.map((position, index) => (
        <div className="reservation-position-row" key={position.key}>
          <Field label={<span className="reservation-position-label">Zimmer</span>}>
            {(control) => (
              <select
                {...control}
                aria-label={`Zimmer Position ${index + 1}`}
                value={position.roomId}
                required
                disabled={disabled}
                onChange={(event) => update(position.key, { roomId: event.target.value })}
              >
                <option value="">Bitte auswählen</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.number}
                    {room.name ? ` · ${room.name}` : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={<span className="reservation-position-label">Artikel</span>}>
            {() => (
              <ArticleSelectCombobox
                label={`Artikel Position ${index + 1}`}
                articleId={position.articleId}
                articles={articles}
                disabled={disabled}
                onPick={(article) =>
                  update(position.key, {
                    articleId: article?.id ?? "",
                    ...(article ? { unitPrice: (article.unitPrice / 100).toFixed(2).replace(".", ",") } : {}),
                  })
                }
              />
            )}
          </Field>
          <Field label={<span className="reservation-position-label">Preis</span>}>
            {(control) => (
              <input
                {...control}
                aria-label={`Preis Position ${index + 1} in Euro`}
                inputMode="decimal"
                value={position.unitPrice}
                required
                disabled={disabled}
                onChange={(event) => update(position.key, { unitPrice: event.target.value })}
              />
            )}
          </Field>
          <Field label={<span className="reservation-position-label">Anreise</span>}>
            {(control) => (
              <input
                {...control}
                aria-label={`Anreise Position ${index + 1}`}
                type="date"
                value={position.arrivalDate}
                required
                disabled={disabled}
                onChange={(event) => update(position.key, { arrivalDate: event.target.value })}
              />
            )}
          </Field>
          <Field label={<span className="reservation-position-label">Abreise</span>}>
            {(control) => (
              <input
                {...control}
                aria-label={`Abreise Position ${index + 1}`}
                type="date"
                value={position.departureDate}
                required
                disabled={disabled}
                onChange={(event) => update(position.key, { departureDate: event.target.value })}
              />
            )}
          </Field>
          <Field label={<span className="reservation-position-label">Beschreibung</span>}>
            {(control) => (
              <input
                {...control}
                aria-label={`Beschreibung Position ${index + 1} (optional)`}
                value={position.description}
                maxLength={2000}
                placeholder="optional"
                disabled={disabled}
                onChange={(event) => update(position.key, { description: event.target.value })}
              />
            )}
          </Field>
          <div className="reservation-position-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label={`Position ${index + 1} entfernen`}
              disabled={disabled || positions.length === 1}
              onClick={() => onChange(positions.filter((candidate) => candidate.key !== position.key))}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      ))}
      <div className="actions">
        <button type="button" className="btn btn-dashed" disabled={disabled || positions.length >= 100} onClick={add}>
          <Icon name="plus" size={16} /> Position hinzufügen
        </button>
      </div>
    </section>
  );
}
