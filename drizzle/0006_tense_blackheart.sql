ALTER TABLE `radar_opportunities` MODIFY COLUMN `provider` varchar(96) NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_opportunities` ADD `sourceCandleTime` timestamp;--> statement-breakpoint
ALTER TABLE `radar_opportunities` ADD `confirmationClose` decimal(12,4);--> statement-breakpoint
ALTER TABLE `radar_opportunities` ADD `zoneStatus` enum('confirmed','unconfirmed') DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_opportunities` ADD `breakType` enum('none','wick_break','confirmed_close_break') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_opportunities` ADD `demandAlertLatched` int DEFAULT 0 NOT NULL;