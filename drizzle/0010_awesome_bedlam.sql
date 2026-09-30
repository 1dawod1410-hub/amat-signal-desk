CREATE TABLE `market_safety_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gapThresholdPercent` decimal(8,4) NOT NULL DEFAULT '4',
	`newsWindowHours` int NOT NULL DEFAULT 24,
	`sessionGuardEnabled` int NOT NULL DEFAULT 1,
	`newsFailClosed` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `market_safety_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_failure_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(64) NOT NULL,
	`ok` int NOT NULL,
	`latencyMs` int NOT NULL,
	`error` text,
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `provider_failure_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `provider_health` ADD `circuitOpenUntil` timestamp;