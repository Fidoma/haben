# PMS-Modulgrenze

Das PMS wird dauerhaft in einem eigenen Branch entwickelt und nicht nach `main` übernommen. Deshalb bleiben Schema,
Fachlogik, UI-Bausteine, Styles, Tests und Dokumentation in PMS-eigenen Dateien.

- `schema.ts` enthält sämtliche PMS-Tabellen. Die einzige Datenbank-Fremdreferenz in ein anderes Fachmodul zeigt auf
  den erzeugten Rechnungsentwurf.
- `billing.ts` ist die einzige schreibende fachliche Schnittstelle zu einem anderen Servermodul. Nur hier wird das
  Rechnungsmodul importiert.
- `host-data.ts` liest Kontakte und Artikel des Hostsystems für Auswahllisten und Anzeigen. Das PMS schreibt diese
  Tabellen nicht und hält dafür keine Fremdschlüssel; Änderungen an deren Aufbau werden nur in diesem Adapter
  nachgezogen.
- Alle übrigen Dateien greifen ausschließlich auf PMS-Tabellen und gemeinsame Infrastruktur wie Authentifizierung,
  Datenbankverbindung und Audit-Akteur zu.

So beschränken sich spätere Rebase-Konflikte auf wenige, ausdrücklich notwendige Einhängepunkte: Drizzle-Konfiguration,
Datenbankschema-Registrierung, Navigation, generierter Routenbaum und Testkonfiguration.
