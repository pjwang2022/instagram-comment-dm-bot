PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automations` (
	`id` text PRIMARY KEY NOT NULL,
	`instagram_media_id` text,
	`apply_scope` text DEFAULT 'media' NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`match_type` text DEFAULT 'contains_any' NOT NULL,
	`public_reply_enabled` integer DEFAULT 1 NOT NULL,
	`private_reply_enabled` integer DEFAULT 1 NOT NULL,
	`opening_dm` text,
	`button_text` text,
	`button_url` text,
	`daily_limit` integer,
	`exclude_own_comments` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`instagram_media_id`) REFERENCES `instagram_media`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_automations`("id", "instagram_media_id", "apply_scope", "name", "status", "match_type", "public_reply_enabled", "private_reply_enabled", "opening_dm", "button_text", "button_url", "daily_limit", "exclude_own_comments", "created_at", "updated_at") SELECT "id", "instagram_media_id", 'media', "name", "status", "match_type", "public_reply_enabled", "private_reply_enabled", "opening_dm", "button_text", "button_url", "daily_limit", "exclude_own_comments", "created_at", "updated_at" FROM `automations`;--> statement-breakpoint
DROP TABLE `automations`;--> statement-breakpoint
ALTER TABLE `__new_automations` RENAME TO `automations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `automations_instagram_media_id_unique` ON `automations` (`instagram_media_id`);