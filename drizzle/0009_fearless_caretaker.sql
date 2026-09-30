ALTER TABLE `provider_health` ADD `totalChecks` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_health` ADD `successCount` int DEFAULT 0 NOT NULL;