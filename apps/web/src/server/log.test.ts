import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLog, captureLogText, configureLog, routeConsoleThroughLogger, scrub } from "./log.ts";
import { withLogComponent } from "./log-kontext.ts";

afterEach(() => configureLog());

describe("Umleitung von console.* (#1860)", () => {
  it("lässt Zeilen unter der Stufe weg: warn zeigt kein info und kein debug", () => {
    const { lines, restore } = captureLog("warn");
    console.debug("leise");
    console.info("Abruf fertig");
    console.warn("Verbindung abgelaufen");
    restore();
    expect(lines.map((z) => z.msg)).toEqual(["Verbindung abgelaufen"]);
  });

  it("schreibt im JSON-Format je Zeile ein Objekt mit time, level, component, msg und den Feldern aus dem letzten Argument", () => {
    const zeilen: string[] = [];
    configureLog({ level: "debug", format: "json", write: (_stream, line) => void zeilen.push(line) });
    const zurueck = routeConsoleThroughLogger();
    try {
      console.info("Kontoabruf: 1 Verbindungen, 12 neue Umsätze", { umsaetze: 12, durationMs: 840 });
      console.error("SSO: Anmeldung abgewiesen", new Error("kaputt"));
      console.log({ nurEinObjekt: true });
    } finally {
      zurueck();
    }
    expect(zeilen).toHaveLength(3);
    for (const zeile of zeilen) {
      expect(zeile).not.toContain("\n");
      const objekt = JSON.parse(zeile);
      expect(objekt).toEqual(expect.objectContaining({ level: expect.any(String), component: "console", msg: expect.any(String) }));
      expect(new Date(objekt.time).toISOString()).toBe(objekt.time);
    }
    expect(JSON.parse(zeilen[0]!)).toMatchObject({ level: "info", umsaetze: 12, durationMs: 840 });
    expect(JSON.parse(zeilen[1]!)).toMatchObject({ level: "error", msg: "SSO: Anmeldung abgewiesen", error: { name: "Error", message: "kaputt" } });
    // Ein einzelnes Objekt ist die Meldung, keine Felder
    expect(JSON.parse(zeilen[2]!).msg).toBe("{ nurEinObjekt: true }");
  });

  it("lässt im Textformat eine Zeile ohne Felder genau wie ohne Umleitung, Felder und Fehler-ID kommen dahinter", () => {
    const { lines, restore } = captureLogText();
    console.log("Haben ist noch nicht eingerichtet. Einrichtungscode für https://haben.example.de/setup: K7QM-3XRP-W9TD");
    console.debug("Kontoabruf: fertig", { ok: true, durationMs: 840 });
    console.error("Unerwarteter Fehler", { errorId: "3f9a1c07" });
    restore();
    expect(lines).toEqual([
      "Haben ist noch nicht eingerichtet. Einrichtungscode für https://haben.example.de/setup: K7QM-3XRP-W9TD",
      "Kontoabruf: fertig ok=true durationMs=840",
      "Unerwarteter Fehler (Fehler-ID 3f9a1c07)",
    ]);
  });

  it("schreibt Fehler nur mit name, message, stack und Ursache, ohne SQL-Parameter und Eigenschaften des Treibers", () => {
    // Wie DrizzleQueryError: Meldung mit der Abfrage und ihren Parametern, der Treiberfehler in cause
    const treiber = Object.assign(new Error('duplicate key value violates unique constraint "documents_sha256"'), {
      detail: "Key (sha256)=(geheim-detail) already exists.",
      parameters: ["Erika Mustermann", "1234.56"],
    });
    const fehler = new Error('Failed query: insert into "documents" ("name", "gross") values ($1, $2)\nparams: Erika Mustermann,123456', { cause: treiber });
    const { lines, restore } = captureLog();
    console.error("Unerwarteter Fehler in einer Server Function", { errorId: "3f9a1c07", error: fehler });
    console.warn("Abschluss nicht gespeichert", { ursache: fehler });
    restore();
    expect(lines[0]).toMatchObject({ errorId: "3f9a1c07", error: { name: "Error", cause: { name: "Error" } } });
    expect(lines[1]!.ursache).toMatchObject({ name: "Error" });
    const text = JSON.stringify(lines);
    expect(text).not.toMatch(/Erika|123456|1234\.56|geheim-detail/);
    expect(text).toContain("params: [entfernt]");
  });

  it("filtert IBANs und Tokens aus jeder Zeile, auch aus Feldern", () => {
    expect(scrub("Konto DE89 3704 0044 0532 0130 00 und DE89370400440532013000")).toBe("Konto [IBAN] und [IBAN]");
    expect(scrub("Authorization: Bearer abcdefghijklmnop.qrs")).toBe("Authorization: Bearer [entfernt]");
    expect(scrub("Version 0.13.0, Commit e0a546e, Transferticket et1234567890")).toBe("Version 0.13.0, Commit e0a546e, Transferticket et1234567890");
    const { lines, restore } = captureLog();
    console.warn("FinTS Musterbank: DE89370400440532013000 abgelaufen", { konto: "DE89370400440532013000" });
    restore();
    expect(JSON.stringify(lines)).not.toContain("DE89");
  });

  it("lässt den Inhalt unlesbarer Antworten von lib-fints weg", () => {
    const { lines, restore } = captureLog();
    console.error("Response Message Content:\n", "HNHBK:1:3+000000000428+300'HIKAZ:DE89370400440532013000 Erika Mustermann");
    restore();
    expect(lines.map((z) => z.msg)).toEqual(["FinTS: Inhalt der unlesbaren Antwort der Bank nicht ins Log geschrieben (Bankdaten)."]);
  });

  it("verpackt im JSON-Format auch, was direkt nach stdout geht, und filtert fertige JSON-Zeilen", () => {
    const geschrieben: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string) => geschrieben.push(chunk) > 0) as typeof process.stdout.write;
    configureLog({ format: "json" });
    const zurueck = routeConsoleThroughLogger();
    try {
      process.stdout.write("Stopping server gracefully (5s)...\x1b[2KServer closed successfully.\n");
      process.stdout.write('{"msg":"Konto DE89370400440532013000"}\n');
      console.info("Einrichtungscode für https://haben.example.de/setup: K7QM-3XRP-W9TD");
    } finally {
      zurueck();
      process.stdout.write = original;
    }
    const zeilen = geschrieben
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((z) => JSON.parse(z));
    expect(zeilen.map((z) => [z.component, z.msg])).toEqual([
      ["stdout", "Stopping server gracefully (5s)...Server closed successfully."],
      [undefined, "Konto [IBAN]"],
      ["console", "Einrichtungscode für https://haben.example.de/setup: K7QM-3XRP-W9TD"],
    ]);
  });
});

describe("Bereich aus dem Kontext", () => {
  it("nimmt den Bereich aus withLogComponent, auch nach await, Timer und Promise-Callbacks, sonst console", async () => {
    const { lines, restore } = captureLog();
    try {
      console.info("ohne Kontext");
      await withLogComponent("bank_sync", async () => {
        console.info("direkt");
        await new Promise((fertig) => setTimeout(fertig, 5));
        console.info("nach Timer");
        await Promise.resolve().then(() => console.info("im then"));
        await withLogComponent("server", async () => console.info("verschachtelt"));
        console.info("wieder außen");
      });
      console.info("danach");
    } finally {
      restore();
    }
    expect(lines.map((z) => [z.msg, z.component])).toEqual([
      ["ohne Kontext", "console"],
      ["direkt", "bank_sync"],
      ["nach Timer", "bank_sync"],
      ["im then", "bank_sync"],
      ["verschachtelt", "server"],
      ["wieder außen", "bank_sync"],
      ["danach", "console"],
    ]);
  });

  it("nimmt ohne Kontext den Bereich, den das Skript vorgibt", () => {
    const zeilen: string[] = [];
    configureLog({ format: "json", write: (_stream, line) => void zeilen.push(line) });
    const zurueck = routeConsoleThroughLogger({ component: "migration" });
    try {
      console.log("Migrationen angewendet");
    } finally {
      zurueck();
    }
    expect(JSON.parse(zeilen[0]!)).toMatchObject({ component: "migration", msg: "Migrationen angewendet" });
  });
});

describe("HABEN_LOG_LEVEL und HABEN_LOG_FORMAT in env.ts", () => {
  const basis = () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
    vi.stubEnv("BETTER_AUTH_URL", "https://haben.example.de");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("HABEN_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  };
  afterEach(() => vi.unstubAllEnvs());
  const load = async () => (await import("./env.ts")).env();

  it("nimmt gültige Werte und ohne Angabe info und text", async () => {
    basis();
    await expect(load()).resolves.toMatchObject({ HABEN_LOG_LEVEL: "info", HABEN_LOG_FORMAT: "text" });
    basis();
    vi.stubEnv("HABEN_LOG_LEVEL", "debug");
    vi.stubEnv("HABEN_LOG_FORMAT", "json");
    await expect(load()).resolves.toMatchObject({ HABEN_LOG_LEVEL: "debug", HABEN_LOG_FORMAT: "json" });
  });

  it.each([
    ["HABEN_LOG_LEVEL", "verbose"],
    ["HABEN_LOG_FORMAT", "logfmt"],
  ])("lässt den Start mit %s=%s scheitern", async (name, wert) => {
    basis();
    vi.stubEnv(name, wert);
    await expect(load()).rejects.toThrow(name);
  });
});
