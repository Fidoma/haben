CREATE TRIGGER pms_tourism_reports_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_tourism_reports
  FOR EACH ROW EXECUTE FUNCTION haben_audit();

CREATE TRIGGER pms_tourism_country_values_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_tourism_country_values
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
