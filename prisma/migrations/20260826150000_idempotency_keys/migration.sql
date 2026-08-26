-- CreateTable
CREATE TABLE `IdempotencyKey` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `responseStatus` INTEGER NOT NULL DEFAULT 0,
    `responseBody` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IdempotencyKey_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `IdempotencyKey_userId_endpoint_key_key`(`userId`, `endpoint`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

