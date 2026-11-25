import { afterEach, describe, expect, it } from "vitest";
import { captureLog, configureLog } from "../../log.ts";
import { progressMessage } from "./umzug-gemeinsam.ts";

afterEach(() => configureLog());

describe("Meldung eines gescheiterten Abrufs (#1860)", () => {
  it("nennt bei einem unerwarteten Fehler die Fehler-ID der Zeile im Log", () => {
    const { lines, restore } = captureLog();
    const meldung = progressMessage(new Error("Verbindung abgebrochen"));
    restore();
    expect(lines).toHaveLength(1);
    expect(meldung).toBe(`Interner Fehler (Fehler-ID ${lines[0]!.errorId}). Details stehen im Server-Log.`);
  });
});
