-- Deployment migration only. Request handlers never execute DDL.
-- Large library JSON and media live in R2; D1 holds atomic revisions and pointers.
-- This file mirrors cloud-runtime/drizzle/*.sql (the source of truth) with
-- IF NOT EXISTS; tests/family-auth-server.test.mjs checks that both produce
-- identical sqlite_master entries. Add new tables with a Drizzle migration first.

-- 0000_steep_zodiak
CREATE TABLE IF NOT EXISTS `cloud_assets` (
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
CREATE TABLE IF NOT EXISTS `cloud_libraries` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`manifest_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "library_revision_positive" CHECK("cloud_libraries"."revision" >= 1)
);

-- 0001_white_reptil
CREATE TABLE IF NOT EXISTS `auto_job_controls` (
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`stop_nonce` text NOT NULL,
	`requested_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `job_id`)
);

-- 0002_lively_synch
CREATE TABLE IF NOT EXISTS `auth_throttle` (
	`bucket` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`bucket`, `window_start`),
	CONSTRAINT "auth_throttle_bucket_digest" CHECK(length("auth_throttle"."bucket") = 64),
	CONSTRAINT "auth_throttle_count_positive" CHECK("auth_throttle"."count" >= 1)
);
CREATE TABLE IF NOT EXISTS `family_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`password_hash` text NOT NULL,
	`recovery_hash` text NOT NULL,
	`password_changed_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "family_owner_prefix" CHECK(substr("family_accounts"."owner_id",1,7) = 'family:'),
	CONSTRAINT "family_username_length" CHECK(length("family_accounts"."username") BETWEEN 4 AND 20),
	CONSTRAINT "family_display_name_length" CHECK(length("family_accounts"."display_name") <= 20),
	CONSTRAINT "family_recovery_digest" CHECK(length("family_accounts"."recovery_hash") = 64)
);
CREATE UNIQUE INDEX IF NOT EXISTS `family_accounts_owner_id_unique` ON `family_accounts` (`owner_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `family_accounts_username_unique` ON `family_accounts` (`username`);
CREATE TABLE IF NOT EXISTS `family_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`idle_expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	CONSTRAINT "family_session_digest" CHECK(length("family_sessions"."token_hash") = 64)
);
CREATE INDEX IF NOT EXISTS `family_sessions_account_idx` ON `family_sessions` (`account_id`);
