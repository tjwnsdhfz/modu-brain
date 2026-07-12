# 독립 저장소 배포 가이드

이 문서는 `https://github.com/tjwnsdhfz/modu-brain`의 `main` branch를 조직 저장소나 외부 maintainer 승인 없이 배포하는 절차를 설명합니다.

## GitHub 기준선

- 기본 branch: `main`
- 품질 workflow: `.github/workflows/modu-brain-quality.yml`
- push 검증: lint, typecheck, 단위·계약 테스트, 커버리지, 프로덕션 빌드, secret scan, 공개 브라우저 접근성, 복원력·부하, 로컬 Supabase migration·RLS·인증 E2E
- 조직 저장소용 자동 병합 workflow는 포함하지 않습니다.

## Supabase

1. 별도 Supabase 프로젝트를 만들거나 기존 Modu Brain 데모 프로젝트를 사용합니다.
2. `supabase/migrations/`를 순서대로 적용합니다.
3. Authentication의 Site URL과 Redirect URL에 최종 Sites/Render origin의 `/login`을 추가합니다.
4. 아래 값은 GitHub에 커밋하지 않고 배포 서비스의 환경변수로만 설정합니다.

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

## Render

저장소 루트의 `render.yaml`을 Blueprint로 연결합니다. 서비스는 무료 Node runtime, `main` branch, Singapore region을 사용하며 GitHub CI가 통과한 커밋만 자동 배포합니다.

[Render에서 독립 저장소 배포](https://render.com/deploy?repo=https://github.com/tjwnsdhfz/modu-brain)

Blueprint 생성 화면에서 `sync: false`로 표시된 Supabase 값을 입력합니다. `SAFETY_IDENTIFIER_SECRET`과 `IP_HASH_SECRET`은 자동 생성됩니다. OpenAI 비용이 발생하지 않도록 다음 기본값을 유지합니다.

```text
MODU_BRAIN_ANALYSIS_PROVIDER=local-heuristic
MODU_BRAIN_OPENAI_ENABLED=false
```

배포가 끝나면 실제 Render origin을 Supabase Redirect URL에 등록하고 다음 두 endpoint를 확인합니다.

```text
GET /api/health/live
GET /api/health/ready
```

## Sites

`.openai/hosting.json`은 현재 공개 Sites 프로젝트를 재사용합니다. 검증된 `main` source로 새 버전을 저장·배포하고, 같은 Supabase 환경변수와 두 HMAC secret을 Sites runtime에 설정합니다. D1과 R2는 사용하지 않습니다.

## 공개 전 확인

- GitHub Actions의 모든 job이 성공했는지 확인합니다.
- `/api/health/ready`가 DB 연결을 포함해 `200`을 반환하는지 확인합니다.
- Magic Link가 최종 origin으로 돌아오는지 확인합니다.
- 다른 사용자의 프로젝트·원문·분석이 `404`로 차단되는지 확인합니다.
- 공유 링크 만료와 폐기가 즉시 반영되는지 확인합니다.
- 저장소와 빌드 결과에 secret이 포함되지 않았는지 확인합니다.
