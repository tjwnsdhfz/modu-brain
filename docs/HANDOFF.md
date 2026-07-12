# Modu Brain v2 handoff

최종 갱신: 2026-07-12 KST

## 저장소와 작업 범위

- 독립 저장소: `https://github.com/tjwnsdhfz/modu-brain`
- 기준 브랜치: `main`
- 작업 브랜치: `agent/standalone-v2-hardening`
- 패키지 버전: `2.0.0`
- 원래 챌린지 저장소 `hub-N031`은 이 작업에서 수정하지 않았다.

## 이번 증분에서 구현한 내용

- GitHub Actions 최신 major와 6시간 주기 무료 uptime workflow
- Render Blueprint의 독립 저장소·`main` 기준 설정
- 공개 가져오기 API를 `/api/v1/public/context-analysis/import`로 이전
- 구형 `/api/context-analysis*`의 `410 LEGACY_ENDPOINT_REMOVED`
- 브라우저와 API의 same-origin HttpOnly 쿠키 전용 인증
- service-only `app_import_source_context`, `app_create_analysis_run_annotation`
- 가져오기 파서 버전, 저장 전 미리보기, 중복 결과 안내
- 원문 근거 기반 신뢰도, 결정 생명주기, 상충 가능성 검토
- 최근 두 성공 실행을 비교하는 시간축 지식맵과 접근 가능한 범례
- KoPub World Dotum 우선 글꼴과 프로젝트 metadata 14px 최소 가독성 계층

## 검증

`npm run check` 통과:

- ESLint 통과
- Vitest 37 files / 349 tests 통과
- statements 83.64%, branches 76.57%, functions 85.84%
- 9개 migration/rollback 안전성 검사 통과
- TypeScript와 production Sites/Node build 통과
- `git diff --check` 통과

로컬 Docker daemon이 실행되지 않아 `supabase test db`는 GitHub의 Supabase job에서 확인해야 한다.

## 운영 Supabase 적용 상태

- project ref: `tduqhanlwjksfrxkareu`
- expand `20260712031058_app_import_and_annotation_boundary` 적용 완료
- 새 `app_*` 함수는 `service_role`만 실행 가능함을 확인
- 구형 두 authenticated RPC는 현재 서비스 보호를 위해 아직 실행 가능
- contract `20260712031100_revoke_authenticated_compatibility_rpcs`는 새 코드 배포와 로그인 smoke 뒤에만 적용

고정 순서:

```text
expand 완료
→ feature branch push와 PR CI
→ main 병합
→ Sites/Render 새 코드 배포
→ 로그인 가져오기·annotation smoke
→ contract 적용
→ Supabase security advisor 재확인
```

## 배포 메모

- Sites project id: `appgprj_6a51d54ffb648191b12e9d4a5a3c173c`
- 공개 URL: `https://modu-brain-n031.ksjun29.chatgpt.site`
- 독립 Render Blueprint 서비스 이름: `modu-brain-tjwnsdhfz`
- uptime 대상은 GitHub repository variable `MODU_BRAIN_MONITOR_TARGETS`로 교체 가능

## 재개 문장

`modu-brain-standalone/docs/HANDOFF.md를 읽고, PR CI와 Sites/Render 배포 상태를 확인한 뒤 로그인 가져오기·annotation smoke를 통과하면 contract migration을 적용해 주세요.`
