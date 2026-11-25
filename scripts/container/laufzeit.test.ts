import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { buendeln, SKRIPTE } from "./laufzeit.ts";

const lesen = (pfad: string) => readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8");
/** Pfad im Image (/app/…) oder relativ zu einem Arbeitsverzeichnis darin → Pfad im Repository */
const imRepo = (pfad: string, arbeitsverzeichnis = "/app") => posix.relative("/app", posix.resolve(arbeitsverzeichnis, pfad));

describe("Skripte im Laufzeit-Image (laufzeit.ts)", () => {
  it("enthält jedes Skript, das der Entrypoint startet", () => {
    // Der Entrypoint wechselt zuerst nach /app/apps/web
    const pfade = [...lesen("deploy/entrypoint.sh").matchAll(/\bbun (\S+\.ts)\b/g)].map(([, p]) => imRepo(p, "/app/apps/web"));
    expect(pfade.length).toBeGreaterThan(0);
    expect(SKRIPTE).toEqual(expect.arrayContaining(pfade));
  });

  it("enthält den ERiC-Worker und den Render-Worker aus den Pfaden im Containerfile", () => {
    const containerfile = lesen("Containerfile");
    const env = (name: string) => containerfile.match(new RegExp(`${name}=(\\S+)`))?.[1];
    const worker = env("ERIC_WORKER_PATH");
    const einvoice = env("HABEN_EINVOICE_DIR");
    expect(worker && einvoice).toBeTruthy();
    // Den Render-Worker sucht render-client.ts unter HABEN_EINVOICE_DIR/src
    expect(lesen("packages/einvoice/src/render-client.ts")).toContain('join(PACKAGE_DIR, "src", "render-worker.ts")');
    expect(SKRIPTE).toEqual(expect.arrayContaining([imRepo(worker ?? ""), imRepo(`${einvoice}/src/render-worker.ts`)]));
  });

  it("enthält jedes Skript, das die Doku im Container starten lässt", () => {
    const docs = readdirSync(new URL("../../docs/", import.meta.url)).filter((datei) => datei.endsWith(".md"));
    // docker compose exec app bun …, docker compose run … --entrypoint bun app …
    const befehl = /(?:exec app bun|--entrypoint bun app) (\S+\.ts)\b/g;
    const pfade = docs.flatMap((datei) => [...lesen(`docs/${datei}`).matchAll(befehl)].map(([, p]) => imRepo(p)));
    expect(pfade.length).toBeGreaterThan(0);
    expect(SKRIPTE).toEqual(expect.arrayContaining(pfade));
  });
});

describe("Bündeln (laufzeit.ts)", () => {
  it("wertet NODE_ENV zur Laufzeit aus, nicht mit dem Wert der Build-Stufe", async () => {
    // Die Build-Stufe des Containerfile setzt kein NODE_ENV; das Image setzt NODE_ENV=production. Ohne Vorgabe schriebe
    // Bun den Wert beim Bündeln fest, etwa die HTTP-Ausnahme für OIDC (env.ts) in umstellung/cli.ts und import-cli.ts
    const ordner = mkdtempSync(join(tmpdir(), "laufzeit-"));
    try {
      const quelle = join(ordner, "skript.ts");
      writeFileSync(quelle, 'console.log(process.env.NODE_ENV !== "production" ? "entwicklung" : "betrieb");\n');
      await buendeln(quelle, join(ordner, "aus", "skript.ts"));
      const lauf = Bun.spawnSync([process.execPath, join(ordner, "aus", "skript.ts")], { env: { ...process.env, NODE_ENV: "production" } });
      expect(lauf.stdout.toString().trim()).toBe("betrieb");
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
  });
});
