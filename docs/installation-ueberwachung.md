---
title: "Überwachung"
description: >-
  Metriken für Prometheus, VictoriaMetrics und andere Systeme: Health, Hintergrundjobs wie Kontoabruf und Belegpostfach,
  ELSTER, Scrape-Konfiguration, Alarmregeln, Grafana-Dashboard.
---

# Überwachung

Ob Haben antwortet, meldet [`/api/health`](installation.md#image). Ob der Kontoabruf oder der Abruf des Belegpostfachs seit Tagen scheitert, zeigen die Metriken.

Mit gesetztem `HABEN_METRICS_TOKEN` ([Konfiguration](installation-konfiguration.md)) liefert `GET /api/metrics` Metriken im Textformat von [Prometheus](https://prometheus.io/docs/instrumenting/exposition_formats/). Das Format liest nicht nur Prometheus, sondern auch VictoriaMetrics, Grafana Alloy, der OpenTelemetry Collector und andere Systeme; die Beispiele unten sind für Prometheus. Ohne die Variable antwortet der Endpunkt mit `404`, ohne oder mit falschem Token mit `401`. Sitzungen und API-Tokens aus der Oberfläche gelten hier nicht, der Scraper bekommt so keinen Zugriff auf die Buchhaltung. Die Metriken zeigen nur, ob Haben läuft: keine Beträge, Namen, IBANs oder IDs.

| Metrik | Inhalt |
| --- | --- |
| `haben_info{version,commit}` | immer `1`, Version und Commit des Images |
| `haben_up` | `1`, wenn `/api/health` `pass` meldet, sonst `0` |
| `haben_job_last_run_timestamp_seconds{task}` | letzter Lauf eines Hintergrundjobs |
| `haben_job_last_success_timestamp_seconds{task}` | letzter erfolgreicher Lauf eines Hintergrundjobs |
| `haben_job_failures_total{task}` | gescheiterte Läufe, auch solche, die nur Fehler gemeldet haben, etwa eine abgelaufene Bankverbindung |
| `haben_elster_submissions_total{kind,result}` | Antworten von ERiC auf `validate` (Prüfen), `test` und `send`, nach `ok` oder `error` |

`task` ist einer von `recurring_invoices`, `archive_delivery`, `recurring_receipts`, `bank_duplicate_check`, `bank_sync`, `fints_sync`, `store_reports`, `etsy_sync`, `psp_sync` (Stripe, PayPal und weitere Zahlungsdienstleister mit Abruf), `elster_mailbox`, `exchange_rates`, `base_rate`, `receipt_inbox`, `vat_id_check`, `deadline_mails`, `file_check` und `audit_checksum_mail`. Das Label heißt nicht `job`, weil Prometheus `job` schon für das Scrape-Ziel setzt. Jobs und ELSTER zählt Haben seit dem Start des Servers; nach einem Neustart fangen sie bei null an, die Zeitpunkte fehlen bis zum ersten Lauf (30 Sekunden nach dem Start, danach stündlich), mit `HABEN_SCHEDULER=off` ganz. Ein Job, der nichts zu tun hat, etwa ohne eingerichtetes Belegpostfach, gilt als erfolgreich. Das gilt auch für die Stunden, in denen ein Job auf seinen nächsten Termin wartet: Kontoabruf und ELSTER-Postfach versuchen es nach einem Fehler erst nach 20 Stunden wieder (eine abgelaufene Bankverbindung gar nicht mehr), die Bestätigung der USt-IdNrn. am nächsten Tag. Solche Fehler zeigt nur `haben_job_failures_total`.

In Kubernetes legt das Helm-Chart dafür einen `ServiceMonitor` an, siehe [Kubernetes › Metriken](kubernetes.md#metriken). Ohne Operator:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: haben
    scheme: https
    metrics_path: /api/metrics
    authorization:
      credentials_file: /etc/prometheus/haben-metrics-token
    static_configs:
      - targets: ["haben.example.de"]
```

Alarmregeln stehen in [`deploy/helm/files/prometheus-regeln.yml`](https://github.com/Speicherstadt/haben/blob/main/deploy/helm/files/prometheus-regeln.yml), zum Laden mit `rule_files` in `prometheus.yml`:

- `HabenNichtBereit`: `haben_up` seit 5 Minuten `0`.
- `HabenJobOhneErfolg`: ein Job seit über 24 Stunden ohne Erfolg, etwa weil er bei jedem Lauf wirft, auch wenn er seit einem Neustart nie gelang.
- `HabenJobGescheitert`: ein gescheiterter Lauf in den letzten 24 Stunden, auch von Jobs, die danach bis zu ihrem nächsten Termin als erfolgreich gelten. Eine abgelaufene Bankverbindung meldet nur diese Regel, und nur einen Tag lang.

Ob Prometheus Haben überhaupt erreicht, meldet sein eigenes `up` (in kube-prometheus-stack der Alarm `TargetDown`); dafür gibt es keine eigene Regel. Die Regeln brauchen einen Scrape-Abstand von höchstens 2 Minuten, weil Prometheus einen Wert nur 5 Minuten lang sieht.

In Kubernetes legt das Helm-Chart daraus eine `PrometheusRule` an, siehe [Kubernetes › Metriken](kubernetes.md#metriken).

Ein Grafana-Dashboard liegt in [`deploy/grafana/haben.json`](https://github.com/Speicherstadt/haben/blob/main/deploy/grafana/haben.json): unter **Dashboards › New › Import** hochladen, Datenquelle und Instanz wählt man oben im Dashboard. Es zeigt, ob Haben bereit ist, die Version, je Job die Zeit seit dem letzten Erfolg und die Fehler der letzten 24 Stunden sowie die Antworten von ERiC.
