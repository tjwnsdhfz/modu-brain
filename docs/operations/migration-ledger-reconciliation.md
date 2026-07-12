# Supabase migration ledger 정합화

## 발견된 drift와 백업

2026-07-12 읽기 전용 감사에서 원격 ledger에는 다음 version만 있었다.

- `20260711080852 external_context_graph`
- `20260711080951 external_context_fk_indexes`
- `20260711082335 external_context_import_hardening`
- `20260711113201 analysis_workflow_events_and_annotations`

원격에는 core schema가 존재하지만 `202607110001_modu_brain_core` ledger row가 없고, graph 계열 세 migration은 로컬 version `202607110002`~`202607110004`와 다른 timestamp로 기록되어 있었다. 변경 전 snapshot과 SHA-256은 `.backups/`에 저장했으며 이 디렉터리는 Git에 포함하지 않는다.

- snapshot: `supabase-pre-hardening-20260712T035548+0900.json`
- SHA-256: `57ea5e4d4c16255d349e374d6ade293aeedc96074db682e9c24bc6d3b331ed43`

## 2026-07-12 적용 기록

1. 원격 사용자·프로젝트·원문·분석 건수를 확인했다. 사용자 데이터 테이블은 모두 비어 있었고 rate-limit bucket 9건만 존재했다.
2. 기존 네 ledger row의 SQL 원문과 작성자 metadata를 읽어 보존 여부를 확인했다.
3. 단일 transaction에서 세 alias version만 로컬 version으로 바꾸고, 이미 존재하는 core schema의 누락 ledger row를 추가했다. 이 단계에서는 schema 객체를 만들거나 삭제하지 않았다.
4. additive expand migration을 Supabase migration API로 적용했다.
5. 적용 뒤 전체 공개 테이블의 RLS, 새 열, service-only RPC 권한과 데이터 건수를 다시 확인했다.

현재 원격과 로컬의 정상 ledger는 다음과 같다.

```text
202607110001 modu_brain_core
202607110002 external_context_graph
202607110003 external_context_fk_indexes
202607110004 external_context_import_hardening
20260711113201 analysis_workflow_events_and_annotations
20260711185902 operations_hardening_expand
20260711191125 authenticated_mutation_boundary
```

Sites와 Render가 service-only RPC를 사용하는 새 버전으로 배포되고 readiness와 공개 분석이 확인된 뒤 contract migration을 적용했다. 이제 로그인 사용자의 직접 테이블 쓰기와 구형 분석 시작·일반 rate-limit RPC 실행은 차단된다. 원문 가져오기와 분석 주석 RPC는 내부에서 `auth.uid()`·소유권·크기·멱등성을 검증하므로 한 릴리스 동안 호환 경로로 유지한다. 다음 schema major release에서는 `app_import_source_context`와 `app_create_analysis_run_annotation`으로 옮긴 뒤 두 호환 RPC의 authenticated 실행 권한을 제거한다.

## 향후 변경 원칙

- 배포 전 `supabase/checks/migration_drift.sql`을 실행해 위 일곱 version과 일치하는지 확인한다.
- 새 drift가 있으면 ledger를 임의로 바꾸지 않고 먼저 snapshot과 schema diff를 만든다.
- 운영 schema 변경과 복구는 새 forward migration으로 명시한다.
- production rollback 폴더의 `*.down.sql`은 실행하지 않는다. 해당 파일은 빈 로컬 DB의 가역성 시험 전용이다.
