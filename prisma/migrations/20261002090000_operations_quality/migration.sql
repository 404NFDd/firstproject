-- 기존 기사와 회원 데이터를 보존하고 운영 집계만 추가합니다.
ALTER TABLE `NewsSyncLog`
  ADD COLUMN `createdCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `repairedCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `excludedCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `durationMs` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `sourceReports` JSON NULL,
  ADD COLUMN `finishedAt` DATETIME(3) NULL;

CREATE TABLE `BriefingDelivery` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `dateKey` VARCHAR(10) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'processing',
  `attempts` INTEGER NOT NULL DEFAULT 1,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sentAt` DATETIME(3) NULL,
  `messageId` TEXT NULL,
  `error` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `BriefingDelivery_userId_dateKey_key`(`userId`, `dateKey`),
  INDEX `BriefingDelivery_dateKey_status_idx`(`dateKey`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `BriefingDelivery` ADD CONSTRAINT `BriefingDelivery_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
