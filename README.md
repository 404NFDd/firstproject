# 📰 NewsHub - 뉴스 수집 대시보드
최신 뉴스를 한 곳에서 모아보는 현대적인 뉴스 대시보드 플랫폼입니다.

### 뉴스 수집 방식
- 기본: NewsAPI 및 각 언론사의 RSS를 통해 기사 메타데이터 수집
- 수집 주기: 10분 간격 배치(서버 크론 / 외부 스케줄러 사용 예정)
- 실행 경로: `POST /api/news/sync` (필요 시 `x-cron-secret` 헤더) → `lib/news-service.ts`가 NewsAPI + RSS 기사 정규화/저장
- 스케줄링: Vercel Cron 또는 자체 서버에서 `*/10 * * * *`로 호출, 로컬 수동 실행 시 `curl -X POST http://localhost:3000/api/news/sync`

## ✨ 주요 기능

- **반응형 UI/UX** - 모바일, 태블릿, 데스크톱 완벽 지원
- **사용자 인증** - Next-Auth를 이용한 안전한 로그인/회원가입
- **토큰 관리** - Access Token (15분) & Refresh Token (7일)
- **뉴스 검색 및 필터** - 카테고리별 뉴스 필터링
- **사용자 프로필** - 프로필 편집 및 설정
- **어두운 테마** - 눈에 편한 다크 모드 기본 적용

## 🛠️ 기술 스택

### Frontend
- **Next.js 16** - React 기반 프레임워크
- **React 19** - UI 라이브러리
- **Tailwind CSS 4** - 유틸리티 기반 스타일링
- **TypeScript** - 타입 안정성

### Backend & Database
- **Node.js** - 런타임
- **Prisma ORM** - 데이터베이스 접근 계층
- **MariaDB** - 관계형 데이터베이스
- **JWT** - 토큰 기반 인증

### 추가 라이브러리
- **jose** - JWT 처리
- **bcryptjs** - 비밀번호 암호화
- **lucide-react** - 아이콘
- **next-themes** - 테마 관리

## 📦 설치 및 설정

### 0. Python & Poetry 워크플로우 (선택)

뉴스 크롤링·운영 스크립트를 분리하고 싶다면 Python 3.11+와 Poetry를 함께 설치하세요.

1. Python 3.11 이상 설치 후 pipx 구성
   ```bash
   python -m pip install --user pipx
   pipx ensurepath
   ```
2. Poetry 설치 및 버전 확인
   ```bash
   pipx install poetry
   poetry --version
   ```
3. 루트 디렉터리에서 가상환경을 프로젝트 내부에 생성하도록 설정
   ```bash
   poetry config virtualenvs.in-project true --local
   ```
4. `pyproject.toml` 기반 의존성 설치
   ```bash
   poetry install
   ```
5. 환경 유틸리티 실행
   ```bash
   poetry run python scripts/setup.py --summary
   poetry run python scripts/setup.py --bootstrap-env --check-env
   ```

> `scripts/setup.py`는 `.env.local` 템플릿 복사와 필수 환경 변수 검증을 자동화합니다. Node.js 기반 개발과 병행해도 충돌이 없으며, `poetry run <command>`로 별도 백오피스 스크립트를 안전하게 실행할 수 있습니다.

### 1. 환경 변수 설정

`.env.local.example`을 참고하여 `.env.local` 파일을 생성합니다:

\`\`\`bash
cp .env.local.example .env.local
\`\`\`

필수 환경 변수를 입력합니다:

\`\`\`env
DATABASE_URL="mysql://user:password@localhost:3306/news_db"
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"
JWT_ACCESS_SECRET="your-access-secret"
JWT_REFRESH_SECRET="your-refresh-secret"
NEWS_API_KEY="your-newsapi-key"
CRON_SECRET="optional-secret-for-cron"
\`\`\`

### 2. 데이터베이스 설정

MariaDB를 설치하고 데이터베이스를 생성합니다:

\`\`\`bash
# MariaDB 접속
mysql -u root -p

# 데이터베이스 생성
CREATE DATABASE news_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
\`\`\`

### 3. 의존성 설치

\`\`\`bash
npm install
\`\`\`

### 4. Prisma 마이그레이션

\`\`\`bash
# 마이그레이션 실행
npx prisma migrate dev

# (선택) Prisma Studio로 데이터베이스 확인
npx prisma studio
\`\`\`

### 5. 개발 서버 시작

\`\`\`bash
npm run dev
\`\`\`

브라우저에서 `http://localhost:3000`으로 접속합니다.

## 🚀 사용하기

### 회원가입 및 로그인
1. `/auth/register`에서 새 계정 생성
2. 이메일과 비밀번호로 로그인

### 뉴스 대시보드
- 최신 뉴스 확인
- 카테고리별로 필터링
- 뉴스 상세 보기

### 프로필 관리
- `/profile`에서 프로필 편집
- 사용자 정보 수정
- 로그아웃

## 📁 프로젝트 구조

\`\`\`
.
├── app/
│   ├── api/                 # API 라우트
│   │   ├── auth/           # 인증 API
│   │   └── news/           # 뉴스 API
│   ├── auth/               # 인증 페이지
│   ├── news/               # 뉴스 상세 페이지
│   ├── profile/            # 프로필 페이지
│   ├── layout.tsx          # 레이아웃
│   ├── page.tsx            # 메인 대시보드
│   └── globals.css         # 글로벌 스타일
├── components/
│   ├── header.tsx          # 헤더
│   ├── news-card.tsx       # 뉴스 카드
│   └── auth-form.tsx       # 인증 폼
├── lib/
│   ├── auth.ts             # 토큰 유틸리티
│   ├── prisma.ts           # Prisma 클라이언트
│   └── news-service.ts     # 뉴스 서비스
├── prisma/
│   └── schema.prisma       # 데이터베이스 스키마
└── scripts/
    └── setup.ts            # 초기 설정 스크립트
\`\`\`

### Prisma 엔티티 개요

| 모델 | 핵심 필드 | 설명 |
| --- | --- | --- |
| `User` | `email`, `password`, `image`, `createdAt` | 회원 기본 정보와 프로필 이미지를 저장하며 RefreshToken·읽음 이력과 관계를 맺습니다. |
| `RefreshToken` | `token`, `expiresAt`, `userId` | Refresh Token을 영속화해 강제 로그아웃·감사 추적을 지원합니다. |
| `News` | `title`, `content`, `imageUrl`, `sourceUrl`, `category`, `publishedAt`, `priority` | 외부 데이터 소스에서 적재한 기사로 읽음 이력과 연결되며 추천·AI 요약의 기본 재료입니다. |
| `NewsReadHistory` | `userId`, `newsId`, `readCount`, `updatedAt` | 사용자의 열람 기록을 집계해 개인화 추천과 아침 브리핑 우선순위를 계산합니다. |

## 🔐 보안 기능

- **비밀번호 암호화** - bcryptjs로 안전하게 해시화
- **JWT 토큰** - Access & Refresh 토큰 분리
- **HttpOnly 쿠키** - XSS 공격 방지
- **CSRF 보호** - SameSite 정책 적용
- **SQL 인젝션 방지** - Prisma ORM 사용

## 🎨 반응형 디자인

- **모바일 (320px ~ 640px)** - 단일 컬럼, 최적화된 터치
- **태블릿 (641px ~ 1024px)** - 2컬럼 그리드
- **데스크톱 (1025px+)** - 3컬럼 그리드

## 📚 API 문서

### 인증
- `POST /api/auth/register` - 회원가입
- `POST /api/auth/login` - 로그인
- `POST /api/auth/logout` - 로그아웃
- `POST /api/auth/refresh` - 토큰 갱신
- `GET /api/auth/me` - 현재 사용자 정보

### 뉴스
- `GET /api/news` - 뉴스 목록 (페이지네이션, 필터링)
- `GET /api/news/[id]` - 뉴스 상세
- `POST /api/news/sync` - 배치 수집 트리거 (Vercel Cron, `x-cron-secret` 헤더 지원)

## ⏱️ 데이터 파이프라인 & 스케줄링

1. `lib/news-service.ts`  
   - NewsAPI + 주요 RSS 피드를 병합해 카테고리별 기사 노말라이즈  
   - 10분 단위 배치에서 `priority` 점수를 재계산해 개인화 추천의 기초 데이터를 준비
2. `POST /api/news/sync`  
   - 로컬: `curl -X POST http://localhost:3000/api/news/sync`  
   - 프로덕션: Vercel Cron (예: `*/10 * * * * https://your-app.vercel.app/api/news/sync`), 필요 시 `x-cron-secret: $CRON_SECRET`
3. 실패 재시도  
   - 라우트 응답에 `persisted`/`skipped`를 포함하므로, 모니터링 시스템에서 비정상 증가 시 Slack/Webhook 경보를 걸 수 있습니다.

`scripts/setup.ts`와 `scripts/setup.py`는 DB/환경 상태를 검증하며, NewsAPI 키가 비어 있으면 RSS만으로 최소한의 데이터셋을 유지합니다.

## 🤖 AI 요약 & 아침 브리핑 메일

- 매일 오전 7시(사용자별 타임존 기준)에 다음 작업 수행:
  1. 사용자 관심 카테고리/키워드 기반으로 지난 24시간 주요 기사 조회
  2. LLM을 이용해 카테고리별로 요약 및 핵심 포인트 생성
  3. 한 이메일 안에 "오늘의 주요 뉴스 브리핑" 형태로 정리 후 발송

- 구현 계획:
  - `News`, `NewsReadHistory`를 조합해 사용자별 가중치를 계산하고, Prisma에서 지난 24시간 기사를 우선순위 큐로 가져옵니다.
  - 사용자 프로필에 저장된 타임존을 UTC로 환산해 Vercel Cron(또는 자체 배치 서버)에서 매일 07:00 잡을 등록합니다.
  - `lib/ai-summary.ts` 모듈(추가 예정)에서 OpenAI/Azure OpenAI/Claude 등 LLM 프로바이더를 래핑해 카테고리별 bullet 요약, 주요 수치, 인용문을 생성합니다.
  - 요약 결과를 `templates/email/daily-briefing.html` 템플릿에 주입하고 Nodemailer/Resend로 발송, `EmailDigestLog` (예정) 모델에 성공/실패 로그를 남겨 중복 발송을 방지합니다.
  - 실패 시 재시도 큐(예: Redis Delayed Job)를 두고, 3회 이상 실패하면 Slack/Webhook 알림을 발송해 운영자가 즉시 대응할 수 있게 합니다.

## 🔧 트러블슈팅

### 데이터베이스 연결 오류
\`\`\`bash
# DATABASE_URL 확인
# MySQL 서버가 실행 중인지 확인
mysql -u root -p -e "SELECT 1;"
\`\`\`

### Prisma 마이그레이션 오류
\`\`\`bash
# Prisma 초기화
npx prisma migrate reset

# 또는 스키마 재생성
npx prisma db push
\`\`\`

### 토큰 만료 오류
- 페이지 새로고침 시 자동으로 Refresh Token이 호출됩니다
- 7일 이상 로그인하지 않으면 다시 로그인 필요

## 📞 지원

문제가 발생하면:
1. 콘솔 에러 메시지 확인
2. 환경 변수 설정 확인
3. 데이터베이스 연결 확인
4. Prisma 마이그레이션 상태 확인

## 🧾 진행 현황 (2025-11-20)

- React 19 및 Node 20.9 환경에 맞춰 `vaul`, `prisma`, `@prisma/client` 등 의존성 버전을 정리했습니다.
- Next.js 16 기반 ESLint 구성을 추가해 전역 린트 검사를 통과하도록 했습니다.
- 뉴스 상세 이미지 최적화, 인터섹션 옵저버 정리, 테마/스켈레톤 컴포넌트 안정화 등 렌더링 이슈를 해결했습니다.
- `npm install`, `npm run lint`, `npm run build`로 배포 전 필수 검증을 수행했습니다.

## 🧠 전체 구현 가이드 (AI 복제용)

1. **환경 준비**
   - Node.js 20.9+, PNPM/NPM, Git을 설치합니다.
   - `cp .env.local.example .env.local` 후 DB·JWT·NextAuth·News API 키·SMTP 정보를 채웁니다.
   - `npm install`로 모든 의존성을 설치합니다.

2. **데이터베이스 & Prisma**
   - MariaDB/MySQL 8 이상에서 `npx prisma migrate dev`로 스키마를 반영합니다.
   - 초기 데이터가 필요하면 `scripts/setup.ts`에서 API 크롤링 후 `prisma.news.createMany`로 적재합니다.

3. **실행 & 개발 플로우**
   - `npm run dev` → App Router 기반 풀스택 서버 실행.
   - `/app/api`의 라우트에서 인증/뉴스/메일 기능을 제공하므로, 기능 추가 시 해당 디렉터리에 server action 또는 route handler를 생성합니다.
   - 클라이언트 전역 상태/테마는 `components/theme-provider.tsx`, `lib/theme-context.tsx`, `hooks/use-toast.ts`를 참조합니다.

4. **품질 관리**
   - `npm run lint`로 React 19/Next 16 규칙을 준수합니다.
   - `npm run build`로 Turbopack 빌드와 정적 페이지 생성을 검증합니다.
   - Prisma 변경 시 `npx prisma generate`를 호출하고, E2E 테스트는 Cypress/Playwright 디렉터리에 추가합니다.

5. **배포 체크리스트**
   - Vercel 배포 시 환경 변수와 Cron 스케줄(아침 브리핑)을 함께 등록합니다.
   - `next.config.mjs`의 `images`·`typescript` 설정을 검토하고, 필요 시 `ignoreBuildErrors`를 false로 돌립니다.
   - CDN/SMTP/LLM 자격 증명은 Vercel 프로젝트의 Environment Variables에 동일한 키로 추가합니다.

이 가이드를 README와 함께 제공하면 다른 AI 또는 엔지니어도 동일한 환경을 그대로 재현해 기능을 확장할 수 있습니다.

## 📄 라이센스

MIT License
