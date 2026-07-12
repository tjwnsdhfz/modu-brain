# PR 벤치마크와 적용 근거

이 문서는 [PR #209](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/209)의 다음 개발 우선순위를 정하기 위해, 구현이 많이 진행된 다섯 개 PR을 읽기 전용으로 비교한 결과를 기록한다. 조사 기준일은 2026-07-11이며, 수치는 GitHub PR 메타데이터, 변경 파일 목록, head tree와 check-run 조회 결과를 기준으로 한다.

이 문서에서는 다음 두 종류의 정보를 구분한다.

- **검증 사실**: GitHub 또는 현재 작업 트리에서 직접 확인한 내용이다.
- **채택·계획**: 벤치마크를 바탕으로 이 브랜치가 따르기로 한 구현 원칙이다. 코드가 일부 존재하더라도 테스트 실행이나 브라우저 확인 증거가 없으면 완료로 표현하지 않는다.

## 1. 선정 기준

후보 PR은 다음 기준을 함께 평가해 선정했다.

1. **구현 깊이**: 화면 수나 추가 줄 수만이 아니라 도메인 로직, API, 상태 관리와 오류 경계가 실제 코드로 연결되어 있는가.
2. **테스트와 검증**: 실행 가능한 테스트, E2E 경로, lint·typecheck·build를 묶은 재현 가능한 검증 명령이 있는가.
3. **사용자 경험**: 온보딩, 반응형 화면, 접근성, 오류·빈 상태와 발표 가능한 사용자 흐름이 있는가.
4. **문서와 추적성**: PRD, ADR, SPEC, 개발 계획, 실행 보고서와 남은 한계가 코드에 연결되어 있는가.
5. **전달 완성도**: 다른 사람이 설치·실행·검증하거나 배포된 데모를 확인할 수 있는가.

lockfile, 생성 코드, 브라우저 frame dump와 대형 계획 문서는 전체 변경량에는 포함하되 구현 깊이를 평가할 때는 별도로 감안했다. 따라서 추가 줄 수가 큰 순서가 곧 최종 순위는 아니다.

## 2. 검증된 비교 결과

| PR | 검증된 변경 규모 | 테스트 정의 | 선택 이유와 한계 |
| --- | --- | --- | --- |
| [#209 모두의 뇌](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/209) | 13 commits, 48 files, `+5,842/-1`; 문서 18개, 소스 21개, 에셋 7개 | 벤치마크 시점 실행 가능한 테스트 파일 0개 | React·TypeScript UI, 맥락 분석 API, PRD·TRD·프롬프트·시장·디자인 문서가 이미 연결되어 있다. 약점은 기능량이 아니라 자동 검증과 운영 증거의 부재다. |
| [#511 LocalTwin](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/511) | 57 commits, 88 files, `+11,890/-3,404`; 문서 39개, 소스 22개 | 3 test files, 9 top-level cases | React와 FastAPI, 디자인 토큰, 문서 허브, task packet·run report·failure log, 단일 로컬 검증 명령을 함께 구성했다. lockfile과 문서 비중이 크며 품질 CI 실행은 확인되지 않았다. |
| [#621 Runtime Diagnostic](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/621) | 10 commits, 90 files, `+4,906/-367` | 변경된 8 test files에 최소 63 top-level cases; head 전체는 9 files, 66 cases | JSON 영속화, 원자적 쓰기, 재시작 복구와 Playwright 기반 HTTP·SSE·취소·reload·restart 검증이 연결되어 있다. 변경 파일 일부는 생성된 protocol type이다. |
| [#628 온보딩·Git 학습 시뮬레이터](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/628) | 7 commits, 41 files, `+4,081/-174`; 소스 26개, 문서 10개 | 변경된 2 test files, 8 cases; head 전체는 3 files, 9 cases | 온보딩·프로필·학습 흐름과 순수 TypeScript 엔진, 그래프 어댑터, 저장소, SPEC과 Design Skill을 함께 구현했다. UI와 테스트 가능한 도메인 로직의 분리가 좋다. |
| [#626 접근성 온보딩](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/626) | 10 commits, 14 files, `+5,639/-693`; 이 중 약 4,095줄은 설계·계획 문서 | 변경된 2 test files, 4 cases; head 전체는 4 files, 9 cases | 390px 반응형, `prefers-reduced-motion`, 범위가 제한된 모션과 사용자에게 보이는 결과 중심 테스트가 강점이다. 마이그레이션은 정책과 계획 비중이 높아 전부 구현 완료로 보지는 않았다. |
| [#568 7화면 데모 SPA](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/568) | 9 commits, 20 files, `+2,744/-75`; 소스 15개, 문서 3개 | 테스트 파일 0개 | 공통 stepper를 쓰는 7개 화면과 [GitHub Pages 데모](https://kimsunho2000.github.io/hub/)가 있어 발표와 전달 완성도가 높다. 자동 검증은 약하다. |

테스트 case 수는 head 파일에서 최상위 `test`·`it` 또는 Python `test_*` 정의를 센 값이다. 이는 테스트가 존재한다는 증거이지, 해당 head에서 테스트가 성공했다는 증거는 아니다.

## 3. 품질 CI에 대한 공통 주의사항

조사한 여섯 PR 모두에서 build·lint·test를 통과시킨 품질 CI check-run은 확인하지 못했다.

- #209, #621, #628, #626, #568의 조회 가능한 head에는 품질 check-run이 없었다.
- #511의 contributor fork head에는 `Auto Merge on time` 성공 check가 하나 있었지만, 이는 예약 병합 workflow이며 코드 품질 검사가 아니다.
- 각 head tree에서 확인한 공통 GitHub workflow도 자동 병합 용도였다.

따라서 PR 본문의 검증 설명이나 로컬 테스트 구조는 참고할 수 있지만, CI 성공으로 해석해서는 안 된다. 이 브랜치도 `npm run check`의 로컬 성공과 실제 GitHub Actions 성공을 별도 증거로 남겨야 한다.

## 4. 이 브랜치에서 채택한 패턴

아래 표는 벤치마크에서 확인한 사실이 아니라, 이를 바탕으로 이 브랜치가 채택한 구현 방향과 현재 확인 가능한 상태다.

| 채택 패턴 | 참고 PR | 이 브랜치의 적용 방식 | 현재 상태와 완료 증거 |
| --- | --- | --- | --- |
| 단일 check gate | [#511](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/511) | `npm run check`가 lint, test, build를 순서대로 실행하고 build가 typecheck를 포함한다. | **코드 적용됨.** `package.json`에서 확인했다. 실제 명령의 종료 코드 0과 CI 실행 결과가 있어야 검증 완료다. |
| API·provider 계약 테스트 | [#511](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/511), [#621](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/621), [#628](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/628) | 정상 분석뿐 아니라 잘못된 JSON, 입력 길이, 지원하지 않는 provider, 키 누락, 인증·rate limit·timeout, 외부 응답 스키마 오류를 고정된 계약으로 검증한다. 클라이언트 응답 type guard도 같은 계약을 확인한다. | **채택됨, 실행 증거 대기.** 테스트 파일과 `npm test` 성공 결과가 함께 있어야 완료로 간주한다. |
| 참여자 근거 UI | [#628](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/628), [#626](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/626) | 참여자별 해석만 표시하지 않고 입력에서 가져온 `evidence`, 합의점, 긴장점, 개인정보 추론 제한 문구를 같은 화면에서 확인하게 한다. | **부분 적용됨.** 서버 결과, 타입과 샘플 데이터에는 근거 필드가 있다. 전용 화면 렌더링과 사용자 흐름 확인이 있어야 완료다. |
| 정직한 상태 표시 | [#621](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/621), [#626](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/626) | 결정은 `확정·검토 중·불명확`으로 구분하고, 결과가 local heuristic인지 외부 모델인지 표시한다. 외부 provider 실패를 조용히 로컬 결과로 바꾸지 않고 원인을 오류 코드와 사용자 메시지로 드러낸다. | **코드 적용됨.** decision status, provider 정보, 구조화된 오류가 확인된다. 브라우저에서 성공·실패 상태를 모두 확인해야 한다. |
| 서버 키 격리 | [#511](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/511) | OpenAI 키와 모델 선택은 서버 provider만 읽는다. 클라이언트 요청·응답과 번들에는 키를 전달하지 않으며, local heuristic을 안전한 기본값으로 유지한다. | **코드 적용됨.** `.env.example`과 서버 provider에서 확인했다. 빌드 산출물·브라우저 네트워크·저장소 검색에서 키가 없음을 추가 확인해야 한다. |
| 브라우저 검증 | [#621](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/621), [#568](https://github.com/connect-AIAgentChallenge-26-1/hub/pull/568) | 실제 서버를 기준으로 예시 입력, 분석 요청, 참여자 근거, 합의·긴장 상태, 탭 이동, provider 표시와 오류 복구를 한 경로로 확인한다. 데스크톱과 모바일 폭도 함께 확인한다. | **검증 대기.** 브라우저 실행 기록이나 자동 E2E 결과가 남기 전에는 완료로 표현하지 않는다. |

## 5. 최소 검증 시나리오

이 브랜치의 채택 패턴은 다음 증거가 모두 있을 때 완료로 판단한다.

1. `npm run check`가 lint, test, typecheck와 production build를 모두 성공시킨다.
2. local heuristic 정상 요청에서 참여자 근거, 합의점, 긴장점과 provider 표시가 화면에 보인다.
3. 너무 짧은 입력과 잘못된 API 요청에서 샘플 결과로 덮이지 않고 명확한 오류 상태가 보인다.
4. OpenAI provider를 선택하고 서버 키가 없을 때 클라이언트에 키나 내부 오류를 노출하지 않은 채 명시적인 설정 오류가 보인다.
5. 데스크톱과 모바일 브라우저에서 입력 → 분석 → 개요 → 지식맵 → 온보딩 흐름을 완료할 수 있다.
6. GitHub Actions가 추가되면 auto-merge 상태와 별개로 `npm run check` 결과가 PR check에 표시된다.

## 6. 결론

#209는 이미 문서와 UI 양에서 비교 후보의 중상위 수준이다. 이번 벤치마크에서 가져올 핵심은 더 많은 화면이나 문서를 추가하는 것이 아니라, **한 번에 재현되는 검증 명령, 실패를 숨기지 않는 상태, 입력 근거를 확인할 수 있는 UI, 서버에 격리된 키, 실제 브라우저 경로의 실행 증거**다. 이 기준을 충족해야 구현 규모가 제품 완성도로 이어졌다고 판단한다.
