# NewsHub 뉴스피드

개발자·IT 종사자를 위해 기술 블로그·전문 매체의 RSS/Atom과 네이버 뉴스에서 후보를 찾고, 읽을 가치가 있는 기술 소식을 AI로 선별·요약하는 뉴스 피드입니다. 목록에서 요약을 읽고 원문으로 이동하며 선택 기사와 일일 브리핑을 이메일로 받을 수 있습니다. Next.js App Router, React, TypeScript, Prisma, MySQL/MariaDB, NextAuth, Gemini, Nodemailer를 사용합니다.

## 로컬 실행 (Windows PowerShell)

작업 위치는 `C:\git\developer\firstproject`입니다. Node.js 20.9 이상과 MySQL/MariaDB가 필요합니다. 의존성은 npm과 `package-lock.json`을 기준으로 설치합니다.

```powershell
Set-Location C:\git\developer\firstproject
npm ci
# 기존 설정을 덮어쓰지 않습니다.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.env`의 `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`을 채웁니다. Prisma CLI도 같은 설정을 읽도록 프로젝트 루트의 `.env`를 사용합니다. 비밀값은 각각 별도로 생성합니다.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

데이터베이스가 준비되면 다음 명령을 실행합니다. `migrate deploy`는 저장소에 포함된 마이그레이션을 적용하므로 DB 스키마를 변경합니다. 기존 데이터베이스는 백업과 마이그레이션 상태 확인 후 실행합니다.

```powershell
npx prisma generate
npx prisma migrate status
npx prisma migrate deploy
npm run dev
```

[로컬 화면](http://localhost:3000)에서 회원가입하고 로그인합니다. 기존 `.env`, DB 데이터, 개발 서버는 자동 테스트에서 변경하지 않습니다.

## 콘텐츠 구성

첫 화면은 개발·기술 전체이며 개발·기술, 엔지니어링, AI·연구, 클라우드·인프라, 릴리스·도구와 네이버 IT·과학을 함께 보여줍니다. 기존 종합 뉴스도 선택할 수 있습니다. 카드와 상세에는 카테고리, 출처, 작성자와 한국 시각을 표시합니다. 피드는 게시 시각을 우선 사용하며, 게시 시각이 없고 갱신 시각만 제공하는 경우 그 시각을 사용합니다. 소개가 본문과 겹칠 때는 중복만 줄이고, 본문이 없으면 원문 확인 안내를 제공합니다.

[개발자 읽기 가이드](http://localhost:3000/guide)는 기술 기사의 변경사항·적용 범위·공식 근거를 확인하는 방법과 연결된 24개 피드의 출처와 수집 범위를 안내합니다. 추가 소스와 운영에 필요한 정보는 [CONTENT.md](CONTENT.md)에 정리했습니다.

선택 기사 메일은 원문/본문 발췌를, 브리핑은 AI 요약·원문 발췌·제목만 제공을 구분하며 안전한 원문 링크를 제공합니다. 본문이 없는 기사는 AI 생성 대신 설명이나 제목을 사용합니다. 기사가 갱신되어 기존 요약보다 새로우면 다시 요약하며, 프롬프트 변경만으로 모든 기존 요약 캐시를 갱신하지는 않습니다.

## 기능과 수집 흐름

- 뉴스 목록과 상세 조회는 로그인 없이 사용할 수 있습니다. 뉴스 수집, 이메일 전송, 프로필과 구독 설정은 로그인이 필요합니다.
- IntelliJ IDEA·Visual Studio(개발·기술), NAVER D2·Toss Tech(엔지니어링), Hugging Face(AI·연구), Cloudflare(클라우드·인프라), GitHub Changelog·Node.js와 React·Next.js·Vue·TypeScript·PHP·Laravel·Java·Spring·Python·PostgreSQL·MySQL·.NET(릴리스·도구), Docker(클라우드·인프라)의 공개 피드를 읽습니다. API 키는 필요하지 않습니다.
- 피드는 소개를 최대 2,000자로 정리하고 RSS/Atom의 전체 본문을 문단과 코드 줄바꿈을 보존해 저장합니다. Hugging Face, Node.js, Next.js, Python, Java, MySQL의 빈 본문은 확인한 공식 원문 영역에서 보강합니다. PostgreSQL News는 RSS description에 담긴 전체 공지 본문을 사용합니다. 실제 본문을 확보하지 못한 피드 글은 새로 저장하지 않습니다. 소개나 제목을 본문으로 대신 저장하지 않습니다.
- 정치(100), 경제(101), 사회(102), 생활·문화(103), 세계(104), IT·과학(105)는 네이버 섹션 HTML과 기사 상세에서 수집합니다.
- 연예(106), 스포츠(107)는 네이버 화면에서 사용하는 공개 목록을 읽습니다. 스포츠는 8개 종목 섹션을 합쳐 최신 기사부터 선택합니다.
- 네이버 수집에는 별도 NewsAPI 키가 필요하지 않습니다.
- HTML 엔티티, 본문과 한국 시각을 정리하고, 기사 URL로 중복을 확인합니다. URL이 없는 경우만 제목과 출처를 함께 비교합니다. 제목이 같아도 URL이 다르면 별도 기사로 보존합니다. 같은 수집에서 상세 요청을 재사용합니다. 같은 원문 URL로 저장된 기사의 본문이 비어 있으면 재수집 시 빈 필드를 보강합니다. `persisted`는 신규 저장과 본문 복구를 합한 건수입니다.
- 기본 수집은 `scope: "tech"`로 21개 기술 피드와 네이버 IT·과학을 가져옵니다. `scope: "all"`은 여기에 네이버 나머지 7개 분야를 포함합니다. `categories`를 명시하면 해당 분야만 수집하며 `scope`보다 우선합니다. 개별 카테고리는 1~13개, 수량은 1~50건이고 기본 20건입니다. `limitPerCategory`는 네이버에서 카테고리별, 기술 피드에서 소스별 제한으로 적용됩니다.
- 성공/부분 성공 및 진행 중인 수집은 시작 시각부터 1시간 동안 추가 수집을 제한합니다. `429`의 `Retry-After`에 남은 시간이 표시됩니다.
- 일부 소스가 실패하면 가능한 기사는 저장하고 네이버 실패는 `failedCategories`, 피드 실패는 `failedSources`의 소스 ID로 반환합니다. 전체 기사 0건은 실패입니다. 발행시각을 확인하지 못한 일반 기사는 제외하며, 상세 본문을 못 받은 기사에는 설명을 본문으로 대신 저장하지 않습니다.
- 카테고리를 바꾸면 이전 목록 요청을 취소하고 선택을 초기화합니다. 조회 실패는 빈 목록과 구분해 재시도할 수 있습니다.

## 설정

전체 예시는 [.env.example](.env.example)에 있습니다.

| 설정 | 용도 |
| --- | --- |
| `DATABASE_URL` | Prisma MySQL 연결 문자열 |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | 웹 로그인 세션과 서비스 주소 |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | 직접 인증 API의 토큰 서명 |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | 양의 정수 초 단위, 기본 900/604800 |
| `CRON_SECRET` | 자동 수집 및 전체 구독자 브리핑 인증, 자동 실행 시 필수 |
| `GEMINI_API_KEY` | 선택: AI 요약 인증 |
| `GEMINI_MODEL` | 기본 `gemini-3.5-flash-lite`, 계정에서 사용할 수 있는 모델로 변경 가능 |
| `AI_SUMMARY_PROMPT` | 선택: `{content}`를 포함한 요약 프롬프트 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | 메일 서버와 TLS 설정 |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | 메일 인증과 발신자 |
| `NEXT_PUBLIC_BASE_URL` | 이메일의 프로필 링크 주소 |

Gemini 기본 모델은 [공식 모델 문서](https://ai.google.dev/gemini-api/docs/models) 기준으로 설정했습니다. AI 키가 없거나 생성에 실패하면 기사 설명/제목을 사용하며, 대체 문구는 AI 요약 캐시에 저장하지 않습니다. 실제 생성 결과만 저장하고 재사용하며, 동시에 최대 3개씩 요청합니다.

메일 서버를 사용할 때 `SMTP_HOST`와 인증 정보를 채웁니다. 일일 브리핑은 저장된 전체 카테고리에서 지난 24시간의 우선순위 상위 50건을 조회하며, 한 카테고리에서 최대 20건을 요약합니다. 테스트 브리핑은 현재 사용자 한 명에게만 발송하며 구독 상태를 바꾸지 않습니다.

## API

| 메서드 / 경로 | 동작 / 인증 |
| --- | --- |
| `GET /api/news` | `category=tech`는 기술 6개 분야 통합, `all`은 전체, 개별 코드는 [CONTENT.md](CONTENT.md) 참고. 목록: `page`, `limit`, `category`, `q`/`search`, `sort`, `minPriority` |
| `GET /api/news/[id]` | 상세, 로그인 상태면 읽음 이력 기록 |
| `POST /api/news/sync` | 로그인 또는 Cron 비밀값, 선택 JSON `{ scope, categories, limitPerCategory }` |
| `GET /api/news/sync` | 스케줄러 호출용, Cron 비밀값 필수 |
| `POST /api/news/send-email` | 로그인, 기사 ID 배열(최대 50개)과 선택 제목 |
| `POST /api/auth/register`, `/api/auth/login` | 직접 회원가입/로그인, 토큰은 HttpOnly 쿠키 |
| `POST /api/auth/refresh`, `/api/auth/logout` | 쿠키 토큰 갱신/로그아웃 |
| `GET /api/auth/me`, `PUT /api/auth/profile` | 로그인 사용자 조회/이름 수정 |
| `GET /api/email/subscribe`, `POST /api/email/subscribe` | 로그인 사용자 구독 조회/변경 (`subscribe`: boolean) |
| `POST /api/email/test-briefing` | 로그인 사용자에게 실제 테스트 메일 발송 |
| `GET`/`POST /api/email/daily-briefing` | Cron 비밀값 필수, 구독자들에게 실제 브리핑 발송 |

웹 API는 유효한 NextAuth 세션 또는 직접 로그인 API의 액세스 쿠키를 인정합니다. 갱신 토큰은 한 번만 교체할 수 있으며, 로그인 시 토큰 정리/저장은 하나의 DB 트랜잭션에서 처리합니다. DB에는 갱신 토큰의 SHA-256 해시(64자)를 저장해 긴 JWT가 기존 열의 길이를 넘지 않도록 합니다. 쿠키는 서명된 JWT를 사용하며 기존 원문 토큰 행도 유효한 갱신 JWT인 경우 호환 조회합니다. 예전 용도 정보가 없는 JWT는 다시 로그인해야 합니다. 브라우저 세션 JSON에는 토큰을 노출하지 않습니다. 토큰 용도 검증이 강화되었으므로 업데이트 후 한 번 로그아웃하고 다시 로그인합니다.

Cron은 `Authorization: Bearer <CRON_SECRET>` 또는 `x-cron-secret` 헤더로 인증한 GET/POST 요청을 사용합니다. 아직 운영 배포와 예약 실행은 구성하지 않았습니다. 서버를 정한 뒤 뉴스 수집과 일일 브리핑의 실행 시각을 등록하고 스케줄러의 시간대를 확인합니다.

## 검증 명령과 화면 테스트

PowerShell에서 프로젝트 루트 기준으로 실행합니다.

```powershell
npm test
npm run typecheck
npm run lint
npm audit
npm run build
```

자동 회귀 테스트는 DB, AI, SMTP를 mock하거나 메모리 전송을 사용합니다. 실제 수집·DB 저장·메일 발송은 다음 수동 테스트로 별도 확인합니다. 개발 서버가 켜진 상태에서 같은 폴더의 `npm run build`를 실행하면 `.next`에 영향을 줄 수 있으므로 서버를 종료하고 빌드합니다.

1. 로그인 전 목록/상세를 열고, 수집 버튼이 로그인 화면으로 안내하는지 확인합니다.
2. 로그인 후 뉴스 수집을 누르고 저장 건수/중복 건수/부분 실패 안내를 확인합니다. 기술 전체 탭과 각 분야에서 여러 출처가 보이는지 확인합니다. 곧바로 다시 누르면 제한 안내와 피드 새로고침이 표시되어야 합니다.
3. 전체 뉴스 탭에서 수집하면 기존 종합 뉴스도 수집됩니다. 카테고리를 빠르게 여러 번 바꾸고 마지막으로 선택한 카테고리만 표시되는지 확인합니다. 스크롤 후 기사 중복과 이전 선택이 남는지도 확인합니다.
4. 체크박스 선택과 기사 열기가 각각 동작하는지 확인합니다.
5. SMTP 설정 후 기사 이메일 및 프로필의 테스트 브리핑을 실행합니다. 이 단계는 실제 메일을 전송합니다. 테스트 브리핑은 현재 사용자에게만 와야 합니다.
6. 구독을 변경하고 새로고침 후 설정이 유지되는지 확인합니다.

## 운영과 의존성

장애별 확인 절차는 [OPERATIONS.md](OPERATIONS.md)에 있습니다. DB 마이그레이션 재설정으로 오류를 해결하면 기존 데이터가 지워질 수 있으므로 연결/권한/마이그레이션 상태를 먼저 확인합니다.

Nodemailer는 보안 수정 버전 `10.0.13`을 사용합니다. NextAuth의 이전 선택적 메일 peer 범위를 `overrides`로 맞췄습니다. 현재 프로젝트는 credentials 로그인만 사용하며, `createTransport`/`sendMail` 호환을 메모리 전송 테스트로 확인합니다. [공식 릴리스](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.13)

초기 환경 점검용 Python 스크립트는 선택 사항입니다. `python scripts/setup.py --bootstrap-env --check-env`는 `.env.example`에서 누락된 `.env`만 생성하고 필수 키 이름을 점검합니다. 실제 값은 출력하지 않습니다. `--force`는 기존 설정을 덮어쓰므로 재생성이 필요한 경우에만 사용합니다.

## 관리자 계정과 대시보드

프로젝트 루트 `.env`에 `ADMIN_ID`, `ADMIN_PASSWORD`와 선택 항목 `ADMIN_EMAIL`을 설정합니다. 관리자 아이디는 영문·숫자·점·밑줄·하이픈 3~64자, 비밀번호는 12자 이상 및 UTF-8 기준 72바이트 이하입니다. `ADMIN_EMAIL` 기본값은 `admin@newshub.local`이며 메일을 받으려면 실제 주소를 사용합니다. 일반 회원과 이메일이 겹치면 동기화를 중단합니다.

```powershell
Set-Location C:\git\developer\firstproject
npx prisma migrate deploy
npm run admin:sync
npm run dev
```

`migrate deploy`는 기존 데이터를 보존하며 관리자 식별자·권한 열을 추가합니다. Windows에서는 실행 중인 개발 서버를 종료한 후 `npx prisma generate`를 실행하면 Prisma DLL 잠금을 피할 수 있습니다. 관리자 설정을 변경하면 `npm run admin:sync`로 DB에 반영합니다. 같은 설정으로 반복 실행해도 계정을 중복 생성하지 않습니다. DB에는 bcrypt 해시를 저장하며 비밀번호 원문은 `.env`에만 둡니다.

`/auth/login`에서 관리자 아이디 또는 이메일로 로그인한 뒤 상단의 관리자 메뉴 또는 `/admin`으로 이동합니다. 관리자 대시보드는 가입 회원 수·메일 구독 수·뉴스 수, 회원의 이름·이메일·구독 상태·가입 시각, 최근 10개 수집 기록을 제공합니다. 회원 목록은 20명씩 조회하며 비밀번호·토큰을 반환하지 않습니다. 회원 수정·삭제 기능은 포함하지 않습니다.

관리자는 기존 `/api/news/sync`와 대시보드에서 최근 성공/부분 성공의 1시간 제한 없이 수집할 수 있습니다. 진행 중인 수집의 중복 실행은 계속 차단합니다. 일반 회원과 Cron의 제한은 유지합니다. 관리자 권한은 요청마다 DB에서 확인하며 요청 JSON이나 JWT의 관리자 주장으로 권한을 부여하지 않습니다.


## 고도화 검증

`npm run check`로 테스트·타입 검사·린트·빌드를 한 번에 실행합니다. 검색·정렬 조건을 URL로 공유할 수 있으며 관리자 화면에서 출처별 수집 결과와 정기 브리핑 발송 상태를 확인합니다. 새 브리핑 상태 테이블과 수집 집계 컬럼의 적용 절차는 [운영 점검](OPERATIONS.md)을 참고하세요.


## 기사 선별·요약과 사전 한국어 번역

기술 분야와 IT·과학은 실제 본문으로 AI 선별·요약을 완료한 기사만 표시합니다. 채택한 외국어 기사는 전체 본문 번역을 이어서 처리하며, 그동안 요약과 원문을 읽을 수 있습니다. 일반 뉴스는 기존 한글 비율 검사와 번역 완료 조건을 유지합니다. 상세 조회는 저장된 요약·번역을 읽고 원문과 전환할 수 있습니다.

npm run dev와 npm run start는 웹 서버와 워커를 함께 실행합니다. 기존 기사 일괄 등록은 npm run translation:enqueue, 현재 상태 조회는 npm run translation:status로 실행합니다. 기본 모델은 하루 450회까지 요청하며, 자체 일일 한도 또는 API의 RPM·TPM·RPD 한도 오류에 걸리면 3.1 Flash Lite → 3.8 Flash → 3.6 Flash 순서로 전환합니다. 모델 사용 불가(404)와 일시적 과부하·시간 초과도 구분해 다음 모델을 시도합니다. 로그는 저장 성공·실패·한도 도달·모델 전환과 실제 사용 모델, 실패 사유를 표시합니다. 대체 모델의 짧은 실제 번역 확인은 npm run translation:check-models로 실행하며 모델당 요청 한 번을 소비합니다. 모든 모델이 대기 중이면 가장 먼저 사용 가능한 시점에 재개합니다. 모델별 한도와 무료 프로젝트 설정은 [운영 점검](OPERATIONS.md)을 참고하세요.
