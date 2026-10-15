CREATE TABLE `cloud_assets` (
	`owner_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `asset_id`),
	CONSTRAINT "asset_kind" CHECK("cloud_assets"."kind" IN ('image','audio')),
	CONSTRAINT "asset_size" CHECK("cloud_assets"."byte_size" > 0 AND "cloud_assets"."byte_size" <= 41943040),
	CONSTRAINT "asset_digest" CHECK(length("cloud_assets"."sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE `cloud_libraries` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`manifest_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "library_revision_positive" CHECK("cloud_libraries"."revision" >= 1)
);
