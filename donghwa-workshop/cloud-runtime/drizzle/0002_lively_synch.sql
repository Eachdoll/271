CREATE TABLE `auth_throttle` (
	`bucket` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`bucket`, `window_start`),
	CONSTRAINT "auth_throttle_bucket_digest" CHECK(length("auth_throttle"."bucket") = 64),
	CONSTRAINT "auth_throttle_count_positive" CHECK("auth_throttle"."count" >= 1)
);
--> statement-breakpoint
CREATE TABLE `family_accounts` (
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
--> statement-breakpoint
CREATE UNIQUE INDEX `family_accounts_owner_id_unique` ON `family_accounts` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `family_accounts_username_unique` ON `family_accounts` (`username`);--> statement-breakpoint
CREATE TABLE `family_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`idle_expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	CONSTRAINT "family_session_digest" CHECK(length("family_sessions"."token_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `family_sessions_account_idx` ON `family_sessions` (`account_id`);