import { definePlugin } from "nitro";
import { db } from "../db/index.ts";
import { logTriggerIntegrity } from "../db/trigger-inventory.ts";

export default definePlugin(() => {
  // Mit Befund als Warnung, sonst ginge die Zeile bei HABEN_LOG_LEVEL=warn unter
  void logTriggerIntegrity(db, (line, befunde) => (befunde ? console.warn(line) : console.info(line))).catch(() =>
    console.error("Sperrtrigger: Prüfung fehlgeschlagen; Datenbankzugriff prüfen."),
  );
});
