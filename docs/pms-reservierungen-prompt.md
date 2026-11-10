---
title: "Prompt: PMS-Meilenstein 2 – Reservierungsansicht"
description: >-
  Umsetzungs-Prompt für eine einfache Zimmerreservierungs-CRUD-Ansicht auf Basis
  des vorhandenen PMS-Zimmerstamms in Haben.
---

# Prompt: PMS-Meilenstein 2 – Reservierungsansicht

## Geprüfte Ausgangslage

Die Struktur wurde am 9. November 2026 gegen die laufende Fidoma-Datenbank und den
aktuellen Haben-Quellstand geprüft.

Fidoma verwendet eine historisch aus InvoicePlane abgeleitete Aufteilung:

- `reservations` enthält den Kopf mit Kunde, Status, Nummer, Erstell- und
  Ablaufdatum, Rabatten, Notiz und Rechnungsverweis;
- `reservation_items` enthält die eigentliche Zimmerbelegung mit `room_id`,
  `arrival_date` und `departure_date`, daneben aber auch Produkt-, Steuer-, Mengen-
  und Preisfelder;
- `reservation_amounts`, `reservation_item_amounts` und
  `reservation_tax_rates` speichern berechnete Geld- und Steuerwerte;
- `rooms` enthält Nummer, Bezeichnung, Kapazität, Aktiv- und Reinigungsstatus;
- `reservations` und `reservation_items` laufen in Fidoma noch mit MyISAM und
  besitzen deshalb keine durchgesetzten Fremdschlüssel.

Für die erste Haben-Reservierungsansicht werden diese Tabellen nicht kopiert. Der
aktuelle Haben-Stand besitzt bereits die PostgreSQL-Tabelle `pms_rooms` mit UUID,
Zimmernummer, Bezeichnung, Kapazität, Archivierung, Zeitpunkten, Constraints und
Audit-Trigger. Darauf baut die folgende Aufgabe auf.

## Kopierbarer Implementierungs-Prompt

```text
Implementiere in Haben den PMS-Meilenstein 2: eine bewusst einfache
Zimmerreservierungs-CRUD-Ansicht.

Lies vor jeder Änderung vollständig AGENTS.md und CLAUDE.md sowie die betroffenen
Abschnitte in docs/entwicklung.md und docs/architektur.md. Prüfe anschließend den
aktuellen Stand des vorhandenen PMS-Zimmermoduls, insbesondere:

- apps/web/src/server/db/schema.ts: pmsRooms
- apps/web/src/server/modules/pms/index.ts
- apps/web/src/server/modules/pms/rooms.ts und rooms.test.ts
- apps/web/src/server/functions/pms.ts
- apps/web/src/routes/_app/pms/zimmer.tsx
- apps/web/src/components/pms/RoomForm.tsx
- die aktuelle PMS-Navigation, Styles und E2E-Seitenlisten

Arbeite TDD-orientiert und halte die Änderung auf diesen Meilenstein begrenzt.
Verwende keine neue Dependency.

Ziel
====

Der Inhaber kann unter /pms/reservierungen einfache Zimmerreservierungen auflisten,
anlegen, bearbeiten und stornieren. Eine Reservierung gehört in diesem ersten
Schritt genau zu einem aktiven Zimmer und genau zu einem vorhandenen Kundenkontakt.
Sie besitzt Anreise, Abreise und eine optionale interne Notiz.

Nicht Teil dieser Aufgabe sind:

- mehrere Zimmer oder mehrere Aufenthaltspositionen je Reservierung;
- Preise, Rabatte, Steuern, Artikel oder Rechnungen;
- Zahlungen und Buchhaltung;
- Belegungsplan oder Kalenderansicht;
- Check-in, Check-out und No-show;
- Erwachsene, Kinder oder einzelne Gastdatensätze;
- Housekeeping und Tourismusstatistik;
- Online-Buchung, Channel-Manager oder Messekalender.

Datenmodell
===========

Ergänze in apps/web/src/server/db/schema.ts die Tabelle pmsReservations mit dem
PostgreSQL-Namen pms_reservations:

- id: UUID, Primärschlüssel, defaultRandom()
- roomId: UUID, nicht null, Fremdschlüssel auf pms_rooms.id
- contactId: UUID, nicht null, Fremdschlüssel auf contacts.id
- arrivalDate: date im String-Modus, nicht null
- departureDate: date im String-Modus, nicht null
- status: Text mit den Werten confirmed und canceled, nicht null, Standard confirmed
- note: Text, nicht null, Standard leerer Text
- createdAt: timestamp with time zone, nicht null, defaultNow()
- updatedAt: timestamp with time zone, nicht null, defaultNow()
- canceledAt: timestamp with time zone, nullable

Nutze englische Identifier und deutsche Kommentare sowie deutsche sichtbare Texte.
Lege Indizes auf room_id mit dem Zeitraum, contact_id und status an.

Ergänze Datenbank-Constraints:

- departure_date muss nach arrival_date liegen;
- note hat höchstens 2.000 Zeichen;
- status darf nur confirmed oder canceled sein;
- status und canceled_at müssen zusammenpassen: confirmed ohne canceled_at,
  canceled mit canceled_at.

Verhindere Doppelbelegungen auch bei parallelen Schreibvorgängen in PostgreSQL.
Nutze dafür eine separate Custom-Migration mit einer geeigneten
Exclusion-Constraint über room_id und den halb offenen Zeitraum
[arrival_date, departure_date). Sie gilt nur für nicht stornierte Reservierungen.
Damit ist eine neue Anreise am Abreisetag einer anderen Reservierung erlaubt, eine
echte Überschneidung aber nicht. Prüfe vor der Umsetzung, wie die dafür nötige
PostgreSQL-Erweiterung im Projekt migrationssicher aktiviert wird. Übersetze einen
Constraint-Konflikt in die Fachmeldung:

„Das Zimmer ist in diesem Zeitraum bereits reserviert.“

Zimmer und Kontakte werden nicht kaskadierend gelöscht. Haben archiviert diese
Stammdaten ohnehin. Eine Reservierung wird niemals hart gelöscht, sondern storniert.

Ändere zuerst schema.ts und führe dann bun run db:generate aus. Bearbeite keine
bestehende Migration und schreibe keine Drizzle-Metadaten von Hand. Lege in einer
separaten Custom-Migration den Audit-Trigger auf pms_reservations mit haben_audit()
an. Alle Schreibvorgänge müssen über withActor laufen.

Backend-Modul
=============

Erweitere das vorhandene Modul apps/web/src/server/modules/pms. Lege die
Reservierungslogik in reservations.ts und die PostgreSQL-Integrationstests direkt
daneben in reservations.test.ts ab. Exportiere nur die benötigte öffentliche API
über pms/index.ts.

Implementiere mindestens:

- reservationInputSchema
- listReservations mit den für die Liste benötigten Zimmer- und Kontaktdaten
- createReservation(actor, input)
- updateReservation(actor, id, input)
- cancelReservation(actor, id)

Die Eingabe enthält roomId, contactId, arrivalDate, departureDate und note. Der
Status wird nicht frei aus dem Formular übernommen: neue Reservierungen sind
confirmed, storniert wird ausschließlich über cancelReservation. Eine stornierte
Reservierung wird in diesem einfachen Meilenstein nicht wiederhergestellt und nicht
mehr bearbeitet.

Prüfe serverseitig:

- Zimmer und Kontakt existieren;
- der Kontakt besitzt die Kundenrolle;
- das Zimmer ist nicht archiviert;
- Datumswerte haben das Format YYYY-MM-DD;
- Abreise liegt strikt nach Anreise;
- Notiz ist höchstens 2.000 Zeichen lang;
- beim Bearbeiten existiert die Reservierung und ist nicht storniert.

Verlasse dich für Parallelität und endgültigen Konfliktschutz auf die
Datenbank-Constraint. Eine zusätzliche Vorprüfung darf nur für eine frühere,
freundliche Meldung dienen.

Server Functions
================

Erweitere apps/web/src/server/functions/pms.ts um dünne Functions:

- getReservations als GET
- getReservationFormOptions als GET für aktive Zimmer und aktive Kunden
- saveReservation als POST mit optionaler Reservierungs-UUID
- cancelPmsReservation als POST

Alle Functions verwenden authMiddleware. Die Steuerberatung erhält in diesem
Meilenstein weder Navigation noch Zugriff. Die Functions enthalten nur
Authentifizierung, Zod-Validierung und Aufrufe der öffentlichen PMS-Modulgrenze.

CRUD-Oberfläche
===============

Erstelle die Route:

apps/web/src/routes/_app/pms/reservierungen.tsx

Öffentliche URL: /pms/reservierungen
Seitentitel: Reservierungen · Haben

Ergänze in der bestehenden Navigationsgruppe PMS den Eintrag „Reservierungen“.
„Reservierungen“ steht vor „Zimmer“, weil dies später die tägliche Hauptansicht des
PMS wird. Nutze das vorhandene Icon-System; füge nur bei Bedarf ein kleines,
stilistisch passendes Symbol hinzu.

Die Seite folgt Look and Feel und Interaktionsmuster der vorhandenen Haben-Seiten,
insbesondere /artikel und /pms/zimmer:

- page-head mit Eyebrow „PMS“, H1 „Reservierungen“ und primärem Button
  „Neue Reservierung“;
- kurzer Hilfetext;
- Formular als card oberhalb der Liste, kein neuer Dialog und kein fremdes
  UI-System;
- NoticeBanner für Erfolg und Fehler;
- Filterchips „Aktiv“ und „Storniert“ mit Anzahl;
- responsive Tabellenkarte;
- verständlicher leerer Zustand;
- ausschließlich bestehende Farben, Abstände, Buttons, Felder und CSS-Variablen;
- Light- und Dark-Theme sowie mobile Darstellung berücksichtigen.

Die aktive Liste zeigt:

- Anreise und Abreise im deutschen Anzeigeformat;
- Zimmernummer und optionale Zimmerbezeichnung;
- Name des Kundenkontakts;
- Anzahl der Nächte, rein aus den beiden Daten berechnet;
- Aktionen „Bearbeiten“ und „Stornieren“.

Die stornierte Liste zeigt dieselben Kerndaten und einen Statushinweis, aber keine
Bearbeitungsaktion. Sortiere aktive Reservierungen zuerst nach nächster Anreise und
danach nach Zimmernummer. Vergangene Reservierungen bleiben sichtbar; eine
zusätzliche Vergangenheitsfilterung ist nicht Teil dieses Meilensteins.

Erstelle eine kleine Komponente:

apps/web/src/components/pms/ReservationForm.tsx

Felder:

- Kunde: vorhandener aktiver Kundenkontakt, Pflichtfeld
- Zimmer: vorhandenes aktives Zimmer, Pflichtfeld
- Anreise: Datum, Pflichtfeld
- Abreise: Datum, Pflichtfeld
- Interne Notiz (optional): Textarea, maximal 2.000 Zeichen

Buttons: „Anlegen“ beziehungsweise „Speichern“ und „Abbrechen“. Während des
Speicherns sind Aktionen deaktiviert. Clientseitige Prüfung verbessert die
Rückmeldung, ersetzt aber nie Zod- und Datenbankprüfung.

Die Stornierung ist fachlich dauerhaft. Zeige deshalb vor der Aktion einen
barrierefreien Bestätigungsdialog im vorhandenen Haben-Stil mit dem konkreten
Zimmer und Zeitraum. Nach Bestätigung wird storniert, die Route invalidiert und
„Reservierung storniert.“ angezeigt.

Verwende echte Buttons und Labels, sichtbaren Tastaturfokus, verständliche
aria-labels für zeilenbezogene Aktionen sowie role=alert für Fehler. Ergänze nur
kleine seitenbezogene CSS-Regeln, falls das vorhandene Tabellenraster nicht reicht.

Tests
=====

Beginne mit PostgreSQL-Integrationstests in reservations.test.ts. Prüfe mindestens:

- Anlegen und Trimmen einer gültigen Reservierung;
- Fremdschlüssel auf vorhandenes aktives Zimmer und vorhandenen aktiven Kunden;
- Ablehnung eines Lieferanten ohne Kundenrolle;
- Ablehnung eines archivierten Zimmers oder Kontakts;
- Abreise am oder vor dem Anreisetag wird abgewiesen;
- zwei Reservierungen dürfen sich am Abreise-/Anreisetag berühren;
- echte Überschneidungen desselben Zimmers werden abgewiesen;
- gleiche Zeiträume in verschiedenen Zimmern sind erlaubt;
- Bearbeitung berücksichtigt die eigene Reservierung nicht als Konflikt;
- stornierte Reservierungen blockieren den Zeitraum nicht mehr;
- eine stornierte Reservierung kann nicht bearbeitet oder erneut storniert werden;
- Anlage, Änderung und Stornierung erscheinen mit Akteur im Audit-Log;
- parallele Anlagen für dasselbe Zimmer und denselben Zeitraum können nicht beide
  erfolgreich sein.

Ergänze die neue Route in apps/web/e2e/seiten.spec.ts und
apps/web/e2e/barrierefreiheit.spec.ts. Decke den sichtbaren CRUD-Ablauf mindestens
mit einem E2E-Test ab: anlegen, bearbeiten, Stornierung bestätigen und in den
Filter „Storniert“ wechseln. Prüfe außerdem, dass die Steuerberatung den Menüpunkt
nicht sieht und die Route nicht öffnen kann.

Dokumentation und Abschluss
===========================

Ergänze bei der Umsetzung eine kurze deutsche Anwenderseite für Reservierungen und
aktualisiere docs/architektur.md um Tabelle und PMS-Modulinhalt. Verändere keine
unbeteiligten Bereiche und übernimm keine PHP-, Filament-, Livewire-, MySQL- oder
InvoicePlane-Struktur aus Fidoma.

Führe zum Abschluss entsprechend AGENTS.md mindestens aus:

- bun run lint
- bun run typecheck
- PostgreSQL-Tests mit einer sicheren TEST_DATABASE_URL
- bun run build
- relevante Playwright-E2E- und Barrierefreiheitstests mit einer ausschließlich
  dafür vorgesehenen E2E-Datenbank
- zensical build --strict für geänderte Dokumentation

Nutze niemals eine Datenbank mit echten Daten für Tests. Dokumentiere übersprungene
Prüfungen ausdrücklich. Der Pull Request enthält nur diesen Reservierungs-
Meilenstein und nimmt Belegungsplan, Housekeeping und Tourismusstatistik nicht
vorweg.
```

## Begründung der Vereinfachung

Das Zielmodell übernimmt aus Fidoma nur die fachlich notwendigen Beziehungen:
Zimmer, Kunde und halb offener Aufenthaltszeitraum. Die Preis- und Rechnungsfelder
aus `reservation_items` gehören in Haben später in eine eigene Integration mit dem
vorhandenen Rechnungsmodul. Ein Kopf-/Positionsmodell ist für genau ein Zimmer pro
Reservierung noch nicht erforderlich und würde den ersten CRUD-Meilenstein unnötig
vergrößern.

Die Exclusion-Constraint ist trotz des einfachen Umfangs wichtig. Ohne sie könnten
zwei fast gleichzeitige Anfragen beide die vorherige Verfügbarkeitsprüfung bestehen
und dasselbe Zimmer belegen. Diese Konsistenz muss PostgreSQL garantieren, nicht die
React-Oberfläche.
