# Modu Brain Design System

이 문서는 `ui-ux-pro-max`의 디자인 시스템 검색 결과를 모두의 뇌 제품 결정에 맞게 조정한 UI 구현 기준이다. 새 화면을 만들 때 `design-system/modu-brain/pages/<page>.md`가 있으면 그 파일을 우선하고, 없으면 이 문서를 따른다.

## Product frame

- 제품 유형: 협업 맥락을 구조화하는 AI 지식관리 SaaS
- 사용자: 회의·리서치·피드백의 근거와 결정 변화를 함께 이해해야 하는 팀
- 스택: React 19, TypeScript, Vite
- 정보 우선순위: 관점 차이 → 미결 질문 → 결정 배경 → 요약
- 스타일: `DESIGN-notion.md` 기반의 warm paper productivity, content-first, light mode 기본
- 디자인 다이얼: variance 4/10, motion 3/10, density 5/10

## Visual tokens

| 역할 | 값 | CSS 변수 |
| --- | --- | --- |
| 페이지 배경 | `#f6f5f4` | `--color-page` |
| 기본 표면 | `#ffffff` | `--color-surface` |
| 보조 표면 | `#fbfaf9` | `--color-surface-subtle` |
| 기본 텍스트 | `#000000` | `--color-text` |
| 본문 텍스트 | `#31302e` | `--color-text-body` |
| 보조 텍스트 | `#615d59` | `--color-text-muted` |
| 기본 경계 | `#e6e6e6` | `--color-border` |
| 강한 경계 | `#d8d6d3` | `--color-border-strong` |
| 주요 액션 | `#0075de` | `--color-primary` |
| 링크·pressed | `#005bab` | `--color-link` / `--color-primary-hover` |
| 단일 dark band | `#213183` | `--color-hero` |
| 포커스 링 | `rgba(0, 117, 222, 0.28)` | `--color-focus-ring` |
| 성공 | `#1f7a3f` / `#e8f7ee` | `--color-success` / `--color-success-bg` |
| 경고 | `#8a5a00` / `#fff8ee` | `--color-warning` / `--color-warning-bg` |
| 오류 | `#b00020` / `#fff2f2` | `--color-danger` / `--color-danger-bg` |

구조색은 검정·warm paper·흰색·파랑만 사용한다. sky, purple, pink, orange, teal, green은 hero sticker와 지식맵 점처럼 작은 장식에만 사용하고 CTA나 구조 배경에는 사용하지 않는다. 상태는 색만으로 표현하지 않고 텍스트나 아이콘을 함께 제공한다.

## Typography and spacing

- `KoPub World Dotum`을 최우선 글꼴로 사용하고 300/400–600/700–900 역할을 Light/Medium/Bold에 매핑한다.
- 공개 웹폰트 파일 임베딩은 한국출판인회의의 별도 승인을 받은 뒤에만 추가한다. 승인 전 배포본은 로컬 설치 글꼴을 우선하고 `Apple SD Gothic Neo`, `Malgun Gothic`, `Noto Sans KR` 순으로 대체한다.
- 본문은 최소 16px, line-height 1.5 이상을 기본으로 한다.
- 제목은 600–800, 라벨은 600–800, 본문은 400–500 굵기를 사용한다.
- 간격은 4/8px 리듬을 사용하며 기본 단계는 4, 8, 12, 16, 24, 32, 48, 64px이다.
- 입력은 4px, utility row와 내부 버튼은 5–8px, 카드와 워크스페이스는 12px, 큰 hero/auth는 16px, marketing CTA와 배지만 pill을 사용한다.
- 기본 카드는 흰색 표면 + hairline만 사용한다. hero의 우측 맥락 카드, drawer, 모바일 메뉴처럼 실제로 떠 있는 표면만 미세한 layered shadow를 사용한다.

## Components and interaction

- 화면당 primary CTA는 하나만 둔다. 보조 액션은 outline 또는 text button으로 낮춘다.
- 카카오톡 TXT, Teams JSON, Notion JSON은 로그인 없이 공개 체험에서 정규화·로컬 분석할 수 있고 DB에는 저장하지 않는다.
- 저장 프로젝트와 공유 링크 생성만 Magic Link를 요청하며, Supabase RLS는 완화하지 않는다.
- 버튼, 링크, 라디오 카드 등 모든 상호작용 영역은 최소 44×44px이다.
- 비동기 액션은 pending 문구를 보여주고 중복 제출을 막는다.
- 입력은 visible label, helper text, 필드 가까운 오류, `aria-live` 상태를 제공한다.
- 텍스트는 가능한 한 줄바꿈한다. 생략할 때는 전체 내용을 확인할 경로를 제공한다.
- 아이콘은 한 계열의 SVG를 사용하고 구조적 아이콘에 emoji를 사용하지 않는다.
- hover, pressed, disabled, focus-visible 상태가 서로 구분되어야 한다.

## Navigation and hierarchy

- 키보드 사용자를 위한 본문 건너뛰기 링크를 유지한다.
- 현재 위치는 `aria-current="page"`와 시각 상태로 함께 표시한다.
- 경로 변경 후 포커스를 주 콘텐츠 영역으로 이동한다.
- sticky header 아래에 콘텐츠가 가려지지 않아야 한다.
- 결과 화면은 단순 요약보다 관점·질문·근거의 연결을 먼저 보여준다.
- 768px 이하에서는 `aria-expanded` 모바일 메뉴로 접고 Escape와 경로 이동으로 닫는다.

## Signature surfaces

- 랜딩은 `#213183` dark hero 한 곳만 반전하고 나머지는 warm paper daylight 리듬을 유지한다.
- hero의 장식 sticker는 콘텐츠·버튼과 겹치지 않고 `aria-hidden`으로 둔다.
- 공개 공유 화면은 한 문단 브리프 → 결정 → 질문 → 관점 → 온보딩 → 지식맵 순서의 읽기 문서처럼 구성한다.

## Responsive behavior

- 375, 768, 1024, 1440px에서 확인한다.
- 모바일에서는 핵심 콘텐츠를 먼저 보여주고 2열 레이아웃을 1열로 전환한다.
- 가로 스크롤을 기본 탐색 방식으로 사용하지 않는다. 탭처럼 필요한 경우에만 제한한다.
- 긴 한글, 참여자 이름, 외부 기록 제목이 카드 폭을 깨지 않도록 wrapping을 우선한다.
- fixed/sticky 요소와 스크롤 콘텐츠가 겹치지 않아야 한다.

## Motion

- micro-interaction은 150–240ms 범위의 opacity, color, transform만 사용한다.
- 모션은 상태 변화나 공간 관계를 설명할 때만 사용한다.
- `prefers-reduced-motion: reduce`에서 애니메이션과 부드러운 스크롤을 제거한다.
- 로딩이 300ms 이상 지속될 수 있으면 status, spinner 또는 skeleton을 제공한다.

## Pre-delivery checklist

- [ ] 키보드만으로 모든 기능 사용 가능
- [ ] focus-visible 링과 논리적 tab 순서 확인
- [ ] 일반 텍스트 대비 4.5:1 이상
- [ ] 모든 주요 터치 타깃 44×44px 이상
- [ ] 로딩·성공·오류·빈 상태와 복구 액션 확인
- [ ] 375 / 768 / 1024 / 1440px에서 가로 넘침 없음
- [ ] reduced motion에서 핵심 기능 유지
- [ ] 구조적 emoji 아이콘과 임의의 raw color 추가 없음
- [ ] `npm test`, `npm run build`, `git diff --check` 통과
