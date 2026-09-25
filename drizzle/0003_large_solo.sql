ALTER TABLE `alert_history` MODIFY COLUMN `alertType` enum('demand','target1','target2','target3','stopLoss','trailingStop') NOT NULL;--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `trailingPercent` decimal(8,4) DEFAULT '5';--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `highestPrice` decimal(12,4);--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `target1Hit` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `trailingStopActive` int DEFAULT 0 NOT NULL;