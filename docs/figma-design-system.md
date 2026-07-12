# 모두의 뇌 Figma 디자인 시스템

이 문서는 `모두의 뇌`를 Figma에서 화면으로 제작할 때 사용할 디자인 시스템 기준이다. 목표는 화려한 장식보다 사용자가 서비스의 핵심인 `협업 맥락 공유`를 빠르게 이해하도록 만드는 것이다.

## 1. Figma 페이지 구조

| 페이지 | 목적 | 포함 내용 |
| --- | --- | --- |
| `00 Cover` | 프로젝트 첫인상 | 서비스명, 한 줄 정의, 문제 정의 |
| `01 Design System` | 디자인 기준 고정 | 컬러, 타이포그래피, spacing, radius, 컴포넌트 |
| `02 User Flow` | 사용자 흐름 시각화 | 기록 입력, AI 분석, 관점 차이, 지식맵, 온보딩 요약 |
| `03 Core Screens` | 핵심 화면 설계 | 홈, 기록 입력, 분석 결과, 지식맵, 온보딩 요약 |
| `04 Design Skill` | 나만의 디자인 규칙 | 반복 작업에 사용할 디자인 원칙 |
| `05 Dev Handoff` | 개발 Agent 전달 | React 컴포넌트와 Figma 화면 연결표 |

## 2. 디자인 방향

- Apple 스타일처럼 흰색과 연회색을 중심으로 차분하게 구성한다.
- 카드와 패널은 8px radius를 유지한다.
- 버튼과 탭은 pill 형태로 사용한다.
- AI 생성 이미지처럼 복잡한 장식은 피하고, 노드와 연결 구조로 맥락을 표현한다.
- 회의 요약 앱처럼 보이지 않도록 `요약`보다 `관점 차이`, `미결 질문`, `결정 배경`을 먼저 보여준다.

## 3. 컬러 토큰

| 토큰명 | 값 | 사용처 |
| --- | --- | --- |
| `color/bg/page` | `#f5f5f7` | 전체 페이지 배경 |
| `color/bg/surface` | `#ffffff` | 카드, 패널, 입력 영역 |
| `color/bg/subtle` | `#fafafc` | 표 헤더, 보조 카드 |
| `color/text/primary` | `#1d1d1f` | 제목, 핵심 텍스트 |
| `color/text/secondary` | `#6e6e73` | 설명, 보조 텍스트 |
| `color/text/body` | `#333333` | 일반 본문 |
| `color/border/default` | `#e0e0e0` | 카드, 패널 경계 |
| `color/border/strong` | `#d2d2d7` | 입력창, 탭 경계 |
| `color/accent/blue` | `#0066cc` | CTA, active tab, 강조 노드 |
| `color/accent/blue-hover` | `#0071e3` | primary hover |
| `color/status/confirmed-bg` | `#e8f7ee` | 확정 상태 배지 |
| `color/status/confirmed-text` | `#1f7a3f` | 확정 상태 텍스트 |
| `color/status/tentative-bg` | `#fff5e6` | 논의중 상태 배지 |
| `color/status/tentative-text` | `#9a5a00` | 논의중 상태 텍스트 |

## 4. 타이포그래피

| 스타일 | 크기 | 굵기 | 줄간격 | 사용처 |
| --- | --- | --- | --- | --- |
| `display/hero` | 64 | 700 | 1.04 | 홈 화면 메인 문장 |
| `heading/page` | 34 | 700 | 1.12 | 결과 화면 제목 |
| `heading/section` | 30 | 700 | 1.14 | 패널 제목 |
| `heading/card` | 24 | 700 | 1.2 | 워크플로우 카드 |
| `body/large` | 21 | 400 | 1.48 | 홈 보조 설명 |
| `body/default` | 16 | 400 | 1.55 | 리스트, 설명 본문 |
| `body/small` | 14 | 400 | 1.45 | 표, 카드 설명 |
| `label/default` | 13 | 700 | 1.2 | 섹션 키커, 메타 라벨 |

폰트 우선순위:

```text
SF Pro Text, SF Pro Display, -apple-system, BlinkMacSystemFont, Segoe UI, Malgun Gothic, system-ui, sans-serif
```

## 5. Spacing과 Radius

| 토큰명 | 값 | 사용처 |
| --- | --- | --- |
| `spacing/xs` | 4 | 탭 내부 gap |
| `spacing/sm` | 8 | 필드 내부 gap |
| `spacing/md` | 12 | 버튼 행 gap, 안내 박스 |
| `spacing/lg` | 18 | 섹션 간 기본 gap |
| `spacing/xl` | 24 | 헤더/패널 gap |
| `spacing/2xl` | 30 | 카드 내부 padding |
| `radius/sm` | 8 | 카드, 패널, 입력창 |
| `radius/full` | 999 | 버튼, 탭, 배지 |

## 6. 핵심 컴포넌트

| 컴포넌트 | Variant | 설명 |
| --- | --- | --- |
| `Button` | `Primary`, `Secondary`, `Disabled` | 주요 CTA, 보조 CTA, 비활성 상태 |
| `Panel` | `Input`, `Summary`, `Result` | 입력/분석/결과 영역 공통 패널 |
| `Tab` | `Default`, `Active` | 개요, 지식맵, 온보딩 요약 전환 |
| `Badge` | `Confirmed`, `Tentative`, `Unclear` | 결정사항 상태 표시 |
| `Metric` | `Default` | 주제 수, 관점 수, 미결 질문 수 |
| `Knowledge Node` | `Topic`, `Person`, `Decision`, `Question` | 지식맵 노드 |

## 7. Figma 제작 기준

- 모든 주요 프레임은 Auto Layout을 사용한다.
- 화면 폭은 데스크톱 `1440px`, 모바일 `390px` 기준으로 잡는다.
- 반복되는 UI는 컴포넌트로 먼저 만들고 화면에는 instance를 배치한다.
- 텍스트는 한글 기준으로 잘림이 없는지 확인한다.
- 입력 화면과 결과 화면은 반드시 같은 디자인 토큰을 사용한다.
- PR 본문에 들어갈 이미지는 PNG로 export하며, 한글 깨짐이 없는지 확인한다.
