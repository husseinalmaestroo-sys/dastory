-- CreateTable
CREATE TABLE `Office` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` ENUM('OFFICE_MANAGER', 'LAWYER', 'CITIZEN') NOT NULL,
    `phone` VARCHAR(191) NULL,
    `barNumber` VARCHAR(191) NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `sessionVersion` INTEGER NOT NULL DEFAULT 0,
    `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorSecret` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `clientId` VARCHAR(191) NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_clientId_key`(`clientId`),
    INDEX `User_officeId_role_idx`(`officeId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Client` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `idNumber` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Client_officeId_ownerId_idx`(`officeId`, `ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Case` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `court` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'CLOSED', 'SUSPENDED', 'PENDING') NOT NULL DEFAULT 'ACTIVE',
    `clientId` VARCHAR(191) NOT NULL,
    `lawyerId` VARCHAR(191) NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Case_officeId_ownerId_idx`(`officeId`, `ownerId`),
    INDEX `Case_officeId_lawyerId_idx`(`officeId`, `lawyerId`),
    UNIQUE INDEX `Case_officeId_number_key`(`officeId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `time` VARCHAR(191) NOT NULL,
    `court` VARCHAR(191) NOT NULL,
    `judge` VARCHAR(191) NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `status` ENUM('UPCOMING', 'DONE', 'POSTPONED') NOT NULL DEFAULT 'UPCOMING',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `paid` DOUBLE NOT NULL DEFAULT 0,
    `status` ENUM('PAID', 'UNPAID', 'PARTIAL', 'OVERDUE') NOT NULL DEFAULT 'UNPAID',
    `dueDate` DATETIME(3) NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `size` INTEGER NULL,
    `url` TEXT NULL,
    `caseId` VARCHAR(191) NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Document_officeId_ownerId_idx`(`officeId`, `ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `read` BOOLEAN NOT NULL DEFAULT false,
    `userId` VARCHAR(191) NOT NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalendarEvent` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'general',
    `officeId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CalendarEvent_officeId_date_idx`(`officeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `officeId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NULL,
    `actorEmail` VARCHAR(191) NULL,
    `actorRole` ENUM('OFFICE_MANAGER', 'LAWYER', 'CITIZEN') NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_officeId_createdAt_idx`(`officeId`, `createdAt`),
    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditLog_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `PasswordResetToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimeEntry` (
    `id` VARCHAR(191) NOT NULL,
    `officeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NULL,
    `task` VARCHAR(191) NOT NULL,
    `minutes` INTEGER NOT NULL,
    `billable` BOOLEAN NOT NULL DEFAULT true,
    `invoiced` BOOLEAN NOT NULL DEFAULT false,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TimeEntry_officeId_userId_date_idx`(`officeId`, `userId`, `date`),
    INDEX `TimeEntry_caseId_idx`(`caseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrialRequest` (
    `id` VARCHAR(191) NOT NULL,
    `officeName` VARCHAR(191) NOT NULL,
    `officeLicense` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `officePhone` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `teamSize` VARCHAR(191) NULL,
    `specialty` VARCHAR(191) NULL,
    `lawyerName` VARCHAR(191) NOT NULL,
    `lawyerBarNumber` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `mobile` VARCHAR(191) NOT NULL,
    `nationalId` VARCHAR(191) NOT NULL,
    `experience` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TrialRequest_email_idx`(`email`),
    INDEX `TrialRequest_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_lawyerId_fkey` FOREIGN KEY (`lawyerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarEvent` ADD CONSTRAINT `CalendarEvent_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarEvent` ADD CONSTRAINT `CalendarEvent_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimeEntry` ADD CONSTRAINT `TimeEntry_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimeEntry` ADD CONSTRAINT `TimeEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimeEntry` ADD CONSTRAINT `TimeEntry_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
