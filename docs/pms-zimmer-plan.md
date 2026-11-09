---
title: "Planung: PMS-Meilenstein 1 – Zimmer"
description: >-
  Einfacher Umsetzungsplan für Zimmerstamm, Backend und CRUD-Oberfläche im Look
  und in der Architektur von Haben.
---

# Planung: PMS-Meilenstein 1 – Zimmer

## Ziel

Der erste PMS-Meilenstein führt ausschließlich einen einfachen Zimmerstamm ein.
Berechtigte Benutzer können Zimmer auf einer Seite auflisten, anlegen, bearbeiten,
archivieren und wiederherstellen. Die Umsetzung folgt den vorhandenen Haben-Mustern
für Stammdaten, insbesondere Artikel und Kontakte.

Dieser Meilenstein schafft nur die Grundlage für spätere Reservierungen. Er enthält
noch keinen Belegungsplan, keine Reservierung, keinen Reinigungsstatus, keine
Tourismusstatistik und keine Abrechnung.

## Bewusst einfacher Umfang

Ein Zimmer besitzt zunächst nur:

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| Zimmernummer | ja | kurze, im Betrieb verwendete Kennung, zum Beispiel `101` oder `A-2` |
| Bezeichnung | nein | ergänzender Name, zum Beispiel `Doppelzimmer Hofseite` |
| Kapazität | ja | maximale Personenzahl, mindestens 1 |
| Archivstatus | systemseitig | steuert, ob das Zimmer für neue Vorgänge angeboten wird |

Nicht aufgenommen werden Zimmerkategorie, Etage, Ausstattung, Preis, Bettenarten,
Gebäude, Fotos, Beschreibung, Notiz, Housekeeping-Status oder Wartung. Solche Felder
werden erst ergänzt, wenn ein späterer Meilenstein sie fachlich benötigt.

## Fachliche Regeln

1. Die Zimmernummer wird vor dem Speichern getrimmt und darf nicht leer sein.
2. Zimmernummern sind unabhängig von Groß- und Kleinschreibung eindeutig. `A-2`
   und `a-2` dürfen nicht gleichzeitig existieren.
3. Die Bezeichnung ist optional und wird ebenfalls getrimmt.
4. Die Kapazität ist eine ganze Zahl zwischen 1 und 100.
5. Zimmer werden nicht endgültig gelöscht, sondern archiviert. Dadurch bleibt der
   spätere Bezug aus Reservierungen stabil.
6. Ein archiviertes Zimmer kann wiederhergestellt werden.
7. Aktive Zimmer stehen in der Liste vor archivierten Zimmern; innerhalb der Liste
   werden Zimmernummern für Menschen sinnvoll sortiert, also beispielsweise
   `2` vor `10`.

Die Obergrenze 100 ist eine einfache Plausibilitätsgrenze und keine Aussage über
eine bestimmte Beherbergungsart. Falls Haben später auch Schlafsäle oder Einheiten
statt Zimmern abbilden soll, wird diese Entscheidung vor der Umsetzung angepasst.

## Datenbank

### Tabelle `pms_rooms`

Die Tabelle wird in `apps/web/src/server/db/schema.ts` mit Drizzle definiert:

| Spalte | PostgreSQL-Typ | Vorgabe und Regel |
| --- | --- | --- |
| `id` | `uuid` | Primärschlüssel, `defaultRandom()` |
| `number` | `text` | nicht null |
| `name` | `text` | nicht null, Standardwert leerer Text |
| `capacity` | `smallint` | nicht null, Standardwert 1 |
| `archived_at` | `timestamp with time zone` | null für aktive Zimmer |
| `created_at` | `timestamp with time zone` | nicht null, `defaultNow()` |
| `updated_at` | `timestamp with time zone` | nicht null, `defaultNow()` |

Zusätzliche Datenbankregeln:

- eindeutiger Index auf `lower(number)`;
- Check Constraint für `char_length(number) between 1 and 50`;
- Check Constraint für `char_length(name) <= 100`;
- Check Constraint für `capacity between 1 and 100`.

Die Anwendung prüft dieselben Grenzen mit Zod. Die Datenbankregeln bleiben trotzdem
notwendig, weil spätere Importe oder interne Abläufe nicht ausschließlich über das
Formular schreiben müssen.

### Migration und Audit

Die Migration wird nicht von Hand in den Drizzle-Snapshots geschrieben:

1. Tabelle in `schema.ts` ergänzen;
2. `bun run db:generate` ausführen;
3. generierte Migration prüfen;
4. separate Custom-Migration für den Audit-Trigger erzeugen;
5. auf `pms_rooms` einen Trigger mit `haben_audit()` anlegen.

Jede Anlage, Änderung, Archivierung und Wiederherstellung erscheint dadurch mit
Akteur in der bestehenden Audit-Hash-Kette. Die Tabelle wird in diesem Meilenstein
nicht versiegelt und erhält keine GoBD-Sperre, weil der Zimmerstamm veränderbare
betriebliche Stammdaten enthält.

## Backend-Architektur

### PMS-Modul

Neuer Modulordner:

```text
apps/web/src/server/modules/pms/
├── index.ts
├── rooms.ts
└── rooms.test.ts
```

`index.ts` ist die einzige öffentliche Grenze. Server Functions und spätere
PMS-Unterbereiche importieren Zimmerfunktionen ausschließlich von dort. Das Modul
`stammdaten` wird nicht erweitert, weil Zimmer zum neuen fachlichen Bereich PMS
gehören.

`rooms.ts` enthält:

- den Zod-Validator `roomInputSchema`;
- die Typen `Room` und `RoomInput`;
- `listRooms({ archived })`;
- `createRoom(actor, input)`;
- `updateRoom(actor, id, input)`;
- `setRoomArchived(actor, id, archived)`;
- den benutzerfreundlichen Fachfehler `RoomError`.

Alle Schreibvorgänge verwenden `withActor`. Nicht gefundene Zimmer ergeben
verständliche Meldungen wie „Zimmer nicht gefunden.“. Ein Konflikt der eindeutigen
Zimmernummer wird in die fachliche Meldung „Diese Zimmernummer gibt es bereits.“
übersetzt und nicht als interner Datenbankfehler an die Oberfläche gegeben.

Für diesen Meilenstein entsteht keine Logik in `packages/core`: Validierung und
einfache CRUD-Operationen besitzen noch keine datenbankunabhängige PMS-Fachlogik.

### Server Functions

Neue Datei `apps/web/src/server/functions/pms.ts`:

| Function | Methode | Aufgabe |
| --- | --- | --- |
| `getRooms` | GET | aktive und archivierte Zimmer für die Seite laden |
| `saveRoom` | POST | anhand einer optionalen UUID anlegen oder bearbeiten |
| `archiveRoom` | POST | archivieren oder wiederherstellen |

Jede Function verwendet `authMiddleware`. Damit kann zunächst nur der Inhaber den
PMS-Zimmerstamm lesen und verändern. Die Steuerberatung erhält weder Navigation noch
Lesezugriff, weil Zimmer für ihre vorhandenen Aufgaben nicht erforderlich sind.

Die Functions enthalten nur Authentifizierung, Zod-Validierung und den Aufruf der
öffentlichen PMS-Modulschnittstelle. Sie enthalten weder SQL noch UI-Formatierung.

## UI und Look and Feel

### Navigation und Route

In der Hauptnavigation wird eine neue Gruppe **PMS** angelegt. Im ersten
Meilenstein enthält sie nur den Eintrag **Zimmer** mit einem zum bestehenden
Icon-System passenden Zimmer- oder Gebäude-Symbol.

Die Seite liegt unter:

```text
apps/web/src/routes/_app/pms/zimmer.tsx
```

Öffentliche Route: `/pms/zimmer`.

Die Route lädt die Zimmer mit `getRooms` im Loader und setzt den Seitentitel
`Zimmer · Haben`. Nach Schreibaktionen wird der Router invalidiert, damit die
angezeigte Liste immer aus dem Serverzustand stammt.

### Seitenaufbau

Die Oberfläche orientiert sich an der vorhandenen Artikelseite und verwendet nur
bestehende Haben-Komponenten und CSS-Klassen:

```text
PMS                                      [Neues Zimmer]
Zimmer
Zimmer und ihre Kapazität verwalten.

[ eingeblendete Formular-Karte ]
[ Erfolg- oder Fehlermeldung ]

┌ Zimmerliste ──────────────────────────────────────────┐
│ [Aktiv (4)] [Archiviert (1)]                         │
│ Zimmer       Bezeichnung                 Kapazität    │
│ 101          Doppelzimmer Hofseite       2  [Bearb.]  │
│                                            [Archiv.]  │
└───────────────────────────────────────────────────────┘
```

Konkret:

- `page-head` mit Eyebrow „PMS“, Überschrift „Zimmer“ und primärem Button
  „Neues Zimmer“;
- ein kurzer Hilfetext unter dem Seitenkopf;
- das Formular erscheint als `card` oberhalb der Liste und verdrängt den
  Neuanlage-Button, wie beim Artikelstamm;
- `NoticeBanner` zeigt Erfolg und Fehler;
- Chips „Aktiv“ und „Archiviert“ wechseln zwischen den Beständen und zeigen die
  Anzahl;
- eine responsive Tabelle zeigt Nummer, Bezeichnung, Kapazität und Aktionen;
- leere Zustände erklären direkt, wie das erste Zimmer angelegt wird;
- auf schmalen Bildschirmen werden Spalten lesbar untereinander angeordnet, ohne
  horizontales Abschneiden wichtiger Aktionen.

Es entsteht kein eigenes Designsystem und kein globaler Stilbruch. Falls für die
Zimmerzeilen eine neue Rasterklasse nötig ist, kommt nur eine kleine,
seitenbezogene Ergänzung in die bei der Route geladene Stylesheet-Struktur.

### Formular

Neue Komponente:

```text
apps/web/src/components/pms/RoomForm.tsx
```

Felder:

- **Zimmernummer**: Textfeld, erforderlich, maximal 50 Zeichen, Autofokus;
- **Bezeichnung (optional)**: Textfeld, maximal 100 Zeichen;
- **Kapazität**: Zahlenfeld, erforderlich, Standardwert 1, Minimum 1, Maximum 100.

Aktionen:

- „Anlegen“ beziehungsweise „Speichern“ als primärer Button;
- „Abbrechen“ als normaler Button;
- Buttons sind während des Speicherns deaktiviert;
- serverseitige Fehlermeldungen erscheinen im Formular mit `role="alert"`;
- nach erfolgreichem Speichern schließt das Formular, die Liste wird neu geladen
  und eine Erfolgsmeldung erscheint.

### Archivierung statt Löschen

Aktive Zeilen bieten „Bearbeiten“ und „Archivieren“. Archivierte Zeilen bieten nur
„Wiederherstellen“. Eine zusätzliche Löschaktion wird nicht angeboten. Für diesen
reversiblen Stammdatenvorgang ist zunächst kein Bestätigungsdialog nötig; die
sichtbare Erfolgsmeldung und sofortige Wiederherstellbarkeit reichen aus und folgen
dem Artikelstamm.

## Geplante Dateien

| Datei | Änderung |
| --- | --- |
| `apps/web/src/server/db/schema.ts` | Tabelle `pmsRooms` |
| `apps/web/drizzle/<nr>_pms_zimmer.sql` | generierte Tabellenmigration |
| `apps/web/drizzle/<nr>_pms_zimmer_trigger.sql` | Audit-Trigger |
| `apps/web/src/server/modules/pms/index.ts` | öffentliche PMS-Schnittstelle |
| `apps/web/src/server/modules/pms/rooms.ts` | Validierung und CRUD-Operationen |
| `apps/web/src/server/modules/pms/rooms.test.ts` | PostgreSQL-Integrationstests |
| `apps/web/src/server/functions/pms.ts` | dünne Server Functions |
| `apps/web/src/routes/_app/pms/zimmer.tsx` | Zimmerseite |
| `apps/web/src/components/pms/RoomForm.tsx` | Anlage- und Bearbeitungsformular |
| `apps/web/src/routes/_app.tsx` | Navigationsgruppe PMS |
| `apps/web/src/components/Icon.tsx` | nur falls noch kein passendes Symbol existiert |
| `apps/web/e2e/seiten.spec.ts` | Route in die Seitentests aufnehmen |
| `apps/web/e2e/barrierefreiheit.spec.ts` | Zimmerseite prüfen |
| `docs/pms-zimmer.md` | kurze Anwenderdokumentation bei der Umsetzung |
| `docs/architektur.md` | PMS-Modul und Tabelle ergänzen |

Die generierte `routeTree.gen.ts` wird durch das vorhandene TanStack-Werkzeug
aktualisiert und nicht von Hand gepflegt.

## Tests und Abnahmekriterien

### Modultests mit PostgreSQL

- ein Zimmer mit Nummer, optionalem Namen und Kapazität wird angelegt;
- Eingaben werden getrimmt;
- leere oder zu lange Nummern werden abgewiesen;
- Kapazitäten außerhalb 1 bis 100 werden abgewiesen;
- dieselbe Zimmernummer wird auch mit anderer Großschreibung abgewiesen;
- Bearbeiten aktualisiert `updated_at`;
- Archivieren blendet das Zimmer aus der aktiven Standardliste aus;
- Wiederherstellen macht es wieder aktiv;
- ein unbekannter Datensatz erzeugt einen Fachfehler;
- Anlage, Änderung, Archivierung und Wiederherstellung stehen mit dem richtigen
  Akteur im Audit-Log.

### UI- und E2E-Tests

- `/pms/zimmer` ist angemeldet erreichbar und in der Hauptnavigation sichtbar;
- Neuanlage, Bearbeitung, Archivierung und Wiederherstellung funktionieren über
  die sichtbaren Bedienelemente;
- Erfolg und Validierungsfehler sind verständlich sichtbar;
- Tastaturfokus, Labels, Buttons, Tabelleninhalt und Farbkontrast bestehen die
  vorhandene Barrierefreiheitsprüfung;
- die Seite funktioniert in den relevanten hellen und dunklen Ansichten sowie auf
  Desktop und Telefon;
- die Steuerberatung kann die Seite nicht öffnen und sieht den Menüpunkt nicht.

### Definition of Done

Der Meilenstein ist fertig, wenn ein Inhaber Zimmer mit den drei geplanten
Eingabefeldern vollständig über die Haben-Oberfläche verwalten kann, kein hartes
Löschen angeboten wird, alle Schreibvorgänge auditiert sind und Modul-, Seiten- und
Barrierefreiheitstests grün sind.

## Vorgesehene Umsetzungsreihenfolge

1. PostgreSQL-Integrationstest für das noch fehlende Zimmermodul anlegen.
2. Drizzle-Schema, generierte Migration und Audit-Trigger ergänzen.
3. `pms/rooms.ts` und die öffentliche `pms/index.ts` implementieren.
4. Server Functions mit Validatoren und Berechtigungen ergänzen.
5. Route, Navigation, Formular und Liste im vorhandenen Haben-Stil umsetzen.
6. Seiten- und Barrierefreiheitstests ergänzen.
7. Anwender- und Architekturdokumentation aktualisieren.
8. Formatierung, Lint, Typecheck, Datenbanktests, Build und E2E-Prüfungen ausführen.

Die Umsetzung erfolgt als eigener Pull Request. Sie nimmt keine Tabellen oder
Komponenten der späteren Reservierungs-, Belegungsplan- oder Housekeeping-
Meilensteine vorweg.
