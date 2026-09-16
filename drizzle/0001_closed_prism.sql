CREATE TABLE "command_receipts" (
	"room_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"response" jsonb NOT NULL,
	CONSTRAINT "command_receipts_room_id_actor_id_command_id_pk" PRIMARY KEY("room_id","actor_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "match_commands" (
	"match_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"actor_id" uuid,
	"command_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "match_commands_match_id_version_pk" PRIMARY KEY("match_id","version")
);
--> statement-breakpoint
CREATE TABLE "match_snapshots" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"status" text NOT NULL,
	"preset" text NOT NULL,
	"seed" bigint NOT NULL,
	"version" integer NOT NULL,
	"card_catalog_version" text NOT NULL,
	"balance_version" text NOT NULL,
	"deadline" bigint NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"seat" integer NOT NULL,
	"token_hash" text NOT NULL,
	"joined_at" bigint NOT NULL,
	"disconnected_at" bigint,
	"rematch_vote" uuid,
	CONSTRAINT "players_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"preset" text NOT NULL,
	"status" text NOT NULL,
	"host_player_id" uuid,
	"match_id" uuid,
	"created_at" bigint NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_commands" ADD CONSTRAINT "match_commands_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_snapshots" ADD CONSTRAINT "match_snapshots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_command_id" ON "match_commands" USING btree ("match_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_room_seat" ON "players" USING btree ("room_id","seat");