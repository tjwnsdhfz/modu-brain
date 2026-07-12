# 모두의 뇌 프롬프트 디자인

## 1. 문서 목적

이 문서는 모두의 뇌에서 LLM을 사용할 때 필요한 프롬프트 구조, 출력 JSON 스키마, 검증 기준을 정의한다. 목표는 회의록을 단순 요약하는 것이 아니라 프로젝트 맥락, 관점 차이, 결정 배경, 미결 질문을 안정적으로 추출하는 것이다.

## 2. 프롬프트 목표

LLM은 입력 텍스트를 읽고 다음 정보를 구조화해야 한다.

- 프로젝트 핵심 주제
- 중요한 용어와 설명
- 결정사항과 결정 배경
- 참여자별 관점
- 참여자별 관점 에이전트 결과
- 서로 이해가 갈린 지점
- 미결 질문
- 지식맵과 온보딩 요약을 만들 수 있는 근거 데이터

## 3. 프롬프트 설계 원칙

- 요약보다 맥락 연결을 우선한다.
- 결정된 내용과 아직 불확실한 내용을 구분한다.
- 사람의 의견을 확정된 사실처럼 쓰지 않는다.
- 입력에 없는 내용을 만들어내지 않는다.
- 근거가 없는 결정, 참여자, 질문, 용어는 최소 개수를 채우지 않고 빈 배열로 반환한다.
- 출력은 UI 렌더링이 가능한 JSON으로만 반환한다.
- 민감한 개인정보가 보이면 분석 결과에 그대로 반복하지 않는다.

현재 OpenAI provider는 Responses API의 `text.format` 구조화 출력을 사용한다. 모델은 `overview`, `keyTerms`, `decisions`, `participants`, `questions`, `participantAgents`만 생성하고, 서버가 검증된 필드에서 `knowledgeMap`과 `onboardingSummary`를 결정적으로 조립한다. 이 분리는 모델이 존재하지 않는 노드 ID를 만들거나 링크 참조를 깨뜨리는 문제를 줄인다.

## 4. 시스템 프롬프트

```text
너는 협업 프로젝트의 맥락을 정리하는 AI 에이전트다.
너의 목표는 회의록과 메모를 단순 요약하는 것이 아니라, 팀이 같은 배경지식 위에서 협업할 수 있도록 프로젝트 맥락을 구조화하는 것이다.

반드시 지켜야 할 규칙:
1. 입력에 없는 사실을 만들지 않는다.
2. 결정된 내용, 의견, 미결 질문을 구분한다.
3. 사람별 관점 차이를 중립적으로 정리한다.
4. 팀원의 성격이나 인격을 추정하지 않고, 입력 기록에 근거가 있는 프로젝트 관점만 정리한다.
5. 불확실한 내용은 status를 "unclear"로 표시한다.
6. 근거가 없는 항목은 만들어내지 말고 해당 배열을 비워 둔다.
7. 출력은 반드시 지정된 JSON 스키마만 사용한다.
8. Markdown 설명을 추가하지 않는다.
```

## 5. 사용자 프롬프트 템플릿

```text
다음 프로젝트 기록을 분석해 팀이 공유해야 할 맥락을 구조화해줘.

프로젝트 이름:
{{projectTitle}}

입력 기록:
{{inputText}}

분석해야 할 항목:
- 핵심 주제
- 중요한 용어
- 결정사항과 이유
- 참여자별 관점
- 팀원별 관점 에이전트 결과
- 미결 질문
- 공유 지식맵 노드와 연결
- 새 참여자 온보딩 요약

출력은 JSON만 반환해.
```

## 6. 출력 JSON 스키마

```json
{
  "projectTitle": "string",
  "summary": {
    "projectTitle": "string",
    "overview": ["string"],
    "sourceLength": 0,
    "generatedAt": "string"
  },
  "keyTerms": [
    {
      "term": "string",
      "meaning": "string"
    }
  ],
  "decisions": [
    {
      "decision": "string",
      "reason": "string",
      "status": "confirmed | tentative | unclear"
    }
  ],
  "participants": [
    {
      "actor": "string",
      "role": "string",
      "focus": "string",
      "concern": "string",
      "question": "string"
    }
  ],
  "questions": [
    {
      "question": "string",
      "reason": "string",
      "ownerHint": "string"
    }
  ],
  "knowledgeMap": {
    "nodes": [
      {
        "id": "string",
        "label": "string",
        "type": "topic | person | role | decision | question",
        "summary": "string"
      }
    ],
    "links": [
      {
        "from": "string",
        "to": "string",
        "relation": "string"
      }
    ]
  },
  "onboardingSummary": {
    "items": ["string"],
    "currentDecisions": ["string"],
    "remainingQuestions": ["string"],
    "shareText": "string"
  },
  "participantAgents": {
    "views": [
      {
        "actor": "string",
        "role": "string",
        "priority": "string",
        "interpretation": "string",
        "evidence": ["string"],
        "risk": "string"
      }
    ],
    "agreementPoints": ["string"],
    "tensionPoints": ["string"],
    "privacyNote": "string"
  }
}
```

## 7. 예시 입력

```text
오늘 프로젝트 회의에서 팀원 A는 사용자가 처음 들어왔을 때 무엇을 해야 하는지 바로 보여주는 화면이 중요하다고 말했다.
팀원 B는 기능이 많아지면 구현 시간이 부족하니 MVP에서는 입력과 분석 결과 화면만 먼저 만들자고 제안했다.
팀원 C는 발표에서 문제 정의와 차별점이 잘 보여야 한다고 했다.
멘토는 기능 설명보다 사용자가 겪는 불편함과 해결 흐름을 먼저 보여주라고 피드백했다.
아직 어떤 화면을 첫 번째로 만들지, 분석 결과를 표로 보여줄지 지식맵으로 보여줄지는 결정되지 않았다.
```

## 8. 최종 API 응답 예시

아래는 모델의 부분 출력이 아니라 서버가 검증·조립을 마친 최종 응답 형태다.

```json
{
  "projectTitle": "모두의 뇌 MVP 기획",
  "summary": {
    "projectTitle": "모두의 뇌 MVP 기획",
    "overview": [
      "팀은 MVP 화면 구성과 발표 방향을 논의했다.",
      "입력 화면과 분석 결과 화면을 먼저 만드는 방향이 제안되었다.",
      "서비스 차별점을 시각적으로 보여주는 방식은 아직 결정되지 않았다."
    ],
    "sourceLength": 238,
    "generatedAt": "2026-07-10T00:00:00.000Z"
  },
  "keyTerms": [
    {
      "term": "MVP",
      "meaning": "가장 먼저 검증할 최소 기능 제품"
    },
    {
      "term": "지식맵",
      "meaning": "사람, 주제, 결정, 질문을 연결해 보여주는 구조"
    }
  ],
  "decisions": [
    {
      "decision": "입력 화면과 분석 결과 화면을 우선 구현한다.",
      "reason": "기능이 많아지면 구현 시간이 부족할 수 있기 때문이다.",
      "status": "tentative"
    }
  ],
  "participants": [
    {
      "actor": "팀원 A",
      "role": "사용자 경험 관점",
      "focus": "사용자가 처음 들어왔을 때 바로 이해하는 화면",
      "concern": "첫 화면이 복잡해질 수 있음",
      "question": "첫 화면에서 무엇을 먼저 보여줄 것인가"
    },
    {
      "actor": "팀원 B",
      "role": "구현 범위 관점",
      "focus": "MVP 범위 축소",
      "concern": "기능이 많아져 완성도가 낮아질 수 있음",
      "question": "어떤 기능을 제외할 것인가"
    }
  ],
  "questions": [
    {
      "question": "첫 화면에서 입력창을 먼저 보여줄 것인가, 예시 결과를 먼저 보여줄 것인가?",
      "reason": "첫 화면 구성은 사용자가 서비스 목적을 이해하는 속도에 영향을 준다.",
      "ownerHint": "사용자 흐름 담당"
    },
    {
      "question": "분석 결과는 표, 카드, 지식맵 중 무엇을 중심으로 보여줄 것인가?",
      "reason": "결과 표현 방식은 서비스 차별점을 보여주는 핵심 화면이다.",
      "ownerHint": "시각화 담당"
    }
  ],
  "knowledgeMap": {
    "nodes": [
      {
        "id": "topic-mvp",
        "label": "MVP 화면",
        "type": "topic",
        "summary": "처음 구현할 핵심 화면 범위"
      },
      {
        "id": "question-result-view",
        "label": "결과 표현 방식",
        "type": "question",
        "summary": "표, 카드, 지식맵 중 무엇을 중심으로 보여줄지 결정 필요"
      }
    ],
    "links": [
      {
        "from": "topic-mvp",
        "to": "question-result-view",
        "relation": "MVP 완성도와 발표 차별점에 모두 영향을 준다."
      }
    ]
  },
  "onboardingSummary": {
    "items": [
      "현재 팀은 MVP 화면 구성과 발표 차별점을 논의하고 있다.",
      "입력 화면과 분석 결과 화면을 먼저 구현하는 방향이 제안되었다.",
      "결과 표현 방식은 아직 확정되지 않았다.",
      "다음 회의에서는 첫 화면 구성과 지식맵 표현 방식을 결정해야 한다."
    ],
    "currentDecisions": ["입력 화면과 분석 결과 화면을 우선 구현한다."],
    "remainingQuestions": ["결과 표현 방식", "첫 화면 구성"],
    "shareText": "현재 모두의 뇌 MVP는 입력 화면과 분석 결과 화면을 중심으로 기획 중이다."
  },
  "participantAgents": {
    "views": [
      {
        "actor": "팀원 A",
        "role": "사용자 경험 관점",
        "priority": "첫 화면 이해도",
        "interpretation": "사용자가 처음 들어왔을 때 바로 이해하는 화면을 가장 중요하게 본다.",
        "evidence": ["사용자가 처음 들어왔을 때 무엇을 해야 하는지 바로 보여주는 화면이 중요하다고 말했다."],
        "risk": "첫 화면이 복잡해질 수 있음"
      }
    ],
    "agreementPoints": ["입력 화면과 분석 결과 화면을 우선 구현한다."],
    "tensionPoints": ["결과 표현 방식을 아직 확정하지 못했다."],
    "privacyNote": "팀원의 성격을 추정하지 않고 입력 기록에 근거가 있는 프로젝트 관점만 표현한다."
  }
}
```

## 9. 후처리 검증 규칙

LLM 응답을 받은 뒤 서버와 프론트엔드에서 각각 다음을 확인한다.

- Responses API 구조화 출력의 Zod 스키마를 만족하는가?
- 필수 필드와 배열 내부 객체가 모두 올바른 타입인가?
- `status` 값이 허용된 값인가?
- `knowledgeMap.links`의 `from`, `to`가 실제 node id와 연결되는가?
- 배열이 비어 있을 때도 UI가 깨지지 않는가?
- `provider` 메타데이터가 있고 실제 외부 모델 사용 여부와 일치하는가?
- 키·모델 누락이나 외부 오류가 샘플 데이터로 조용히 대체되지 않는가?

## 10. 실패 처리

```text
구조화 출력 스키마를 지키지 않은 응답은 `PROVIDER_RESPONSE_INVALID` 오류로 처리한다.
현재 MVP는 잘못된 응답을 임의로 보정하거나 샘플 결과로 대체하지 않는다.
재시도를 도입할 때도 횟수와 비용 상한을 서버 설정으로 명시한다.
```

## 11. 평가 기준

| 기준 | 좋은 결과 | 나쁜 결과 |
| --- | --- | --- |
| 맥락성 | 결정 배경과 관점 차이를 함께 설명 | 회의 내용을 짧게만 요약 |
| 정확성 | 입력에 있는 내용만 사용 | 없는 내용을 추측 |
| 구조화 | JSON 필드가 안정적으로 채워짐 | 자유 형식 문장으로 반환 |
| 실용성 | 다음 질문과 온보딩 요약이 바로 사용 가능 | 추상적인 조언만 제공 |

## 12. 다음 단계

- 서버의 OpenAI provider를 실제 키로 검증할 때 비용·모델을 먼저 명시적으로 승인한다.
- 같은 입력을 여러 번 실행해 구조 정확도와 결과 편차를 평가한다.
- 지식맵 노드가 너무 많아질 경우 상위 8개만 표시하는 규칙을 추가한다.
- 팀원별 관점 에이전트는 성격 추론이 아니라 근거 기반 프로젝트 관점으로 제한한다.
