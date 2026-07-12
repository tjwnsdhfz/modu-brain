# 모두의 뇌 작업 분해 체크리스트

## 1. 기획 산출물

- [x] 프로젝트명을 모두의 뇌로 수정
- [x] 회의 요약/업무표 중심에서 협업 맥락 공유 중심으로 문제 정의 수정
- [x] 목표 사용자 정리: 대학생 팀, 연구 프로젝트, 공모전/해커톤 팀
- [x] 사용자 시나리오 수정
- [x] 핵심 기능 3개 재정의
- [x] MVP 포함/제외 범위 수정
- [x] 예시 입력/출력 수정
- [x] 시장 조사 및 경쟁 분석 문서 작성
- [x] PRD 작성
- [x] TRD 작성
- [x] 프롬프트 디자인 문서 작성
- [x] Apple 스타일 단순 벡터 대표 이미지 제작
- [x] Canva 편집 디자인 생성
- [x] Figma FigJam 흐름도 생성
- [x] README와 PR 본문에서 대표 PNG 바로 표시
- [x] Figma 디자인 시스템 문서 작성
- [x] 모두의 뇌 Design Skill 문서 작성
- [x] Figma 개발 핸드오프 문서 작성
- [x] Figma 보드 프리뷰 HTML 작성
- [x] PR #209와 개발 수준이 높은 비교 PR 5개의 벤치마크 문서 작성

## 2. 개발 산출물

- [x] React + TypeScript 개발 환경 구성
- [x] `NewsCard` 컴포넌트 작성
- [x] CSS Modules 적용
- [x] 샘플 데이터로 카드 3개 렌더링
- [x] 문서 입력 화면 구현
- [x] 맥락 추출 결과 화면 구현
- [x] 새 참여자 온보딩 요약 화면 구현
- [x] `/api/context-analysis` 개발용 API 구현
- [x] 입력 검증과 API 오류 응답 구현
- [x] UI의 `맥락 분석하기` 버튼을 실제 API 호출과 연결
- [x] 팀원별 관점 에이전트 확장 타입 추가
- [x] 참여자별 입력 근거, 공통 합의, 관점 충돌·확인 필요 UI 구현
- [x] `idle / loading / sample / success / error` 상태 분리
- [x] 오류 또는 입력 수정 시 이전 결과와 샘플을 성공 결과처럼 남기지 않도록 처리
- [x] API node ID, type, link를 사용하는 동적 SVG 지식맵 구현
- [x] `local-heuristic`과 `openai` provider 계약 분리
- [x] OpenAI Responses API 구조화 출력과 Zod 응답 스키마 구현
- [x] OpenAI 키를 서버 provider에서만 읽도록 격리
- [x] provider 설정 누락·인증·rate limit·timeout·잘못된 응답의 구조화 오류 구현
- [x] 근거 없는 결정·참여자·질문·용어를 빈 배열과 명시적 빈 상태로 처리
- [x] 입력 수정·재분석·연결 종료 시 브라우저부터 OpenAI SDK까지 요청 취소 전파
- [x] OpenAI 외부 전송 조건을 제출 전에 고지하고 preview 서버를 기본 `127.0.0.1`로 제한
- [x] 정적 응답 보안 헤더와 Windows encoded traversal 차단 회귀 테스트 추가
- [x] 서버·HTTP API·클라이언트·상태 UI·동적 지식맵 회귀 테스트 작성
- [x] lint, test, typecheck, build를 묶은 `npm run check` 추가
- [ ] `npm run check`를 실행하는 품질 CI workflow 파일 원격 반영 — 로컬 준비 완료, OAuth `workflow` scope 재인증 필요
- [x] `npm run build` 검증

## 3. 남은 작업과 외부 검증

- [x] 실제 AI API 연결 방향 정리
- [x] 지식맵 노드/링크 데이터 구조 구체화
- [x] 선택형 OpenAI provider 코드 연동
- [ ] OpenAI live paid call 실행 및 실제 모델 품질·비용·권한 확인 — 아직 실행하지 않음
- [x] 최신 작업 트리에서 `npm run check` 종료 코드 0 기록 — 7개 파일, 55개 테스트 통과
- [x] 실제 브라우저에서 대기 → 예시 → 분석 → 근거 UI → 동적 지식맵 → 온보딩 → 오류 흐름 검증
- [x] 데스크톱·390px 모바일 최신 화면 캡처와 가로 넘침 없음 확인
- [ ] 브랜치를 push해 `Modu Brain quality` GitHub Actions 결과 확인
- [ ] Figma MCP 한도 해제 후 실제 Figma 파일에 디자인 시스템 반영

## 4. 검증 기준

- [x] 기존 회의 요약 에이전트와 차별점이 명확하다.
- [x] 문제 정의가 협업 맥락 손실과 노동력 낭비를 다룬다.
- [x] 시장 조사와 경쟁 분석이 기획 타당성을 뒷받침한다.
- [x] README에서 모든 문서와 대표 이미지에 접근할 수 있다.
- [x] GitHub PR 본문에서 대표 PNG가 바로 보인다.
- [x] `NewsCard` 컴포넌트가 요구 props로 렌더링된다.
- [x] `npm run dev`에서 확인 가능한 시나리오가 3개 이상 있다.
- [x] API 정상 응답과 입력 오류 응답을 확인했다.
- [x] 첫 진입·명시적 샘플·실제 성공·오류 상태가 구분되어 있다.
- [x] 참여자별 해석에 입력 근거와 개인정보 제한 문구가 함께 표시된다.
- [x] 합의점과 관점 충돌이 비어 있을 때도 정직한 빈 상태 문구가 있다.
- [x] 지식맵이 API가 반환한 노드와 링크를 기준으로 동적으로 렌더링된다.
- [x] local provider와 OpenAI provider가 명시적으로 구분되고 자동 fallback하지 않는다.
- [x] `OPENAI_API_KEY`는 서버에서만 읽으며 클라이언트 응답·번들 계약에 포함되지 않는다.
- [x] `npm run check` 로컬 품질 게이트가 코드에 정의되어 있다.
- [ ] 품질 CI workflow가 PR 브랜치에 게시되어 있다.
- [x] 로컬 품질 게이트에서 statements 84.93%, branches 78.90%, functions 92.10%, lines 87.98%를 기록했다.
- [x] `npm audit --omit=dev`에서 취약점 0건을 확인했다.
- [ ] OpenAI live paid call 검증 완료
- [ ] GitHub Actions 품질 check 성공 — OAuth `workflow` scope 재인증 후 파일 게시 필요
