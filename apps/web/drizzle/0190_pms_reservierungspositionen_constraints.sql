INSERT INTO pms_reservation_items (
  reservation_id, position, room_id, arrival_date, departure_date, description, canceled_at, created_at, updated_at
)
SELECT id, 1, room_id, arrival_date, departure_date, note, canceled_at, created_at, updated_at
FROM pms_reservations;
--> statement-breakpoint
ALTER TABLE pms_reservation_items ADD CONSTRAINT pms_reservation_items_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(arrival_date, departure_date, '[)') WITH &&
  ) WHERE (canceled_at IS NULL);
--> statement-breakpoint
CREATE TRIGGER pms_reservation_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON pms_reservation_items
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
