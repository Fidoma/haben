import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { errorMessage } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { getHousekeepingRooms, updateCleaningStatus } from "../../../server/functions/pms.ts";

export const Route = createFileRoute("/_app/pms/housekeeping")({
  loader: () => getHousekeepingRooms(),
  head: () => ({ meta: [{ title: "Housekeeping · Haben" }] }),
  component: HousekeepingPage,
});

function HousekeepingPage() {
  const rooms = Route.useLoaderData();
  const save = useServerFn(updateCleaningStatus);
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const groups = [
    { title: "Zu reinigen", status: "dirty" as const, action: "Als sauber markieren" },
    { title: "Sauber", status: "clean" as const, action: "Als schmutzig markieren" },
  ];

  async function change(roomId: string, status: "clean" | "dirty") {
    setPending(roomId);
    try {
      await save({ data: { roomId, status } });
      await router.invalidate();
      setNotice({ tone: "ok", text: status === "clean" ? "Zimmer als sauber markiert." : "Zimmer als schmutzig markiert." });
    } catch (cause) {
      setNotice({ tone: "danger", text: errorMessage(cause) });
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">PMS</div>
          <h1>Housekeeping</h1>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Abgereiste Zimmer werden ab 07:00 Uhr automatisch als schmutzig markiert.
      </p>
      <NoticeBanner notice={notice} />
      <div className="housekeeping-columns">
        {groups.map((group) => {
          const selected = rooms.filter((room) => room.cleaningStatus === group.status);
          const next = group.status === "dirty" ? "clean" : "dirty";
          return (
            <section className="card housekeeping-group" key={group.status}>
              <h2>
                {group.title} ({selected.length})
              </h2>
              {selected.length === 0 ? (
                <p className="muted">Keine Zimmer.</p>
              ) : (
                <div className="housekeeping-list">
                  {selected.map((room) => (
                    <article className={`housekeeping-room ${group.status}`} key={room.id}>
                      <div>
                        <strong className="mono">Zimmer {room.number}</strong>
                        {room.name && <div className="muted small">{room.name}</div>}
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary housekeeping-action"
                        disabled={pending === room.id}
                        onClick={() => void change(room.id, next)}
                      >
                        {pending === room.id ? "Speichert …" : group.action}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
