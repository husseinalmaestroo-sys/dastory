-- Phase 2 AI boundary.
--
-- 1. AiUsageLog gains the real usage ailegal_hussein now reports per call
--    (embedding tokens, model-call count, estimated cost in micro-USD, the
--    engine's request id, the answer's grounding level). Existing rows keep
--    0/NULL — they predate the engine reporting usage.
-- 2. AiConversation / AiMessage: server-side assistant memory, scoped by
--    office + user + conversation. The assistant no longer accepts history
--    from the browser (forged "assistant" turns were forwarded verbatim).
--
-- Additive only; take a backup first (deploy/deploy.sh does this automatically).

-- AlterTable
ALTER TABLE `AiUsageLog` ADD COLUMN `costMicroUsd` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `embeddingTokens` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `engineRequestId` VARCHAR(191) NULL,
    ADD COLUMN `groundingLevel` VARCHAR(191) NULL,
    ADD COLUMN `llmCalls` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `AiConversation` (
    `id` VARCHAR(191) NOT NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AiConversation_officeId_userId_updatedAt_idx`(`officeId`, `userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `mode` VARCHAR(191) NULL,
    `groundingLevel` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AiMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AiConversation` ADD CONSTRAINT `AiConversation_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiConversation` ADD CONSTRAINT `AiConversation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiMessage` ADD CONSTRAINT `AiMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AiConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

