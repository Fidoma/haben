import { AsyncLocalStorage } from "node:async_hooks";

/*
 * Bereich (component) einer Logzeile aus dem Kontext statt aus der Datei (#1860): runJob setzt den Namen des Jobs wie in
 * /api/metrics, Middleware, REST-API und MCP setzen server, api und mcp. Jedes console.* darunter trägt ihn, auch die
 * Zeilen von Abhängigkeiten wie lib-fints während eines Kontoabrufs. Ohne Kontext gilt der Bereich, den log.ts vorgibt.
 * Auf globalThis, weil Nitro-Plugins und SSR-Bundle je eine Kopie dieser Datei haben.
 */
const KEY = Symbol.for("haben.logComponent");
const state = globalThis as { [KEY]?: AsyncLocalStorage<string> };
state[KEY] ??= new AsyncLocalStorage<string>();
const storage = state[KEY];

export const withLogComponent = <T>(component: string, run: () => T): T => storage.run(component, run);

export const logComponent = (): string | undefined => storage.getStore();
