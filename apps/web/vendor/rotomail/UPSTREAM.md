# RotoMail-Upstream

- Repository: <https://github.com/rotomic/rotomail>
- Commit: `ffecc524e7ededd32f1c30ee3cf65499cd50026b`
- Lizenz: Apache-2.0 (`LICENSE` und `NOTICE` in diesem Ordner)

Der Snapshot enthält die verwendeten Teile aus `app/`, `server/` und `shared/`. RotoMails eigener Serverstart, Anmeldung, Sitzung und OIDC-Anbindung sind bewusst nicht enthalten. Haben passt nur die notwendigen Integrationsstellen an:

- API-Präfix `/api/webmail/v1` statt `/api/v1`
- IMAP-/SMTP-Ziele und Zugangsdaten je Konto statt globaler Umgebungsvariablen
- vorhandene Haben-Sitzung statt RotoMail-Anmeldecookie
- strengere TypeScript-7-Nullprüfungen
- Tailwind ohne globale Preflight-Regeln

Zum Aktualisieren den neuen Upstream-Commit zunächst außerhalb des Arbeitsbaums auschecken, diese Verzeichnisse vergleichen und die Anpassungen einzeln erneut anwenden. Keine RotoMail-Anmeldung oder globalen Serverwerte übernehmen.
