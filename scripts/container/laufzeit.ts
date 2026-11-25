/*
 * Stellt im Containerfile nach `bun run build` zusammen, was das Laufzeit-Image braucht, und nur das: Server-Bundle,
 * Migrationen ohne die Schnappschüsse von drizzle-kit, Vorlagen und Schriften der Belege, die gebündelten Skripte und
 * ein node_modules nur mit den nativen Paketen. Ohne das hätte das Image alle rund 350 installierten Pakete, darunter
 * Build-Werkzeuge, die nie laufen.
 *
 * Jedes Skript, das Bun im Image startet, liegt dort unter seinem Pfad aus dem Repository, aber als ein gebündeltes
 * JavaScript (Bun liest es trotz der Endung .ts). So bleiben Entrypoint, ERIC_WORKER_PATH, der Pfad des Render-Workers
 * und die Befehle in der Doku unverändert, und `import.meta.url` zeigt auf denselben Ordner wie in den Quellen
 * (etwa `../../../drizzle` in migrate.ts). Außen bleiben nur die nativen Pakete; sie kommen aus /app/node_modules.
 * Ein Skript, das hier fehlt, fehlt im Image; laufzeit.test.ts gleicht SKRIPTE mit Entrypoint, Containerfile und Doku ab.
 *
 * Aufruf: bun scripts/container/laufzeit.ts <Zielordner>
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Native Bindungen, je mit dem Workspace-Paket, aus dem sie aufgelöst werden */
const NATIV = [
  { paket: "koffi", von: "packages/elster" },
  { paket: "@myriaddreamin/typst-ts-node-compiler", von: "packages/einvoice" },
];

/** Skripte, die Bun im Image per Pfad startet: Entrypoint, Kindprozesse und Befehle für Betreiber aus der Doku */
export const SKRIPTE = [
  "apps/web/src/server/db/migrate.ts",
  "apps/web/src/server/db/sso-uebernahme.ts",
  "apps/web/src/server/db/local-owner.ts",
  "apps/web/src/server/modules/umstellung/cli.ts",
  "apps/web/src/server/modules/datenimport/import-cli.ts",
  "packages/elster/src/worker.ts",
  "packages/elster/src/install-cli.ts",
  "packages/einvoice/src/render-worker.ts",
];

/** Der Befehl haben (deploy/haben.sh) */
const CLI = { quelle: "apps/web/src/server/modules/betrieb/cli.ts", ziel: "apps/web/.output/haben-cli.js" };

/** Dateien und Ordner, die unverändert ins Image gehen */
const UNVERAENDERT = [
  "package.json",
  "apps/web/package.json",
  "apps/web/.output",
  "apps/web/drizzle",
  "packages/einvoice/templates",
  "packages/einvoice/fonts",
];

/** Die Schnappschüsse des Schemas (rund 100 MB) braucht nur drizzle-kit; der Migrator liest SQL und _journal.json */
const ohneSchnappschuss = (pfad: string): boolean => !pfad.endsWith("_snapshot.json");

export async function buendeln(quelle: string, ziel: string): Promise<void> {
  const ergebnis = await Bun.build({
    entrypoints: [quelle],
    target: "bun",
    external: NATIV.map((n) => n.paket),
    // Sonst schriebe Bun das NODE_ENV der Build-Stufe (leer, also Entwicklung) fest; im Image gilt NODE_ENV=production
    define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
    banner: `// Gebündelt aus ${quelle} (scripts/container/laufzeit.ts)`,
    throw: false,
  });
  const [ausgabe] = ergebnis.outputs;
  if (!ergebnis.success || !ausgabe || ergebnis.outputs.length !== 1) {
    for (const log of ergebnis.logs) console.error(log);
    throw new Error(`${quelle} ließ sich nicht bündeln`);
  }
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, await ausgabe.text());
}

/** Kopiert das Paket und seine installierten optionalen Pakete (die Bindung je Plattform), ohne die für musl */
function nativKopieren(paket: string, von: string, nodeModules: string): void {
  const ordner = realpathSync(dirname(Bun.resolveSync(`${paket}/package.json`, resolve(von))));
  cpSync(ordner, join(nodeModules, paket), { recursive: true, dereference: true });
  const { optionalDependencies = {} } = JSON.parse(readFileSync(join(ordner, "package.json"), "utf8")) as {
    optionalDependencies?: Record<string, string>;
  };
  for (const name of Object.keys(optionalDependencies)) {
    if (name.endsWith("-musl")) continue;
    let plattform: string;
    try {
      plattform = realpathSync(dirname(Bun.resolveSync(`${name}/package.json`, ordner)));
    } catch {
      continue; // für eine andere Plattform, nicht installiert
    }
    cpSync(plattform, join(nodeModules, name), { recursive: true, dereference: true });
  }
}

async function zusammenstellen(ziel: string): Promise<void> {
  if (!existsSync("apps/web/.output")) throw new Error("apps/web/.output fehlt; vorher bun run build");
  rmSync(ziel, { recursive: true, force: true });
  for (const pfad of UNVERAENDERT) cpSync(pfad, join(ziel, pfad), { recursive: true, filter: ohneSchnappschuss });
  for (const skript of [...SKRIPTE.map((s) => ({ quelle: s, ziel: s })), CLI]) await buendeln(skript.quelle, join(ziel, skript.ziel));
  for (const { paket, von } of NATIV) nativKopieren(paket, von, join(ziel, "node_modules"));
}

if (import.meta.main) {
  const ziel = process.argv[2];
  if (!ziel) throw new Error("Aufruf: bun scripts/container/laufzeit.ts <Zielordner>");
  await zusammenstellen(ziel);
}
