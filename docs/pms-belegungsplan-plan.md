---
title: "Planung: PMS-Meilenstein 3 – Belegungsplan mit DayPilot"
description: >-
  Technischer und fachlicher Implementierungsplan für die Übernahme des
  DayPilot-Belegungsplans aus Fidoma in die Haben-Architektur.
---

# Planung: PMS-Meilenstein 3 – Belegungsplan mit DayPilot

## Ziel

Haben erhält unter `/pms/belegungsplan` einen grafischen Hotelbelegungsplan auf
Basis von DayPilot Lite. Bedienung und Darstellung orientieren sich eng am
vorhandenen Fidoma-Belegungsplan, werden aber in React, TanStack Start und die
funktionale Serverarchitektur von Haben übersetzt.

Der Plan zeigt Zimmer als Zeilen, Kalendertage als Spalten und jede
Reservierungsposition als Balken. Ein Klick auf einen Balken öffnet die zugehörige
Reservierung. Die Auswahl eines freien Zeitraums öffnet eine neue Reservierung mit
vorbelegtem Zimmer sowie An- und Abreise.

## Analysierter Fidoma-Stand

Fidoma verwendet:

- DayPilot Lite `2026.3.856-lite` als lokale, minifizierte JavaScript-Datei;
- Apache License 2.0 laut Dateikopf;
- `DayPilot.Scheduler` mit Tagesraster und zwei Kopfzeilen für Monat und Tag;
- 90 Tage ab 32 Tagen vor heute als Standardzeitraum;
- höchstens 366 Tage bei explizitem `start` und `end`;
- Zimmer als Ressourcen, natürlich nach Zimmernummer sortiert;
- Reservierungspositionen als einzelne Ereignisse;
- visuelle Uhrzeiten 14:00 Uhr am Anreisetag und 11:00 Uhr am Abreisetag;
- deaktiviertes Verschieben, Vergrößern und Löschen von Balken;
- Zeitraumsauswahl zum Öffnen der Reservierungsanlage;
- Klick auf einen Balken zum Bearbeiten der Reservierung;
- Wochenend-, Heute-, Reservierungsstatus- und Abrechnungsmarkierungen;
- lokale Styles für Light und Dark Mode;
- zusätzlich Messemarkierungen und Housekeeping-Punkte.

Die verwendete JavaScript-Datei hat 412.632 Bytes und den SHA-256-Wert
`3a9b4858da3162d15eeef2b8859ab2a8f887e617462222cc6bf59f76032d4b3e`.

## Aktueller Haben-Stand

Der Plan baut auf den bereits vorhandenen Tabellen und Modulen auf:

- `pms_rooms` für Zimmer;
- `pms_reservations` für Reservierungsköpfe;
- `pms_reservation_items` für Zimmer und Aufenthaltszeiträume;
- `contacts` für den Gast beziehungsweise Kunden;
- optional `invoices` über `pms_reservations.invoice_id`;
- `server/modules/pms` als öffentliche PMS-Modulgrenze;
- `/pms/reservierungen` als vorhandene CRUD-Ansicht.

Eine Reservierung kann inzwischen mehrere Positionen besitzen. Deshalb wird nicht
der Reservierungskopf, sondern jede `pms_reservation_items`-Zeile als eigener
DayPilot-Balken ausgegeben. Alle Balken derselben Reservierung verweisen auf dieselbe
Reservierungs-UUID.

## Umfang dieses Meilensteins

### Wird umgesetzt

- neue PMS-Navigation „Belegungsplan“;
- neue Route `/pms/belegungsplan`;
- lokal ausgelieferte DayPilot-Lite-Datei aus Fidoma;
- Zimmerzeilen und Reservierungsbalken;
- Standardzeitraum und begrenzte Zeitraumparameter;
- natürliche Zimmersortierung;
- Monats- und Tageskopf;
- horizontales und vertikales Scrollen;
- Wochenenden und den heutigen Tag hervorheben;
- Reservierungs- und Rechnungsstatus anzeigen;
- Klick auf Belegung öffnet die vorhandene Reservierung;
- Auswahl eines freien Zeitraums öffnet die vorhandene Anlage vorbelegt;
- Light-, Dark- und mobile Darstellung im Haben-Design;
- barrierefreie alternative Bedienwege;
- Modul-, Komponenten- und E2E-Tests.

### Noch nicht enthalten

- Drag-and-drop zum Umbuchen;
- Größenänderung eines Balkens zum Ändern von An- oder Abreise;
- Löschen oder Stornieren direkt im Plan;
- Messe- oder Veranstaltungskalender;
- Housekeeping-Punkte an Zimmern;
- Zimmerkategorien oder Gruppierung mehrerer Häuser;
- Preise, Auslastungsstatistiken oder automatische Optimierung;
- dynamisches Nachladen beim horizontalen Scrollen.

Damit entspricht das Raster dem Fidoma-Plan, ohne spätere PMS-Meilensteine
vorwegzunehmen.

## DayPilot übernehmen und lizenzieren

DayPilot wird entsprechend Fidoma als lokale Browserdatei übernommen und nicht von
einem CDN geladen. Es wird keine neue Bun-Paketabhängigkeit benötigt.

Geplante Dateien:

```text
apps/web/public/vendor/daypilot/daypilot-all.min.js
apps/web/public/vendor/daypilot/LICENSE
```

Vorgehen:

1. `public/vendor/daypilot/daypilot-all.min.js` aus Fidoma unverändert nach Haben
   kopieren;
2. Copyright-, Versions- und Apache-2.0-Kopf in der Datei erhalten;
3. vollständigen Text der Apache License 2.0 daneben ablegen;
4. DayPilot mit Version, Urheber, Projektadresse und Lizenz in `NOTICE` ergänzen;
5. den SHA-256-Wert nach dem Kopieren erneut prüfen;
6. keine Änderungen an der minifizierten Herstellerdatei vornehmen.

Apache-2.0 ist grundsätzlich mit der AGPL-Anwendung kombinierbar. Der Lizenz- und
Hinweiserhalt ist dennoch Teil der Abnahme. Der Plan trifft keine Aussage über
andere, kostenpflichtige DayPilot-Ausgaben; übernommen wird ausschließlich die in
Fidoma vorhandene Lite-Datei.

## Backend und Lesemodell

### Öffentliche PMS-Funktion

Im vorhandenen Modul `apps/web/src/server/modules/pms/` entsteht eine Datei
`schedule.ts`. Die öffentliche `pms/index.ts` exportiert daraus nur die benötigte
Funktion und Typen:

```text
reservationSchedule(startDate, endDate, today)
```

Die Funktion ist rein lesend und liefert ein ausdrücklich für den Belegungsplan
bestimmtes DTO. Sie verwendet nicht ungefiltert `listReservations()`, damit nur der
sichtbare Zeitraum und nur die tatsächlich benötigten Spalten geladen werden.

### Zeitraumregeln

- Anreise ist inklusive, Abreise exklusive.
- Eine Position überschneidet den sichtbaren Bereich, wenn
  `arrival_date < endDate` und `departure_date > startDate` gilt.
- Standardstart ist heute minus 32 Tage.
- Standardende ist Standardstart plus 90 Tage.
- `endDate` muss nach `startDate` liegen.
- der Zeitraum darf höchstens 366 Tage umfassen;
- ungültige Parameter führen kontrolliert auf den Standardzeitraum zurück oder
  werden bereits durch die Route verworfen;
- alle fachlichen Daten bleiben reine `YYYY-MM-DD`-Werte ohne Zeitzonenverschiebung.

### DTO

```ts
interface ScheduleData {
  startDate: string;
  days: number;
  rooms: Array<{
    id: string;
    number: string;
    name: string;
    archived: boolean;
  }>;
  events: Array<{
    id: string;
    reservationId: string;
    roomId: string;
    arrivalDate: string;
    departureDate: string;
    contactName: string;
    reservationStatus: "confirmed" | "canceled";
    reservationStatusLabel: string;
    billingStatus: "none" | "draft" | "open" | "paid";
    billingStatusLabel: string;
    invoiceNumber: string | null;
  }>;
}
```

DayPilot-spezifische IDs, Farben, HTML-Fragmente und Uhrzeiten gehören nicht in das
Servermodul. Sie werden im Browser aus diesem neutralen Lesemodell erzeugt.

### Zimmerauswahl

Alle aktiven Zimmer werden angezeigt, auch wenn sie im Zeitraum unbelegt sind.
Archivierte Zimmer werden nur angezeigt, wenn im gewählten Zeitraum noch eine
Reservierungsposition für sie existiert. So bleiben historische Belegungen sichtbar,
ohne dass leere archivierte Zimmer den täglichen Plan füllen. Archivierte Zimmer
werden in der Zeilenüberschrift als „Archiviert“ gekennzeichnet und können bei einer
Neuanlage nicht ausgewählt werden.

### Stornierte Reservierungen

Stornierte Positionen bleiben wie in Fidoma sichtbar, erhalten aber eine rote
Statusmarkierung. Sie belegen den Zeitraum fachlich nicht mehr. Damit ist erkennbar,
warum ein früherer Vorgang existierte, während eine neue Reservierung denselben
Zeitraum nutzen kann.

### Rechnungsstatus

Die Anzeige verwendet dieselbe Rechnungslifecycle-Logik wie die bestehende
Rechnungsliste und dupliziert keine Zahlungsberechnung im PMS:

| Zustand | Anzeige |
| --- | --- |
| keine `invoice_id` | Nicht berechnet |
| Rechnungsentwurf | Entwurf |
| festgeschrieben mit offenem Betrag | Offen |
| vollständig ausgeglichen | Bezahlt |

Das Modul `rechnungen` erhält bei Bedarf eine kleine öffentliche, gebündelte
Lesefunktion für die Status mehrerer Rechnungs-UUIDs. `schedule.ts` importiert sie
ausschließlich über `server/modules/rechnungen/index.ts`. Ein Aufruf pro Ereignis
ist zu vermeiden; Status werden in einem Batch geladen.

## Server Function und Route

### Server Function

`apps/web/src/server/functions/pms.ts` erhält eine lesende Function
`getReservationSchedule`:

- Methode GET;
- `authMiddleware`, analog zu den übrigen PMS-Seiten;
- Zod-Validator für optionale `start`- und `end`-Datumswerte;
- Aufruf ausschließlich über `pms/index.ts`;
- keine SQL- oder DayPilot-Konfiguration in der Function.

### Route

Neue Datei:

```text
apps/web/src/routes/_app/pms/belegungsplan.tsx
```

Die Route:

- setzt `Belegungsplan · Haben` als Titel;
- validiert `start` und `end` als Suchparameter;
- verwendet die Suchparameter als Loader-Abhängigkeiten;
- lädt Plan und Reservierungsformular-Optionen serverseitig;
- zeigt im `page-head` Eyebrow „PMS“, H1 „Belegungsplan“, eine kurze Legende und
  den primären Button „Neue Reservierung“;
- rendert den DayPilot-Wrapper ausschließlich im Browser;
- bietet einen verständlichen Lade- und Fehlerzustand.

In `apps/web/src/routes/_app.tsx` wird der Eintrag **Belegungsplan** zwischen
**Reservierungen** und **Zimmer** eingefügt.

## React-Integration von DayPilot

### Loader für die Herstellerdatei

Neue kleine Hilfsdatei:

```text
apps/web/src/components/pms/daypilot-loader.ts
```

Sie lädt `/vendor/daypilot/daypilot-all.min.js` einmalig über ein lokales
`<script>`-Element und gibt ein gemeinsames Promise zurück. Sie prüft vorher
`window.DayPilot`, behandelt Ladefehler und führt auf dem Server keinerlei
Browserzugriff aus. Es wird nur die tatsächlich verwendete Teilmenge des globalen
DayPilot-API typisiert; `any` wird nicht über die gesamte Komponente verteilt.

### Scheduler-Komponente

Neue Komponente:

```text
apps/web/src/components/pms/ReservationSchedule.tsx
```

Sie besitzt einen `ref` auf den Container und initialisiert in `useEffect` genau
eine `DayPilot.Scheduler`-Instanz. Bei geänderten Daten wird die Instanz aktualisiert
oder kontrolliert neu aufgebaut. Beim Unmount wird sie, soweit vom Lite-API
unterstützt, entsorgt und der Container geleert. React rendert nicht in das von
DayPilot verwaltete DOM.

Konfiguration entsprechend Fidoma:

```text
locale                         de-de
scale                          Day
cellWidthSpec                  Fixed
cellWidth                      90
timeHeaders                    Monat/Jahr und Wochentag/Tag
eventHeight                    56
rowHeaderWidth                 90
durationBarVisible             false
eventMoveHandling              Disabled
eventResizeHandling            Disabled
eventDeleteHandling            Disabled
timeRangeSelectedHandling      Enabled
useEventBoxes                  Never
```

Nach `init()` scrollt der Plan auf heute minus fünf Tage. Fehlt DayPilot oder kann
die Datei nicht geladen werden, zeigt die Seite statt eines leeren Containers eine
verständliche Fehlermeldung und weiterhin die alternative Reservierungsliste.

### Mapping der Daten

Zimmer werden zu DayPilot-Ressourcen:

```text
id    room-<UUID>
name  Zimmernummer
```

Eine Reservierungsposition wird zu einem Ereignis:

```text
id        reservation-item-<UUID>
resource  room-<Zimmer-UUID>
start     <Anreise>T14:00:00
end       <Abreise>T11:00:00
text      Kontaktname
```

Die Uhrzeiten sind ausschließlich Teil der Darstellung. Datenbank und
Konfliktprüfung bleiben bei der halb offenen Folge ganzer Aufenthaltstage.

Alle Werte, die in `html`, Tooltip oder Zeilenüberschrift gelangen, werden vor dem
Einfügen als HTML escaped. IDs und URLs werden nicht aus ungeprüften Strings
zusammengesetzt.

### Ereignisgestaltung

- bestätigte Reservierung: grüner linker Rand;
- stornierte Reservierung: roter linker Rand;
- neutraler heller beziehungsweise dunkler Hintergrund aus Haben-Tokens;
- erste Zeile: Kundenname;
- zweite Zeile: Reservierungsstatus und Abrechnungsstatus;
- oberer schmaler Streifen: grau für nicht berechnet/Entwurf/offen, grün für
  bezahlt;
- Tooltip enthält Kundenname, Zimmer, Zeitraum, Reservierungsstatus,
  Abrechnungsstatus und gegebenenfalls Rechnungsnummer.

Der Klick auf ein Ereignis navigiert zu
`/pms/reservierungen?edit=<Reservierungs-UUID>`. Die Reservierungsroute wird so
erweitert, dass sie das bestehende Bearbeitungsformular für diese UUID öffnet. Ein
storniertes Ereignis öffnet die Liste mit hervorgehobener Reservierung, aber kein
editierbares Formular.

### Zeitraumsauswahl und Neuanlage

`onTimeRangeSelected` übernimmt Zimmer-UUID, Start und Ende. Danach wird die
Auswahl sofort geleert und ein Dialog im vorhandenen Haben-Stil geöffnet. Der Dialog
verwendet das bestehende `ReservationForm` und erhält eine erste vorbelegte Position:

- ausgewähltes Zimmer;
- Anreise aus `args.start`;
- Abreise aus `args.end`;
- noch kein Kunde und kein Artikel;
- Preis und Beschreibung nach den bestehenden Formularvorgaben.

Dafür wird `ReservationForm` nur so weit verallgemeinert, dass es optional eine
Vorbelegung und einen Abschluss-Callback akzeptiert. Speichern, Zod-Validierung,
Überschneidungsschutz und Audit bleiben unverändert im bestehenden Backend. Nach
erfolgreicher Anlage wird der Route-Loader invalidiert und der neue Balken erscheint.

Der Button „Neue Reservierung“ öffnet denselben Dialog ohne Zimmer- und
Zeitraumvorbelegung. Damit bleibt die Anlage auch ohne Maus und DayPilot-Auswahl
vollständig möglich.

## Look and Feel in Haben

Die Fidoma-CSS-Datei wird nicht unverändert übernommen, weil sie feste
Tailwind-/Filament-Farben und die Klasse `.dark` verwendet. Ihre Struktur dient als
Vorlage für eine Haben-spezifische Datei:

```text
apps/web/src/styles/pms-schedule.css
```

Sie verwendet vorhandene Variablen wie `--surface`, `--ground`, `--line`,
`--line-soft`, `--ink`, `--muted`, `--accent`, `--danger-ink` und `--accent-soft`.
Dadurch funktionieren Wald, Ozean, Pflaume, Graphit, Nacht und Tiefsee ohne
separate fest verdrahtete Farbsets.

Zu übernehmen sind:

- Kartenrahmen und Rundung passend zu `.card`;
- dezente Rasterlinien;
- abgesetzte Monats- und Tagesköpfe;
- Wochenendhintergrund;
- deutliche Heute-Markierung mit Punkt;
- kompakte Zimmerzeilen;
- abgerundete Balken mit Ellipsis;
- Hover- und sichtbare Fokusdarstellung;
- interne horizontale und vertikale Scrollbereiche.

Die Route importiert das Stylesheet gezielt. Globale DayPilot-Klassen werden immer
unter einer lokalen `.reservation-scheduler-card` gekapselt.

## Barrierefreiheit und mobile Nutzung

DayPilot ist eine visuelle Rasterkomponente und ersetzt keine semantische Liste.
Deshalb erhält die Seite zusätzlich:

- einen sichtbaren Button „Neue Reservierung“ als Tastaturalternative zur
  Zeitraumsauswahl;
- eine kompakte semantische Liste „Belegungen im Zeitraum“ unter beziehungsweise
  auf schmalen Bildschirmen anstelle des alleinigen Rasters;
- Links aus dieser Liste zur jeweiligen Reservierung;
- einen beschrifteten Scheduler-Container;
- eine Textlegende für Farben und Markierungen;
- eine Meldung, wenn im Zeitraum keine Belegung existiert;
- sichtbaren Fokus auf allen von Haben kontrollierten Aktionen.

Auf dem Telefon bleibt DayPilot horizontal scrollbar. Die alternative Liste steht
vor oder direkt nach dem Raster und macht die Inhalte ohne präzise
Zeigegeräte bedienbar. Die DayPilot-interne DOM-Struktur wird mit Axe und manueller
Tastaturprüfung geprüft; unvermeidbare Drittanbieterbefunde werden nicht pauschal
unterdrückt, sondern einzeln bewertet.

## Tests

### Servermodul

`apps/web/src/server/modules/pms/schedule.test.ts` prüft mit PostgreSQL:

- Standard- und explizite Zeitraumgrenzen;
- ausschließlich überlappende Positionen werden geladen;
- Abreise am Starttag und Anreise am Endtag liegen außerhalb;
- mehrere Positionen derselben Reservierung ergeben mehrere Ereignisse;
- natürliche Zimmersortierung;
- aktive Zimmer ohne Belegung bleiben sichtbar;
- archivierte Zimmer erscheinen nur mit historischer Belegung;
- stornierte Reservierungen werden mit Status ausgegeben;
- Kontaktname und neutrale Rechnungsdaten werden korrekt zugeordnet;
- Nicht berechnet, Entwurf, Offen und Bezahlt verwenden die bestehende
  Rechnungslifecycle-Logik;
- die Abfrage erzeugt kein N+1-Verhalten.

### Komponenten

Mit Vitest werden DayPilot-Loader und Mapping-Helfer geprüft:

- Herstellerdatei wird nur einmal geladen;
- Ladefehler erzeugt den Fallback;
- IDs, Zeiten, Farben und Beschriftungen werden korrekt gemappt;
- fremde Texte werden vor HTML-Ausgabe escaped;
- stornierte und bezahlte Ereignisse erhalten die richtigen Klassen.

### E2E

Neue Datei `apps/web/e2e/pms-belegungsplan.spec.ts`:

- Route und Navigation sind für den Inhaber erreichbar;
- Zimmer und vorhandene Reservierungspositionen erscheinen im Raster;
- Wochenenden und Heute-Markierung sind vorhanden;
- Klick auf einen Balken öffnet die richtige Reservierung;
- Auswahl eines freien Bereichs öffnet die vorbelegte Anlage;
- Speichern zeigt den neuen Balken ohne vollständigen Browser-Reload;
- stornierte Reservierung ist rot markiert;
- Rechnung ohne/mit Zahlung zeigt den erwarteten Status;
- alternative Liste und Neuanlage sind per Tastatur bedienbar;
- Steuerberatung sieht Navigation und Route nicht;
- Light-, Dark-, Desktop- und Telefonansichten werden für die
  PR-Screenshots geprüft.

Die Route wird außerdem in `e2e/seiten.spec.ts` und
`e2e/barrierefreiheit.spec.ts` aufgenommen.

## Geplante Dateien

| Datei | Aufgabe |
| --- | --- |
| `apps/web/public/vendor/daypilot/daypilot-all.min.js` | unveränderte DayPilot-Lite-Datei |
| `apps/web/public/vendor/daypilot/LICENSE` | Apache-2.0-Lizenztext |
| `NOTICE` | DayPilot-Hinweis |
| `apps/web/src/server/modules/pms/schedule.ts` | Zeitraumabfrage und DTO |
| `apps/web/src/server/modules/pms/schedule.test.ts` | PostgreSQL-Tests |
| `apps/web/src/server/modules/pms/index.ts` | öffentlicher Export |
| `apps/web/src/server/modules/rechnungen/index.ts` | gegebenenfalls gebündelte Status-Lese-API |
| `apps/web/src/server/functions/pms.ts` | `getReservationSchedule` |
| `apps/web/src/components/pms/daypilot-loader.ts` | einmaliger lokaler Script-Loader |
| `apps/web/src/components/pms/ReservationSchedule.tsx` | DayPilot-Wrapper |
| `apps/web/src/components/pms/ReservationForm.tsx` | optionale Vorbelegung/Callback |
| `apps/web/src/routes/_app/pms/belegungsplan.tsx` | Seite und Dialogsteuerung |
| `apps/web/src/routes/_app/pms/reservierungen.tsx` | Bearbeiten per Suchparameter |
| `apps/web/src/routes/_app.tsx` | PMS-Navigation |
| `apps/web/src/styles/pms-schedule.css` | gekapselte Haben-Styles |
| `apps/web/e2e/pms-belegungsplan.spec.ts` | Browserabläufe |
| `apps/web/e2e/seiten.spec.ts` | Routenvollständigkeit |
| `apps/web/e2e/barrierefreiheit.spec.ts` | Barrierefreiheitsprüfung |
| `docs/pms-belegungsplan.md` | spätere Anwenderdokumentation |
| `docs/architektur.md` | PMS-Lesemodell und DayPilot erwähnen |

Für diesen Meilenstein ist keine neue Datenbanktabelle oder Migration vorgesehen.

## Umsetzungsreihenfolge

1. Aktuellen Reservierungsstand einschließlich Mehrfachpositionen,
   Rechnungsverknüpfung und Tests als belastbaren Ausgangsstand verifizieren.
2. Fehlschlagende PostgreSQL-Tests für das Belegungsplan-Lesemodell anlegen.
3. `schedule.ts`, öffentliche Modulgrenze und Server Function implementieren.
4. DayPilot-Datei, Lizenz und NOTICE übernehmen und Hash prüfen.
5. isolierten DayPilot-Loader und `ReservationSchedule` implementieren.
6. Route, Navigation, Legende und alternative Liste ergänzen.
7. Reservierungsformular für Vorbelegung im Dialog wiederverwenden.
8. Styles mit Haben-Tokens für alle Themes und Bildschirmgrößen umsetzen.
9. Komponenten-, E2E-, Seiten- und Barrierefreiheitstests ergänzen.
10. Benutzer- und Architekturdokumentation aktualisieren.
11. Screenshots vor und nach der UI-Änderung in den geforderten Ansichten erstellen.
12. Lint, Typecheck, PostgreSQL-Tests, Build, E2E und strikten Docs-Build ausführen.

## Abnahmekriterien

Der Meilenstein ist fertig, wenn:

- DayPilot Lite lokal, reproduzierbar und lizenzkonform ausgeliefert wird;
- der Plan Zimmer und jede Reservierungsposition im gewählten Zeitraum korrekt
  darstellt;
- die Darstellung dem Fidoma-Plan funktional entspricht und visuell in alle
  Haben-Themes passt;
- Balkenklick und Zeitraumsauswahl die bestehenden Reservierungsabläufe verwenden;
- parallele Doppelbelegungen weiterhin durch die vorhandene PostgreSQL-Constraint
  verhindert werden;
- keine PMS-Schreiblogik in der DayPilot-Komponente liegt;
- Bedienung ohne Maus über Button, Formular und alternative Liste möglich ist;
- alle relevanten Prüfungen grün sind.
