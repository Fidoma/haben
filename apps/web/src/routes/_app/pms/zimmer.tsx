import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { RoomForm } from "../../../components/pms/RoomForm.tsx";
import { errorMessage } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { archiveRoom, getRooms } from "../../../server/functions/pms.ts";

export const Route = createFileRoute("/_app/pms/zimmer")({
  loader: () => getRooms(),
  head: () => ({ meta: [{ title: "Zimmer · Haben" }] }),
  component: RoomsPage,
});

type Room = Awaited<ReturnType<typeof getRooms>>[number];

function RoomsPage() {
  const rooms = Route.useLoaderData();
  const router = useRouter();
  const archive = useServerFn(archiveRoom);
  const [editing, setEditing] = useState<Room | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = rooms.filter((room) => !room.archivedAt);
  const archived = rooms.filter((room) => room.archivedAt);
  const shown = showArchived ? archived : active;
  const formOpen = creating || editing !== null;

  async function toggleArchive(room: Room) {
    try {
      await archive({ data: { id: room.id, archived: !room.archivedAt } });
      await router.invalidate();
      setNotice({ tone: "ok", text: room.archivedAt ? "Zimmer wiederhergestellt." : "Zimmer archiviert." });
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">PMS</div>
          <h1>Zimmer</h1>
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
            Neues Zimmer
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Zimmer und ihre Kapazität verwalten. Archivierte Zimmer bleiben für vorhandene Vorgänge erhalten.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {formOpen && (
          <RoomForm
            key={editing?.id ?? "neu"}
            room={editing}
            onDone={(nextNotice) => {
              setEditing(null);
              setCreating(false);
              setNotice(nextNotice);
            }}
          />
        )}
        <NoticeBanner notice={notice} />
        <section className="card" aria-label="Zimmerliste">
          <div className="chip-row" role="group" aria-label="Filter">
            <button type="button" className={`chip${showArchived ? "" : " active"}`} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>
              Aktiv ({active.length})
            </button>
            <button type="button" className={`chip${showArchived ? " active" : ""}`} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>
              Archiviert ({archived.length})
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {showArchived ? "Keine archivierten Zimmer." : "Noch keine Zimmer. Lege das erste mit „Neues Zimmer“ an."}
            </p>
          ) : (
            <div className="table">
              <div className="table-row head room-cols">
                <div>Zimmer</div>
                <div>Bezeichnung</div>
                <div className="num">Kapazität</div>
                <div />
              </div>
              {shown.map((room) => (
                <div key={room.id} className="table-row room-cols">
                  <div className="mono room-number">{room.number}</div>
                  <div className="room-name">{room.name || <span className="muted">Ohne Bezeichnung</span>}</div>
                  <div className="num room-capacity">{room.capacity}</div>
                  <div className="actions room-actions">
                    {!room.archivedAt && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={`Zimmer ${room.number} bearbeiten`}
                        onClick={() => {
                          setCreating(false);
                          setEditing(room);
                          setNotice(null);
                        }}
                      >
                        Bearbeiten
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => void toggleArchive(room)}>
                      {room.archivedAt ? "Wiederherstellen" : "Archivieren"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
