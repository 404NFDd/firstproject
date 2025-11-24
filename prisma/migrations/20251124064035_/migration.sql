/*
  Warnings:

  - You are about to drop the `newsbookmark` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `newsbookmark` DROP FOREIGN KEY `NewsBookmark_newsId_fkey`;

-- DropForeignKey
ALTER TABLE `newsbookmark` DROP FOREIGN KEY `NewsBookmark_userId_fkey`;

-- DropTable
DROP TABLE `newsbookmark`;
