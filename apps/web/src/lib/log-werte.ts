/*
 * Stufen und Formate des Loggers (#1860), ohne Abhängigkeiten: env.ts prüft sie beim Start und landet im Bundle des
 * Browsers, server/log.ts samt Filter soll das nicht.
 */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const LOG_FORMATS = ["text", "json"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFormat = (typeof LOG_FORMATS)[number];
