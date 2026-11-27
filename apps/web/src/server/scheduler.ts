import { formatHundredths } from "@haben/core";
import { kleinunternehmerStand, runDueFileCheck, runDuePruefwertMail } from "./modules/auswertungen/index.ts";
import { runDueArchiveDeliveries } from "./modules/ablage/index.ts";
import { erklaerteAbweichungsZeilen } from "./modules/jahreserklaerung/index.ts";
import { runDueBankSyncs, runDueFintsSyncs, runExistingDuplicateCheck } from "./modules/bank/index.ts";
import { elsterClient, elsterMode } from "./modules/elster/index.ts";
import { env } from "./env.ts";
import { withLogComponent } from "./log-kontext.ts";
import { type Job, recordJobRun } from "./metriken.ts";
import { applyPublishedRates, runDueDauerbelege, runDueInboxFetch } from "./modules/belege/index.ts";
import { runDueExchangeRates } from "./modules/stammdaten/index.ts";
import { runDueFristenMails, runDuePostfachFetch } from "./modules/finanzamt/index.ts";
import { applyPublishedRatesToDrafts, runDueBaseRate, runDueRecurring } from "./modules/rechnungen/index.ts";
import { runDueEtsySyncs } from "./modules/etsy/index.ts";
import { runDueStoreSyncs } from "./modules/stores/index.ts";
import { runDueUstIdPruefung } from "./modules/umsatzsteuer/index.ts";
import { runDuePspSyncs } from "./modules/zahlungsdienstleister/index.ts";
import { today } from "./today.ts";

const HOUR = 60 * 60 * 1000;

/**
 * Ein Hintergrundjob: `label` steht im Log, `run` gibt false zurück, wenn er Fehler gemeldet hat, ohne zu werfen
 * (etwa eine abgelaufene Bankverbindung). Beides zählt in /api/metrics als gescheiterter Lauf.
 */
interface ScheduledJob {
  task: Job;
  label: string;
  run: () => Promise<boolean>;
}

/** Ein Job nach dem anderen; ein Fehler landet im Log und hält die übrigen nicht auf, der nächste Lauf versucht es erneut */
async function runJob({ task, label, run }: ScheduledJob): Promise<void> {
  // Jede Logzeile des Jobs trägt seinen Namen als Bereich (log-kontext.ts), wie in /api/metrics, auch die von lib-fints
  await withLogComponent(task, async () => {
    const started = performance.now();
    console.debug(`${label}: gestartet`);
    let ok = false;
    try {
      ok = await run();
    } catch (error) {
      console.error(label, error);
    }
    recordJobRun(task, ok);
    // Auch ein Lauf ohne Ergebnis, damit bei debug sichtbar ist, dass der Job lief und wie lange
    console.debug(`${label}: ${ok ? "fertig" : "gescheitert"}`, { ok, durationMs: Math.round(performance.now() - started) });
  });
}

/** Meldet die Fehler eines Abrufs einzeln im Log; ok, wenn es keine gab */
function warnAll(errors: string[]): boolean {
  for (const error of errors) console.warn(error);
  return errors.length === 0;
}

/** In dieser Reihenfolge, stündlich */
const JOBS: ScheduledJob[] = [
  {
    task: "recurring_invoices",
    label: "Wiederkehrende Rechnungen",
    run: async () => {
      const result = await runDueRecurring(today(), kleinunternehmerStand);
      if (result.created > 0 || result.errors.length > 0)
        console.log(`Wiederkehrende Rechnungen: ${result.created} angelegt, ${result.finalized} festgeschrieben, ${result.mailed} per E-Mail versandt`);
      return warnAll(result.errors);
    },
  },
  {
    // Nach den wiederkehrenden Rechnungen, damit deren neue gleich mitgehen
    task: "archive_delivery",
    label: "Ablage im Archiv",
    run: async () => {
      const result = await runDueArchiveDeliveries();
      if (result && (result.uebertragen > 0 || result.fehler > 0))
        console.log(`Ablage im Archiv: ${result.uebertragen} Rechnungen übertragen, ${result.fehler} fehlgeschlagen`);
      return !result?.fehler;
    },
  },
  {
    task: "recurring_receipts",
    label: "Dauerbelege",
    run: async () => {
      const result = await runDueDauerbelege(today());
      if (result.created > 0 || result.errors.length > 0) console.log(`Dauerbelege: ${result.created} Belege zu prüfen angelegt`);
      return warnAll(result.errors);
    },
  },
  {
    // Vor dem Kontoabruf
    task: "bank_duplicate_check",
    label: "Bankdublettenprüfung",
    run: async () => {
      const result = await runExistingDuplicateCheck();
      if (result) console.log(`Bankdubletten: Bestand geprüft, ${result.added} Verdachtspaare`);
      return true;
    },
  },
  {
    task: "bank_sync",
    label: "Kontoabruf",
    run: async () => {
      const result = await runDueBankSyncs();
      if (result.synced > 0) console.log(`Kontoabruf: ${result.synced} Verbindungen, ${result.added} neue Umsätze`);
      return warnAll(result.errors);
    },
  },
  {
    task: "fints_sync",
    label: "FinTS-Abruf",
    run: async () => {
      const result = await runDueFintsSyncs();
      if (result.synced > 0) console.log(`FinTS-Abruf: ${result.synced} Verbindungen, ${result.added} neue Umsätze`);
      return warnAll(result.errors);
    },
  },
  {
    task: "store_reports",
    label: "Store-Finanzberichte",
    run: async () => {
      const result = await runDueStoreSyncs();
      if (result.added > 0) console.log(`Store-Finanzberichte: ${result.synced} Stores, ${result.added} neue Berichte im Archiv`);
      return warnAll(result.errors);
    },
  },
  {
    task: "etsy_sync",
    label: "Etsy Payments",
    run: async () => {
      const result = await runDueEtsySyncs();
      if (result.added > 0) console.log(`Etsy Payments: ${result.added} neue Umsätze aus dem Zahlungsverlauf`);
      return warnAll(result.errors);
    },
  },
  {
    task: "psp_sync",
    label: "Zahlungsdienstleister",
    run: async () => {
      const result = await runDuePspSyncs();
      if (result.added > 0) console.log(`Zahlungsdienstleister: ${result.added} neue Umsätze`);
      // Hinweise wie eine Lücke im Zeitraum sind kein Fehler; jede Meldung nennt ihre Verbindung
      for (const message of result.messages) console.warn(message);
      return warnAll(result.errors);
    },
  },
  {
    task: "elster_mailbox",
    label: "ELSTER-Postfach",
    run: async () => {
      if (elsterMode() !== "eric") return true;
      const result = await runDuePostfachFetch(elsterClient(), env().ELSTER_HERSTELLER_ID);
      if (!result) return true;
      console.log(`ELSTER-Postfach: ${result.message}${result.bestaetigungFehler ? ` Bestätigung fehlgeschlagen: ${result.bestaetigungFehler}` : ""}`);
      return result.ok && !result.bestaetigungFehler;
    },
  },
  {
    task: "exchange_rates",
    label: "Umrechnungskurse",
    run: async () => {
      const result = await runDueExchangeRates(today());
      if (!result) return true;
      const applied = await applyPublishedRates("system:kurse");
      const drafts = await applyPublishedRatesToDrafts("system:kurse");
      console.log(
        `Umrechnungskurse: ${result.added} neu, ${result.changed} geändert (bis ${result.latest ?? "–"}), ${applied} Belege und ${drafts} Rechnungsentwürfe umgerechnet`,
      );
      return true;
    },
  },
  {
    task: "base_rate",
    label: "Basiszinssatz",
    run: async () => {
      const result = await runDueBaseRate(today());
      if (result?.updated)
        console.log(
          `Basiszinssatz: ${formatHundredths(result.basisPoints)} % (Bundesbank, Stand ${result.month})${result.changed ? ", geändert" : ", unverändert"}`,
        );
      else if (result) console.log(`Basiszinssatz: Bundesbank meldet noch Stand ${result.month}, neuer Versuch morgen`);
      return true;
    },
  },
  {
    task: "receipt_inbox",
    label: "Belege per E-Mail",
    run: async () => {
      const result = await runDueInboxFetch();
      if (result?.messages) console.log(`Belege per E-Mail: ${result.messages} Mails, ${result.documents} neue Belege`);
      return true;
    },
  },
  {
    // USt-IdNrn. aus Rechnungen beim BZSt bestätigen, höchstens einmal am Tag; vor der Erinnerung, damit eine ungültige Nummer gleich in der Mail steht
    task: "vat_id_check",
    label: "USt-IdNrn. beim BZSt",
    run: async () => {
      const result = await runDueUstIdPruefung();
      if (result?.gefragt) console.log(`USt-IdNrn. beim BZSt: ${result.gefragt} von ${result.offen} angefragt`);
      if (result?.ausfall) console.warn(`USt-IdNrn. beim BZSt: abgebrochen, ${result.ausfall}`);
      return !result?.ausfall;
    },
  },
  {
    task: "deadline_mails",
    label: "Fristen-Erinnerung",
    run: async () => {
      const result = await runDueFristenMails(today());
      if (result?.sent) console.log(`Fristen-Erinnerung: ${result.sent} Frist(en) per E-Mail erinnert`);
      return true;
    },
  },
];

/** Ein Lauf auf einmal */
let running = false;

export async function runScheduledJobs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const job of JOBS) await runJob(job);
  } finally {
    running = false;
  }
  void runFileCheckAndPruefwertMail();
}

/** Eine Vollprüfung samt Mail auf einmal, unabhängig von `running` */
let fileCheckRunning = false;

/**
 * Die Vollprüfung liest alle Dateien und kann bei großen Beständen oder auf einem NAS länger als eine Stunde dauern.
 * Sie läuft deshalb neben den übrigen Jobs, damit Kontoabruf und Postfach des nächsten Laufs nicht auf sie warten. Die Prüfwert-Mail folgt ihr, damit sie den Stand dieses Tages nennt.
 */
async function runFileCheckAndPruefwertMail(): Promise<void> {
  if (fileCheckRunning) return;
  fileCheckRunning = true;
  try {
    await runJob({
      task: "file_check",
      label: "Vollprüfung der Dateien",
      run: async () => {
        const result = await runDueFileCheck();
        // Fehlende oder veränderte Dateien sind ein Befund der Prüfung, kein Scheitern des Jobs; die Prüfwert-Mail meldet sie
        if (result?.problemCount) console.warn(`Vollprüfung der Dateien: ${result.problemCount} von ${result.files} fehlen oder sind verändert`);
        return true;
      },
    });
    await runJob({
      task: "audit_checksum_mail",
      label: "Prüfwert-Mail",
      run: async () => {
        // Übermittelte Jahreserklärungen gegen das Journal: jahreserklaerung steht über auswertungen (erklaert-pruefen.ts)
        const result = await runDuePruefwertMail(undefined, erklaerteAbweichungsZeilen);
        if (!result) return true;
        console.log(
          `Prüfwert des Audit-Logs (Nr. ${result.seq}) per E-Mail gesendet, ${"failed" in result ? "Prüfung fehlgeschlagen" : `${result.problems} Befunde`}${result.fileProblems ? `, ${result.fileProblems} Dateien fehlen oder sind verändert` : ""}${result.rewritten ? ", Prüfwert der letzten Mail passt nicht mehr" : ""}`,
        );
        return !("failed" in result);
      },
    });
  } finally {
    fileCheckRunning = false;
  }
}

/**
 * Startet die Hintergrundjobs: kurz nach dem Start und danach stündlich. Mehrfaches Starten
 * (z. B. nach einem Neuladen im Entwicklungsserver) richtet nur einen Timer ein.
 */
export function startScheduler(): void {
  const state = globalThis as { __habenScheduler?: boolean };
  if (state.__habenScheduler || process.env.HABEN_SCHEDULER === "off") return;
  state.__habenScheduler = true;
  setTimeout(() => void runScheduledJobs(), 30_000).unref();
  setInterval(() => void runScheduledJobs(), HOUR).unref();
}
