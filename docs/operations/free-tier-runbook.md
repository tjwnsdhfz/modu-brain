# Modu Brain 무료 운영 런북

이 문서는 별도 유료 서비스 없이 공개 데모를 안전하게 운영하기 위한 기준이다. 기능보다 데이터 보존과 복구 가능성을 우선하며, OpenAI 호출은 기본적으로 꺼 둔다.

## 운영 기준

- 주 서비스 주소는 Sites 배포로 통일하고 Render는 무료 대기 경로로 둔다.
- 두 배포 모두 `local-heuristic`만 기본 제공하며 `MODU_BRAIN_OPENAI_ENABLED=false`를 유지한다.
- Render의 플랫폼 health check는 DB를 조회하지 않는 `/api/health/live`를 사용한다. `/api/health/ready`는 사람이 의존성 상태를 확인할 때 사용하며 짧은 캐시를 적용한다.
- 원문·토큰·이메일·IP·분석 결과는 로그에 남기지 않는다. request ID, route template, status, duration, safe error code만 기록한다.
- 운영 DB migration은 rollback SQL로 되돌리지 않는다. 새 forward-fix 또는 검증한 logical backup 복구만 사용한다.

## 배포 전 필수 게이트

1. `npm ci`
2. `npm run check`
3. `npm audit --omit=dev --audit-level=high`
4. `npm run ops:migrations:check -- --linked`
5. DB 변경이 있으면 backup 생성과 별도 빈 PostgreSQL 17 DB restore drill
6. 로컬 또는 폐기 가능한 staging에서 `npm run ops:load`
7. OpenAI, DB, 인증 이메일 kill switch와 현재 배포 commit 확인

하나라도 실패하면 원격 DB migration과 공개 배포를 중단한다.

## 무료 백업과 복구

Supabase Free에는 자동 일일 백업이 없으므로 [공식 권고](https://supabase.com/docs/guides/platform/backups)에 따라 CLI logical dump를 사용한다.

### 백업

PostgreSQL direct connection string을 현재 셸의 `DATABASE_URL`에만 설정한 뒤 실행한다. URL은 파일과 콘솔에 기록되지 않는다.

```powershell
$env:DATABASE_URL = "postgresql://..."
npm run ops:backup
Remove-Item Env:DATABASE_URL
```

생성된 `.backups/supabase/<timestamp>/` 전체를 BitLocker 또는 암호화된 외장 저장소/개인 클라우드 폴더 한 곳에 추가 복사한다. 저장소에는 커밋하지 않는다. 권장 보존은 최근 일일 7개와 주간 4개다.

목표 RPO는 24시간, 목표 RTO는 2시간이다. 데이터 변경이 큰 날과 모든 schema migration 직전에는 추가 백업을 만든다.

### 복구 연습

실서비스가 아닌 빈 PostgreSQL 17/Supabase 검증 프로젝트에서만 실행한다. `psql` 17 client가 필요하다.

```powershell
$env:RESTORE_DATABASE_URL = "postgresql://empty-verification-db"
$env:CONFIRM_RESTORE_TARGET = "empty-target"
npm run ops:restore -- ".backups/supabase/<timestamp>"
Remove-Item Env:RESTORE_DATABASE_URL
Remove-Item Env:CONFIRM_RESTORE_TARGET
```

스크립트는 파일 checksum을 먼저 확인하고, 대상에 Modu Brain 핵심 테이블이 있으면 쓰기 전에 중단한다. 복구 뒤에는 다음을 추가 확인한다.

- migration 목록과 schema checksum
- 사용자별 프로젝트·원문·분석 row count
- source와 snapshot의 SHA-256 일치
- `supabase test db`
- 로그인부터 공유 폐기까지 Playwright authenticated flow

## 부하 시험

기본 도구는 외부 SaaS 없이 Node 내장 `fetch`만 쓴다. 기본 대상은 localhost이며 원격 주소는 명시적으로 허용하지 않으면 거부한다.

```powershell
$env:LOAD_TEST_PHASES = "5:30,25:30,50:30,75:30"
npm run ops:load
```

인증 staging API를 시험할 때만 `LOAD_TEST_BASE_URL`, `LOAD_TEST_PATH`, `LOAD_TEST_METHOD`, `LOAD_TEST_BEARER_TOKEN`, `LOAD_TEST_BODY`를 일시적으로 설정한다. 실서비스 Sites/Render 주소에는 부하를 주지 않는다.

합격 기준은 일반 조회 p95 500ms 이하, mutation p95 1초 이하, 로컬 분석 p95 2초 이하, 5xx/네트워크 오류 1% 이하다. 429는 정상 한도 동작을 따로 검증하고 용량 합격으로 계산하지 않는다.

## 장애 대응

### DB 장애

1. `/api/health/live`와 `/api/health/ready`를 각각 확인한다.
2. ready만 실패하면 로그인·저장·공유를 일시 중단하고 공개 로컬 샘플은 유지한다.
3. 같은 request ID의 구조화 로그에서 `DATABASE_UNAVAILABLE`과 circuit 상태를 확인한다.
4. 잘못된 migration 직후라면 추가 쓰기를 멈추고 forward-fix를 우선한다.
5. 데이터 손상이 확인된 경우에만 마지막 검증 backup으로 새 DB를 복구하고 DNS/환경변수를 전환한다.

### 인증 이메일 장애 또는 429

1. 로그인 화면의 재전송 cooldown이 끝날 때까지 반복 요청을 막는다.
2. Supabase Auth 로그에서 `/otp` 429와 제공된 retry 시간을 확인한다.
3. CAPTCHA가 구성되어 있으면 token 전달 실패를 확인한다.
4. 무료 기본 발송 한도를 넘은 동안에는 저장 없는 샘플 데모를 안내한다. 발송 성공 응답을 실제 메일 도착으로 표현하지 않는다.

### OpenAI 장애 또는 비용 위험

1. `MODU_BRAIN_OPENAI_ENABLED=false`로 즉시 비활성화한다.
2. 로컬 분석은 계속 제공하고 자동 fallback으로 OpenAI 결과처럼 위장하지 않는다.
3. 재활성화 전 전체 deadline, `max_output_tokens`, request ID/usage 저장, 일일 한도를 확인한다.
4. 공개 데모에서는 비용 승인이 없는 한 재활성화하지 않는다.

### 트래픽 급증

1. 429 비율, p95, event-loop 지연, DB ready 상태를 확인한다.
2. 익명 분석/import 한도를 낮추고 로그인 저장 기능은 유지한다.
3. 공유 링크는 token+IP와 IP 전체 bucket을 함께 사용해 단일 NAT 사용자를 과도하게 막지 않는다.
4. DB가 불안정하면 mutation을 503과 `Retry-After`로 빠르게 실패시켜 연결 적체를 막는다.

### 배포 회귀

1. `/api/health/live`의 commit과 Sites/Render 배포 version을 비교한다.
2. DB schema가 바뀌지 않았다면 직전 검증 version으로 애플리케이션만 되돌린다.
3. expand migration 뒤에는 이전 앱과 새 앱이 모두 동작하는 기간을 유지한다.
4. contract migration은 새 앱이 두 배포에서 검증된 뒤 별도 release로 적용한다.

## 개인정보와 보존

- 기본 보존은 사용자가 삭제할 때까지이지만 archive 데이터는 UI에서 복원 또는 영구 삭제할 수 있어야 한다.
- 계정 export는 프로젝트, 원문, 분석, annotation, 공유 링크 metadata를 기계 판독 JSON으로 제공한다. 공유 원문 token은 export하지 않는다.
- 계정 삭제는 현재 session을 먼저 폐기하고 모든 소유 데이터 cascade 완료를 확인한다.
- 공유 화면은 전체 원문·이메일·provider 내부정보를 제외하지만, 근거 인용 자체에 개인정보가 있을 수 있음을 생성 전에 경고한다.
- 백업에 남은 삭제 데이터는 위 보존 주기에 따라 최대 28일 안에 만료된다고 안내한다.

## 정기 점검

- 매일: live/ready, Auth 429, 5xx, DB 크기, 마지막 backup 성공
- 매주: `pg_stat_statements` 상위 쿼리, dead tuple, rate bucket cleanup, archive 용량
- 매월: 빈 DB restore drill, secret 교체 계획, account delete/export drill, 25~75 RPS staging 시험

두 공개 origin의 빠른 상태 확인은 `npm run ops:monitor`로 실행한다. 이 명령은 원문이나 인증정보를 보내지 않고 live endpoint의 상태·지연·commit만 출력하며, 하나라도 실패하면 종료 코드 1을 반환한다. Windows 작업 스케줄러에 연결할 수 있지만 DB를 조회하는 ready endpoint를 짧은 간격으로 반복 호출하지 않는다.
