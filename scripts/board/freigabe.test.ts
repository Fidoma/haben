import { afterEach, expect, it, vi } from "vitest";
import { MARKE_ERINNERUNG } from "./uebernahme.ts";

/* Der tägliche Lauf (erinnerung.ts) gegen ein nachgebautes GitHub: Issue #5, vor sieben und mehr Tagen erinnert */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function lauf(boardNummer: string) {
  const schreibend: string[] = [];
  const antwort = (daten: unknown) => new Response(JSON.stringify(daten), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (eingabe: string, init: RequestInit = {}) => {
    const { pathname } = new URL(eingabe);
    const methode = init.method ?? "GET";
    const query: string = pathname === "/graphql" ? JSON.parse(String(init.body)).query : "";
    if (query.includes("projectV2(number")) {
      const options = ["Später", "Geplant", "In Arbeit", "Im nächsten Release", "Erledigt"].map((name) => ({ id: name, name }));
      return antwort({ data: { organization: { projectV2: { id: "p", field: { id: "f", options } } } } });
    }
    if (query.includes("issueOrPullRequest")) {
      const projectItems = { nodes: [{ id: "karte", project: { id: "p" }, fieldValueByName: { name: "In Arbeit" } }] };
      return antwort({ data: { repository: { issueOrPullRequest: { __typename: "Issue", id: "i", state: "OPEN", projectItems } } } });
    }
    if (query.includes("updateProjectV2ItemFieldValue") || methode !== "GET") {
      schreibend.push(query ? "Karte" : `${methode} ${pathname}`);
      return antwort({ data: {}, assignees: [] });
    }
    if (pathname.endsWith("/pulls")) return antwort([]);
    if (pathname.endsWith("/issues")) return antwort([{ number: 5, assignees: [{ login: "alice" }] }]);
    if (pathname.includes("/collaborators/")) return antwort({ permission: "read", role_name: "read" });
    if (pathname.endsWith("/comments")) {
      return antwort([{ body: MARKE_ERINNERUNG, created_at: "2020-02-01T00:00:00Z", user: { login: "bot" } }]);
    }
    return antwort([{ event: "assigned", created_at: "2020-01-01T00:00:00Z", assignee: { login: "alice" } }]);
  });
  vi.stubEnv("GITHUB_TOKEN", "g");
  vi.stubEnv("PROJECT_TOKEN", "p");
  vi.stubEnv("GITHUB_REPOSITORY", "Speicherstadt/haben");
  vi.stubEnv("BOARD_NUMMER", boardNummer);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  const fehler = await import("./erinnerung.ts").then(
    () => null,
    (e: Error) => e.message,
  );
  return { schreibend, fehler };
}

it("gibt frei, legt die Karte zurück und kommentiert", async () => {
  const { schreibend, fehler } = await lauf("");
  expect(fehler).toBeNull();
  expect(schreibend).toEqual(["DELETE /repos/Speicherstadt/haben/issues/5/assignees", "Karte", "POST /repos/Speicherstadt/haben/issues/5/comments"]);
});

it("schreibt bei unbrauchbarer BOARD_NUMMER nichts", async () => {
  const { schreibend, fehler } = await lauf("7a");
  expect(fehler).toContain("BOARD_NUMMER");
  expect(schreibend).toEqual([]);
});
