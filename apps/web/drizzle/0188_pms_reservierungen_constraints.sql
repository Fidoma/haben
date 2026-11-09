CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE pms_reservations ADD CONSTRAINT pms_reservations_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(arrival_date, departure_date, '[)') WITH &&
  ) WHERE (status = 'confirmed');
--> statement-breakpoint
CREATE TRIGGER pms_reservations_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_reservations
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
