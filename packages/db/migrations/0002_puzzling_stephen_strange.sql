CREATE TABLE `outbox` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`recorded_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_event_id_unique` ON `outbox` (`event_id`);--> statement-breakpoint
CREATE INDEX `outbox_pending` ON `outbox` (`published_at`,`sequence`);