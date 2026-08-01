CREATE TABLE `send_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`window_start` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_counters_scope_window_unique` ON `send_counters` (`scope_key`,`window_start`);--> statement-breakpoint
ALTER TABLE `api_attempts` ADD `failure_reason` text;--> statement-breakpoint
DELETE FROM `login_rate_limits` WHERE `id` NOT IN (SELECT `id` FROM `login_rate_limits` GROUP BY `ip_address`, `window_start` HAVING `attempt_count` = MAX(`attempt_count`));--> statement-breakpoint
CREATE UNIQUE INDEX `login_rate_limits_ip_window_unique` ON `login_rate_limits` (`ip_address`,`window_start`);