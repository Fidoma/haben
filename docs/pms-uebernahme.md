---
title: "Planung: PMS-Funktionen aus Fidoma"
description: >-
  Fachliche Zerlegung der Hotel- und Reservierungsfunktionen aus Fidoma und
  Vorschlag für ihre schrittweise Umsetzung in Haben.
---

# Planung: PMS-Funktionen aus Fidoma

## Ziel und Abgrenzung

Dieses Dokument beschreibt, welche Funktionen aus Fidoma zu einem eigenständigen
Property-Management-System (PMS) in Haben gehören, welche vorhandenen Haben-Module
sie benutzen und in welcher Reihenfolge sie umgesetzt werden sollten. Es ist eine
Übertragungslandkarte, keine Aufforderung, PHP-, Filament- oder MySQL-Code direkt zu
kopieren.

### Beschlossener Einstieg

Der PMS-Einstieg in Haben wird bewusst grob und einfach in fünf aufeinanderfolgende
Meilensteine zerlegt:

1. **Zimmer planen**;
2. **Reservierungen als einfache CRUD-Ansicht planen**;
3. **Hotelbelegungsplan planen**;
4. **Housekeeping planen**;
5. **Tourismusstatistik planen**.

Ein Meilenstein wird zuerst fachlich abgestimmt und erst anschließend umgesetzt.
Die Planung des nächsten Meilensteins soll die noch offenen Entscheidungen des
vorherigen nicht vorwegnehmen. Alle Bereiche erscheinen später gemeinsam unter dem
Einstiegspunkt **PMS**.

Nicht Bestandteil des ersten Umfangs sind Reservierungsabrechnung,
PMS-Umsatzberichte, Messekalender, Online-Buchung und Channel-Manager. Die
Reservierungsdaten werden so angelegt, dass eine spätere Rechnungsintegration über
das vorhandene Haben-Modul `rechnungen` ohne neues Reservierungsmodell möglich ist.

Die Analyse basiert auf dem Stand von Fidoma vom 9. November 2026, insbesondere auf:

- `app/Features/Reservations/`;
- `app/Features/TourismStatistics/`;
- den angebundenen Features `Clients`, `Products`, `TaxRates`, `Units`, `Invoices`,
  `Payments`, `InvoiceGroups` und optional `TradeFairs`;
- `tests/Feature/ReservationTest.php`, `ReservationStatisticsTest.php` und
  `TourismStatisticsTest.php`;
- den Tabellen `rooms`, `reservations`, `reservation_items`,
  `reservation_*_amounts`, `reservation_tax_rates`, `tourism_reports` und
  `tourism_report_country_values`.

## Ergebnis der fachlichen Trennung

| Bereich | Einordnung | Zielmodul in Haben | Abhängigkeiten |
| --- | --- | --- | --- |
| Zimmerstamm | PMS-Kern | `server/modules/pms` | Audit, Benutzerrechte |
| Reservierungen und Aufenthalte | PMS-Kern | `server/modules/pms` | Kontakte, Artikel, Steuern |
| Verfügbarkeits- und Konfliktprüfung | PMS-Kern | `packages/core` plus `pms` | Zimmer, Aufenthalte |
| Belegungsplan | PMS-Kernoberfläche | Route und Komponenten `pms` | PMS-Lesemodell |
| Housekeeping | PMS-Kern | `server/modules/pms` | Zimmer, Abreisen, Scheduler |
| Reservierungsabrechnung | spätere Integration | `pms` über öffentliche API von `rechnungen` | Kontakte, Rechnungen |
| PMS-Auswertungen | spätere Ausbaustufe | `server/modules/pms` | Aufenthalte, Rechnungen, Zahlungen |
| Tourismusstatistik/HOTE | erster PMS-Umfang, intern abgegrenzt | Unterbereich `pms/tourismusstatistik` | PMS-Lese-API |
| Messe- und Ereigniskalender | optionale Erweiterung | eigenes Modul, später | Belegungsplan |
| KI, Webmail, Paperless, Zeiterfassung, Projekte | nicht Teil des PMS | keine Übernahme | – |

Die Trennung ist wichtig: Der Unterbereich Tourismusstatistik und ein späterer
Messekalender dürfen den Reservierungskern lesen, der Reservierungskern darf aber
nicht von ihnen abhängen. Ebenso bleibt die bestehende Buchhaltung in Haben
Eigentümerin von Rechnungen, Zahlungen und Journalbuchungen.

## 1. Zimmerstamm

### Fachlicher Umfang

Fidoma verwaltet je Zimmer Nummer, Bezeichnung, Kapazität, Aktivstatus und
Reinigungsstatus. Zimmer werden numerisch sinnvoll sortiert; ein Zimmer mit bereits
vorhandenen Aufenthalten kann nicht gelöscht werden. Inaktive Zimmer bleiben für
Historie und Auswertung erhalten.

### Zielmodell

Tabelle `pms_rooms`:

| Feld | Bedeutung |
| --- | --- |
| `id` | UUID |
| `number` | eindeutige, angezeigte Zimmernummer |
| `name` | optionale Bezeichnung |
| `capacity` | Betten beziehungsweise Personen, mindestens 1 |
| `active` | für neue Belegungen verfügbar |
| `cleaning_status` | zunächst `clean` oder `dirty` |
| `created_at`, `updated_at` | technische Zeitpunkte |

Für Haben sollten Fremdschlüssel, Prüfbedingungen und Audit-Trigger bereits in der
ersten Migration vorhanden sein. Ein Zimmer wird archiviert oder deaktiviert, nicht
gelöscht, sobald es fachliche Historie besitzt.

### Spätere Erweiterungen

Zimmerkategorie, Etage, Ausstattung, Sperrzeitraum, Wartung, mehrere Häuser und ein
feinerer Housekeeping-Status (`in_reinigung`, `geprüft`) sind in Fidoma nicht
modelliert. Sie gehören nicht in die erste Übernahme, das Datenmodell sollte ihre
spätere Ergänzung aber nicht verhindern.

## 2. Reservierung und Aufenthalt

### Fachliche Aggregate

Fidoma trennt den Reservierungskopf von den Aufenthaltspositionen:

- Der Kopf hält Gast/Kunde, Nummer, Status, Erstell- und Ablaufdatum, Rabatt, Notiz
  und den Verweis auf eine erzeugte Rechnung.
- Eine Position hält Zimmer, Anreise, Abreise, Leistung/Artikel, Menge, Preis,
  Steuersatz und Positionsrabatt.
- Eine Reservierung kann mehrere Positionen und damit mehrere Zimmer oder
  Zeitabschnitte enthalten.

Diese Trennung sollte erhalten bleiben. Eine Position ist fachlich ein gebuchter
Aufenthalt mit einer verkaufbaren Leistung, nicht bloß eine Rechnungszeile.

### Zieltabellen

`pms_reservations`:

- UUID, fortlaufende fachliche Nummer und Status;
- `contact_id` auf einen bestehenden Haben-Kontakt;
- Erstell-, Options-/Ablaufdatum und Notiz;
- Gesamtrabatt entweder in Cent oder Basispunkten, niemals beides;
- optional `invoice_id` auf den aus der Reservierung erzeugten Rechnungsentwurf;
- Ersteller und technische Zeitpunkte.

`pms_stays`:

- UUID und `reservation_id`;
- optionales `room_id` während der Anfragephase, vor Bestätigung verpflichtend;
- Anreise inklusive und Abreise exklusive;
- Verweis auf einen Artikel als Eingabehilfe, aber eine gespeicherte Kopie von
  Bezeichnung, Beschreibung, Einheit, Preis und Steuersatz;
- Menge in Tausendsteln, Preis und Rabatt in ganzen Cent, Steuersatz in
  Basispunkten;
- Position für eine stabile Reihenfolge;
- Zeitpunkt, zu dem die Abreise bereits als „Zimmer verschmutzt“ verarbeitet wurde.

Eine eigene Betrags-Tabelle wie in Fidoma ist nicht zwingend. Haben kann berechnete
Summen entweder am Reservierungskopf speichern oder aus unveränderlichen
Positionswerten ermitteln. Die Entscheidung muss für alle Leser einheitlich sein;
Gleitkommazahlen aus Fidoma dürfen nicht übernommen werden.

### Statusmodell

Fidoma kennt nur `open`, `confirmed` und `canceled`. Das reicht als erste
Kompatibilitätsstufe, bildet aber den Hotelbetrieb nicht vollständig ab. Empfohlen
ist folgende bewusste Staffelung:

1. MVP: `option`, `confirmed`, `canceled`;
2. Betrieb: zusätzlich `checked_in`, `checked_out`, `no_show`;
3. Änderungen werden mit Akteur und Zeitpunkt protokolliert.

Statusübergänge gehören als reine Funktionen mit Tests in `packages/core`. Das
Servermodul prüft Berechtigung und Parallelität und schreibt innerhalb einer
Transaktion. Eine Stornierung löscht weder Reservierung noch Aufenthalte.

### Zentrale Regeln

- Abreise liegt strikt nach Anreise.
- Abreise ist eine exklusive Grenze: Anreise am Abreisetag eines anderen Gasts ist
  möglich.
- Bestätigte, eingecheckte oder ausgecheckte Reservierungen benötigen mindestens
  einen Aufenthalt.
- Stornierte Reservierungen belegen keine Kapazität.
- Eine Zimmerüberschneidung wird vor Bestätigung und bei jeder Termin- oder
  Zimmeränderung in der Datenbanktransaktion geprüft.
- Die Datenbank sollte Parallelbuchungen absichern; eine reine Prüfung in der
  Oberfläche genügt nicht.
- Kontakt- und Artikeldaten werden bei späterer Rechnungsstellung über die
  vorhandenen Versionierungs- beziehungsweise Kopiermechanismen von Haben
  festgehalten.

## 3. Reservierungsverwaltung

Fidoma bietet Liste, Anlage, Bearbeitung, Detailansicht und Statusfilter. Für Haben
entstehen daraus:

- Route `/pms/reservierungen` mit Suche, Zeitraum-, Status- und Zimmerfilter;
- Route `/pms/reservierungen/neu` und eine Bearbeitungsseite;
- Schnellanlage aus dem Belegungsplan mit vorbelegtem Zimmer und Zeitraum;
- Gastanlage über das bestehende Kontaktmodul, nicht über eine zweite
  Gästestammtabelle;
- Artikelvorschläge aus den bestehenden Stammdaten, zugleich freie
  Leistungsbezeichnungen;
- sichtbare Summen, Steueraufschlüsselung und Rechnungsstatus;
- idempotente Status- und Rechnungsaktionen.

Die Server Functions bleiben entsprechend der Haben-Architektur dünn: Anmeldung,
Zod-Prüfung und Aufruf der öffentlichen `pms`-API. Geschäftslogik gehört nicht in
React-Komponenten oder Routen.

## 4. Hotelbelegungsplan

### Verhalten aus Fidoma

Der Plan zeigt Zimmer als Zeilen und Tage als Spalten. Reservierungen werden mit
Gast, Reservierungsstatus und Rechnungsstatus angezeigt. Wochenenden, der heutige
Tag und optional Messetermine sind markiert. Ein Klick öffnet die Reservierung; eine
Zeitraumauswahl startet die Schnellanlage. Der Standardausschnitt beginnt 32 Tage
vor heute und umfasst 90 Tage, maximal wird ein Jahr abgefragt.

### Ziel in Haben

Route `/pms/belegungsplan` mit einem eigenen, kleinen Lesemodell:

```text
Zimmer: id, number, cleaningStatus
Belegung: stayId, reservationId, roomId, arrival, departure,
          guestName, reservationStatus, invoiceStatus
```

Der Endpunkt lädt nur den sichtbaren Zeitraum. Er muss stornierte Einträge
kennzeichnen oder aus der tatsächlichen Belegung ausschließen und darf keine
Rechnungs- oder Kontaktdetails außerhalb der Benutzerberechtigung ausgeben.

Fidoma liefert DayPilot als minifizierte Datei unter `public/vendor/daypilot` aus.
Diese Datei sollte weder technisch noch lizenzrechtlich ungeprüft übernommen
werden. Vor der Umsetzung ist zu entscheiden, ob eine kompatible Bibliothek bereits
in Haben zulässig ist oder der begrenzte Zeitraster selbst umgesetzt wird. Das ist
eine bewusste Vorentscheidung des Belegungsplan-Arbeitspakets.

## 5. Housekeeping

### Umfang

Fidoma stellt ein Board mit sauberen und schmutzigen Zimmern bereit. Mitarbeitende
können den Zustand umschalten. Ein täglicher Prozess markiert nach der Abreise ab
07:00 Uhr Ortszeit das Zimmer genau einmal als schmutzig; stornierte Reservierungen
werden ignoriert. Wird Zimmer oder Abreisedatum geändert, wird die
Verarbeitungsmarke zurückgesetzt.

### Umsetzung in Haben

- Route `/pms/housekeeping`, mobil zuerst, mit großen echten Buttons;
- Schreibaktion `setCleaningStatus(roomId, status)` über `withActor`;
- Scheduler-Aufgabe für fällige Abreisen;
- Idempotenz über `dirty_processed_at` am Aufenthalt;
- Zeitzone als Firmeneinstellung statt fest verdrahtetem `Europe/Berlin`;
- Transaktion und Sperre, damit parallele Scheduler-Läufe nicht doppelt arbeiten.

Housekeeping ist Teil des PMS-Kerns, kann aber nach Reservierung und Belegungsplan in
einem eigenen Arbeitspaket geliefert werden.

## 6. Rechnung, Zahlung und Buchhaltung

Fidoma kopiert eine Reservierung idempotent in eine Rechnungsentwurfsstruktur und
ergänzt Zimmer, Anreise und Abreise in der Beschreibung. Es unterscheidet in der
Statistik Reservierungswert, fakturierten Betrag und tatsächliche Zahlung.

In Haben darf der PMS-Bereich keine zweite Rechnungslogik erhalten:

- Er erzeugt über die öffentliche API des Moduls `rechnungen` genau einen Entwurf.
- `invoice_id` wird in derselben Transaktion beziehungsweise mit einem
  Idempotenzschlüssel an der Reservierung verknüpft.
- Kontakt, Positionen, Leistungszeitraum, Cent-Beträge, Basispunkt-Steuern und
  Tausendstel-Mengen werden in das native Haben-Format übersetzt.
- Festschreiben, PDF/XML, Nummernkreis, GoBD-Sperre, Storno, Zahlung, Bankabgleich
  und Journal bleiben vollständig bei den bestehenden Haben-Modulen.
- Eine Änderung der Reservierung verändert niemals still eine festgeschriebene
  Rechnung. Sie führt je nach Fall zu einem neuen Entwurf, einer Korrektur oder
  einem Storno über die vorhandenen Prozesse.

Diese Integration ist ein eigenes Arbeitspaket nach dem Reservierungs-MVP. Die
Fidoma-Abhängigkeit von `InvoiceGroups` entfällt; Haben vergibt Rechnungsnummern erst
beim Festschreiben.

## 7. Auswertungen

Fidoma enthält folgende nützliche Kennzahlen:

- Reservierungsanzahl nach Status;
- Übernachtungen und Auslastung;
- belegte, freie und verfügbare Zimmernächte;
- Konflikte je Zimmer;
- Reservierungswert;
- Rechnungsbetrag und Zahlungseingang getrennt;
- Verlauf von Volumen, Wert und Auslastung;
- Zimmervergleich.

Die gemeinsame fachliche Basis ist ein Zeitraum mit Anreise inklusive und Abreise
exklusive. Überlappende Aufenthalte dürfen bei der tatsächlichen Zimmerauslastung
nicht doppelt gezählt werden; zugleich müssen Konflikte sichtbar bleiben.

Für Haben sollte zunächst eine reine, datenbankunabhängige Intervalllogik in
`packages/core` entstehen. Das PMS-Modul liefert danach aggregierte Lesemodelle an
`/pms/auswertungen`. Rechnungs- und Zahlungswerte werden nur über öffentliche APIs
der zuständigen Module bezogen. „Reserviert“, „fakturiert“ und „bezahlt“ bleiben
getrennte Größen.

## 8. Tourismusstatistik

Dieses Modul ist fachlich eng angebunden, aber kein Bestandteil des PMS-Kerns.
Fidoma bietet:

- einen Bericht pro Monat;
- angebotene Betten, verfügbare und belegte Gästezimmertage;
- Ankünfte und Übernachtungen nach amtlichen Ländergruppen;
- automatische Vorbelegung aus nicht stornierten Aufenthalten und Wohnsitzland des
  Kontakts;
- Plausibilitätsprüfungen;
- HOTE-CSV mit genau 116 Feldern, Semikolon, CRLF und Windows-1252;
- optionaler Kopfzeile und reproduzierbarem Dateinamen.

Empfohlene Zielgrenze innerhalb des PMS-Moduls:

- eigener Unterordner `pms/tourismusstatistik`, veröffentlicht über die `pms/index.ts`;
- Tabellen für Monatsbericht und Länderwerte mit eindeutigem Jahr/Monat;
- Zugriff ausschließlich über die interne öffentliche Grenze des
  Reservierungsbereichs;
- keine Rückabhängigkeit des Reservierungskerns von der Tourismusstatistik;
- Formatbeschreibung und Testvektoren gegen die zum Umsetzungszeitpunkt gültige
  amtliche HOTE-Spezifikation prüfen, statt das Fidoma-Format ungeprüft zu kopieren.

Das Wohnsitzland des Gasts wird derzeit aus `contacts.land` gelesen. Falls
Rechnungsempfänger und tatsächlicher Gast auseinanderfallen, braucht eine spätere
Stufe eigene Gastdatensätze pro Aufenthalt. Für die erste Stufe ist diese
Einschränkung ausdrücklich zu dokumentieren.

## 9. Optionale Nachbarmodule

### Messe- und Ereigniskalender

Fidoma lädt Messetermine unabhängig und markiert sie im Belegungsplan. Das ist eine
gute Preis- und Planungshilfe, aber keine Voraussetzung für Reservierung,
Verfügbarkeit oder Housekeeping. Daher erst nach dem PMS-Kern und über eine kleine
öffentliche Zeitraum-API anbinden.

### Weitere spätere PMS-Punkte

Nicht in Fidoma vorhanden oder nicht ausreichend ausgearbeitet sind unter anderem:

- Gästeliste unabhängig vom Rechnungskontakt;
- Check-in/Check-out mit Meldeschein;
- Zimmerkategorien und automatische Zimmerzuweisung;
- Ratenpläne, Saisonpreise, Pakete und Kurtaxe;
- Anzahl Erwachsene/Kinder je Aufenthalt;
- Anzahlungen, Garantien und No-show-Gebühren;
- Channel-Manager, iCal/OTA-Synchronisation und Online-Buchung;
- Wartungs- und Sperrzeiten;
- mehrere Standorte beziehungsweise Häuser.

Diese Punkte sind kein stiller Teil der Übernahme. Jeder benötigt eine eigene
fachliche Entscheidung und ein eigenes Arbeitspaket.

## Zielarchitektur in Haben

```text
packages/core/src/pms/
  intervalle.ts              reine Überlappungs- und Zimmernachtlogik
  status.ts                  erlaubte Statusübergänge
  summen.ts                  Cent/Basispunkt/Tausendstel-Berechnung, soweit nicht
                             bestehende Rechnungslogik wiederverwendet wird

apps/web/src/server/modules/pms/
  index.ts                   einzige öffentliche Modulgrenze
  rooms.ts                   Zimmerstamm
  reservations.ts            Reservierungen und Aufenthalte
  availability.ts            transaktionale Verfügbarkeitsprüfung
  housekeeping.ts            Reinigungsstatus und Abreiseverarbeitung
  invoicing.ts               Adapter zur öffentlichen Rechnungs-API
  reports.ts                 PMS-Lesemodelle und Kennzahlen
  tourism-statistics/
    reports.ts               Monatsberichte und Länderwerte
    prefill.ts               Vorbelegung aus Aufenthalten
    hote.ts                  HOTE-Prüfung und Export

apps/web/src/server/functions/pms.ts
apps/web/src/routes/_app/pms.*
apps/web/src/components/pms/

```

Die genaue Aufteilung erfolgt erst bei der Umsetzung. Dateien bleiben unter ungefähr
400 Zeilen und Funktionen unter ungefähr 80 Zeilen, wie für Haben festgelegt.

## Meilensteine und Reihenfolge

### Meilenstein 1: Zimmer

Zuerst wird nur der Zimmerstamm geplant. Zu klären sind die wenigen notwendigen
Felder, Aktivierung beziehungsweise Archivierung, Sortierung und die einfache
Verwaltung in Haben. Zimmerkategorien, Ausstattung, mehrere Häuser und Wartung
bleiben vorerst außen vor.

**Grobes Ergebnis:** Eine abgestimmte Beschreibung der Zimmerdaten und der späteren
einfachen CRUD-Oberfläche. Der konkrete Plan steht unter
[PMS-Meilenstein 1 – Zimmer](pms-zimmer-plan.md).

### Meilenstein 2: Reservierungen als CRUD-Ansicht

Auf Grundlage der Zimmer wird eine einfache Reservierungsverwaltung geplant. Im
Mittelpunkt stehen Liste, Anlegen, Anzeigen, Bearbeiten und Stornieren. Gastkontakt,
Zimmer, Anreise, Abreise, einfacher Status und Notiz reichen zunächst aus.
Preisberechnung, Rechnungsstellung, mehrere Zimmer je Reservierung, Online-Buchung
und komplexe Statusabläufe sind noch nicht Teil dieses Meilensteins.

**Grobes Ergebnis:** Eine abgestimmte CRUD-Ansicht und ein minimales
Reservierungsmodell mit einfacher Überschneidungsregel. Ein ausführbarer Entwurf
steht unter [Prompt: PMS-Meilenstein 2 – Reservierungsansicht](pms-reservierungen-prompt.md).

### Meilenstein 3: Hotelbelegungsplan

Danach wird die zeitliche Darstellung der vorhandenen Zimmer und Reservierungen
geplant. Der erste Plan soll lesen, einen begrenzten Zeitraum darstellen und von
einer Belegung zur Reservierung führen. Verschieben per Drag-and-drop,
Preissteuerung, Messekalender und aufwendige Interaktionen bleiben zunächst außen
vor.

**Grobes Ergebnis:** Eine abgestimmte einfache Rasteransicht mit Zimmerzeilen und
Reservierungszeiträumen. Der konkrete Übernahmeplan steht unter
[PMS-Meilenstein 3 – Belegungsplan mit DayPilot](pms-belegungsplan-plan.md).

### Meilenstein 4: Housekeeping

Anschließend wird eine kleine Housekeeping-Sicht geplant. Für den Einstieg genügen
die Zustände sauber und schmutzig sowie eine manuelle Umschaltung. Die automatische
Markierung nach Abreise wird separat innerhalb dieses Meilensteins bewertet; weitere
Zustände, Aufgabenverteilung und Prüfabläufe sind spätere Erweiterungen.

**Grobes Ergebnis:** Eine abgestimmte mobile Übersicht und ein minimales
Statusmodell für die Zimmerreinigung.

**Umgesetzt:** Mobile Übersicht, manuelle Umschaltung, Audit-Protokollierung und
der idempotente Hintergrundlauf nach Abreise sind vorhanden. Die erste Stufe nutzt
`Europe/Berlin`; eine frei einstellbare Firmenzeitzone bleibt offen.

### Meilenstein 5: Tourismusstatistik

Zuletzt wird die Tourismusstatistik geplant. Erst dann wird festgelegt, welche Daten
aus den bis dahin vorhandenen Reservierungen zuverlässig ableitbar sind. Der
Einstieg betrachtet Monatswerte, Länderzuordnung und einen einfachen Export. Die
zum Umsetzungszeitpunkt gültige HOTE-Spezifikation wird erst in diesem Meilenstein
verbindlich geprüft.

**Grobes Ergebnis:** Eine abgestimmte Monatsansicht mit Datenherkunft,
Plausibilitätsregeln und Exportumfang.

**Umgesetzt:** Monatsansicht, Vorbelegung, manuelle Korrektur, Plausibilitätsprüfung
und HOTE-CSV mit 116 Feldern, CRLF und Windows-1252 sind vorhanden. Die erste Stufe
setzt Gast und Rechnungskontakt gleich; mehrere tatsächliche Gäste je Aufenthalt
bleiben eine spätere Erweiterung.

Rechnungsintegration, weitergehende PMS-Auswertungen und Messekalender folgen erst
in späteren, separat priorisierten Meilensteinen.

Jedes Arbeitspaket sollte als eigener Issue und Pull Request umgesetzt werden. So
bleiben Migrationen, Modulgrenzen und unabhängige TDD-Prüfung beherrschbar.

## Prüfmatrix

### Domäne und Datenbank

- Grenzfall: Abreise und nächste Anreise am selben Tag ist kein Konflikt.
- Echte Überschneidung desselben Zimmers wird abgewiesen, auch bei zwei parallelen
  Anfragen.
- Stornierte Reservierungen blockieren kein Zimmer.
- Cent-, Basispunkt- und Tausendstelwerte bleiben ohne Rundungsfehler stabil.
- Statusübergänge sind vollständig getestet; Storno löscht keine Historie.
- Neue Tabellen besitzen Audit-Trigger und alle Schreibvorgänge laufen mit Akteur.

### Oberfläche und Rechte

- Liste, Editor, Belegungsplan und Housekeeping sind per Tastatur und auf dem Telefon
  bedienbar.
- Jede neue Seite steht in den vorhandenen Seiten- und Barrierefreiheitstests.
- Rollen dürfen PMS-Daten nur entsprechend ihrer Berechtigung lesen und ändern.
- Der Belegungsplan lädt begrenzte Zeiträume und bleibt bei vielen Zimmern nutzbar.

### Integrationen

- Wiederholtes „Rechnung erstellen“ liefert denselben Entwurf.
- Eine festgeschriebene Rechnung wird durch spätere PMS-Änderungen nicht verändert.
- Reservierungswert, Rechnungsbetrag und Zahlungseingang werden getrennt ausgewiesen.
- Der Housekeeping-Lauf ist wiederholbar, ignoriert Stornos und respektiert die
  Firmenzeitzone.
- HOTE-Dateien erfüllen Feldzahl, Reihenfolge, Zeilenende und Kodierung der gültigen
  Spezifikation.

## Nicht 1:1 aus Fidoma übernehmen

- Laravel-Models, Filament-Seiten und Livewire-Komponenten passen nicht zur
  funktionalen TanStack-/Bun-Architektur.
- MySQL-Schlüssel und InvoicePlane-Spaltennamen sind kein Zielmodell für PostgreSQL.
- Dezimalwerte und `float`-Berechnungen werden durch Cent, Basispunkte und
  Tausendstel ersetzt.
- Der dreistufige Reservierungsstatus wird bewusst geprüft und erweitert.
- Rechnungsnummerngruppen und die Fidoma-Rechnungskopie werden durch die vorhandene
  Haben-Rechnungs-API ersetzt.
- Fest verdrahtete deutsche Zeitzone und Check-out-Uhrzeit werden konfigurierbar.
- Vendored DayPilot-Dateien werden erst nach Technik- und Lizenzentscheidung
  verwendet oder ersetzt.
- Messekalender und Tourismusstatistik werden nicht als Abhängigkeiten in den
  Reservierungskern gezogen.

## Definition des ersten nutzbaren PMS-Stands

Der erste grobe PMS-Ausbau ist nach Abschluss aller fünf Meilensteine erreicht, wenn
berechtigte Benutzer:

- Zimmer verwalten;
- einen vorhandenen Kontakt als Gast auswählen;
- eine einfache Reservierung anlegen, anzeigen, ändern und stornieren;
- vor parallelen oder überlappenden Belegungen desselben Zimmers geschützt sind;
- alle relevanten Aufenthalte im Hotelbelegungsplan sehen und daraus eine
  Reservierung beginnen können;
- Zimmer im Housekeeping als sauber oder schmutzig bearbeiten können;
- einen monatlichen Tourismusbericht aus den Aufenthalten vorbelegen, prüfen und im
  gültigen HOTE-Format exportieren können.

Die genaue Abnahme wird je Meilenstein erst in dessen Detailplanung festgelegt.
Rechnungsstellung, Zahlungsauswertung, Messekalender und weitere PMS-Erweiterungen
sind ausdrücklich keine Abnahmevoraussetzung dieses ersten Ausbaus.
