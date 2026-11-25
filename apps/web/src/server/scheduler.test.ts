import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureLog, configureLog } from "./log.ts";

// Die Module selbst testen ihre Tests; hier zählt nur, wer auf wen wartet
const jobs = vi.hoisted(() => ({
  runDueFileCheck: vi.fn(),
  runDuePruefwertMail: vi.fn(),
  runDueBankSyncs: vi.fn(),
  runExistingDuplicateCheck: vi.fn(),
  runDueFintsSyncs: vi.fn(),
  runDueInboxFetch: vi.fn(),
  runDueUstIdPruefung: vi.fn(),
  runDueFristenMails: vi.fn(),
}));

vi.mock("./modules/auswertungen/index.ts", () => ({ runDueFileCheck: jobs.runDueFileCheck, runDuePruefwertMail: jobs.runDuePruefwertMail }));
vi.mock("./modules/bank/index.ts", () => ({
  runDueBankSyncs: jobs.runDueBankSyncs,
  runDueFintsSyncs: jobs.runDueFintsSyncs,
  runExistingDuplicateCheck: jobs.runExistingDuplicateCheck,
}));
vi.mock("./modules/elster/index.ts", () => ({ elsterClient: vi.fn(), elsterMode: () => "simuliert" }));
vi.mock("./env.ts", () => ({ env: () => ({}) }));
vi.mock("./modules/belege/index.ts", () => ({
  applyPublishedRates: vi.fn(async () => 0),
  runDueDauerbelege: vi.fn(async () => ({ created: 0, errors: [] })),
  runDueInboxFetch: jobs.runDueInboxFetch,
}));
vi.mock("./modules/stammdaten/index.ts", () => ({ runDueExchangeRates: vi.fn(async () => null) }));
vi.mock("./modules/finanzamt/index.ts", () => ({ runDueFristenMails: jobs.runDueFristenMails, runDuePostfachFetch: vi.fn(async () => null) }));
vi.mock("./modules/rechnungen/index.ts", () => ({
  applyPublishedRatesToDrafts: vi.fn(async () => 0),
  runDueBaseRate: vi.fn(async () => null),
  runDueRecurring: vi.fn(async () => ({ created: 0, finalized: 0, mailed: 0, errors: [] })),
}));
vi.mock("./modules/stores/index.ts", () => ({ runDueStoreSyncs: vi.fn(async () => ({ synced: 0, added: 0, errors: [] })) }));
vi.mock("./modules/ablage/index.ts", () => ({ runDueArchiveDeliveries: vi.fn(async () => null) }));
vi.mock("./modules/etsy/index.ts", () => ({ runDueEtsySyncs: vi.fn(async () => ({ added: 0, errors: [] })) }));
vi.mock("./modules/umsatzsteuer/index.ts", () => ({ runDueUstIdPruefung: jobs.runDueUstIdPruefung }));

/** Eine Vollprüfung, die erst endet, wenn der Test es sagt; so lange wie bei einem großen Bestand auf einem NAS */
function langeVollpruefung() {
  let beenden = () => {};
  jobs.runDueFileCheck.mockImplementation(
    () =>
      new Promise((resolve) => {
        beenden = () => resolve({ at: new Date(), files: 1, problemCount: 0, problems: [] });
      }),
  );
  return () => beenden();
}

describe("Scheduler", () => {
  let scheduler: typeof import("./scheduler.ts");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    jobs.runDuePruefwertMail.mockResolvedValue(null);
    jobs.runDueBankSyncs.mockResolvedValue({ synced: 0, added: 0, errors: [] });
    jobs.runExistingDuplicateCheck.mockResolvedValue(null);
    jobs.runDueFintsSyncs.mockResolvedValue({ synced: 0, added: 0, errors: [] });
    jobs.runDueInboxFetch.mockResolvedValue(null);
    jobs.runDueUstIdPruefung.mockResolvedValue(null);
    jobs.runDueFristenMails.mockResolvedValue(null);
    scheduler = await import("./scheduler.ts");
  });

  it("meldet bei debug Start, Dauer und Ergebnis jedes Jobs unter seinem Namen, auch ohne Ergebnis; bei info nichts davon (#1860)", async () => {
    jobs.runDueFileCheck.mockResolvedValue(null);
    const debug = captureLog("debug");
    try {
      await scheduler.runScheduledJobs();
      await vi.waitFor(() => expect(debug.lines.some((z) => z.component === "audit_checksum_mail" && z.durationMs !== undefined)).toBe(true));
    } finally {
      debug.restore();
    }
    const ende = debug.lines.filter((z) => z.level === "debug" && typeof z.durationMs === "number");
    const { JOBS } = await import("./metriken.ts");
    expect(new Set(ende.map((z) => z.component))).toEqual(new Set(JOBS));
    // Der Kontoabruf ohne fällige Verbindung hat nichts zu melden, läuft aber sichtbar
    expect(ende.find((z) => z.component === "bank_sync")).toMatchObject({ msg: "Kontoabruf: fertig", ok: true });
    expect(debug.lines.find((z) => z.component === "bank_sync" && z.msg === "Kontoabruf: gestartet")).toBeDefined();

    const info = captureLog("info");
    try {
      // runScheduledJobs wartet auf alle stündlichen Jobs
      await scheduler.runScheduledJobs();
    } finally {
      info.restore();
      configureLog();
    }
    expect(info.lines.filter((z) => z.level === "debug")).toEqual([]);
  });

  it("bestätigt die USt-IdNrn. vor der Fristen-Erinnerung und erinnert auch nach einem Fehler dabei", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    jobs.runDueUstIdPruefung.mockRejectedValueOnce(new Error("Testfehler"));
    await scheduler.runScheduledJobs();
    // Sonst stünde eine heute ungültig gemeldete Nummer erst in der Mail des nächsten Laufs
    expect(jobs.runDueUstIdPruefung).toHaveBeenCalledBefore(jobs.runDueFristenMails);
    expect(jobs.runDueFristenMails).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("USt-IdNrn. beim BZSt", expect.any(Error));
    error.mockRestore();
  });

  it("versucht die Bestandsprüfung vor dem Kontoabruf und fährt auch nach einem Fehler fort", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    jobs.runExistingDuplicateCheck.mockRejectedValueOnce(new Error("Testfehler"));
    await scheduler.runScheduledJobs();
    expect(jobs.runExistingDuplicateCheck).toHaveBeenCalledBefore(jobs.runDueBankSyncs);
    expect(error).toHaveBeenCalledWith("Bankdublettenprüfung", expect.any(Error));
    error.mockRestore();
  });

  it("hält Kontoabruf und Postfach des nächsten Laufs nicht auf, solange die Vollprüfung der Dateien läuft", async () => {
    const beenden = langeVollpruefung();
    // Nicht abwarten: Vor der Änderung endete dieser Lauf erst mit der Vollprüfung
    void scheduler.runScheduledJobs();
    await vi.waitFor(() => expect(jobs.runDueFileCheck).toHaveBeenCalledOnce());
    // Eine Stunde später, die Vollprüfung liest noch
    await scheduler.runScheduledJobs();
    expect(jobs.runDueBankSyncs).toHaveBeenCalledTimes(2);
    expect(jobs.runDueFintsSyncs).toHaveBeenCalledTimes(2);
    expect(jobs.runDueInboxFetch).toHaveBeenCalledTimes(2);
    beenden();
  });

  it("startet keine zweite Vollprüfung, solange eine läuft", async () => {
    const beenden = langeVollpruefung();
    // Nicht abwarten: Vor der Änderung endete dieser Lauf erst mit der Vollprüfung
    void scheduler.runScheduledJobs();
    await vi.waitFor(() => expect(jobs.runDueFileCheck).toHaveBeenCalledOnce());
    await scheduler.runScheduledJobs();
    expect(jobs.runDueFileCheck).toHaveBeenCalledOnce();
    beenden();
    await vi.waitFor(() => expect(jobs.runDuePruefwertMail).toHaveBeenCalledOnce());
  });

  it("sendet die Prüfwert-Mail erst nach der Vollprüfung, damit sie deren Stand nennt", async () => {
    const beenden = langeVollpruefung();
    // Nicht abwarten: Vor der Änderung endete dieser Lauf erst mit der Vollprüfung
    void scheduler.runScheduledJobs();
    await vi.waitFor(() => expect(jobs.runDueFileCheck).toHaveBeenCalledOnce());
    expect(jobs.runDuePruefwertMail).not.toHaveBeenCalled();
    beenden();
    await vi.waitFor(() => expect(jobs.runDuePruefwertMail).toHaveBeenCalledOnce());
  });

  it("sendet die Prüfwert-Mail auch, wenn die Vollprüfung scheitert", async () => {
    jobs.runDueFileCheck.mockRejectedValue(new Error("Volume nicht eingehängt"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await scheduler.runScheduledJobs();
    await vi.waitFor(() => expect(jobs.runDuePruefwertMail).toHaveBeenCalledOnce());
  });

  it("zählt für /api/metrics: geworfener Fehler und gemeldete Fehler scheitern, ein Lauf ohne Fehler setzt den letzten Erfolg", async () => {
    const metriken = await import("./metriken.ts");
    metriken.resetMetrics();
    const stumm = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")].map((spy) => spy.mockImplementation(() => {}));
    try {
      // Abgelaufene FinTS-Verbindung: der Abruf wirft nicht, er meldet den Fehler, mit Daten aus der Buchhaltung
      jobs.runDueFintsSyncs.mockResolvedValue({
        synced: 0,
        added: 0,
        errors: ["FinTS Musterbank, DE89370400440532013000 (Erika Mustermann): 1.234,56 € offen"],
      });
      jobs.runExistingDuplicateCheck.mockRejectedValue(new Error("Rechnung RE-2026-0042 an Beispiel GmbH"));
      jobs.runDueFileCheck.mockResolvedValue(null);
      await scheduler.runScheduledJobs();
      await vi.waitFor(() => expect(jobs.runDuePruefwertMail).toHaveBeenCalledOnce());
      const erster = metriken.metricsText({ version: null, commit: null, up: true });
      const wert = (text: string, reihe: string) =>
        text
          .split("\n")
          .find((z) => z.startsWith(`${reihe} `))
          ?.split(" ")[1];
      expect(wert(erster, 'haben_job_failures_total{task="fints_sync"}')).toBe("1");
      expect(wert(erster, 'haben_job_failures_total{task="bank_duplicate_check"}')).toBe("1");
      expect(wert(erster, 'haben_job_last_success_timestamp_seconds{task="fints_sync"}')).toBeUndefined();
      expect(wert(erster, 'haben_job_last_run_timestamp_seconds{task="fints_sync"}')).toBeDefined();
      expect(wert(erster, 'haben_job_failures_total{task="bank_sync"}')).toBe("0");
      expect(wert(erster, 'haben_job_last_success_timestamp_seconds{task="bank_sync"}')).toBeDefined();
      expect(wert(erster, 'haben_job_last_success_timestamp_seconds{task="audit_checksum_mail"}')).toBeDefined();
      // Nur feste Namen und Zahlen: nichts aus den Meldungen
      expect(erster).not.toMatch(/Musterbank|DE89|Mustermann|1\.234|RE-2026|Beispiel/);

      jobs.runDueFintsSyncs.mockResolvedValue({ synced: 1, added: 3, errors: [] });
      await scheduler.runScheduledJobs();
      const zweiter = metriken.metricsText({ version: null, commit: null, up: true });
      expect(wert(zweiter, 'haben_job_failures_total{task="fints_sync"}')).toBe("1");
      expect(wert(zweiter, 'haben_job_last_success_timestamp_seconds{task="fints_sync"}')).toBe(
        wert(zweiter, 'haben_job_last_run_timestamp_seconds{task="fints_sync"}'),
      );
      expect(wert(zweiter, 'haben_job_failures_total{task="bank_duplicate_check"}')).toBe("2");
    } finally {
      for (const spy of stumm) spy.mockRestore();
    }
  });

  it("nennt im Log eine gescheiterte Prüfung der Prüfwert-Mail, nicht „0 Befunde“", async () => {
    jobs.runDueFileCheck.mockResolvedValue(null);
    jobs.runDuePruefwertMail.mockResolvedValue({ seq: 7, problems: 0, rewritten: false, fileProblems: 0, failed: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await scheduler.runScheduledJobs();
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith("Prüfwert des Audit-Logs (Nr. 7) per E-Mail gesendet, Prüfung fehlgeschlagen"));
    } finally {
      log.mockRestore();
    }
  });
});
