import { type MetricsSnapshot, renderMetrics } from "@haben/core";

/*
 * Zähler für /api/metrics (#1858): Läufe der Hintergrundjobs und ELSTER-Übermittlungen seit dem Start des Prozesses.
 * Nur Zeitpunkte und Anzahlen mit festen Labels, nie Meldungen, Namen, Beträge oder IDs. Nach einem Neustart fangen
 * sie bei null an; Prometheus erkennt zurückgesprungene Zähler selbst. Den Text macht `renderMetrics` in @haben/core.
 */

/** Feste Namen der Hintergrundjobs, englisch wie /api/health; Monitore und Alarmregeln verlassen sich auf sie */
export const JOBS = [
  "recurring_invoices",
  "archive_delivery",
  "recurring_receipts",
  "bank_duplicate_check",
  "bank_sync",
  "fints_sync",
  "store_reports",
  "etsy_sync",
  "psp_sync",
  "elster_mailbox",
  "exchange_rates",
  "base_rate",
  "receipt_inbox",
  "vat_id_check",
  "deadline_mails",
  "file_check",
  "audit_checksum_mail",
] as const;
export type Job = (typeof JOBS)[number];

/** validate: nur prüfen, test: Testübermittlung, send: echt (ElsterVorgang) */
const ELSTER_KINDS = ["validate", "test", "send"] as const;
const ELSTER_RESULTS = ["ok", "error"] as const;
type ElsterKind = (typeof ELSTER_KINDS)[number];

interface JobStand {
  lastRun?: number;
  lastSuccess?: number;
  failures: number;
}

interface Stand {
  jobs: Map<Job, JobStand>;
  elster: Map<string, number>;
}

/** Auf globalThis wie der Scheduler: Plugin und Route teilen sich so denselben Stand, auch nach einem Neuladen im Entwicklungsserver */
function stand(): Stand {
  const g = globalThis as { __habenMetriken?: Stand };
  g.__habenMetriken ??= { jobs: new Map(), elster: new Map() };
  return g.__habenMetriken;
}

/** Nur für Tests */
export function resetMetrics(): void {
  delete (globalThis as { __habenMetriken?: Stand }).__habenMetriken;
}

/** Ein Lauf eines Jobs; ein gescheiterter zählt als Fehler und lässt den letzten Erfolg stehen */
export function recordJobRun(job: Job, ok: boolean, at = Date.now()): void {
  const jobs = stand().jobs;
  const s = jobs.get(job) ?? { failures: 0 };
  s.lastRun = at;
  if (ok) s.lastSuccess = at;
  else s.failures++;
  jobs.set(job, s);
}

/** Eine Antwort von ERiC auf Prüfen oder Senden; ok ist das Ergebnis, nicht der Inhalt */
export function recordElsterSubmission(kind: ElsterKind, ok: boolean): void {
  const key = `${kind}:${ok ? "ok" : "error"}`;
  const elster = stand().elster;
  elster.set(key, (elster.get(key) ?? 0) + 1);
}

/** Text für /api/metrics aus dem Stand seit dem Start; alle Jobs und Kombinationen erscheinen, auch ohne Lauf mit null Fehlern */
export function metricsText(info: Pick<MetricsSnapshot, "version" | "commit" | "up">): string {
  const { jobs, elster } = stand();
  return renderMetrics({
    ...info,
    jobs: JOBS.map((task) => ({ task, failures: 0, ...jobs.get(task) })),
    elster: ELSTER_KINDS.flatMap((kind) => ELSTER_RESULTS.map((result) => ({ kind, result, count: elster.get(`${kind}:${result}`) ?? 0 }))),
  });
}
