/*
 * Prüft im fertigen Image, dass alle Pakete da sind, die zur Laufzeit geladen werden (CI-Job container). Das
 * Laufzeit-Image hat nur die nativen Pakete in node_modules, alles andere ist gebündelt (scripts/container/laufzeit.ts);
 * fehlt eines, fiele das sonst erst beim Nutzer auf, etwa bei der ersten Übermittlung an ELSTER. Geprüft wird jede
 * JavaScript- und TypeScript-Datei unter /app außerhalb von node_modules: das Server-Bundle, der Befehl haben und die
 * gebündelten Skripte (Migrationen, ERiC-Worker und -Installation, Render-Worker, Befehle für Betreiber). Jedes Paket,
 * das eine davon von außen importiert, wird geladen.
 * Aufruf im Container: bun /tmp/externe-module.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

/** Im Image /app; ein anderer Ordner als Argument, etwa der Zielordner von laufzeit.ts */
const APP = process.argv[2] ?? "/app";
/** Darf nicht fehlen: sonst hätte die Suche den falschen Ordner erwischt */
const ERWARTET = ["koffi", "@myriaddreamin/typst-ts-node-compiler"];

const builtin = new Set(builtinModules);
const transpiler = new Bun.Transpiler({ loader: "js" });
let fehler = 0;

function* dateien(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "public") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* dateien(path);
    else if (/\.([cm]?js|ts)$/.test(entry.name)) yield path;
  }
}

const pakete = new Map<string, string>();
for (const datei of dateien(APP)) {
  for (const { path } of transpiler.scanImports(readFileSync(datei, "utf8"))) {
    if (/^[./#]/.test(path) || path.includes(":") || builtin.has(path) || pakete.has(path)) continue;
    pakete.set(path, datei);
  }
}
for (const name of ERWARTET.filter((n) => !pakete.has(n))) {
  console.error(`Kein Import von ${name} unter ${APP}; stimmt der Pfad?`);
  fehler++;
}
for (const [name, datei] of pakete) {
  try {
    await import(Bun.resolveSync(name, datei));
    console.log(`ok     ${name} (${datei})`);
  } catch (error) {
    fehler++;
    console.log(`FEHLT  ${name} (${datei}): ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

process.exit(fehler > 0 ? 1 : 0);
