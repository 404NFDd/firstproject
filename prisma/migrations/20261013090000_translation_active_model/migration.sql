-- 기존 요청 수와 대기 시각을 보존하며 현재 사용 모델만 추가합니다.
ALTER TABLE `NewsTranslationUsage` ADD COLUMN `activeModel` VARCHAR(64) NULL;
