import { definePlugin } from "nitro";
import { env } from "../env.ts";
import { routeConsoleThroughLogger } from "../log.ts";

// Zuerst: Ein ungültiges HABEN_LOG_LEVEL oder HABEN_LOG_FORMAT lässt den Start scheitern, danach läuft console.* von Haben und
// Abhängigkeiten durch Stufe, Format und Filter (log.ts)
export default definePlugin(() => {
  env();
  routeConsoleThroughLogger();
});
