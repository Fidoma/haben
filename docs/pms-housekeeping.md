---
title: "PMS: Housekeeping"
description: >-
  Zimmer nach Abreise automatisch als schmutzig markieren und die Reinigung mobil dokumentieren.
---

# Housekeeping

Unter **PMS › Housekeeping** stehen alle aktiven Zimmer getrennt nach **Zu reinigen** und **Sauber**. Die großen Schaltflächen sind für die Bedienung auf dem Telefon ausgelegt.

Nach einer Abreise markiert der stündliche Hintergrundlauf das betreffende Zimmer ab 07:00 Uhr als schmutzig. Jede Reservierungsposition wird dabei höchstens einmal verarbeitet. Stornierte Reservierungen werden ignoriert. Ändert sich eine Reservierungsposition, wird sie neu angelegt und kann am neuen Abreisetag wieder verarbeitet werden.

Die manuelle Umschaltung und der automatische Lauf werden mit Akteur im Audit-Protokoll festgehalten. Die erste Stufe verwendet die Betriebszeitzone `Europe/Berlin`; eine frei einstellbare Firmenzeitzone bleibt eine spätere Erweiterung.
