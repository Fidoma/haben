import { formatWithOptions } from "node:util";
import { ohneBankdaten } from "@haben/import";
import { LOG_FORMATS, LOG_LEVELS, type LogFormat, type LogLevel } from "../lib/log-werte.ts";
import { logComponent } from "./log-kontext.ts";

/*
 * Log des Serverprozesses (#1860): Haben schreibt überall mit console.*; diese Datei leitet console beim Start um
 * (plugins/log.ts) und gibt jeder Zeile Stufe, Format und den Filter an einer Stelle, auch den Ausgaben von Abhängigkeiten
 * (lib-fints, Nitro, Better Auth). Stufe und Format kommen aus HABEN_LOG_LEVEL und HABEN_LOG_FORMAT; env.ts prüft die
 * Werte beim Start. Den Bereich (component) setzt der Kontext (log-kontext.ts).
 *
 * - Felder: ein einfaches Objekt als letztes Argument, etwa console.info("Abruf fertig", { umsaetze: 12 }). Ein Fehler
 *   darin oder als eigenes Argument erscheint nur mit Name, Meldung, Stack und Ursache.
 * - Im Textformat bleibt eine Zeile ohne Felder genau die Meldung, wie ohne Umleitung; auf diese Zeilen verweist die Doku
 *   („Einrichtungscode für …“). Das Feld errorId erscheint dort als „(Fehler-ID …)“, Stack und Ursachen darunter.
 * - debug und info gehen nach stdout, warn und error nach stderr.
 */

type Fields = Record<string, unknown>;

interface Config {
  level: LogLevel;
  format: LogFormat;
  write: (stream: "stdout" | "stderr", line: string) => void;
}

const fromEnv = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
  const value = process.env[name]?.trim();
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
};

/** Auf globalThis: Plugins und SSR-Bundle (und Tests nach vi.resetModules) haben je eine Kopie dieser Datei */
const state = globalThis as { __habenLog?: Config };
const current = (): Config =>
  (state.__habenLog ??= {
    level: fromEnv("HABEN_LOG_LEVEL", LOG_LEVELS, "info"),
    format: fromEnv("HABEN_LOG_FORMAT", LOG_FORMATS, "text"),
    write: (stream, line) => void process[stream].write(`${line}\n`),
  });

/** Nur für Tests: Stufe, Format und Ausgabe festlegen; ohne Argument wieder aus der Umgebung */
export function configureLog(next?: Partial<Config>): void {
  if (next) state.__habenLog = { ...current(), ...next };
  else delete state.__habenLog;
}

/** Nur für Tests: schaltet die Umleitung ein und fängt jede Zeile ab, bis `restore` */
function capture<T>(level: LogLevel, format: LogFormat, parse: (line: string) => T): { lines: T[]; restore: () => void } {
  const lines: T[] = [];
  const installed = !(globalThis as { __habenConsole?: unknown }).__habenConsole;
  configureLog({ level, format, write: (_stream, line) => void lines.push(parse(line)) });
  const undo = routeConsoleThroughLogger();
  return {
    lines,
    restore: () => {
      if (installed) undo();
      configureLog();
    },
  };
}

/** Nur für Tests: jede Zeile als JSON-Objekt */
export const captureLog = (level: LogLevel = "debug") => capture(level, "json", (line) => JSON.parse(line) as Record<string, unknown>);

/** Nur für Tests: jede Zeile im Textformat */
export const captureLogText = (level: LogLevel = "debug") => capture(level, "text", (line) => line);

/*
 * Der Filter: Auch bei debug kommen keine IBANs, Bearer-Tokens oder SQL-Parameter ins Log. Drizzle hängt die Parameter
 * einer gescheiterten Abfrage als Zeile „params: …“ an Meldung und Stack (DrizzleQueryError). Beleginhalte, Beträge und
 * Namen schreibt Haben selbst nicht ins Log; ein Muster dafür gibt es nicht.
 */
// Nicht \b: Der Unterstrich zählt dort als Buchstabe, und ING nennt den Export „Umsatzanzeige_<IBAN>_<Datum>.csv“
const IBAN = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SQL_PARAMS = /^params: .*$/gm;
const SQL_PARAMS_START = /^params: /m;

export function scrub(text: string): string {
  return text.replace(SQL_PARAMS, "params: [entfernt]").replace(BEARER, "$1 [entfernt]").replace(IBAN, "[IBAN]");
}

/*
 * DrizzleQueryError setzt die Parameter mit Array#toString ans Ende der Meldung (drizzle-orm/errors.js): Ein Parameter
 * mit Zeilenumbruch (Anschrift, Rechnungstext) reicht über die Zeile „params: …“ hinaus. Darum fällt hier alles ab
 * „params: “ bis zum Ende der Meldung weg, im Stack ebenso, der mit der Meldung beginnt.
 */
function messageAndStack(error: Error): { message: string; stack?: string } {
  const start = error.message.search(SQL_PARAMS_START);
  if (start < 0) return { message: error.message, stack: error.stack };
  const message = `${error.message.slice(0, start)}params: [entfernt]`;
  if (!error.stack) return { message };
  if (error.stack.includes(error.message)) return { message, stack: error.stack.replace(error.message, () => message) };
  const frames = error.stack.search(/^\s+at /m);
  return { message, stack: `${error.name}: ${message}${frames < 0 ? "" : `\n${error.stack.slice(frames)}`}` };
}

/** Fehler nur mit Name, Meldung, Stack und Ursache, nie als ganzes Objekt: Treiberfehler tragen sonst Parameter und Zeilen */
function serializeError(error: unknown, depth = 0): Fields {
  if (!(error instanceof Error)) return { message: String(error) };
  const { message, stack } = messageAndStack(error);
  const out: Fields = { name: error.name, message };
  if (stack) out.stack = stack;
  if (error.cause !== undefined && depth < 2) out.cause = serializeError(error.cause, depth + 1);
  return out;
}

const scrubDeep = (value: unknown): unknown => {
  if (typeof value === "string") return scrub(value);
  // Auch in anderen Feldern als error nie die eigenen Eigenschaften eines Fehlers (etwa params eines DrizzleQueryError)
  if (value instanceof Error) return scrubDeep(serializeError(value));
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  return value;
};

/** Textformat: Stack des Fehlers, darunter die Ursachen; bei DrizzleQueryError sagt erst die Ursache, warum die Abfrage scheiterte */
const errorText = (err: Fields): string => {
  const own = (err.stack as string | undefined) ?? `${err.name ?? "Error"}: ${err.message}`;
  return err.cause ? `${own}\nUrsache: ${errorText(err.cause as Fields)}` : own;
};

const textValue = (value: unknown) => (typeof value === "string" ? (/\s/.test(value) ? JSON.stringify(value) : value) : JSON.stringify(value));

function emit(level: LogLevel, msg: string, fields: Fields, fallback: string): void {
  const cfg = current();
  if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(cfg.level)) return;
  const { error, errorId, ...rest } = fields;
  const err = error === undefined ? undefined : serializeError(error);
  const stream = level === "warn" || level === "error" ? "stderr" : "stdout";
  if (cfg.format === "json") {
    const line = {
      ...(scrubDeep(rest) as Fields),
      time: new Date().toISOString(),
      level,
      component: logComponent() ?? fallback,
      msg: scrub(msg),
      ...(errorId === undefined ? {} : { errorId }),
      ...(err ? { error: scrubDeep(err) } : {}),
    };
    cfg.write(stream, JSON.stringify(line));
    return;
  }
  const extra = Object.entries(scrubDeep(rest) as Fields).map(([k, v]) => `${k}=${textValue(v)}`);
  let line = `${msg}${errorId === undefined ? "" : ` (Fehler-ID ${String(errorId)})`}${extra.length ? ` ${extra.join(" ")}` : ""}`;
  if (err) line += `\n${errorText(err)}`;
  cfg.write(stream, scrub(line));
}

/** Ein einfaches Objekt (kein Fehler, keine Liste, kein Datum) als letztes Argument sind die Felder der Zeile */
const isFields = (value: unknown): value is Fields => {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const CONSOLE_LEVELS = { debug: "debug", log: "info", info: "info", warn: "warn", error: "error" } as const;

/**
 * Leitet console.* durch Stufe, Format und Filter; einmal je Prozess, beim Start (plugins/log.ts, Skripte beim Start des
 * Containers). `component` gilt, wo der Kontext keinen Bereich setzt. Gibt eine Funktion zurück, die console
 * wiederherstellt (für Tests).
 */
export function routeConsoleThroughLogger({ component = "console" }: { component?: string } = {}): () => void {
  const state = globalThis as { __habenConsole?: () => void };
  if (state.__habenConsole) return state.__habenConsole;
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  const originals = Object.fromEntries(Object.keys(CONSOLE_LEVELS).map((method) => [method, target[method]]));
  for (const [method, level] of Object.entries(CONSOLE_LEVELS)) {
    target[method] = (...args: unknown[]) => {
      const filtered = ohneBankdaten(args);
      const last = filtered.at(-1);
      const withFields = filtered.length > 1 && isFields(last);
      const fields: Fields = withFields ? { ...last } : {};
      let rest = withFields ? filtered.slice(0, -1) : filtered;
      const error = rest.find((a): a is Error => a instanceof Error);
      if (error) {
        rest = rest.filter((a) => a !== error);
        fields.error ??= error;
      }
      emit(level, formatWithOptions({ colors: false, depth: 4 }, ...rest), fields, component);
    };
  }
  const streams = current().format === "json" ? (["stdout", "stderr"] as const).map(wrapStream) : [];
  state.__habenConsole = () => {
    Object.assign(target, originals);
    for (const restore of streams) restore();
    delete state.__habenConsole;
  };
  return state.__habenConsole;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: Escape-Sequenzen des Terminals sind hier gesucht
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Nur im JSON-Format: Was an console vorbei direkt nach stdout oder stderr geht (srvx beim Herunterfahren), wird zu einer
 * JSON-Zeile mit component stdout bzw. stderr. Zeilen, die schon ein Objekt sind, auch die eigenen, gehen bis auf den Filter unverändert durch.
 */
function wrapStream(name: "stdout" | "stderr"): () => void {
  const stream = process[name];
  const original = stream.write;
  const write = original.bind(stream) as (chunk: string) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : undefined;
    if (text === undefined) return (original as (...args: unknown[]) => boolean).call(stream, chunk, ...rest);
    // Schon ein Objekt, auch die eigenen Zeilen: unverändert bis auf den Filter, der auch fremde JSON-Zeilen trifft
    if (text.trimStart().startsWith("{")) return (original as (...args: unknown[]) => boolean).call(stream, scrub(text), ...rest);
    for (const zeile of text.replace(ANSI, "").split(/\r?\n|\r/)) {
      if (zeile.trim())
        write(`${JSON.stringify({ time: new Date().toISOString(), level: name === "stderr" ? "warn" : "info", component: name, msg: scrub(zeile.trim()) })}\n`);
    }
    const callback = rest.find((r): r is () => void => typeof r === "function");
    callback?.();
    return true;
  }) as typeof stream.write;
  return () => {
    stream.write = original;
  };
}
