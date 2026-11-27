import { definePlugin } from "nitro";
import { resumeExtractionQueue } from "../modules/belege/index.ts";
import { startScheduler } from "../scheduler.ts";

// Hintergrundjobs (wiederkehrende Rechnungen) laufen im Serverprozess
export default definePlugin(() => {
  startScheduler();
  // Belege, die vor dem Neustart auf die KI-Auslesung warteten, kommen weiter der Reihe nach dran (#1735)
  void resumeExtractionQueue().catch((error: unknown) => console.error("Warteschlange der Belegauslesung", error));
});
