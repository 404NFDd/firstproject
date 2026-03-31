/*
  Warnings:

  - You are about to drop the `NewsBookmark` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `NewsBookmark` DROP FOREIGN KEY `NewsBookmark_newsId_fkey`;

-- DropForeignKey
ALTER TABLE `NewsBookmark` DROP FOREIGN KEY `NewsBookmark_userId_fkey`;

-- DropTable
DROP TABLE `NewsBookmark`;
