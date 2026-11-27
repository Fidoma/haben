import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { pauseExtraction, reextractDocuments } from "../../../server/functions/documents.ts";

/*
 * Warteschlange der KI-Auslesung in der Belegliste (#1735): wie viele Belege warten, gerade ausgelesen werden und
 * fehlgeschlagen sind, Anhalten und Fortsetzen, und neu auslesen für markierte und für fehlgeschlagene Belege. Neu
 * ausgelesen wird in der Reihenfolge, in der die Liste die Belege beim Klick zeigt.
 */

export interface QueueOverview {
  waiting: number;
  running: number;
  failed: number;
  paused: boolean;
}

type Row = { id: string; status: "neu" | "gebucht"; extractionStatus: string; mimeType: string };

/** Dateien, die die KI liest; E-Rechnungs-XML liest Haben selbst, HEIC nimmt kein Dienst an */
const lesbar = (row: Row) => row.status === "neu" && row.mimeType !== "application/xml" && row.mimeType !== "image/heic";

/** Solange etwas läuft oder wartet und nicht angehalten ist, frischt die Liste sich auf */
export const auslesungAktiv = (queue: QueueOverview) => queue.running > 0 || (queue.waiting > 0 && !queue.paused);

/** Markierung der Belege, die sich neu auslesen lassen; was nicht mehr in der Liste steht, fällt heraus */
export function useAuslesung(rows: readonly Row[]) {
  const router = useRouter();
  const reextract = useServerFn(reextractDocuments);
  const pause = useServerFn(pauseExtraction);
  const action = useAction();
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const markierbar = rows.filter(lesbar).map((r) => r.id);
  const markierbarKey = markierbar.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: markierbarKey steht für die Liste der markierbaren Belege
  useEffect(() => {
    setMarked((prev) => {
      const behalten = markierbar.filter((id) => prev.has(id));
      return behalten.length === prev.size ? prev : new Set(behalten);
    });
  }, [markierbarKey]);

  const toggle = (id: string) =>
    setMarked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** In der Reihenfolge der Liste, wie sie gerade zu sehen ist */
  const neuAuslesen = (ids: string[]) =>
    action.run(async () => {
      const { queued } = await reextract({ data: ids });
      setMarked(new Set());
      await router.invalidate();
      action.setNotice({
        tone: queued > 0 ? "ok" : "info",
        text:
          queued === 0
            ? "Diese Belege warten schon auf die Auslesung."
            : queued === 1
              ? "Ein Beleg wartet auf die Auslesung."
              : `${queued} Belege warten auf die Auslesung.`,
      });
    });

  const anhalten = (paused: boolean) =>
    action.run(async () => {
      await pause({ data: paused });
      await router.invalidate();
    });

  const failedIds = rows.filter((r) => lesbar(r) && r.extractionStatus === "fehler").map((r) => r.id);
  return { markierbar, marked, toggle, neuAuslesen, anhalten, failedIds, busy: action.busy, notice: action.notice };
}

type Auslesung = ReturnType<typeof useAuslesung>;

const anzahl = (n: number, eins: string, mehr: string) => (n === 1 ? `1 ${eins}` : `${n} ${mehr}`);

function stand(queue: QueueOverview): string {
  const teile = [
    queue.waiting > 0 && anzahl(queue.waiting, "wartet", "warten"),
    queue.running > 0 && anzahl(queue.running, "wird ausgelesen", "werden ausgelesen"),
    queue.failed > 0 && anzahl(queue.failed, "fehlgeschlagen", "fehlgeschlagen"),
  ].filter(Boolean);
  return teile.join(" · ");
}

/** Leiste über der Liste; ohne Wartende, Fehlgeschlagene und Markierte steht sie nicht da */
export function AuslesungLeiste({ queue, a }: { queue: QueueOverview; a: Auslesung }) {
  const warteschlange = queue.waiting + queue.running > 0 || queue.paused;
  if (!warteschlange && queue.failed === 0 && a.marked.size === 0) return <NoticeBanner notice={a.notice} />;
  const text = stand(queue);
  return (
    <section className="card auslesung-leiste" aria-label="KI-Auslesung">
      <p className="small" role="status" style={{ margin: 0 }}>
        <strong>{queue.paused ? "Auslesung angehalten" : "KI-Auslesung"}</strong>
        {text ? ` · ${text}` : ""}
      </p>
      <div className="actions">
        {a.marked.size > 0 && (
          <>
            <span className="small muted" style={{ alignSelf: "center" }}>
              {a.marked.size} ausgewählt
            </span>
            <button type="button" className="btn btn-sm" disabled={a.busy} onClick={() => void a.neuAuslesen(a.markierbar.filter((id) => a.marked.has(id)))}>
              Neu auslesen
            </button>
          </>
        )}
        {a.failedIds.length > 0 && (
          <button type="button" className="btn btn-sm" disabled={a.busy} onClick={() => void a.neuAuslesen(a.failedIds)}>
            Fehlgeschlagene neu auslesen
          </button>
        )}
        {warteschlange && (
          <button type="button" className="btn btn-sm" disabled={a.busy} onClick={() => void a.anhalten(!queue.paused)}>
            {queue.paused ? "Fortsetzen" : "Anhalten"}
          </button>
        )}
      </div>
      <NoticeBanner notice={a.notice} />
    </section>
  );
}

/** Markierfeld einer Zeile; gebuchte Belege und Dateien, die die KI nicht liest, haben keins */
export function BelegMarkierung({ id, a, label }: { id: string; a: Auslesung; label: string }) {
  if (!a.markierbar.includes(id)) return <span className="doc-check" />;
  return (
    <span className="doc-check">
      <input
        type="checkbox"
        className="row-check"
        aria-label={`${label} markieren`}
        checked={a.marked.has(id)}
        onChange={() => a.toggle(id)}
        disabled={a.busy}
      />
    </span>
  );
}
