# AWS 개발 브랜치 전환 매뉴얼

## 목적

EC2에서 서비스 코드를 `main`에서 개발 브랜치로 전환하거나, 다시 되돌릴 때 안전하게 적용하기 위한 절차입니다.

## 적용 대상

- 서버: AWS EC2 (Ubuntu)
- 프로세스 매니저: `pm2`
- 앱 경로: `~/app`

## 사전 점검

1. 현재 접속 브랜치와 변경사항 확인
2. 운영 환경 변수(`.env`) 최신 상태 확인
3. DB 마이그레이션 필요 여부 확인
4. 복구(rollback) 브랜치 이름 확보 (`main`)

```bash
cd ~/app
git status
git branch --show-current
pm2 show newshub
```

## 표준 전환 절차

아래 예시는 대상 브랜치가 `fix/main1.0`인 경우입니다.

```bash
cd ~/app
git fetch origin
git checkout fix/main1.0
git pull origin fix/main1.0
```

### 의존성 설치

```bash
npm ci
```

`npm ci`가 `Killed`로 실패하면 메모리 부족 가능성이 높습니다. 스왑 추가 후 재시도합니다.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

재시도:

```bash
npm ci
```

### 빌드/재기동

```bash
npm run build
pm2 restart newshub --update-env
pm2 logs newshub --lines 100
```

## DB 스키마 변경이 있는 경우

브랜치에 Prisma 변경이 포함되면 아래를 추가 실행합니다.

```bash
npx prisma generate
npx prisma migrate deploy
```

## 동작 검증

### 1) 앱 기동 확인

```bash
pm2 status
pm2 logs newshub --lines 100
```

- `next: not found`가 보이면 의존성 설치 실패입니다.
- 재시작 횟수(`restarts`)가 빠르게 증가하면 비정상입니다.

### 2) 뉴스 동기화 API 확인

```bash
curl -i -X POST "http://localhost:3000/api/news/sync" \
  -H "x-cron-secret: YOUR_SECRET"
```

- `200 OK`: 정상
- `429 Too Many Requests`: 최근 1시간 내 실행으로 정상 제한
- `401 Unauthorized`: 시크릿/인증 설정 확인 필요

## 롤백 절차 (문제 발생 시)

```bash
cd ~/app
git fetch origin
git checkout main
git pull origin main
npm ci
npm run build
pm2 restart newshub --update-env
pm2 logs newshub --lines 100
```

## 운영 체크리스트

- 브랜치 전환 전 `git status`가 깨끗한지 확인
- `npm ci` 성공 여부 확인
- `npm run build` 성공 여부 확인
- `pm2 logs`에 오류 반복이 없는지 확인
- `/api/news/sync` 수동 호출 결과 확인
- 필요 시 `CRON_SECRET` 교체 후 cron 호출 값 동기화
