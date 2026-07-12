import type { ContextAnalysisResult } from "../types/context";

export const sampleInput = `프로젝트명: 캠퍼스 공모전 서비스 기획

오늘 회의에서 우리 팀은 대학생 공모전 준비 과정에 흩어진 회의록, 자료 조사, 멘토 피드백을 한곳에서 이해할 수 있게 만드는 서비스를 논의했다.

민지는 첫 화면에서 사용자가 무엇을 입력해야 하는지 바로 이해해야 한다고 말했다. 서준은 단순한 회의 요약처럼 보이면 차별점이 약하므로 결정 배경과 미해결 질문을 함께 보여줘야 한다고 제안했다. 현우는 발표 때 지식맵이 중요하지만 노드가 많으면 복잡해질 수 있다고 우려했다.

팀은 MVP에서 메신저 자동 연동과 실시간 녹음은 제외하고, 사용자가 직접 붙여 넣은 기록을 분석하기로 결정했다. 다음 회의까지 입력 화면, 분석 결과, 신규 팀원 온보딩 요약을 준비하기로 했다.

아직 지식맵 노드 수 제한, 개인정보 안내 위치, 발표용 예시 데이터 범위는 결정되지 않았다.`;

const evidence = (quote: string) => [{
  sourceRecordId: "sample-meeting",
  sourceTitle: "공모전 기획 회의",
  quote,
}];

export const sampleAnalysis: ContextAnalysisResult = {
  projectTitle: "캠퍼스 공모전 서비스 기획",
  summary: {
    projectTitle: "캠퍼스 공모전 서비스 기획",
    overview: [
      "팀 기록이 여러 곳에 흩어져 공동 맥락을 잃는 문제를 해결한다.",
      "결정 배경, 참여자 관점, 미해결 질문을 원문 근거와 연결한다.",
      "MVP는 사용자가 직접 붙여 넣은 텍스트 분석에 집중한다.",
    ],
    sourceLength: sampleInput.length,
    generatedAt: "2026-07-11T00:00:00.000Z",
  },
  keyTerms: [
    { term: "공동 맥락", meaning: "팀이 함께 알아야 하는 배경, 결정 이유, 관점 차이" },
    { term: "지식맵", meaning: "사람, 주제, 결정, 질문의 연결 관계를 보여주는 화면" },
    { term: "온보딩 요약", meaning: "새 팀원이 빠르게 현재 상태를 파악하는 핵심 정보" },
  ],
  decisions: [
    {
      id: "decision-direct-input",
      decision: "MVP는 사용자가 직접 텍스트를 붙여 넣는 방식으로 시작한다.",
      reason: "자동 연동과 실시간 녹음은 초기 구현 범위를 크게 늘린다.",
      status: "confirmed",
      evidence: evidence("팀은 MVP에서 메신저 자동 연동과 실시간 녹음은 제외하고, 사용자가 직접 붙여 넣은 기록을 분석하기로 결정했다."),
    },
    {
      id: "decision-result-scope",
      decision: "분석 결과는 결정 배경과 미해결 질문을 중심으로 구성한다.",
      reason: "일반 회의 요약과 구분되는 핵심 가치이기 때문이다.",
      status: "confirmed",
    },
    {
      id: "decision-privacy-copy",
      decision: "개인정보 안내 문구 위치는 다음 회의에서 확정한다.",
      reason: "원문 저장 전에 민감정보 취급을 명확히 알려야 한다.",
      status: "tentative",
    },
  ],
  participants: [
    {
      id: "participant-minji",
      actor: "민지",
      role: "사용자 흐름",
      focus: "첫 화면의 입력 행동을 쉽게 이해시키기",
      concern: "사용자가 무엇을 넣어야 하는지 모르면 이탈할 수 있음",
      question: "샘플 입력을 어느 시점에 보여줄 것인가?",
      evidence: evidence("민지는 첫 화면에서 사용자가 무엇을 입력해야 하는지 바로 이해해야 한다고 말했다."),
    },
    {
      id: "participant-seojun",
      actor: "서준",
      role: "서비스 차별화",
      focus: "요약을 넘어 결정 배경과 질문을 보여주기",
      concern: "기존 회의 요약 도구와 차이가 약해질 수 있음",
      question: "결정 배경을 한 화면에서 어떻게 강조할 것인가?",
    },
    {
      id: "participant-hyunwoo",
      actor: "현우",
      role: "시각화",
      focus: "사람, 주제, 결정, 질문을 지식맵으로 연결하기",
      concern: "노드가 많아지면 맵을 이해하기 어려워질 수 있음",
      question: "MVP 지식맵의 노드 수를 몇 개로 제한할 것인가?",
    },
  ],
  questions: [
    { id: "question-node-limit", question: "지식맵 노드 수를 어떻게 제한할 것인가?", reason: "복잡도가 핵심 맥락보다 먼저 보일 수 있다.", ownerHint: "시각화 담당" },
    { id: "question-privacy", question: "개인정보 주의 문구를 어디에 배치할 것인가?", reason: "원문 저장 전에 이용자가 위험을 인지해야 한다.", ownerHint: "사용자 흐름 담당" },
    { id: "question-demo-data", question: "발표용 예시 데이터는 어떤 프로젝트로 통일할 것인가?", reason: "시연이 하나의 상황에 집중되어야 이해하기 쉽다.", ownerHint: "서비스 차별화 담당" },
  ],
  knowledgeMap: {
    nodes: [
      { id: "topic", label: "공동 맥락 손실", type: "topic", summary: "기록이 흩어져 팀이 서로 다른 이해를 갖는 문제" },
      { id: "decision", label: "직접 입력 MVP", type: "decision", summary: "초기 범위를 텍스트 붙여넣기 분석으로 제한" },
      { id: "person-seojun", label: "서준", type: "person", summary: "서비스 차별화와 발표 메시지 담당" },
      { id: "person-hyunwoo", label: "현우", type: "person", summary: "지식맵 시각화와 화면 흐름 담당" },
      { id: "question", label: "남은 질문", type: "question", summary: "노드 수, 개인정보 안내, 예시 데이터" },
    ],
    links: [
      { from: "topic", to: "decision", relation: "MVP 범위로 축소" },
      { from: "person-seojun", to: "topic", relation: "차별화 제안" },
      { from: "person-hyunwoo", to: "question", relation: "시각화 위험 제기" },
      { from: "decision", to: "question", relation: "다음 검증 필요" },
    ],
  },
  onboardingSummary: {
    items: [
      "Modu Brain은 팀 기록을 요약하는 것을 넘어 결정 배경과 관점 차이를 연결한다.",
      "초기 MVP는 직접 붙여 넣은 텍스트를 분석한다.",
      "핵심 화면은 관점, 결정, 질문, 지식맵, 온보딩 요약이다.",
    ],
    currentDecisions: [
      "자동 연동 없이 직접 입력 기반으로 시작한다.",
      "분석 결과는 결정 배경과 미해결 질문을 강조한다.",
    ],
    remainingQuestions: ["지식맵 노드 수", "개인정보 안내 위치", "발표용 예시 범위"],
    shareText: "현재 MVP는 흩어진 팀 기록에서 결정, 관점, 질문을 구조화해 새 팀원이 빠르게 맥락을 파악하도록 돕습니다.",
  },
  participantAgents: {
    views: [
      { actor: "민지", role: "사용자 흐름", priority: "첫 진입 이해도", interpretation: "입력 행동이 명확해야 사용자가 결과까지 도달한다.", evidence: ["사용자가 무엇을 입력해야 하는지 바로 이해해야 한다."], risk: "입력 안내가 복잡하면 분석 전에 이탈할 수 있다." },
      { actor: "서준", role: "서비스 차별화", priority: "결정 배경과 질문", interpretation: "단순 요약이 아닌 생각의 차이를 드러내야 한다.", evidence: ["단순한 회의 요약처럼 보이면 차별점이 약하다."], risk: "결과가 요약 중심이면 기존 서비스와 구분되지 않는다." },
    ],
    agreementPoints: ["직접 입력 기반 MVP로 시작한다.", "결정 배경과 미해결 질문을 강조한다."],
    tensionPoints: ["간단한 입력 화면과 충분한 개인정보 안내 사이의 균형이 필요하다."],
    privacyNote: "참여자의 성격을 추정하지 않고 입력 기록에서 확인되는 프로젝트 관점만 표현한다.",
  },
  provider: { mode: "mock", name: "sample", usedExternalModel: false },
};
