# Neues Dateiformat

Die Schritte für ein Bankformat stehen in `docs/entwicklung.md`, „Neues Bankformat“; hier nur, was ein Agent darüber hinaus prüft. Vorbild für eine Bank: #698 (C24), für einen Zahlungsdienstleister: `parseStripe` in `packages/import/src/psp.ts`.

## Vor dem Parser

- Reicht die Spaltenzuordnung (`docs/bank-spaltenzuordnung.md`)? Ein eigener Parser lohnt sich nur für verbreitete Banken oder für das, was eine Zuordnung nicht kann (eigene IBAN oder Saldo aus dem Kopf, Referenzen aus dem Buchungstext, Gebühren getrennt).
- Aufbau an mehreren echten Dateien ermitteln (verschiedene Konten, Monate, Buchungsarten); die Fixture ist erfunden und bildet den Aufbau nach.
- Kodierung, Trennzeichen, Dezimalformat, Datumsformat, Reihenfolge der Zeilen, kürzere Zeilen als die Kopfzeile, Fremdwährung.

## Erkennung

- Die ganze Erkennungstabelle in `parse.test.ts` muss weiter stimmen: ein neues Format darf kein bestehendes übernehmen.
- Die Meldung „wurde nicht erkannt“ in `parse.ts` zählt die unterstützten Formate auf; dort ergänzen.

## Was das Format in Haben noch braucht

| Stelle | Eintrag |
| --- | --- |
| `packages/import/src/types.ts` | `StatementFormat` und die Liste daneben |
| `packages/import/src/format-namen.ts` | `FORMAT_NAMEN` (gleicher Name = gleiche Quelle beim Wechsel) |
| `packages/core/src/matching-direkt.ts` | `PAYMENT_PROVIDERS`, bei einem neuen Zahlungsdienstleister |

## Zahlungsdienstleister als Datei

- Der Export ist ein Saldenverlauf des Guthabens beim Anbieter, kein Kontoauszug einer Bank: Hauptbetrag und Gebühr getrennt, Auszahlung mit dem Anbieter als Gegenpartei, Referenz je Zeile (Kennung der Bewegung).
- Gibt es auch eine API, liest später der Abruf über diesen Parser ([references/zahlungsdienstleister-api.md](zahlungsdienstleister-api.md)); Spalten deshalb so benennen, wie die API sie liefert, wo das geht.
