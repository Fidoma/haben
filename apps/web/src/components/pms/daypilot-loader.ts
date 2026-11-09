type DayPilotDate = {
  toString(format: string): string;
};

export interface DayPilotSchedulerInstance {
  init(): void;
  update(): void;
  clearSelection(): void;
  scrollTo(date: unknown): void;
  dispose?: () => void;
}

export interface DayPilotApi {
  Date: {
    today(): DayPilotDate & { addDays(days: number): unknown };
  };
  Scheduler: new (container: HTMLElement, config: Record<string, unknown>) => DayPilotSchedulerInstance;
}

declare global {
  interface Window {
    DayPilot?: DayPilotApi;
  }
}

let loading: Promise<DayPilotApi> | null = null;

/** Lädt die unveränderte lokale DayPilot-Lite-Datei genau einmal. */
export function loadDayPilot(): Promise<DayPilotApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("DayPilot ist nur im Browser verfügbar."));
  if (window.DayPilot) return Promise.resolve(window.DayPilot);
  if (loading) return loading;

  const request = new Promise<DayPilotApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/daypilot/daypilot-all.min.js";
    script.async = true;
    script.dataset.daypilot = "lite";
    script.onload = () => {
      const api = window.DayPilot;
      if (api) resolve(api);
      else reject(new Error("DayPilot wurde nicht initialisiert."));
    };
    script.onerror = () => reject(new Error("DayPilot konnte nicht geladen werden."));
    document.head.append(script);
  });
  loading = request.catch((error: unknown) => {
    loading = null;
    throw error;
  });

  return loading;
}
