ALTER TABLE `alert_history` ADD `resistanceJson` text;--> statement-breakpoint
ALTER TABLE `alert_history` ADD `resistanceWarning` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alert_history` ADD `break5` varchar(64);--> statement-breakpoint
ALTER TABLE `alert_history` ADD `break10` varchar(64);--> statement-breakpoint
ALTER TABLE `alert_history` ADD `break20` varchar(64);