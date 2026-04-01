# 운영 런북

## 뉴스 동기화 빠른 점검

뉴스 동기화가 실패해 보일 때 아래 순서대로 점검

```bash
pm2 show newshub
curl -i -X POST "http://localhost:3000/api/news/sync" -H "x-cron-secret: YOUR_SECRET"
pm2 logs newshub --lines 200
```

## 응답 코드별 분류

- `401 Unauthorized`
  - 시크릿 헤더가 없거나 값이 다릅니다.
  - 런타임 환경 변수 `CRON_SECRET`과 요청 헤더 값을 확인
- `429 Too Many Requests`
  - 최근 10분 내 동기화가 이미 성공했습니다.
  - 제한 시간이 지난 뒤 다시 호출
- `200 OK`
  - 응답 JSON 카운터로 단계 상태를 판단
    - `fetched=0`: 크롤링/파싱 실패 또는 소스 구조 변경 가능성
    - `fetched>0` 이고 `persisted=0`: 중복 판정 또는 DB 저장 경로 점검 필요
    - `persisted>0`: 동기화 성공

## CRON_SECRET 교체 절차

1. 충분히 긴 랜덤 시크릿을 새로 생성
2. 서버 환경 변수 `CRON_SECRET` 값을 교체
3. 프로세스 매니저를 환경 변수 갱신 옵션으로 재시작
4. cron/모니터링 호출 주체의 시크릿 값을 모두 새 값으로 변경
5. 수동 동기화 1회를 호출해 정상 응답을 확인

## Retry/Backoff 설계 권고

일시적 네트워크 장애에 대비해 `lib/news-service.ts`에 재시도 로직 도입을 권장

- 대상 함수
  - `fetchNaverSectionHtml(...)`
  - `fetchHtml(...)`
- 재시도 정책
  - 최대 3회 시도
  - 백오프: 300ms, 900ms, 1800ms (+ 소량 jitter)
  - 재시도 대상: timeout, 네트워크 오류, HTTP `429/5xx`
  - 재시도 제외: HTTP `400/401/403/404`
- 로깅
  - 시도 횟수, URL host, 상태 코드/오류 타입을 기록
  - PM2 로그 과다를 막기 위해 한 줄 요약 형식 유지
