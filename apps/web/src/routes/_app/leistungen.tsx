import { formatDuration, germanDay } from "@haben/core";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { ServiceBillingForm } from "../../components/ServiceBillingForm.tsx";
import { AlleWaehlen, LeistungsFilter, LeistungsKopf, LeistungsSumme, LeistungsZeile, useAbrechnenAuswahl } from "../../components/ServiceEntryList.tsx";
import { ServiceEntryForm, type ServiceEntryRow } from "../../components/ServiceEntryForm.tsx";
import { errorMessage, formatDate } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { useBereichAktiv } from "../../lib/use-bereich.ts";
import { getServiceEntries, removeServiceEntry } from "../../server/functions/leistungen.ts";
import { menueGruppe } from "../../lib/menue-gruppe.ts";

const searchSchema = z.object({
  kunde: z.uuid().optional(),
  von: z.iso.date().optional(),
  bis: z.iso.date().optional(),
  stand: z.enum(["offen", "abgerechnet", "nicht-abrechenbar"]).optional(),
  projekt: z.string().max(200).optional(),
  taetigkeit: z.string().max(200).optional(),
});

type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_app/leistungen")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    kunde: search.kunde,
    von: search.von,
    bis: search.bis,
    stand: search.stand,
    projekt: search.projekt,
    taetigkeit: search.taetigkeit,
  }),
  loader: ({ deps }) =>
    getServiceEntries({
      data: { contactId: deps.kunde, from: deps.von, to: deps.bis, status: deps.stand, project: deps.projekt, description: deps.taetigkeit },
    }),
  head: () => ({ meta: [{ title: "Zeiteinträge · Haben" }] }),
  component: ServiceEntriesPage,
});

function ServiceEntriesPage() {
  const { entries, customers } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const remove = useServerFn(removeServiceEntry);
  const [editing, setEditing] = useState<ServiceEntryRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [billing, setBilling] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<ServiceEntryRow | null>(null);
  const names = new Map(customers.map((c) => [c.id, c.name]));
  const formOpen = creating || editing !== null || billing;
  const schreiben = useBereichAktiv("rechnungserstellung");
  /** Öffnet das Formular zum Anlegen oder das zum Abrechnen und schließt das andere */
  const openForm = (form: "creating" | "billing") => {
    setEditing(null);
    setCreating(form === "creating");
    setBilling(form === "billing");
    setNotice(null);
  };
  const newButton = (
    <button type="button" className="btn btn-primary" onClick={() => openForm("creating")}>
      Neuer Eintrag
    </button>
  );

  async function onDelete(entry: ServiceEntryRow) {
    try {
      await remove({ data: { id: entry.id } });
      await router.invalidate();
      setNotice({ tone: "ok", text: "Eintrag gelöscht." });
    } catch (e) {
      setNotice({ tone: "danger", text: errorMessage(e) });
    }
  }

  const filtered = Boolean(search.kunde || search.von || search.bis || search.stand || search.projekt || search.taetigkeit);
  const auswahl = useAbrechnenAuswahl(
    billing,
    search.stand,
    customers.find((c) => c.id === search.kunde),
    entries,
  );
  const { kunde, waehlbar, kandidaten, gewaehlt } = auswahl;
  const filter = (patch: Partial<Search>) => {
    auswahl.zuruecksetzen();
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{menueGruppe("/leistungen")}</div>
          <h1>Zeiteinträge</h1>
        </div>
        {!formOpen && (
          <div className="actions">
            {schreiben && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  openForm("billing");
                  filter({ stand: "offen" });
                }}
              >
                Abrechnen
              </button>
            )}
            {newButton}
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Zeiteinträge je Kunde, von Hand oder aus einem Zeiterfassungsprogramm wie Kimai über die REST-API. Jeder Eintrag behält den Stundensatz vom Anlegen.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {billing && (
          <ServiceBillingForm customer={kunde ?? null} candidates={kandidaten.length} entryIds={gewaehlt.map((e) => e.id)} onClose={() => setBilling(false)} />
        )}
        {(creating || editing !== null) && (
          <ServiceEntryForm
            key={editing?.id ?? "neu"}
            entry={editing}
            customers={customers}
            today={germanDay(new Date())}
            defaultContactId={search.kunde}
            onDone={(n) => {
              setEditing(null);
              setCreating(false);
              setNotice(n);
            }}
          />
        )}
        <NoticeBanner notice={notice} />
        <EintragLoeschen entry={confirm} names={names} loeschen={onDelete} schliessen={() => setConfirm(null)} />
        <section className="card" aria-label="Leistungsliste">
          <LeistungsFilter search={search} customers={customers} filter={filter} standFest={billing} />
          {entries.length === 0 ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {filtered ? "Keine Einträge für diesen Filter." : "Hier stehen deine Zeiteinträge je Kunde."}
              </p>
              {!filtered && !formOpen && <div style={{ alignSelf: "flex-start" }}>{newButton}</div>}
            </>
          ) : (
            <>
              {waehlbar && <AlleWaehlen gewaehlt={gewaehlt.length} gesamt={kandidaten.length} onChange={auswahl.alle} />}
              <div className="table">
                <LeistungsKopf wahl={waehlbar} />
                {entries.map((e) => (
                  <LeistungsZeile
                    key={e.id}
                    e={e}
                    kunde={names.get(e.contactId) ?? "Kunde"}
                    bearbeiten={() => {
                      setCreating(false);
                      setEditing(e);
                    }}
                    loeschen={() => setConfirm(e)}
                    {...(waehlbar && { wahl: { gewaehlt: !auswahl.abgewaehlt.has(e.id), onChange: () => auswahl.umschalten(e.id) } })}
                  />
                ))}
              </div>
              <LeistungsSumme entries={entries} />
            </>
          )}
        </section>
      </div>
    </>
  );
}

/** Rückfrage vor dem Löschen eines Eintrags, mit Tag, Kunde und Dauer */
function EintragLoeschen({
  entry,
  names,
  loeschen,
  schliessen,
}: {
  entry: ServiceEntryRow | null;
  names: Map<string, string>;
  loeschen: (entry: ServiceEntryRow) => void;
  schliessen: () => void;
}) {
  return (
    <ConfirmDialog
      open={entry !== null}
      title="Eintrag löschen?"
      facts={
        entry
          ? [
              { label: "Tag", value: formatDate(entry.workedOn) },
              { label: "Kunde", value: names.get(entry.contactId) ?? "Kunde" },
              { label: "Dauer", value: `${formatDuration(entry.minutes)} Std.`, strong: true },
            ]
          : undefined
      }
      confirmLabel="Löschen"
      danger
      onConfirm={() => entry && loeschen(entry)}
      onClose={schliessen}
    >
      <p>Der Eintrag wird gelöscht. Das steht im Änderungsprotokoll.</p>
    </ConfirmDialog>
  );
}
