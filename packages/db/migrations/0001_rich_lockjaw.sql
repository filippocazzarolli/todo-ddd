ALTER TABLE `todos` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `version` integer DEFAULT 1 NOT NULL;