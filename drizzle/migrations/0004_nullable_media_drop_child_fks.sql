-- automations.instagram_media_id 改為可空（next_post/account_default 自動化需要）。
-- D1 無法在有子表 FK 參照時重建父表（PRAGMA foreign_keys=OFF/defer 皆無效），
-- 因此連鎖移除 child→parent 的 FK：automations←{keywords,variants,runs}、runs←api_attempts。
-- 這些關係無刪除路徑（app 只建不刪自動化），完整性由應用層維護。
-- 順序：子表先重建（去 FK）→ 父表最後，確保每次 DROP 都不被外部參照阻擋。
PRAGMA defer_foreign_keys=on;
--> statement-breakpoint
CREATE TABLE `__new_api_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_run_id` text NOT NULL,
	`action_type` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`http_status` integer,
	`meta_error_code` text,
	`meta_error_subcode` text,
	`meta_error_message` text,
	`meta_trace_id` text,
	`request_payload_redacted` text,
	`response_payload_redacted` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
INSERT INTO `__new_api_attempts` SELECT `id`,`automation_run_id`,`action_type`,`attempt_number`,`http_status`,`meta_error_code`,`meta_error_subcode`,`meta_error_message`,`meta_trace_id`,`request_payload_redacted`,`response_payload_redacted`,`started_at`,`completed_at` FROM `api_attempts`;
--> statement-breakpoint
DROP TABLE `api_attempts`;
--> statement-breakpoint
ALTER TABLE `__new_api_attempts` RENAME TO `api_attempts`;
--> statement-breakpoint
CREATE INDEX `idx_attempts_run` ON `api_attempts` (`automation_run_id`);
--> statement-breakpoint
CREATE TABLE `__new_automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`webhook_event_id` text,
	`instagram_comment_id` text NOT NULL,
	`instagram_media_id` text NOT NULL,
	`commenter_id` text,
	`commenter_username` text,
	`original_comment_text` text,
	`normalized_comment_text` text,
	`matched_keyword` text,
	`status` text NOT NULL,
	`public_reply_message` text,
	`public_reply_status` text,
	`private_reply_status` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`webhook_event_id`) REFERENCES `webhook_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_automation_runs` SELECT `id`,`automation_id`,`webhook_event_id`,`instagram_comment_id`,`instagram_media_id`,`commenter_id`,`commenter_username`,`original_comment_text`,`normalized_comment_text`,`matched_keyword`,`status`,`public_reply_message`,`public_reply_status`,`private_reply_status`,`retry_count`,`started_at`,`completed_at`,`created_at`,`updated_at` FROM `automation_runs`;
--> statement-breakpoint
DROP TABLE `automation_runs`;
--> statement-breakpoint
ALTER TABLE `__new_automation_runs` RENAME TO `automation_runs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_automation_id_instagram_comment_id_unique` ON `automation_runs` (`automation_id`,`instagram_comment_id`);
--> statement-breakpoint
CREATE INDEX `idx_runs_status` ON `automation_runs` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_runs_created` ON `automation_runs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_runs_media` ON `automation_runs` (`instagram_media_id`);
--> statement-breakpoint
CREATE TABLE `__new_automation_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`keyword` text NOT NULL,
	`normalized_keyword` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_automation_keywords` SELECT `id`,`automation_id`,`keyword`,`normalized_keyword`,`created_at` FROM `automation_keywords`;
--> statement-breakpoint
DROP TABLE `automation_keywords`;
--> statement-breakpoint
ALTER TABLE `__new_automation_keywords` RENAME TO `automation_keywords`;
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_keywords_automation_id_normalized_keyword_unique` ON `automation_keywords` (`automation_id`,`normalized_keyword`);
--> statement-breakpoint
CREATE INDEX `idx_keywords_automation` ON `automation_keywords` (`automation_id`);
--> statement-breakpoint
CREATE TABLE `__new_public_reply_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`message` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_public_reply_variants` SELECT `id`,`automation_id`,`message`,`enabled`,`created_at`,`updated_at` FROM `public_reply_variants`;
--> statement-breakpoint
DROP TABLE `public_reply_variants`;
--> statement-breakpoint
ALTER TABLE `__new_public_reply_variants` RENAME TO `public_reply_variants`;
--> statement-breakpoint
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
INSERT INTO `__new_automations` (`id`,`instagram_media_id`,`apply_scope`,`name`,`status`,`match_type`,`public_reply_enabled`,`private_reply_enabled`,`opening_dm`,`button_text`,`button_url`,`daily_limit`,`exclude_own_comments`,`created_at`,`updated_at`) SELECT `id`,`instagram_media_id`,`apply_scope`,`name`,`status`,`match_type`,`public_reply_enabled`,`private_reply_enabled`,`opening_dm`,`button_text`,`button_url`,`daily_limit`,`exclude_own_comments`,`created_at`,`updated_at` FROM `automations`;
--> statement-breakpoint
DROP TABLE `automations`;
--> statement-breakpoint
ALTER TABLE `__new_automations` RENAME TO `automations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `automations_instagram_media_id_unique` ON `automations` (`instagram_media_id`);
