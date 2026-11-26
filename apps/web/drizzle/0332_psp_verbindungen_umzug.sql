-- Gemeinsame Zugänge der Zahlungsdienstleister (#1729): jede Änderung ins Protokoll, der Zugang (ciphertext) bleibt
-- draußen. Wie bei den bisherigen Tabellen der Zugänge gegen TRUNCATE gesperrt.

CREATE TRIGGER psp_connections_audit AFTER INSERT OR UPDATE OR DELETE ON psp_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER psp_connections_no_truncate BEFORE TRUNCATE ON psp_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
-- Die Zugänge von Stripe und PayPal ziehen um, mit Abrufstand, Rhythmus und Fehler. Der Zugang bleibt verschlüsselt, wie er
-- ist (Stripe: der Schlüssel als Text, PayPal: JSON mit Client-ID und Secret); die Adapter lesen beide Formen. Das Konto ist
-- das, in das der Abruf bisher schrieb: das älteste Konto der Art Zahlungsdienstleister mit diesem Anbieter, sonst leer.
INSERT INTO psp_connections (provider, name, bank_account_id, account_id, key_hint, config, ciphertext, fetch_from, abruf_start, rhythmus, last_sync_at, last_error, updated_at)
SELECT 'stripe', 'Stripe',
  (SELECT b.id FROM bank_accounts b WHERE b.purpose = 'zahlungsdienstleister' AND b.provider = 'stripe' ORDER BY b.created_at LIMIT 1),
  s.account_id, s.key_hint, '{}'::jsonb, s.ciphertext, s.fetch_from, s.abruf_start, s.rhythmus, s.last_sync_at, s.last_error, s.updated_at
FROM stripe_connections s;
--> statement-breakpoint
INSERT INTO psp_connections (provider, name, bank_account_id, account_id, key_hint, config, ciphertext, fetch_from, abruf_start, rhythmus, last_sync_at, last_error, updated_at)
SELECT 'paypal', 'PayPal',
  (SELECT b.id FROM bank_accounts b WHERE b.purpose = 'zahlungsdienstleister' AND b.provider = 'paypal' ORDER BY b.created_at LIMIT 1),
  p.account_id, p.key_hint, jsonb_build_object('sandbox', p.sandbox, 'zeitzone', p.zeitzone), p.ciphertext, p.fetch_from, p.abruf_start, p.rhythmus, p.last_sync_at, p.last_error, p.updated_at
FROM paypal_connections p;
