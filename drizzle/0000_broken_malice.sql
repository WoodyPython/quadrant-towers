CREATE TABLE "application_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
INSERT INTO "application_metadata" ("key", "value") VALUES ('foundation_version', '1');
