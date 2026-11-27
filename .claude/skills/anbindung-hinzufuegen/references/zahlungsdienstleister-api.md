# Zahlungsdienstleister über die API

Was die gemeinsame Anbindung schon kann, steht in `docs/entwicklung.md`, „Neuer Zahlungsdienstleister“. Ein Anbieter bringt den Client in `packages/import`, einen Adapter und die Einträge in den festen Listen unten.

Vorlagen: Stripe (ein Schlüssel, Fenster in UTC, Schlüssel der Metadaten als `config`) und PayPal (Client-ID und Secret, Sandbox und Zeitzone als `config`, ausstehende Zahlungen über `offenSeit`).

## 1. Client und Lieferung in `packages/import/src/<anbieter>/`

- `client.ts`: HTTP mit `fetch`, Basis-URL als Option (Standard die echte API), alle Seiten selbst holen, Grenzen für Anfragen beachten, Fehler als eigene Klasse mit verständlicher Meldung. Keine SDK des Anbieters als Abhängigkeit ohne Begründung (`docs/entwicklung.md`, Konventionen).
- `statement.ts`: Bewegungen → `ParsedStatement`. Gibt es einen Export als Datei, über dessen Parser (gleiche Zeilen, gleicher Hash).
- `batch.ts`: Bewegungen → Lieferung des Importvertrags (`ImportBatch`, `packages/import/src/importvertrag/types.ts`). Ereigniskennung ist die stabile ID der Bewegung beim Anbieter; Gebühr als Komponente desselben Ereignisses; nicht Unterstütztes in `unsupported`.
- `index.ts` exportiert, `packages/import/src/index.ts` exportiert den Ordner.
- Formate in `StatementFormat` und der Liste daneben (`packages/import/src/types.ts`): `<anbieter>-api`, bei einer Datei auch `<anbieter>-csv`. In `parse.ts` lehnt der Fall `<anbieter>-api` eine Datei ab (wie `stripe-api`).

## 2. Adapter in `apps/web/src/server/modules/zahlungsdienstleister/<anbieter>.ts`

Der Vertrag steht in `adapter.ts` mit Kommentar je Feld. Worauf es ankommt:

- `provider`: Kleinbuchstaben und Ziffern, gleich dem Schlüssel in `PAYMENT_PROVIDERS` und dem `provider` des Kontos.
- `felder`: Was der Nutzer einträgt. Geheimes mit `art: "geheim"` (bleibt beim Bearbeiten leer und behält den Wert), Einstellungen mit `config: true` und `standard`. Einrichtung und Bearbeiten bauen die Felder daraus; an der Oberfläche ist nichts zu ändern.
- `beschreibung` und `link`: Was Haben holt und wo beim Anbieter der Zugang entsteht, mit den nötigen Rechten (nur lesen).
- Zugang als Zod-Schema mit `art`, damit eine spätere zweite Form lesbar bleibt; `zugangLesen` liest jede Form, die je gespeichert wurde.
- `zugangAusEingabe`: Format prüfen, Testschlüssel ablehnen, wenn sie nicht über `config` (Sandbox) gewählt sind; Meldung als `UserError`-Unterklasse `<Anbieter>Error`; betrifft sie die Eingabe, mit `{ felder: ["<name aus felder>"] }` (wie `AM_SCHLUESSEL` in `stripe.ts`). In `pruefen` nur, wenn der Anbieter die Zugangsdaten ablehnt, nicht bei Netzfehlern oder fehlenden Rechten. Einrichtung und Bearbeiten zeigen die Meldung dann an diesem Feld und setzen den Fokus dorthin (`useZugangFehler`). Bei `configSchema` nimmt Haben das Feld aus dem Zod-Pfad (`configLesen`): Schlüssel wie in `felder`, ein `refine` am Feld, nicht am Objekt.
- `pruefen`: eine billige Anfrage, die das Konto beim Anbieter nennt (`accountId`, Quelle der Quellenbindung) und den Zugang prüft.
- `fenster`, `naechsterStart`, `standNachFehler`: Überlappung, damit spät gebuchte Bewegungen nicht fehlen; die Regeln ohne Datenbank in `<anbieter>-regeln.ts` mit eigenem Test (`stripe-regeln.ts`).
- `einstellungFehler`: Grenzen des Anbieters, etwa wie weit der Abruf zurückreicht.
- Client über `set<Anbieter>ClientFactory` austauschbar für Tests, Basis-URL aus `env()` (`<ANBIETER>_API_URL`, nur zum Testen).

Danach in `anbieter.ts` in `ANBIETER` eintragen und `set<Anbieter>ClientFactory` und den Fehler in `index.ts` exportieren.

## 3. Feste Listen, die ein neuer Anbieter braucht

tsc meldet nicht jede davon; alle durchgehen:

| Stelle | Eintrag |
| --- | --- |
| `packages/import/src/importvertrag/anbieter.ts` | `INTERNAL_PROVIDERS` (Test `interne-anbieter.test.ts`) |
| `packages/core/src/matching-direkt.ts` | `PAYMENT_PROVIDERS`: Bezeichnung und Muster der Gegenpartei auf der Bank; daraus kommen der Anbieter des Kontos und sein Name in der Konfliktklärung |
| `packages/import/src/format-namen.ts` | `FORMAT_NAMEN` (tsc): Name der Quelle in Meldungen |
| `modules/bank/quellen.ts` | `ABRUF_NAMEN` (tsc) |
| `routes/_app/-bank-konto-neu.tsx` | Beispiele im Text der Auswahl, wenn der Anbieter bekannt genug ist |
| `server/env.ts`, `docs/installation-konfiguration.md` | `<ANBIETER>_API_URL` |
| `e2e/durchlaeufe.ts`, `playwright.config.ts` | Durchlauf `<anbieter>-abruf` mit Port für die nachgebaute API |

## 4. Tests

Vorbild sind die Tests von Stripe in `modules/zahlungsdienstleister/` und `packages/import/src/stripe/`:

- `packages/import`: Client gegen aufgezeichnete Antworten (Paginierung, Fehler, Grenzen), Lieferung und Auszug gegen die Fixtures, „Datei und API gleichwertig“, wo es eine Datei gibt.
- `<anbieter>.test.ts` mit Postgres über die Client-Factory: Speichern mit Prüfung, falscher und Test-Zugang abgelehnt, Abruf legt Umsätze an, zweiter Abruf keine Dubletten, Fehler des Anbieters landet in `last_error` ohne Geheimnis, Stand nach Fehler.
- `<anbieter>-csv-zuerst.test.ts`, wenn es eine Datei gibt.
- `<anbieter>-regeln.test.ts` für Fenster und nächsten Start.
- `e2e/<anbieter>-abruf.spec.ts`: über „Konto verbinden › Zahlungsdienstleister hinzufügen“ und die Schritte der Einrichtung verbinden, Zugang prüfen, erster Abruf, Umsatz auf der Bankseite, Zeile auf der Seite Verbindungen mit Abruf und `⋯`, axe.

## 5. Oberfläche

Der Dialog **Anbieter wählen** hinter „Konto verbinden ▾“ auf der Bankseite und der Seite Verbindungen (`routes/_app/-bank-verbinden.tsx`) zeigt jeden Anbieter aus `ANBIETER`; die geführte Einrichtung (`routes/_app/bank_.verbinden.$anbieter.tsx`, `-bank-einrichtung.tsx`) baut die Schrittleiste aus `schritte` des Adapters (Standard: Zugang, Name und Zeitraum, erster Abruf) und den Schritt Zugang aus `felder`; „Zugang prüfen“ ruft `zugangPruefen`, Hinweise aus `Pruefung.hinweise` stehen unter der erkannten Kennung. „Bearbeiten …“ im Menü `⋯` der Zeile auf der Seite Verbindungen (`-verbindungen-zeilen.tsx`) und „Verbindung bearbeiten“ im Menü der Karte auf der Bankseite (`bank.tsx`) öffnen einen Dialog mit denselben Feldern (`ZahlungsdienstleisterAbruf.tsx`, `ZahlungsdienstleisterFormular.tsx`). Karte und Zeile zeigen Stand, Status und den Knopf, der ihn löst, für jeden Anbieter gleich (`lib/kontenkarten-zugaenge.ts`, `lib/verbindungen.ts`). Ein Anbieter ändert dort nichts. Braucht er etwas, das `felder` oder `schritte` nicht beschreiben können, etwa eine Anmeldung über Weiterleitung, zuerst den Vertrag in `adapter.ts` erweitern, für alle Anbieter, nicht eine Ausnahme in der Einrichtung. Ohne Adapter steht ein Anbieter im Dialog ausgegraut; seinen Grund nennt `ohneAdapter` in `-bank-verbinden.tsx`. Gestaltung nach `DESIGN.md`.
