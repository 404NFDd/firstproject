-- 기존 회원은 일반 회원으로 유지합니다.
ALTER TABLE `User`
  ADD COLUMN `adminUsername` VARCHAR(191) NULL,
  ADD COLUMN `isAdmin` BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX `User_adminUsername_key` ON `User`(`adminUsername`);
