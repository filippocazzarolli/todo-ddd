CREATE TABLE `todos` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`description` text,
	`important` integer DEFAULT false NOT NULL,
	`expiration` text,
	`tags` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`subscription` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);