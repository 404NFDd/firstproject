-- 기사 원문을 보존하며 번역 캐시와 무료 요청 집계만 추가합니다.
CREATE TABLE `NewsTranslation` (
  `id` VARCHAR(191) NOT NULL,
  `newsId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(191) NOT NULL,
  `chunkIndex` INTEGER NOT NULL DEFAULT 0,
  `sourceHash` VARCHAR(64) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `translatedTitle` LONGTEXT NULL,
  `translatedText` LONGTEXT NULL,
  `startedAt` DATETIME(3) NULL,
  `retryAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `NewsTranslation_newsId_kind_chunkIndex_key` (`newsId`, `kind`, `chunkIndex`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `NewsTranslation` ADD CONSTRAINT `NewsTranslation_newsId_fkey`
  FOREIGN KEY (`newsId`) REFERENCES `News`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE `NewsTranslationUsage` (
  `dateKey` VARCHAR(10) NOT NULL,
  `requests` INTEGER NOT NULL DEFAULT 0,
  `nextRequestAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `blockedUntil` DATETIME(3) NULL,
  PRIMARY KEY (`dateKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
