---
title: "Gehostet oder mit Partner"
description: >-
  Haben ohne eigenen Server: eigene Instanz buchen, mit Updates, Backups und ELSTER; Partnerprogramm
  für IT-Dienstleister und Steuerberatungen; Fragen.
---

# Gehostet oder mit Partner

## Haben gehostet

Haben ist Open Source: Du kannst es [selbst betreiben](installation.md), ohne etwas zu zahlen. Wer
keinen Server pflegen will, bucht den Betrieb bei uns. Du bekommst eine eigene Instanz; Tarife
mit mehr oder weniger Funktionen gibt es nicht. Nicht eingerichtet sind die
[KI-Auslesung von Belegen](einrichtung.md#ki-auslesung-von-belegen) und der [Bankabruf über FinTS](bank-fints.md); Kontoauszüge
liest du als Datei ein oder rufst sie über Enable Banking ab.

### Was du bekommst

- **Eine eigene Instanz** unter `dein-name.haben.app`, mit eigener Datenbank, getrennt von allen
  anderen. Du hast Zugang zu Haben, nicht zum Server.
- **Updates und Backups:** Wir spielen neue Versionen ein und sichern täglich.
- **ELSTER ohne eigene Hersteller-ID:** Voranmeldung und Erklärungen sendest du direkt aus Haben.
  Die [Hersteller-ID](einrichtung-elster.md#hersteller-id-wer-ist-hersteller), auf die man sonst
  Tage bis Wochen wartet, und ERiC bringen wir mit. Dein ELSTER-Zertifikat lädst du selbst hoch und bestätigst
  die Datenschutzhinweise der Finanzverwaltung.
- **Hilfe zum Betrieb** per E-Mail: Störungen, Zugang, Updates und Backups. Fragen zur Bedienung
  beantworten wir öffentlich (siehe [Fragen](#fragen)). Steuerberatung ist das nicht.
- **Server in Deutschland:** Deine Instanz läuft bei netcup im Rechenzentrum Nürnberg. Die
  verschlüsselten Backups liegen zusätzlich bei Cloudflare R2.

### Preis

**12,90 € im Monat** oder **129 € im Jahr** (zwei Monate geschenkt), zuzüglich Umsatzsteuer. Du zahlst per SEPA-Lastschrift,
Karte, Apple Pay oder Google Pay über Stripe und bekommst die Rechnung per E-Mail. Das Angebot richtet sich an Unternehmer
(Selbstständige, Freiberufler, Gesellschaften), nicht an Verbraucher.

[Monatlich buchen](https://buy.stripe.com/bJe3cu9oU8lW3Q3ghc7wA00){ .md-button .md-button--primary } [Jährlich buchen](https://buy.stripe.com/3cI8wO0SodGg72f2qm7wA01){ .md-button }

### So läuft es ab

1. Du buchst über einen der Knöpfe und nennst den Wunschnamen deiner Instanz. Dort bestätigst du die
   [AGB](gehostet-agb.md); der [Vertrag zur Auftragsverarbeitung](gehostet-avv.md) gehört dazu.
2. Wir richten deine Instanz von Hand ein, in der Regel innerhalb eines Werktags.
3. Du bekommst eine E-Mail mit der Adresse und dem Einrichtungscode und legst damit dein Konto an
   ([Erste Schritte](einrichtung.md#konto-anlegen)). Dein Passwort kennst nur du.

### Kündigen und umziehen

Du kündigst zum Ende des bezahlten Zeitraums, im
[Kundenportal](https://billing.stripe.com/p/login/bJe3cu9oU8lW3Q3ghc7wA00) oder mit einer Nachricht an
uns. Im Kundenportal änderst du auch die Zahlungsart und lädst deine Rechnungen herunter. Deine Daten
nimmst du mit:

- Das [Jahresarchiv](auswertungen.md#jahresexport) und den
  [DATEV-Export](auswertungen.md#datev-export-für-die-steuerberatung) lädst du selbst herunter.
- Auf Wunsch bekommst du ein vollständiges Backup mit dem Schlüssel der Instanz und dem Passwort des
  Backups. Damit betreibst du Haben auf
  einem eigenen Server weiter ([Wiederherstellen](installation-backup.md#wiederherstellen)).

Nach dem Ende des Vertrags kannst du dich noch 30 Tage anmelden, dann löschen wir die Instanz und
ihre Backups. Die Aufbewahrungspflicht für deine Unterlagen bleibt bei dir: Sichere den Export vorher.

### Mehr als eine Instanz

Für mehrere Firmen, Single Sign-on oder eine eigene Domain schreibst du an
[info@teufel-it.de](mailto:info@teufel-it.de). Wer Einrichtung und Betreuung vor Ort will, fragt dort
nach einem Partner.

## Partnerprogramm

IT-Dienstleister, Hoster und Steuerberatungen, die Haben für ihre Kunden einrichten und betreuen wollen, werden Partner
über das [Partnerprogramm](https://speicherstadt.org/partner/). Partner bekommen 30 % Rabatt auf gehostete
Instanzen und legen den Preis für ihre Kunden selbst fest; zum Ausprobieren gibt es eine kostenlose Demo-Instanz, und wer
jetzt Partner wird, zahlt im ersten Jahr keine Partnergebühr.

## Fragen

Fragen zur Nutzung beantworten wir öffentlich in den [Discussions](https://github.com/Speicherstadt/haben/discussions),
im [Discord](https://discord.gg/CT2GQytSYH) oder in den [Issues](https://github.com/Speicherstadt/haben/issues), damit alle
etwas davon haben. Größere Einführungen übernehmen wir auch als bezahltes Projekt.
