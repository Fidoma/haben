-- Überschneidungen von Zimmerbelegungen auch bei gleichzeitigen Schreibvorgängen verhindern.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE pms_reservations ADD CONSTRAINT pms_reservations_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(arrival_date, departure_date, '[)') WITH &&
  ) WHERE (status = 'confirmed');
--> statement-breakpoint
ALTER TABLE pms_reservation_items ADD CONSTRAINT pms_reservation_items_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(arrival_date, departure_date, '[)') WITH &&,
    reservation_id WITH <>
  ) WHERE (canceled_at IS NULL);
--> statement-breakpoint
-- Änderungen der PMS-Stammdaten und Reservierungen GoBD-konform protokollieren.
CREATE TRIGGER pms_rooms_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_rooms
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER pms_reservations_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_reservations
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER pms_reservation_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_reservation_items
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER pms_tourism_reports_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_tourism_reports
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER pms_tourism_country_values_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_tourism_country_values
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER pms_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_settings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
