export const TECH_NEWS_CATEGORY_VALUES = [
  "developer", "engineering", "ai", "infrastructure", "release",
] as const

export type TechCategory = (typeof TECH_NEWS_CATEGORY_VALUES)[number]

export const TECH_NEWS_CATEGORIES = [
  { value: "developer", label: "개발·기술", description: "공식 개발 도구 블로그에서 제품 업데이트와 실무 기술 글을 읽습니다." },
  { value: "engineering", label: "엔지니어링", description: "기술 블로그와 전문 매체에서 개발 경험, 설계와 운영 사례를 골라 읽습니다." },
  { value: "ai", label: "AI·연구", description: "AI 모델, 연구와 머신러닝 생태계의 새 소식을 확인합니다." },
  { value: "infrastructure", label: "클라우드·인프라", description: "클라우드, 네트워크와 서비스 인프라의 변화와 기술 글을 읽습니다." },
  { value: "release", label: "릴리스·도구", description: "언어, 프레임워크, 데이터베이스와 개발 도구의 릴리스, 보안 공지와 업데이트를 확인합니다." },
] as const

export const NEWS_CATEGORIES = [
  ...TECH_NEWS_CATEGORIES,
  { value: "105", label: "IT·과학", description: "AI, 소프트웨어, 디지털 산업과 과학기술 소식을 살펴봅니다." },
  { value: "101", label: "경제", description: "기업, 투자와 산업 동향을 통해 기술 시장의 흐름을 읽습니다." },
  { value: "102", label: "사회", description: "기술이 일상과 사회에 미치는 변화와 현장의 소식을 살펴봅니다." },
  { value: "100", label: "정치", description: "정책, 국회와 국내 정치 소식을 확인합니다." },
  { value: "104", label: "세계", description: "각국의 정책과 국제 소식을 살펴봅니다." },
  { value: "103", label: "생활·문화", description: "생활, 건강과 문화 분야의 소식을 읽습니다." },
  { value: "106", label: "연예", description: "방송, 음악과 대중문화 소식을 확인합니다." },
  { value: "107", label: "스포츠", description: "종목별 경기와 선수 소식을 살펴봅니다." },
] as const

const legacyLabels: Record<string, string> = {
  general: "일반", business: "비즈니스", technology: "기술", developer: "개발자",
  entertainment: "연예", health: "건강", science: "과학", sports: "스포츠",
}

export function getNewsCategoryLabel(category?: string | null): string {
  return NEWS_CATEGORIES.find((item) => item.value === category)?.label ||
    (category && Object.hasOwn(legacyLabels, category) ? legacyLabels[category] : "기타")
}
