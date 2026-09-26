ALTER TABLE `alert_rules` ADD `closePrice` decimal(12,4);--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `finalPnlPercent` decimal(12,4);--> statement-breakpoint
ALTER TABLE `alert_rules` ADD `closedAt` timestamp;