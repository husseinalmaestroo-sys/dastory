-- Phase 2.1: duplicate in-flight AI request suppression (src/lib/ai/usage.ts).
ALTER TABLE `AiUsageLog` ADD COLUMN `inflightKey` VARCHAR(64) NULL;
CREATE INDEX `AiUsageLog_userId_inflightKey_idx` ON `AiUsageLog`(`userId`, `inflightKey`);
