ALTER TABLE pms_reservation_items DROP CONSTRAINT pms_reservation_items_no_overlap;
--> statement-breakpoint
ALTER TABLE pms_reservation_items ADD CONSTRAINT pms_reservation_items_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(arrival_date, departure_date, '[)') WITH &&,
    reservation_id WITH <>
  ) WHERE (canceled_at IS NULL);
