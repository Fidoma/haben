import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projekt } from "./github.ts";
import { boardLink, boardNummer } from "./projekt.ts";
import { STATUS } from "./regel.ts";
import { entscheiden, textZugewiesen } from "./uebernahme.ts";

const URL_HABEN = "https://github.com/orgs/Speicherstadt/projects/3";
const URL_ANDERES = "https://github.com/orgs/Speicherstadt/projects/7";

/** Beide Antworten, die auf das Board verweisen */
const antworten = () => [
  textZugewiesen("alice", "Geplant"),
  JSON.stringify(entscheiden("übernehmen", { person: "alice", offen: true, status: null, zugewiesen: [] })),
];

beforeEach(() => vi.stubEnv("GITHUB_REPOSITORY", "Speicherstadt/haben"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Board aus BOARD_NUMMER", () => {
  // Eine nicht gesetzte Variable des Repositorys kommt im Workflow als leerer Text an
  it.each([undefined, "", "  "])("ist ohne Einstellung (%j) das Board von Haben", (wert) => {
    vi.stubEnv("BOARD_NUMMER", wert);
    expect(boardNummer()).toBe(3);
    expect(boardLink()).toBe(`[Board](${URL_HABEN})`);
    for (const text of antworten()) expect(text).toContain(URL_HABEN);
  });

  it("ist mit Einstellung das genannte Board, auch in den Antworten", () => {
    vi.stubEnv("BOARD_NUMMER", "7");
    expect(boardNummer()).toBe(7);
    for (const text of antworten()) {
      expect(text).toContain(URL_ANDERES);
      expect(text).not.toContain(URL_HABEN);
    }
  });

  it("bricht in einem anderen Repository ohne Einstellung ab, statt auf Board 3 zu schreiben", () => {
    vi.stubEnv("BOARD_NUMMER", "");
    vi.stubEnv("GITHUB_REPOSITORY", "Speicherstadt/haben-at");
    expect(() => boardNummer()).toThrow("BOARD_NUMMER");
    vi.stubEnv("BOARD_NUMMER", "7");
    expect(boardNummer()).toBe(7);
  });

  it.each([undefined, "Speicherstadt/haben"])("ist im Repository %j ohne Einstellung Board 3", (repo) => {
    vi.stubEnv("BOARD_NUMMER", undefined);
    vi.stubEnv("GITHUB_REPOSITORY", repo);
    expect(boardNummer()).toBe(3);
  });

  it.each(["0", "-1", "3.5", "7a", "sieben", "0x7", "1e1"])("bricht bei „%s“ ab, statt auf Board 3 zu schreiben", (wert) => {
    vi.stubEnv("BOARD_NUMMER", wert);
    expect(() => boardNummer()).toThrow("BOARD_NUMMER");
  });

  it.each([
    [undefined, 3],
    ["7", 7],
  ])("fragt bei %j das Project %i ab", async (wert, nummer) => {
    vi.stubEnv("BOARD_NUMMER", wert);
    const anfragen: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      anfragen.push(JSON.parse(String(init.body)).variables);
      const options = STATUS.map((name) => ({ id: name, name }));
      return new Response(JSON.stringify({ data: { organization: { projectV2: { id: "p", field: { id: "f", options } } } } }));
    });
    await projekt("token", STATUS);
    expect(anfragen).toEqual([{ owner: "Speicherstadt", number: nummer }]);
  });

  it.each(["board.yml", "uebernehmen.yml"])("bekommen in %s alle Schritte mit PROJECT_TOKEN", async (datei) => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL(`../../.github/workflows/${datei}`, import.meta.url), "utf8");
    const token = text.match(/PROJECT_TOKEN: \$\{\{ secrets\.PROJECT_TOKEN \}\}/g) ?? [];
    const board = text.match(/PROJECT_TOKEN: \$\{\{ secrets\.PROJECT_TOKEN \}\}\n +BOARD_NUMMER: \$\{\{ vars\.BOARD_NUMMER \}\}/g) ?? [];
    expect(token.length).toBeGreaterThan(0);
    expect(board).toHaveLength(token.length);
  });
});
