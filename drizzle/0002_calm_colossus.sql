ALTER TABLE "command_receipts" ADD COLUMN "match_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "finished_at" bigint;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "inactive_since" bigint;
--> statement-breakpoint
UPDATE rooms r SET inactive_since = GREATEST(r.created_at,
  COALESCE((SELECT MAX(p.disconnected_at) FROM players p WHERE p.room_id=r.id), r.created_at))
WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.room_id=r.id AND p.disconnected_at IS NULL);
--> statement-breakpoint
UPDATE matches m SET finished_at = COALESCE(
  (SELECT MAX(c.created_at) FROM match_commands c WHERE c.match_id=m.id),
  (SELECT s.created_at FROM match_snapshots s WHERE s.match_id=m.id)) WHERE m.status='finished';
--> statement-breakpoint
UPDATE command_receipts SET match_id = (response->>'matchId')::uuid WHERE response->>'matchId' IS NOT NULL;
