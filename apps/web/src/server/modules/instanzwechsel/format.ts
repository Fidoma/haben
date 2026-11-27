/*
 * Kennung und Version der Einstellungsdatei (#488), ohne Datenbank, damit felder.test.ts sie liest. Die Version steigt,
 * wenn eine ältere Instanz die neue Datei nicht mehr richtig übernähme, etwa weil ein Feld dazukommt, das sie still
 * verwürfe; der Import muss Dateien älterer Versionen weiter lesen.
 */
export const SETTINGS_EXPORT_FORMAT = "haben-einstellungen";
// 2: Textbausteine mit „Standard für“, die Standard-Einleitungen sind keine Firmendaten mehr (#1494). Eine Datei der
// Version 1 liest der Import weiter, ihre Einleitungen werden zu Standard-Bausteinen (alteStandardEinleitungen).
// 3: Artikel mit arbeitskosten (§ 35a EStG, #712). Eine Datei der Version 1 oder 2 liest der Import weiter, ihre Artikel
// bekommen false (articleInputSchema).
// 4: Standard-Textbaustein je Mahnstufe statt „mahnung“ (#1678). Ein Standard „mahnung“ einer älteren Datei gilt danach
// für jede Stufe (alterMahnungsStandard in stammdaten/uebernahme.ts).
// 5: weitere Zahlungskonten und das bevorzugte Zahlungskonto am Kontakt (#1887). Eine ältere Datei hat keine; ihre Kontakte
// bekommen den Standard.
export const SETTINGS_EXPORT_VERSION = 5;
