import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fintsClient, fintsSynchronisieren } from "@haben/import";
import { afterEach, describe, expect, it } from "vitest";
import { captureLog, configureLog } from "./log.ts";
import { withLogComponent } from "./log-kontext.ts";

afterEach(() => configureLog());

describe("Bereich aus dem Kontext durch lib-fints (#1860)", () => {
  it("trägt die Zeile, die lib-fints selbst mit console.error schreibt, unter dem Bereich des Jobs", async () => {
    // Eine Bank, deren Antwort lib-fints nicht lesen kann: lib-fints schreibt dann aus seinen eigenen Callbacks (fetch,
    // Dekodieren) mit console.error. Unter Bun muss der Kontext von AsyncLocalStorage bis dorthin reichen.
    const server = createServer((_req, res) => res.end(Buffer.from("HNHBK:1:3+kaputt'HIRMG:2:2+Erika Mustermann'", "latin1").toString("base64")));
    await new Promise<void>((fertig) => server.listen(0, "127.0.0.1", fertig));
    const { lines, restore } = captureLog();
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const zugang = { url, blz: "12030000", benutzer: "max", pin: "12345" };
      await withLogComponent("fints_sync", () =>
        expect(fintsSynchronisieren(fintsClient({ id: "TESTPRODUKT0123456789ABCD", version: "0.9" }, zugang))).rejects.toThrow(),
      );
    } finally {
      restore();
      server.close();
    }
    const vonLibFints = lines.filter((z) => z.msg === "FinTS: Inhalt der unlesbaren Antwort der Bank nicht ins Log geschrieben (Bankdaten).");
    expect(vonLibFints).toHaveLength(1);
    expect(vonLibFints[0]).toMatchObject({ level: "error", component: "fints_sync" });
    expect(lines.every((z) => z.component === "fints_sync")).toBe(true);
    expect(JSON.stringify(lines)).not.toContain("Mustermann");
  });
});
