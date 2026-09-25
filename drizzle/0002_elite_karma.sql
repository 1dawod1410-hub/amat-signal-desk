CREATE TABLE `permanent_watchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`source` varchar(32) NOT NULL DEFAULT 'radar',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `permanent_watchlist_id` PRIMARY KEY(`id`),
	CONSTRAINT `permanent_watchlist_symbol_unique` UNIQUE(`symbol`)
);
--> statement-breakpoint
CREATE TABLE `radar_opportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`price` decimal(12,4) NOT NULL,
	`changePercent` decimal(12,4) NOT NULL,
	`volume` decimal(20,0) NOT NULL,
	`score` decimal(12,4) NOT NULL,
	`demandLow` decimal(12,4) NOT NULL,
	`demandHigh` decimal(12,4) NOT NULL,
	`stopLoss` decimal(12,4) NOT NULL,
	`target1` decimal(12,4) NOT NULL,
	`target2` decimal(12,4) NOT NULL,
	`target3` decimal(12,4) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`scannedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `radar_opportunities_id` PRIMARY KEY(`id`),
	CONSTRAINT `radar_opportunities_symbol_unique` UNIQUE(`symbol`)
);
--> statement-breakpoint
CREATE TABLE `radar_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`enabled` int NOT NULL DEFAULT 1,
	`lastScanAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `radar_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `alert_history` MODIFY COLUMN `alertType` enum('demand','target1','target2','target3','stopLoss') NOT NULL;--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `stopLoss` decimal(12,4);--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `target3Low` decimal(12,4);--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `target3High` decimal(12,4);--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `trackTrade` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `entryPrice` decimal(12,4);--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `trackedAt` timestamp;--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `lastPrice` decimal(12,4);--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `lastPnlPercent` decimal(12,4);