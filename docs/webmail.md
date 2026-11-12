---
title: Web-Mail
description: E-Mail-Konten über IMAP und SMTP direkt in Haben verwenden.
---

# Web-Mail

Das optionale Modul **Externe Dienste › Web-Mail** bindet [RotoMail](https://github.com/rotomic/rotomail) direkt in Haben ein. Es verwendet weder ein iframe noch einen zusätzlichen Container. Nachrichten bleiben auf dem Mailserver; Haben speichert keine E-Mail-Kopien in seiner Datenbank.

## Einrichten

Beim ersten Öffnen fragt der Assistent nach IMAP- und SMTP-Server, Port, Verschlüsselung, Benutzername und Passwort. Eine vorhandene SMTP-Konfiguration von Haben erscheint als Vorschlag, ihr gespeichertes Passwort wird nicht übernommen oder im Browser offengelegt. **Verbindung testen** prüft beide Zugänge, **Speichern und öffnen** prüft erneut und legt das Konto an.

Jeder Haben-Zugang besitzt seine eigenen Webmail-Konten. Die Passwörter liegen gemeinsam AES-256-GCM-verschlüsselt in `webmail_accounts.ciphertext`; Browserantworten und Audit-Log enthalten sie nicht. Frei eingetragene Server dürfen nicht auf Loopback-, Link-Local- oder private Netze zeigen. TLS-Zertifikate werden geprüft.

Die lokale Entwicklungsumgebung setzt `HABEN_WEBMAIL_ALLOW_PRIVATE_HOSTS=true`, damit Test-Mailserver im Docker-Netz erreichbar sind. Für solche lokalen Testserver darf SMTP ohne STARTTLS verwendet werden. Diese Option darf in einer Produktivumgebung nicht gesetzt werden.

## Funktionen und Grenzen

RotoMail stellt Ordner, Nachrichtenliste und -ansicht, Suche, Entwürfe, Antworten, Weiterleiten, Anhänge, Verschieben, Löschen sowie Gelesen- und Markiert-Status bereit. Aktive Anhänge werden nur als Download ausgeliefert. HTML-Nachrichten werden in RotoMails isolierter, bereinigter Nachrichtenansicht dargestellt; externe Inhalte werden nicht ungefragt als Teil der Haben-Seite ausgeführt.

Microsoft Graph aus den allgemeinen E-Mail-Einstellungen ist kein IMAP-Konto und wird daher nicht automatisch übernommen. OAuth für einzelne Webmail-Konten ist in dieser Integration noch nicht eingerichtet; dafür werden providerbezogene delegierte Berechtigungen und eine eigene Token-Erneuerung benötigt.

## Technischer Ursprung

Der Quell-Snapshot liegt unter `apps/web/vendor/rotomail` und nennt in `UPSTREAM.md` den verwendeten Commit. Lizenz und NOTICE des Apache-2.0-Projekts werden mit ausgeliefert. Der Adapter unter `server/modules/webmail` ersetzt ausschließlich RotoMails eigene Anmeldung und globale Serverkonfiguration durch Habens Sitzung und benutzerbezogene, verschlüsselte Konten.
