-- Phase 1 core hardening.
--
-- 1. Invoice money moves from DOUBLE to exact DECIMAL(12,3) (JOD: 3 fils
--    digits). MySQL rounds each existing value to 3 decimals during the
--    MODIFY; values are otherwise preserved. A value outside ±999,999,999.999
--    would abort the statement (strict mode) and leave the table unchanged.
-- 2. Invoice.paymentRecordedAt — set once a payment exists, never cleared.
--    Backfilled below for every invoice that already records a payment.
-- 3. Notification.body VARCHAR(191) -> TEXT (long case titles/document names
--    used to overflow it and the notification was silently dropped).
-- 4. User.isPlatformAdmin — explicit, operator-provisioned platform admin
--    flag (defaults to false for everyone; see scripts/platform-admin.mjs).
--
-- Take a backup first (deploy/deploy.sh does this automatically).

-- AlterTable
ALTER TABLE `Invoice` ADD COLUMN `paymentRecordedAt` DATETIME(3) NULL,
    MODIFY `amount` DECIMAL(12, 3) NOT NULL,
    MODIFY `paid` DECIMAL(12, 3) NOT NULL DEFAULT 0;

-- Backfill: any invoice that already has money recorded against it.
UPDATE `Invoice` SET `paymentRecordedAt` = `updatedAt`
WHERE `paymentRecordedAt` IS NULL AND (`paid` > 0 OR `status` = 'PAID');

-- AlterTable
ALTER TABLE `Notification` MODIFY `body` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `isPlatformAdmin` BOOLEAN NOT NULL DEFAULT false;
