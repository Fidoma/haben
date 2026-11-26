import { dauerbelegSummen, formatEuro, recurrenceLabel } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { formatDate } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getDauerbelegList, runDauerbelegeNow } from "../../../server/functions/dauerbelege.ts";
import { RecurringDocumentStatus } from "../../../components/RecurringStatus.tsx";
import { menueGruppe } from "../../../lib/menue-gruppe.ts";

export const Route = createFileRoute("/_app/dauerbelege/")({
  loader: () => getDauerbelegList(),
  head: () => ({ meta: [{ title: "Dauerbelege · Haben" }] }),
  component: DauerbelegePage,
});

function DauerbelegePage() {
  const { items, categories, today } = Route.useLoaderData();
  const router = useRouter();
  const runNow = useServerFn(runDauerbelegeNow);
  const { busy, notice, setNotice, run } = useAction();
  const due = items.filter(({ vorlage }) => vorlage.status === "aktiv" && vorlage.nextDate <= today).length;
  const categoryLabel = new Map(categories.map((c) => [c.value, c.label]));

  const onRun = () =>
    run(async () => {
      const result = await runNow();
      await router.invalidate();
      const text = `${result.created} ${result.created === 1 ? "Beleg" : "Belege"} zum Prüfen angelegt.`;
      setNotice(result.errors.length ? { tone: "danger", text: `${text} ${result.errors.join(" ")}` } : { tone: "ok", text });
    });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{menueGruppe("/dauerbelege")}</div>
          <h1>Dauerbelege</h1>
        </div>
        <div className="actions">
          {due > 0 && (
            <button type="button" className="btn" onClick={onRun} disabled={busy}>
              {due} fällige jetzt anlegen
            </button>
          )}
          <Link to="/dauerbelege/neu" className="btn btn-primary">
            Neuer Dauerbeleg
          </Link>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Wiederkehrende Ausgaben legst du einmal mit Betrag und Intervall an; Haben macht zu jedem Termin einen Beleg zum Prüfen daraus und schlägt ihn im
        Bankabgleich vor.
      </p>
      <NoticeBanner notice={notice} />
      <section className="card" aria-label="Dauerbelege">
        {items.length === 0 ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Hier stehen deine Dauerbelege, etwa für Miete, Versicherung, Leasing oder Abos.
            </p>
            <Link to="/dauerbelege/neu" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
              Neuer Dauerbeleg
            </Link>
          </>
        ) : (
          <div className="table">
            <div className="table-row head recurring-cols">
              <div>Dauerbeleg</div>
              <div>Kategorie</div>
              <div>Intervall</div>
              <div>Nächster</div>
              <div className="num">Brutto</div>
            </div>
            {items.map(({ vorlage, belege, zuPruefen }) => (
              <Link key={vorlage.id} to="/dauerbelege/$id" params={{ id: vorlage.id }} className="table-row recurring-cols">
                <div>
                  {vorlage.name} <RecurringDocumentStatus status={vorlage.status} lastError={vorlage.lastError} />
                  <div className="small muted">
                    {vorlage.supplierName} · {belege} {belege === 1 ? "Beleg" : "Belege"}
                    {zuPruefen > 0 ? `, ${zuPruefen} zu prüfen` : ""}
                  </div>
                </div>
                <div className="small">{categoryLabel.get(vorlage.category) ?? vorlage.category}</div>
                <div className="small">{recurrenceLabel(vorlage.recurrence)}</div>
                <div className="small">{vorlage.status === "aktiv" ? formatDate(vorlage.nextDate) : "–"}</div>
                <div className="num">{formatEuro(dauerbelegSummen(vorlage.amounts).gross)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
      <p className="small muted">
        Haben prüft stündlich, ob ein Termin fällig ist, und holt verpasste Termine mit ihrem Datum nach. Gebucht wird erst, wenn du den Beleg prüfst.
      </p>
    </>
  );
}
