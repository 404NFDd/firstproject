# NewsHub - 뉴스 수집 및 요약 대시보드

여러 뉴스 소스에서 뉴스를 모아서 보고, AI로 요약해 이메일로 받아보는 플랫폼입니다.

## 프로젝트 소개

NewsAPI, 네이버 검색 API, RSS 피드에서 뉴스를 수집하고, Google Gemini로 요약하며, 매일 이메일 브리핑을 보내줍니다.

주요 기능:
- NewsAPI, 네이버 검색 API, RSS 피드에서 자동으로 뉴스 수집
- Google Translate로 영어 뉴스를 한국어로 번역
- Google Gemini로 뉴스 요약
- 매일 오전 7시 구독자에게 이메일 브리핑 발송
- JWT 토큰 기반 인증
- 모바일/태블릿/데스크톱 반응형
- 다크 모드 지원

## 기능

### 뉴스 수집
- NewsAPI, 네이버 검색 API, RSS 피드에서 뉴스 가져오기
- 카테고리별 분류 (일반, 비즈니스, 기술, 개발자, 엔터테인먼트, 건강, 스포츠)
- 중복 제거 (URL, 제목 기준)
- 영어 뉴스 자동 번역
- 우선순위 계산 (신선도, 카테고리, 이미지 유무)

### AI 요약
- Google Gemini 1.5 Flash로 뉴스 요약
- 요약 결과를 DB에 저장해서 재사용
- API 오류 시 원문으로 폴백

### 이메일
- 뉴스 선택해서 이메일로 보내기
- 매일 오전 7시 구독자에게 브리핑 발송
- HTML 이메일 템플릿
- SMTP 서버 지원

### 사용자
- 회원가입/로그인
- 프로필 관리
- 이메일 구독 설정
- 읽은 뉴스 기록
- RSS 피드 제공

## 기술 스택

**Frontend**
- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS 4, Radix UI
- React Hook Form, Zod

**Backend**
- Next.js API Routes
- Prisma ORM, MariaDB/MySQL
- JWT (jose), bcryptjs

**외부 API**
- NewsAPI - 뉴스 수집
- 네이버 검색 API - 한국 뉴스
- Google Translate API - 번역
- Google Gemini API - 뉴스 요약
- SMTP - 이메일 전송

## 설치 및 실행

필수 요구사항: Node.js 20.9+, MariaDB/MySQL 8.0+

### 1. 프로젝트 클론 및 의존성 설치

```bash
git clone <repository-url>
cd firstproject
npm install
```

### 2. 환경 변수 설정

`.env.local` 파일을 만들고 필요한 환경 변수를 설정합니다:

```env
# 데이터베이스
DATABASE_URL="mysql://user:password@localhost:3306/news_db"

# NextAuth 설정
NEXTAUTH_SECRET="your-random-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"

# JWT 토큰
JWT_ACCESS_SECRET="your-access-token-secret"
JWT_REFRESH_SECRET="your-refresh-token-secret"

# NewsAPI (선택사항)
NEWS_API_KEY="your-newsapi-key"

# 네이버 검색 API (선택사항)
CLIENT_ID="your-naver-client-id"
CLIENT_SECRET="your-naver-client-secret"

# Google Translate API (선택사항)
GOOGLE_TRANSLATE_API_KEY="your-google-translate-api-key"

# Google Gemini API (선택사항, AI 요약용)
GEMINI_API_KEY="your-gemini-api-key"

# SMTP 설정 (이메일 발송용)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
SMTP_FROM="NewsHub <noreply@newshub.com>"

# 크론 작업 보안 (선택사항)
CRON_SECRET="your-cron-secret-key"

# 공개 URL (이메일 링크용)
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```

### 3. 데이터베이스 설정

```bash
# MariaDB/MySQL 접속
mysql -u root -p

# 데이터베이스 생성
CREATE DATABASE news_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

```

### 4. Prisma 마이그레이션

```bash
# Prisma 클라이언트 생성
npx prisma generate

# 데이터베이스 마이그레이션 실행
npx prisma migrate dev

```

### 5. 개발 서버 시작

```bash
npm run dev
```

`http://localhost:3000`에서 확인할 수 있습니다.

### 6. Python 환경 설정 (선택)

Python 스크립트가 필요하면:

```bash
# Python 3.11 이상 설치 후 pipx 구성
python -m pip install --user pipx
pipx ensurepath

# Poetry 설치
pipx install poetry

# 가상환경을 프로젝트 내부에 생성
poetry config virtualenvs.in-project true --local

# 의존성 설치
poetry install

# 환경 설정 스크립트 실행
poetry run python scripts/setup.py --bootstrap-env --check-env
```

## 사용 방법

1. `/auth/register`에서 회원가입
2. `/auth/login`에서 로그인
3. 메인 페이지에서 "뉴스 수집" 버튼으로 뉴스 가져오기
4. 카테고리 필터로 원하는 뉴스만 보기
5. 스크롤하면 자동으로 더 많은 뉴스 로드
6. `/profile`에서 이메일 구독 설정
7. `/api/rss`를 RSS 리더에 추가

## 프로젝트 구조

```
firstproject/
├── app/                          # Next.js App Router
│   ├── api/                      # API 라우트
│   │   ├── auth/                 # 인증 API
│   │   │   ├── [...nextauth]/    # NextAuth 핸들러
│   │   │   ├── login/            # 로그인 엔드포인트
│   │   │   ├── logout/           # 로그아웃 엔드포인트
│   │   │   ├── register/         # 회원가입 엔드포인트
│   │   │   ├── refresh/          # 토큰 갱신
│   │   │   ├── me/               # 현재 사용자 정보
│   │   │   └── profile/          # 프로필 업데이트
│   │   ├── news/                 # 뉴스 API
│   │   │   ├── route.ts          # 뉴스 목록 조회
│   │   │   ├── [id]/             # 뉴스 상세
│   │   │   ├── sync/             # 뉴스 수집 트리거
│   │   │   ├── bookmark/         # 북마크 관리
│   │   │   ├── bookmarks/        # 북마크 목록
│   │   │   └── send-email/       # 뉴스 이메일 발송
│   │   ├── email/                # 이메일 API
│   │   │   ├── subscribe/        # 구독 관리
│   │   │   ├── daily-briefing/   # 일일 브리핑 전송
│   │   │   └── test-briefing/    # 브리핑 테스트
│   │   └── rss/                  # RSS 피드 생성
│   ├── auth/                     # 인증 페이지
│   │   ├── login/                # 로그인 페이지
│   │   └── register/             # 회원가입 페이지
│   ├── news/                     # 뉴스 페이지
│   │   └── [id]/                 # 뉴스 상세 페이지
│   ├── profile/                  # 프로필 페이지
│   ├── bookmarks/                # 북마크 페이지
│   ├── layout.tsx                # 루트 레이아웃
│   ├── page.tsx                  # 메인 대시보드
│   └── globals.css               # 글로벌 스타일
├── components/                   # React 컴포넌트
│   ├── ui/                       # 재사용 가능한 UI 컴포넌트
│   ├── header.tsx                # 헤더 컴포넌트
│   ├── news-card.tsx             # 뉴스 카드 컴포넌트
│   ├── auth-form.tsx             # 인증 폼 컴포넌트
│   ├── app-providers.tsx         # 앱 프로바이더
│   └── theme-provider.tsx        # 테마 프로바이더
├── lib/                          # 유틸리티 및 서비스
│   ├── prisma.ts                 # Prisma 클라이언트
│   ├── auth.ts                   # 인증 유틸리티
│   ├── auth-options.ts           # NextAuth 설정
│   ├── news-service.ts           # 뉴스 수집 및 조회 서비스
│   ├── rss-service.tsx           # RSS 피드 생성 서비스
│   ├── email-service.tsx         # 이메일 전송 서비스
│   ├── ai-summary.ts             # AI 요약 서비스 (Gemini)
│   ├── daily-briefing.ts         # 일일 브리핑 서비스
│   ├── utils.ts                  # 공통 유틸리티
│   └── theme-context.tsx         # 테마 컨텍스트
├── hooks/                        # React 훅
│   ├── use-toast.ts              # 토스트 알림 훅
│   └── use-mobile.ts             # 모바일 감지 훅
├── prisma/                       # Prisma 설정
│   ├── schema.prisma             # 데이터베이스 스키마
│   └── migrations/               # 마이그레이션 파일
├── scripts/                      # 유틸리티 스크립트
│   ├── setup.ts                  # 초기 설정 (TypeScript)
│   ├── setup.py                  # 초기 설정 (Python)
│   └── translate-existing-news.ts # 기존 뉴스 번역
├── public/                       # 정적 파일
│   └── *.jpg, *.png, *.svg      # 이미지 및 아이콘
├── data/                         # 데이터 파일
│   └── mock-news.ts              # 목업 데이터
├── styles/                       # 스타일 파일
│   └── globals.css               # 글로벌 스타일
├── package.json                  # 프로젝트 의존성
├── tsconfig.json                 # TypeScript 설정
├── next.config.mjs               # Next.js 설정
├── tailwind.config.js            # Tailwind CSS 설정
├── components.json               # shadcn/ui 설정
├── pyproject.toml                # Python 프로젝트 설정
└── README.md                     # 프로젝트 문서
```

## 데이터베이스 스키마

주요 모델:

**User** - 사용자 정보

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String | 고유 ID (CUID) |
| email | String | 이메일 (고유) |
| name | String? | 사용자 이름 |
| password | String | 해시된 비밀번호 |
| image | String? | 프로필 이미지 URL |
| emailSubscription | Int | 이메일 구독 상태 (0: 미구독, 1: 구독) |
| createdAt | DateTime | 생성일시 |
| updatedAt | DateTime | 수정일시 |

**News** - 뉴스 기사

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String | 고유 ID |
| title | String | 제목 |
| description | String? | 요약 설명 |
| content | String? | 본문 내용 |
| imageUrl | String? | 이미지 URL |
| sourceUrl | String? | 원문 URL |
| source | String | 출처 |
| author | String? | 작성자 |
| publishedAt | DateTime | 발행일시 |
| category | String | 카테고리 |
| priority | Int | 우선순위 점수 |
| isTranslated | Int | 번역 상태 (0: 미번역, 1: 번역 완료) |
| createdAt | DateTime | 생성일시 |
| updatedAt | DateTime | 수정일시 |

**NewsSummary** - AI 요약 저장

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String | 고유 ID |
| newsId | String | 뉴스 ID (고유) |
| summary | String | AI 요약 내용 |
| createdAt | DateTime | 생성일시 |
| updatedAt | DateTime | 수정일시 |

**NewsReadHistory** - 읽음 이력

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String | 고유 ID |
| userId | String | 사용자 ID |
| newsId | String | 뉴스 ID |
| readCount | Int | 읽은 횟수 |
| createdAt | DateTime | 생성일시 |
| updatedAt | DateTime | 수정일시 |

**RefreshToken** - JWT 토큰 저장

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String | 고유 ID |
| token | String | 토큰 값 (고유) |
| userId | String | 사용자 ID |
| expiresAt | DateTime | 만료일시 |
| createdAt | DateTime | 생성일시 |

**NewsSyncLog** - 수집 로그

| 필드 | 타입 | 설명 |
|------|------|------|
| id | String | 고유 ID |
| status | String | 상태 (success, failed, processing) |
| fetched | Int | 가져온 기사 수 |
| persisted | Int | 저장된 기사 수 |
| skipped | Int | 건너뛴 기사 수 |
| error | String? | 오류 메시지 |
| createdAt | DateTime | 생성일시 |

## API 엔드포인트

### 인증

**POST /api/auth/register** - 회원가입

**POST /api/auth/login** - 로그인  
**POST /api/auth/logout** - 로그아웃  
**POST /api/auth/refresh** - 토큰 갱신  
**GET /api/auth/me** - 현재 사용자 정보  
**PUT /api/auth/profile** - 프로필 업데이트

### 뉴스

**GET /api/news** - 뉴스 목록 (쿼리: page, limit, category, search, sort)  
**GET /api/news/[id]** - 뉴스 상세  
**POST /api/news/sync** - 뉴스 수집 (10분당 1회 제한)  
**POST /api/news/send-email** - 뉴스 이메일 발송  
**GET /api/rss** - RSS 피드

### 이메일

**POST /api/email/subscribe** - 구독 관리  
**POST /api/email/daily-briefing** - 일일 브리핑 전송 (크론)

## 뉴스 수집 프로세스

1. NewsAPI, 네이버 검색 API, RSS 피드에서 뉴스 가져오기
2. HTML 태그 제거, 이미지 추출, 출처 파싱
3. 영어 뉴스는 Google Translate로 번역
4. 개발자 키워드 감지해서 카테고리 재분류
5. 우선순위 계산 (신선도, 카테고리, 이미지)
6. 중복 체크 후 DB 저장

## 스케줄링

로컬:
```bash
curl -X POST http://localhost:3000/api/news/sync
```

Vercel Cron (`vercel.json`):
```json
{
  "crons": [
    { "path": "/api/news/sync", "schedule": "*/10 * * * *" },
    { "path": "/api/email/daily-briefing", "schedule": "0 7 * * *" }
  ]
}
```

자체 서버 (crontab):
```
*/10 * * * * curl -X POST https://your-app.com/api/news/sync -H "x-cron-secret: YOUR_SECRET"
0 7 * * * curl -X POST https://your-app.com/api/email/daily-briefing -H "x-cron-secret: YOUR_SECRET"
```

## AI 요약 및 일일 브리핑

Google Gemini 1.5 Flash로 뉴스를 2-3문장으로 요약합니다. 요약 결과는 DB에 저장해서 재사용합니다.

매일 오전 7시 구독자에게 지난 24시간 뉴스 50개를 카테고리별로 요약해서 이메일로 보냅니다.

## 보안

- 비밀번호 bcryptjs 해싱
- JWT 토큰 (Access 15분, Refresh 7일)
- HttpOnly 쿠키
- Prisma ORM 사용
- 뉴스 수집 10분당 1회 제한

## 반응형 디자인

모바일: 1컬럼 | 태블릿: 2컬럼 | 데스크톱: 3컬럼

## 트러블슈팅

**DB 연결 오류**
- `DATABASE_URL` 확인
- MySQL 서버 실행 확인: `mysql -u root -p -e "SELECT 1;"`

**Prisma 마이그레이션 오류**
- `npx prisma migrate reset` (데이터 삭제됨)
- 또는 `npx prisma db push`

**뉴스 수집 실패**
- `.env.local`에서 API 키 확인
- 로그 확인 후 수동 테스트: `curl -X POST http://localhost:3000/api/news/sync`

**이메일 발송 실패**
- SMTP 설정 확인 (Gmail은 앱 비밀번호 필요)
- 서버 로그에서 오류 확인

**번역/요약 API 오류**
- `GOOGLE_TRANSLATE_API_KEY`, `GEMINI_API_KEY` 확인
- 할당량 확인 (Google Cloud Console)

## 라이센스

MIT License

## 로드맵

- 사용자별 관심 분야 추가