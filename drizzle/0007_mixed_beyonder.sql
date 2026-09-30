CREATE TABLE `provider_health` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(64) NOT NULL,
	`ok` int NOT NULL DEFAULT 0,
	`latencyMs` int NOT NULL DEFAULT 0,
	`failureCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`lastSuccessAt` timestamp,
	`lastFailureAt` timestamp,
	`lastNotifiedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `provider_health_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_health_provider_unique` UNIQUE(`provider`)
);
--> statement-breakpoint
ALTER TABLE `radar_opportunities` ADD `atr` decimal(12,4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_opportunities` ADD `gapPercent` decimal(12,4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_opportunities` ADD `gapBlocked` int DEFAULT 0 NOT NULL;
