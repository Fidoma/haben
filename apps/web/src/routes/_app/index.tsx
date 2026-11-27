import { formatEuro, lastMonthOfPeriod, periodKey, periodLabel } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { daysUntil, formatDate, formatDateTime, formatLongDate } from "../../lib/format.ts";
import { InvoiceStatus } from "../../components/InvoiceStatus.tsx";
import { EricHinweis } from "../../components/EricHinweis.tsx";
import { KleinunternehmerHinweise } from "../../components/KleinunternehmerHinweise.tsx";
import { UebersichtAufgaben, ZUERST, ordneAufgaben, type Todo } from "../../components/UebersichtAufgaben.tsx";
import { UebersichtKennzahlen, ohneKennzahlen, type UebersichtDaten } from "../../components/UebersichtKennzahlen.tsx";
import { getBackupStatus } from "../../server/functions/backup.ts";
import { getInvoiceSummary } from "../../server/functions/invoices.ts";
import { getOverview } from "../../server/functions/vat.ts";
import { einrichtungsAufgaben } from "../../lib/einrichtung.ts";
import { useBereichAktiv } from "../../lib/use-bereich.ts";

export const Route = createFileRoute("/_app/")({
  loader: async () => {
    const [vat, invoices, backup] = await Promise.all([getOverview(), getInvoiceSummary(), getBackupStatus()]);
    return { ...vat, invoices, backup };
  },
  head: () => ({ meta: [{ title: "Übersicht · Haben" }] }),
  component: OverviewPage,
});

const BESCHEID_LABEL: Record<string, string> = {
  ESB: "Steuerbescheid",
  DivaBescheidESt: "Einkommensteuerbescheid",
  DivaBescheidUSt: "Umsatzsteuerbescheid",
  DivaBescheidGewSt: "Gewerbesteuer-Messbescheid",
  DivaBescheidKSt: "Körperschaftsteuerbescheid",
  DivaBescheidFEIN: "Feststellungsbescheid",
  DivaSonstigerVA: "Bescheid",
};

type Konto = UebersichtDaten["invoices"]["bank"][number];

/** Vor der nächsten Leistung klären: Reverse Charge und die steuerfreie Lieferung brauchen eine gültige Nummer (#1489) */
function ustIdAufgaben(ungueltig: { contactId: string; kontakt: string; nummer: string; meldung: string }[]): Todo[] {
  return ungueltig.map((u) => ({
    id: `ustid-${u.nummer}`,
    title: `USt-IdNr. von ${u.kontakt} laut BZSt nicht gültig`,
    detail: `${u.nummer}: ${u.meldung}`,
    action: "Ansehen",
    tone: "warn",
    to: "/kontakte/$id",
    kontakt: u.contactId,
  }));
}

/** Stand der Voranmeldung des Zeitraums und des Steuerkontos für die Übersicht */
function voranmeldungStand(data: UebersichtDaten) {
  const sent = data.current?.status === "sent";
  const vatRequired = !data.kleinunternehmer && !data.exempt;
  // Vor dem ersten Buchungsmonat ist nichts fällig (wie bei den Fristen); ein gespeicherter Entwurf zeigt, dass es dennoch bearbeitet wird
  const vorStart = data.current === null && periodKey(lastMonthOfPeriod(data.period)) < data.ersterBuchungsmonat;
  // Steuerkonto: reicht der Stand für die Zahllast, die das Finanzamt per Lastschrift einzieht?
  const zahllast = data.current?.status === "sent" ? data.current.kz83 : vorStart ? 0 : data.computedKz83;
  const taxAccount = data.invoices.bank.find((a) => a.purpose === "steuer");
  // Abgegebene Voranmeldungen: was je Posten noch offen ist; der Zeitraum ohne Abgabe nach den Buchungen, abzüglich
  // schon eingezogener Lastschriften ohne Bezug (dann ist der Kontostand bereits um sie gesunken)
  const periodOpen = data.vatOpen.filter((p) => p.year === data.period.year && p.month === data.period.month).reduce((sum, p) => sum + p.offen, 0);
  // Bestehende Anmeldungen und ihre offenen Beträge bleiben auch ohne reguläre Abgabepflicht erreichbar.
  const showVatPeriod = data.current !== null || periodOpen !== 0 || (!vorStart && (vatRequired || data.computedKz83 !== 0));
  const postenOffen = data.vatOpen.filter((p) => p.offen > 0).reduce((sum, p) => sum + p.offen, 0);
  const zahllastOffen = postenOffen + (sent || vorStart ? 0 : Math.max(0, data.computedKz83 - data.vatPaid));
  const taxShortfall = taxAccount && taxAccount.balance !== null && zahllastOffen > 0 ? zahllastOffen - taxAccount.balance : 0;
  return { sent, vatRequired, vorStart, zahllast, periodOpen, showVatPeriod, zahllastOffen, taxAccount, taxShortfall };
}

/** Umsatzsteuer: die Voranmeldung des Zeitraums, unbezahlte Voranmeldungen und ein zu knappes Steuerkonto */
function umsatzsteuerAufgaben(
  data: UebersichtDaten,
  {
    sent,
    vatRequired,
    vorStart,
    taxAccount,
    taxShortfall,
  }: { sent: boolean; vatRequired: boolean; vorStart: boolean; taxAccount: Konto | undefined; taxShortfall: number },
): Todo[] {
  const todos: Todo[] = [];
  if (!sent && vatRequired && !vorStart) {
    todos.push({
      title: `Voranmeldung ${periodLabel(data.period)} senden`,
      detail: `Fällig ${formatLongDate(data.dueDate)}`,
      frist: data.dueDate,
      action: "Öffnen",
      tone: daysUntil(data.dueDate) <= 3 ? "warn" : "info",
      to: "/umsatzsteuer/$zeitraum",
    });
  }
  for (const posten of data.vatOpen.filter((p) => p.offen > 0 && daysUntil(p.faellig) < 0)) {
    todos.push({
      id: `ustva-${posten.vatReturnId}`,
      title: `Umsatzsteuer ${periodLabel(posten)}${posten.berichtigt ? " (Berichtigung)" : ""} nicht bezahlt`,
      detail: `${formatEuro(posten.offen)} offen, fällig seit ${formatLongDate(posten.faellig)}; Lastschrift im Bankabgleich der Voranmeldung zuordnen`,
      frist: posten.faellig,
      action: "Zur Bank",
      tone: "warn",
      to: "/bank",
    });
  }
  if (taxAccount && taxShortfall > 0 && vatRequired) {
    todos.push({
      title: `Steuerkonto ${taxAccount.name} deckt die Zahllast nicht`,
      // Vor dem Start enthält der Fehlbetrag nur offene Voranmeldungen früherer Zeiträume, nicht den der Seite
      detail: vorStart
        ? `Es fehlen ${formatEuro(taxShortfall)} für offene Voranmeldungen`
        : `Es fehlen ${formatEuro(taxShortfall)} für ${periodLabel(data.period)}, fällig ${formatLongDate(data.dueDate)}`,
      // Platzt die Lastschrift, gilt die Steuer nicht als am Fälligkeitstag entrichtet (§ 224 Abs. 2 Nr. 3 AO): Säumniszuschläge (§ 240 AO)
      frist: vorStart ? undefined : data.dueDate,
      action: "Zur Bank",
      tone: "warn",
      to: "/bank",
    });
  }
  return todos;
}

/** Was im Bankabgleich zu tun ist: Geldtransit und offene Umsätze */
function bankAufgaben(data: UebersichtDaten): Todo[] {
  const todos: Todo[] = [];
  if (data.transit !== 0) {
    todos.push({
      title: "Geldtransit nicht ausgeglichen",
      detail: `${formatEuro(Math.abs(data.transit))} ${data.transit > 0 ? "abgegangen, aber auf keinem deiner Konten angekommen" : "angekommen, ohne dass es woanders abgegangen ist"}: Beim Geldtransit, dem Geld zwischen deinen eigenen Konten, fehlt die Gegenbuchung`,
      action: "Zur Bank",
      tone: "warn",
      to: "/bank",
    });
  }
  for (const provider of data.invoices.bank.filter((a) => a.staleOpenCount > 0)) {
    todos.push({
      id: provider.id,
      title: `${provider.name}: ${provider.staleOpenCount} ${provider.staleOpenCount === 1 ? "Umsatz" : "Umsätze"} seit über zwei Wochen offen`,
      detail: "Zahlungen, Gebühren oder Auszahlungen beim Zahlungsdienstleister noch nicht zugeordnet",
      action: "Zuordnen",
      tone: "info",
      to: "/bank",
    });
  }
  const openBank = data.invoices.bank.reduce((sum, a) => sum + a.openCount, 0);
  if (openBank > 0) {
    todos.push({
      title: `${openBank} ${openBank === 1 ? "Bankumsatz" : "Bankumsätze"} ohne Zuordnung`,
      detail: data.invoices.bank
        .filter((a) => a.openCount > 0)
        .map((a) => a.name)
        .join(" und "),
      action: "Zuordnen",
      tone: "info",
      to: "/bank",
    });
  }
  return todos;
}

/** Was in den Einstellungen fehlt: Firmendaten, ELSTER-Zertifikat und Backup */
function einstellungsAufgaben(data: UebersichtDaten, backup: Awaited<ReturnType<typeof getBackupStatus>>): Todo[] {
  const todos: Todo[] = [];
  const certificateDays = data.certificate?.validUntil ? daysUntil(data.certificate.validUntil) : null;
  if (data.companyIssues.length > 0 && !data.kleinunternehmer) {
    const detail = data.companyIssues.join(" · ");
    todos.push({ title: "Firmendaten vervollständigen", detail, action: "Ergänzen", tone: "warn", to: "/einstellungen", bereich: "firma" });
  }
  if (!data.certificate) {
    if (!data.kleinunternehmer)
      todos.push({
        title: "ELSTER-Zertifikat hinterlegen",
        detail: "Die .pfx-Datei aus Mein ELSTER wird zum Senden gebraucht",
        action: "Hochladen",
        tone: "neutral",
        to: "/einstellungen",
        bereich: "elster",
      });
  } else if (certificateDays !== null && certificateDays <= 30) {
    todos.push({
      title: certificateDays < 0 ? "ELSTER-Zertifikat abgelaufen" : "ELSTER-Zertifikat läuft bald ab",
      detail: `Gültig bis ${formatDate(data.certificate.validUntil!)}`,
      frist: data.certificate.validUntil!,
      action: "Erneuern",
      tone: "warn",
      to: "/einstellungen",
      bereich: "elster",
    });
  }

  for (const { kind, run } of backup.failed) {
    todos.push({
      title: kind === "backup" ? "Backup fehlgeschlagen" : "Test-Restore fehlgeschlagen",
      detail: `${formatDateTime(run.at)}${run.message ? ` · ${run.message}` : ""}`,
      action: "Ansehen",
      tone: "warn",
      to: "/einstellungen",
      bereich: "export",
    });
  }
  if (backup.overdue) {
    todos.push({
      title: "Backup überfällig",
      detail: backup.lastBackup ? `Letztes erfolgreiches Backup ${formatDateTime(backup.lastBackup.at)}` : "Noch kein erfolgreiches Backup",
      action: "Ansehen",
      tone: "warn",
      to: "/einstellungen",
      bereich: "export",
    });
  } else if (backup.state === "keins") {
    todos.push({
      title: "Backup einrichten",
      detail: "Noch kein Backup eingetragen",
      action: "Ansehen",
      tone: "neutral",
      to: "/einstellungen",
      bereich: "export",
    });
  }
  return todos;
}

function OverviewPage() {
  const data = Route.useLoaderData();
  const key = periodKey(data.period);
  const { sent, vatRequired, vorStart, zahllast, periodOpen, showVatPeriod, zahllastOffen, taxAccount, taxShortfall } = voranmeldungStand(data);

  const schreiben = useBereichAktiv("rechnungserstellung");
  const mahnwesen = useBereichAktiv("mahnwesen");
  const todos: Todo[] = [...einrichtungsAufgaben(Route.useRouteContext().einrichtung), ...ustIdAufgaben(data.ustIdUngueltig)];
  todos.push(...umsatzsteuerAufgaben(data, { sent, vatRequired, vorStart, taxAccount, taxShortfall }), ...bankAufgaben(data));
  if (data.invoices.overdueCount > 0) {
    todos.push({
      title: `${data.invoices.overdueCount} ${data.invoices.overdueCount === 1 ? "Rechnung" : "Rechnungen"} überfällig`,
      detail: "Zahlungseingang prüfen oder erinnern",
      action: mahnwesen ? "Mahnen" : "Ansehen",
      tone: "warn",
      to: mahnwesen ? "/rechnungen/mahnwesen" : "/rechnungen",
    });
  }
  for (const appeal of data.appeals) {
    const days = daysUntil(appeal.fristende);
    todos.push({
      id: `bescheid-${appeal.id}`,
      title: `Bescheid ${appeal.veranlagungszeitraum ? `${appeal.veranlagungszeitraum} ` : ""}prüfen`,
      detail: `${BESCHEID_LABEL[appeal.datenart] ?? "Bescheid"} · Einspruch bis ${formatDate(appeal.fristende)}`,
      frist: appeal.fristende,
      action: "Ansehen",
      tone: days <= 7 ? "warn" : "info",
      to: "/finanzamt",
      erledigen: { id: appeal.id },
    });
  }
  for (const afa of data.afaPending) {
    todos.push({
      id: `afa-${afa.year}`,
      title: `Abschreibung (AfA) ${afa.year} buchen`,
      detail: `Für ${afa.count} ${afa.count === 1 ? "Anlage" : "Anlagen"} im Anlagenverzeichnis ist sie noch nicht gebucht`,
      action: "Öffnen",
      tone: "info",
      to: "/anlagen",
    });
  }
  if (data.invoices.drafts > 0) {
    todos.push({
      title: `${data.invoices.drafts} ${data.invoices.drafts === 1 ? "Rechnungsentwurf" : "Rechnungsentwürfe"}`,
      detail: "Noch nicht festgeschrieben",
      action: "Öffnen",
      tone: "neutral",
      to: "/rechnungen",
    });
  }
  todos.push(...einstellungsAufgaben(data, data.backup));

  const geordnet = ordneAufgaben(todos);
  // Steht die Voranmeldung nicht unter den offenen Aufgaben (gesendet, keine Pflicht oder unter „Weitere“), bleibt der Weg hier
  const voranmeldungOffen = geordnet.slice(0, ZUERST).some((todo) => todo.to === "/umsatzsteuer/$zeitraum");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{formatLongDate(new Date())}</div>
          <h1>Übersicht</h1>
        </div>
        <div className="actions">
          {showVatPeriod && !voranmeldungOffen && (
            <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: key }} className="btn btn-ghost">
              Voranmeldung {periodLabel(data.period)}
              {sent && " · abgegeben"}
            </Link>
          )}
          {schreiben && (
            <Link to="/rechnungen/neu" className="btn btn-primary">
              Neue Rechnung
            </Link>
          )}
        </div>
      </div>

      {data.mode === "simuliert" && vatRequired && <EricHinweis />}

      {data.kleinunternehmerStand && <KleinunternehmerHinweise stand={data.kleinunternehmerStand} />}

      <UebersichtAufgaben geordnet={geordnet} zeitraum={key} />

      {!ohneKennzahlen(data, vorStart) && (
        <UebersichtKennzahlen
          data={data}
          showVatPeriod={showVatPeriod}
          sent={sent}
          vatRequired={vatRequired}
          periodOpen={periodOpen}
          zahllast={zahllast}
          zahllastOffen={zahllastOffen}
          taxShortfall={taxShortfall}
          taxAccount={taxAccount}
        />
      )}

      <div className="grid-main uebersicht-listen">
        {(vatRequired || data.recent.length > 0) && (
          <section className="card" aria-labelledby="recent-heading">
            <h2 id="recent-heading">Letzte Voranmeldungen</h2>
            {data.recent.length === 0 ? (
              <p className="muted">Noch keine Voranmeldung über Haben gesendet.</p>
            ) : (
              data.recent.map((entry) => (
                <div key={entry.id} className="history-row">
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: periodKey(entry) }}>
                      {periodLabel(entry)}
                      {entry.berichtigt ? " (berichtigt)" : ""}
                    </Link>
                    <span className="small muted">gesendet {formatDate(entry.sentAt!)}</span>
                  </div>
                  <span className="amount">{formatEuro(entry.kz83)}</span>
                </div>
              ))
            )}
            {/* Das Zertifikat ist keine Kennzahl; es gehört zum Senden der Voranmeldungen, Ablauf und Fehlen meldet „Zu erledigen“ */}
            <p className="small muted" style={{ margin: 0 }}>
              ELSTER-Zertifikat: {data.certificate ? data.certificate.filename : "nicht hinterlegt"}
              {data.certificate && (data.certificate.validUntil ? ` · gültig bis ${formatDate(data.certificate.validUntil)}` : " · Ablaufdatum unbekannt")}
            </p>
          </section>
        )}
        <LetzteRechnungen recent={data.invoices.recent} schreiben={schreiben} />
      </div>
    </>
  );
}

type Rechnungen = Awaited<ReturnType<typeof getInvoiceSummary>>["recent"];

function LetzteRechnungen({ recent, schreiben }: { recent: Rechnungen; schreiben: boolean }) {
  return (
    <section className="card" aria-labelledby="invoices-heading">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 id="invoices-heading">Letzte Rechnungen</h2>
        <Link to="/rechnungen" className="small">
          Alle anzeigen
        </Link>
      </div>
      {recent.length === 0 ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Noch keine festgeschriebene Rechnung.
          </p>
          {schreiben && (
            <Link to="/rechnungen/neu" className="btn" style={{ alignSelf: "flex-start" }}>
              Erste Rechnung schreiben
            </Link>
          )}
        </>
      ) : (
        <div className="table">
          {recent.map((invoice) => (
            <Link key={invoice.id} to="/rechnungen/$id" params={{ id: invoice.id }} className="table-row invoice-cols-compact">
              <div className="mono small">{invoice.number}</div>
              <div title={invoice.customer}>{invoice.customer}</div>
              <div className="num">{formatEuro(invoice.gross)}</div>
              <div>
                <InvoiceStatus invoice={invoice} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
