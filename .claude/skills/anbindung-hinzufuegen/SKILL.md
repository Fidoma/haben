---
name: "anbindung-hinzufuegen"
description: "Eine neue Bank oder einen neuen Zahlungsdienstleister an Haben anbinden: Abruf über die API mit Adapter (wie Stripe, PayPal, Mollie) oder Import einer Datei (CSV, Export des Anbieters). Vor der ersten Zeile Code laden, auch für ein Issue dazu."
---

# Anbindung hinzufügen

Wie Umsätze nach Haben kommen, steht für Menschen in `docs/bank.md` und `docs/bank-zahlungsdienstleister.md`, die Module in `docs/architektur.md`. Hier steht, welchen Weg eine neue Anbindung nimmt und was sie in jedem Fall braucht.

## 1. Weg wählen

| Was kommt neu dazu | Weg | Weiter in |
| --- | --- | --- |
| Zahlungsdienstleister mit API und Zugang aus Schlüssel oder Client-ID und Secret (Stripe, PayPal, Mollie, SumUp …) | Adapter in `modules/zahlungsdienstleister/` | [references/zahlungsdienstleister-api.md](references/zahlungsdienstleister-api.md) |
| Export eines Zahlungsdienstleisters als Datei (Saldenverlauf, Abrechnung) | Parser in `packages/import/src/psp.ts` o. Ä. | [references/datei-format.md](references/datei-format.md) |
| CSV oder anderes Dateiformat einer Bank | Parser in `packages/import/src/` | [references/datei-format.md](references/datei-format.md) |
| Anbieter liefert fertige Abrechnungen statt Bewegungen (App-Stores, Amazon #1947) | eigenes Modul nach Vorbild `modules/stores/`: ein Zugang, das Konto aus dem Bericht (etwa Marktplatz), Speichern über den Parser der Datei mit `storeStatement`; kein Adapter, `psp_connections` gilt nur für Bewegungen | – |
| Bank mit PSD2 oder FinTS | nichts Neues: Enable Banking und FinTS decken sie ab (`docs/bank.md`, „Automatischer Abruf“). Nur eine Eigenheit der Bank kommt in `packages/import/src/enablebanking/` bzw. `modules/bank/fints*.ts`. | – |
| Dienst eines Dritten, der selbst abholt und liefert | REST-Import nach dem Importvertrag (`docs/api.md`, „Bankimporte“): keine Änderung an Haben | – |
| Anmeldung mit OAuth (Weiterleitung zum Anbieter, wie Etsy) | Der Vertrag `PspAdapter` kennt nur Zugänge, die der Nutzer einträgt. Erst mit dem Maintainer klären, ob der Vertrag wächst oder ein eigenes Modul wie `etsy/` entsteht. | – |

Gibt es API und Datei (wie bei Stripe), sind das getrennte Pull Requests, die Datei zuerst: Der Abruf liest über ihren Parser. Passt keiner der Wege, erst ein Issue (Skill `issue-schreiben`).

## 2. Quellen, bevor Code entsteht

- **Doku des Anbieters** lesen und im Code nennen: Endpunkte, Felder, Paginierung, Zeitzone der Zeitpunkte, Grenzen für Anfragen und Zeitraum, Testmodus. Wo die Doku nicht erreichbar ist (Host gesperrt, Anmeldung nötig), das im Issue festhalten, nicht raten.
- **Echte Antworten oder Dateien** sind die Grundlage, nicht die Beschreibung allein: aus einem Testkonto oder maskiert von der Person, die das Issue gestellt hat. Unter `packages/import/test-fixtures/<anbieter>/` ablegen, mit README, was echt und was ersetzt ist (Vorbild `test-fixtures/stripe/README.md`). Nie echte Namen, IBANs, Kennungen oder Schlüssel.
- **Zugänge zum Testen** kommen nie in den Chat und nie ins Repository. In einer Cloud-Session über `request_credential` für den Host; der Host muss im Netz der Umgebung freigegeben sein.
- Beträge in ganze Cent aus dem Text lesen: `parseDotAmount` und `parseGermanAmount` (`packages/import/src/text.ts`), bei einer API Dezimaltext mit `apiBetragInCent` (ebenda), das Stellen nach dem Cent ablehnt, außer Nullen. Kommt der Betrag in der kleinsten Einheit (Stripe), als Ganzzahl prüfen. Nie `Math.round(x * 100)` auf einer Zahl aus JSON; Fremdwährung ablehnen oder als übersprungen melden.

## 3. Gemeinsame Regeln

- **Eine Quelle je Konto** (#306): Abruf, Datei und REST-Import desselben Kontos schließen sich aus; `modules/bank/abruf-bindung.ts` kennt jede Anbindung in Haben. Ein Abruf in Haben steht in `INTERNAL_PROVIDERS` (`packages/import/src/importvertrag/anbieter.ts`), sonst nimmt der REST-Import Lieferungen in seine Quelle an. `modules/bank/interne-anbieter.test.ts` prüft das.
- **Derselbe Umsatz aus Datei und Abruf** ergibt denselben Dubletten-Hash (Tag, Betrag, Zweck): Die Lesart des Abrufs baut auf dem Parser der Datei auf, wo es beide gibt (`stripeStatement` → `parseStripe`). Ein Test „Datei zuerst, dann Abruf“ hält das fest (`stripe-csv-zuerst.test.ts`).
- **Gebühr und Hauptbetrag** sind getrennte Umsätze; Auszahlungen auf die Bank erkennt `PAYMENT_PROVIDERS` in `packages/core/src/matching-direkt.ts` am Namen der Gegenpartei.
- **Was Haben nicht einordnet**, bleibt sichtbar (`unsupported` im Importvertrag, Warnung beim Import), statt geraten zu werden.
- Fremdwährung, Teilerstattung, Rückbuchung, Streitfall, Auszahlung, Gebühr: je ein Fall in den Fixtures und in den Tests.

## 4. Tests

- **Vitest ohne Datenbank** in `packages/import`: Parser bzw. Client und Lieferung gegen die Fixtures, Erkennung des Formats, Beträge an der Grenze.
- **Postgres** im Modul: Speichern, Dubletten, Quellenbindung, Datei und Abruf nacheinander, SKR03 und SKR04 dort, wo gebucht wird.
- **Playwright**, wenn sich etwas in der Oberfläche ändert (beim Adapter: ein Durchlauf mit nachgebauter API wie `e2e/stripe-abruf.spec.ts`).
- Prüfungen nach Skill `checks`.

## 5. Doku und Pull Request

- Abschnitt des Anbieters in `docs/bank-zahlungsdienstleister.md` (Zugang, was kommt, wie gespeichert, Grenzen) bzw. Zeile in der Formattabelle von `docs/bank.md`.
- Aufzählungen der Anbieter und Formate nachziehen: `README.md`, `docs/index.md`, `docs/ueberblick.md`, `docs/architektur.md` (Zeile `packages/import`), bei einem Abruf `docs/einrichtung-echtbetrieb.md` (Zugangsdaten), `docs/auswertungen.md` (`bank/quellen.csv`) und `docs/installation-anbindungen.md` (Host, den der Server erreichen muss, wie „PayPal-Abruf“); eine neue Umgebungsvariable in `docs/installation-konfiguration.md`.
- Ändert sich die Oberfläche: Bilder vorher und nachher (Skill `pr-screenshots`), mit nachgebauter API und Testdaten.
- Pull Request nach Skill `beitrag`; nennt die Quellen und welche Fälle an echten Daten geprüft sind und welche nur nach Doku.
