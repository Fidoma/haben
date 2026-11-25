import { describe, expect, it } from "vitest";
import { ohneBankdaten } from "./log.ts";

describe("FinTS: Bankdaten nicht ins Log", () => {
  it("ersetzt den Inhalt einer unlesbaren Antwort von lib-fints und lässt alles andere durch", () => {
    const antwort = "HNHBK:1:3+000000000428+300+0+1'HIKAZ:5:7:3+@120@:20:STARTUMS'DE89370400440532013000";
    expect(ohneBankdaten(["Response Message Content:\n", antwort])).toEqual([
      "FinTS: Inhalt der unlesbaren Antwort der Bank nicht ins Log geschrieben (Bankdaten).",
    ]);
    const fehler = new Error("Invalid response");
    expect(ohneBankdaten(["Fehler beim Dekodieren", fehler])).toEqual(["Fehler beim Dekodieren", fehler]);
  });
});
