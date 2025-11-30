-- AlterTable
ALTER TABLE `user` ADD COLUMN `emailSubscription` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `User_emailSubscription_idx` ON `User`(`emailSubscription`);
