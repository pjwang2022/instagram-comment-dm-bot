ALTER TABLE `automations` ADD `platform` text DEFAULT 'instagram' NOT NULL;--> statement-breakpoint
ALTER TABLE `instagram_accounts` ADD `platform` text DEFAULT 'instagram' NOT NULL;--> statement-breakpoint
ALTER TABLE `instagram_media` ADD `platform` text DEFAULT 'instagram' NOT NULL;