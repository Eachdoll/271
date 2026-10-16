CREATE TABLE `auto_job_controls` (
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`stop_nonce` text NOT NULL,
	`requested_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `job_id`)
);
