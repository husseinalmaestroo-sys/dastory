-- CreateTable
CREATE TABLE `SiteSettings` (
    `id` VARCHAR(191) NOT NULL,
    `tickerItems` JSON NOT NULL,
    `tickerBg` VARCHAR(191) NOT NULL DEFAULT '#0F172A',
    `tickerColor` VARCHAR(191) NOT NULL DEFAULT '#D4AF37',
    `tickerSpeed` INTEGER NOT NULL DEFAULT 40,
    `heroVideoType` VARCHAR(191) NULL,
    `heroVideoUrl` VARCHAR(191) NULL,
    `heroVideoAutoplay` BOOLEAN NOT NULL DEFAULT true,
    `heroVideoLoop` BOOLEAN NOT NULL DEFAULT true,
    `heroVideoControls` BOOLEAN NOT NULL DEFAULT false,
    `contactPhone` VARCHAR(191) NOT NULL DEFAULT '+962 79 000 0000',
    `contactWhatsapp` VARCHAR(191) NOT NULL DEFAULT '9627900000001',
    `contactEmail` VARCHAR(191) NOT NULL DEFAULT 'info@dostoori.jo',
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `updatedByEmail` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SiteSettings` ADD CONSTRAINT `SiteSettings_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
