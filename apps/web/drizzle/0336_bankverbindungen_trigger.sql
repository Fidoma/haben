-- Weitere Zahlungskonten (#1887): Änderungen ins Audit-Log, TRUNCATE gesperrt wie bei den übrigen Stammdaten. Löschen ist
-- erlaubt: Festgeschriebene Belege tragen eine Kopie der Kontodaten und keinen Verweis, Entwürfe und Kontakte fallen über
-- ON DELETE SET NULL auf das Standardkonto zurück.
CREATE TRIGGER bankverbindungen_audit AFTER INSERT OR UPDATE OR DELETE ON bankverbindungen
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER bankverbindungen_no_truncate BEFORE TRUNCATE ON bankverbindungen
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
