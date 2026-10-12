// 단위 테스트에서 빠진 DB 모의 객체가 실제 로컬 데이터에 접근하지 못하도록 격리합니다.
process.env.DATABASE_URL = "mysql://unit_test:invalid@127.0.0.1:1/unit_test"
process.env.TRANSLATION_GEMINI_API_KEY = ""
process.env.TRANSLATION_FREE_TIER_CONFIRMED = ""
process.env.GEMINI_API_KEY = ""
