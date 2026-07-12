# 모두의 뇌 Figma 개발 핸드오프

이 문서는 Figma 화면을 React 개발로 옮길 때 필요한 기준을 정리한다.

## 1. 화면과 React 컴포넌트 연결

| Figma 화면 | React 파일 | 역할 |
| --- | --- | --- |
| 홈 / 진입 | `src/App.tsx` | 서비스 소개, 주요 CTA, 워크플로우 |
| 프로젝트 기록 입력 | `src/components/ContextInput.tsx` | 프로젝트명, 회의록 입력, 예시 불러오기, 분석 버튼 |
| 분석 요약 | `src/components/SummaryPanel.tsx` | 주제 수, 관점 수, 질문 수, 요약 리스트 |
| 참여자별 관점 | `src/components/PerspectiveTable.tsx` | 역할, 중점, 우려, 질문 표 |
| 미결 질문 | `src/components/QuestionList.tsx` | 다음 회의 질문 목록 |
| 결정사항 | `src/components/DecisionList.tsx` | 결정 내용과 상태 배지 |
| 핵심 용어 | `src/components/KeyTerms.tsx` | 새 팀원이 알아야 할 용어 카드 |
| 공유 지식맵 | `src/components/KnowledgeMap.tsx` | 사람/주제/결정/질문 연결 |
| 온보딩 요약 | `src/components/OnboardingSummary.tsx` | 새 팀원 공유용 요약 |

## 2. 화면별 동작 기준

| 화면 | 사용자 행동 | 시스템 반응 |
| --- | --- | --- |
| 홈 | CTA 클릭 | 입력 영역 또는 지식맵 영역으로 이동 |
| 입력 | 예시 불러오기 클릭 | 샘플 회의록이 입력창에 채워짐 |
| 입력 | 맥락 분석하기 클릭 | 더미 분석 결과가 결과 영역에 표시됨 |
| 결과 | 탭 클릭 | 개요, 지식맵, 온보딩 요약 콘텐츠 전환 |
| 지식맵 | 노드 구조 확인 | 사람, 주제, 결정, 질문 관계를 시각화 |

## 3. 개발에서 유지할 디자인 규칙

- `.app-shell`은 최대 폭 `1180px`을 유지한다.
- 카드와 패널은 `border: 1px solid #e0e0e0`, `border-radius: 8px`, `background: #ffffff`을 기본으로 한다.
- Primary 버튼은 `#0066cc` 배경과 흰색 텍스트를 사용한다.
- 탭의 active 상태는 Primary 버튼과 같은 색을 사용한다.
- 모바일에서는 2열/3열 그리드를 모두 1열로 전환한다.
- 텍스트 overflow가 생기면 hidden 처리보다 줄바꿈과 responsive grid를 우선한다.

## 4. Figma에서 개발로 넘길 때 확인할 것

- 화면 이름과 React 컴포넌트 이름이 연결되어 있는가?
- 디자인 토큰 값이 CSS와 일치하는가?
- 버튼, 탭, 배지 상태가 모두 표현되어 있는가?
- 한글 텍스트가 잘리지 않는가?
- 모바일 화면이 별도로 확인되었는가?
- PR 본문에 넣을 대표 PNG가 export 되었는가?

## 5. 후속 개발 환경 구성 메모

현재는 React + TypeScript + Vite 프로토타입 기준으로 개발한다. Express, DB, 인증은 다음 단계에서 확장하며, 이번 Figma 핸드오프에서는 화면 구조와 컴포넌트 기준을 먼저 고정한다.
