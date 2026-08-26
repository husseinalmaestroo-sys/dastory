-- Multi-tenant ownership hardening for the existing MySQL/Prisma stack.
-- Each user must belong to an office. Each client, case, and document has an owner.

INSERT INTO `Office` (`id`, `name`, `active`, `createdAt`, `updatedAt`)
VALUES ('legacy-office', 'المكتب الافتراضي', true, NOW(), NOW())
ON DUPLICATE KEY UPDATE `name` = `name`;

UPDATE `User` SET `officeId` = 'legacy-office' WHERE `officeId` IS NULL;

ALTER TABLE `User` DROP FOREIGN KEY `User_officeId_fkey`;
ALTER TABLE `User` MODIFY `officeId` VARCHAR(191) NOT NULL;
ALTER TABLE `User`
  ADD CONSTRAINT `User_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE `User` ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `Client` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `Client` c
SET c.`ownerId` = (
  SELECT u.`id`
  FROM `User` u
  WHERE u.`officeId` = c.`officeId` AND u.`role` = 'LAWYER'
  ORDER BY u.`createdAt` ASC
  LIMIT 1
)
WHERE c.`ownerId` IS NULL;
UPDATE `Client` c
SET c.`ownerId` = (
  SELECT u.`id`
  FROM `User` u
  WHERE u.`officeId` = c.`officeId` AND u.`role` = 'OFFICE_MANAGER'
  ORDER BY u.`createdAt` ASC
  LIMIT 1
)
WHERE c.`ownerId` IS NULL;
ALTER TABLE `Client` MODIFY `ownerId` VARCHAR(191) NOT NULL;

ALTER TABLE `Case` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `Case` c SET c.`ownerId` = c.`lawyerId` WHERE c.`ownerId` IS NULL AND c.`lawyerId` IS NOT NULL;
UPDATE `Case` c
SET c.`ownerId` = (
  SELECT u.`id`
  FROM `User` u
  WHERE u.`officeId` = c.`officeId` AND u.`role` = 'OFFICE_MANAGER'
  ORDER BY u.`createdAt` ASC
  LIMIT 1
)
WHERE c.`ownerId` IS NULL;
ALTER TABLE `Case` MODIFY `ownerId` VARCHAR(191) NOT NULL;

ALTER TABLE `Document` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `Document` d
JOIN `Case` c ON c.`id` = d.`caseId`
SET d.`ownerId` = c.`ownerId`
WHERE d.`ownerId` IS NULL;
UPDATE `Document` d
SET d.`ownerId` = (
  SELECT u.`id`
  FROM `User` u
  WHERE u.`officeId` = d.`officeId` AND u.`role` = 'OFFICE_MANAGER'
  ORDER BY u.`createdAt` ASC
  LIMIT 1
)
WHERE d.`ownerId` IS NULL;
ALTER TABLE `Document` MODIFY `ownerId` VARCHAR(191) NOT NULL;

CREATE INDEX `User_officeId_role_idx` ON `User`(`officeId`, `role`);
CREATE INDEX `Client_officeId_ownerId_idx` ON `Client`(`officeId`, `ownerId`);
CREATE INDEX `Case_officeId_ownerId_idx` ON `Case`(`officeId`, `ownerId`);
CREATE INDEX `Case_officeId_lawyerId_idx` ON `Case`(`officeId`, `lawyerId`);
CREATE UNIQUE INDEX `Case_officeId_number_key` ON `Case`(`officeId`, `number`);
CREATE INDEX `Document_officeId_ownerId_idx` ON `Document`(`officeId`, `ownerId`);

ALTER TABLE `Client`
  ADD CONSTRAINT `Client_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE `Case`
  ADD CONSTRAINT `Case_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE `Document`
  ADD CONSTRAINT `Document_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT;
