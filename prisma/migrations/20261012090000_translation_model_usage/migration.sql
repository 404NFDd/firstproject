-- 기존 사용량과 대기 상태는 기존 기본 모델의 기록으로 보존합니다.
ALTER TABLE `NewsTranslationUsage`
  ADD COLUMN `model` VARCHAR(64) NOT NULL DEFAULT 'gemini-3.5-flash-lite',
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`dateKey`, `model`);
