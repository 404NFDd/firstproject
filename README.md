# 📰 NewsHub - 뉴스 수집 대시보드

최신 뉴스를 한 곳에서 모아보는 현대적인 뉴스 대시보드 플랫폼입니다.

## ✨ 주요 기능

- **반응형 UI/UX** - 모바일, 태블릿, 데스크톱 완벽 지원
- **사용자 인증** - Next-Auth를 이용한 안전한 로그인/회원가입
- **토큰 관리** - Access Token (15분) & Refresh Token (7일)
- **뉴스 검색 및 필터** - 카테고리별 뉴스 필터링
- **즐겨찾기** - 관심 뉴스 저장 및 관리
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
- 즐겨찾기 추가

### 즐겨찾기 관리
- `/bookmarks`에서 저장한 뉴스 확인
- 뉴스 카드에서 북마크 추가/제거

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
│   ├── bookmarks/          # 즐겨찾기 페이지
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
- `GET /api/news/bookmarks` - 즐겨찾기 목록
- `POST /api/news/bookmark` - 북마크 추가
- `DELETE /api/news/bookmark` - 북마크 제거

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

## 📄 라이센스

MIT License
