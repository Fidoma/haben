import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { captureLog, captureLogText, configureLog, scrub } from "./log.ts";

afterEach(() => configureLog());

describe("Logger: Daten bleiben aus dem Log (Review #1860)", () => {
  // Drizzle hängt die Parameter mit Array#toString an („params: ${params}“, drizzle-orm/errors.js): Ein Parameter mit
  // Zeilenumbruch, etwa eine Anschrift oder ein Rechnungstext, reicht über die Zeile „params: …“ hinaus
  const anschrift = "Erika Mustermann\nHeidestraße 17\n51147 Köln";
  const treiber = new Error('duplicate key value violates unique constraint "contacts_name"');
  const fehler = new DrizzleQueryError('insert into "contacts" ("address", "gross") values ($1, $2)', [anschrift, 123456], treiber);

  it("schreibt keine Zeile eines SQL-Parameters mit Zeilenumbruch, im JSON- und im Textformat", () => {
    const json = captureLog();
    console.error("Unerwarteter Fehler", { error: fehler });
    json.restore();
    const text = captureLogText();
    console.error("Unerwarteter Fehler", { error: fehler });
    text.restore();
    for (const ausgabe of [JSON.stringify(json.lines), text.lines.join("\n")]) {
      expect(ausgabe).toContain("params: [entfernt]");
      expect(ausgabe).not.toMatch(/Heidestraße|51147|Köln|123456/);
    }
  });

  it("lässt die Abfrage im Stack unverändert, auch mit $$ und $&", () => {
    const query = "do $$ begin perform 1; end $$; select '$&'";
    const { lines, restore } = captureLog();
    console.error("Unerwarteter Fehler", { error: new DrizzleQueryError(query, ["Zeile 1\nZeile 2"]) });
    restore();
    expect((lines[0]!.error as { stack: string }).stack).toContain(`Failed query: ${query}\nparams: [entfernt]\n`);
  });

  it("schreibt auch mit dem Fehler als eigenem Argument keine Zeile eines SQL-Parameters", () => {
    const { lines, restore } = captureLog();
    try {
      console.error("[unhandledRejection]", fehler);
    } finally {
      restore();
    }
    expect(JSON.stringify(lines)).not.toMatch(/Heidestraße|51147|Köln/);
  });

  it("nennt im Textformat die Ursache, wie zuvor console.error", () => {
    // Bei DrizzleQueryError steht nur in cause, warum die Abfrage scheiterte
    const { lines, restore } = captureLogText();
    console.error("Unerwarteter Fehler", { error: fehler });
    restore();
    expect(lines.join("\n")).toContain('duplicate key value violates unique constraint "contacts_name"');
  });

  it("findet eine IBAN auch zwischen Unterstrichen, etwa im Dateinamen eines Kontoauszugs", () => {
    expect(scrub("Import von Umsatzanzeige_DE89370400440532013000_20261124.csv gescheitert")).not.toContain("DE89370400440532013000");
  });

  it("schreibt im Textformat keinen SQL-Parameter eines Fehlers in einem anderen Feld als error", () => {
    const { lines, restore } = captureLogText();
    console.warn("Abruf gescheitert", { grund: fehler, details: { letzter: fehler } });
    restore();
    expect(lines.join("\n")).not.toMatch(/Heidestraße|51147|Köln|123456/);
  });
});
