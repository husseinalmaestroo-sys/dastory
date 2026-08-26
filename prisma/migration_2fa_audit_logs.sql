-- Adds account 2FA and office-scoped audit logs.

ALTER TABLE `User`
  ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `twoFactorSecret` TEXT NULL;

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

  PRIMARY KEY (`id`),
  INDEX `AuditLog_officeId_createdAt_idx` (`officeId`, `createdAt`),
  INDEX `AuditLog_actorId_createdAt_idx` (`actorId`, `createdAt`),
  INDEX `AuditLog_action_createdAt_idx` (`action`, `createdAt`),
  CONSTRAINT `AuditLog_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);
