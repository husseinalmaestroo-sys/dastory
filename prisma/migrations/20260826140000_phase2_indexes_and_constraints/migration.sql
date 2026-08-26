-- CreateIndex
CREATE INDEX `Case_officeId_createdAt_idx` ON `Case`(`officeId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Client_officeId_createdAt_idx` ON `Client`(`officeId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Document_officeId_createdAt_idx` ON `Document`(`officeId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Invoice_officeId_status_idx` ON `Invoice`(`officeId`, `status`);

-- CreateIndex
CREATE INDEX `Invoice_officeId_createdAt_idx` ON `Invoice`(`officeId`, `createdAt`);

-- CreateIndex
CREATE UNIQUE INDEX `Invoice_officeId_number_key` ON `Invoice`(`officeId`, `number`);

-- CreateIndex
CREATE INDEX `Notification_userId_createdAt_idx` ON `Notification`(`userId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Session_officeId_date_idx` ON `Session`(`officeId`, `date`);

