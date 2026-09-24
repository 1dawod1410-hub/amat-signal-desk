CREATE TABLE `alert_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`alertType` enum('demand','target1','target2') NOT NULL,
	`price` varchar(32) NOT NULL,
	`rangeLabel` varchar(64) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`delivery` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alert_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`demandLow` decimal(12,4) NOT NULL,
	`demandHigh` decimal(12,4) NOT NULL,
	`target1Low` decimal(12,4) NOT NULL,
	`target1High` decimal(12,4) NOT NULL,
	`target2Low` decimal(12,4) NOT NULL,
	`target2High` decimal(12,4) NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alert_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `alert_rules_symbol_unique` UNIQUE(`symbol`)
);
--> statement-breakpoint
CREATE TABLE `telegram_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chatId` varchar(128) NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
