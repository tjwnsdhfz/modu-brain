# Modu Brain 에이전트 워크플로 계약

## 1. 목적

이 문서는 한 번의 분석 요청을 검증 가능한 4단계 실행으로 추적하는 서버·DB 계약을 정의한다. 사용자에게는 진행 단계와 검증 결과를 설명하되, 모델의 숨겨진 추론이나 원문을 실행 로그로 복제하지 않는 것이 핵심 원칙이다.

워크플로는 동기식 요청 안에서 실행된다. 백그라운드 작업 큐, 자율적인 도구 실행, 무제한 재시도, 모델 사고과정 저장은 이번 범위가 아니다.

## 2. 신뢰 경계와 저장 원칙

- 프로젝트 이름과 직접 작성·가져오기한 모든 원문은 **신뢰하지 않는 데이터**다.
- OpenAI 지시문은 원문 안의 역할 변경, 비밀 공개, 출력 형식 변경 요청을 따르지 않도록 명시한다.
- OpenAI 요청은 `store: false`를 사용하고, 애플리케이션은 hidden reasoning 또는 chain-of-thought를 요청·저장·반환하지 않는다.
- 원문은 사용자가 명시적으로 저장한 `source_records`와 분석 시점의 `analysis_run_sources.content_snapshot`에만 존재한다.
- `analysis_run_step_events`에는 원문, 제목, 발언자, prompt, 모델 응답, 자유형 추론 필드가 없다.
- annotation은 사용자가 작성한 검토 의견이며 후속 분석의 prompt나 입력으로 자동 사용하지 않는다.
- 단계 이벤트와 annotation은 읽기 전용 공유 결과에 포함하지 않는다.

즉, “원문 미저장” 원칙은 원문의 정식 저장 기능을 제거한다는 의미가 아니라 **워크플로 로그와 피드백 레이어에 원문을 중복 저장하지 않는다**는 의미다.

## 3. 4단계 실행

| 순서 | `step` | 수행 내용 | 저장 가능한 지표 |
| --- | --- | --- | --- |
| 1 | `source_snapshot` | 선택한 소유자 원문을 불변 스냅숏으로 고정 | 원문 수, 합계 문자 수, 소요 시간 |
| 2 | `provider_analysis` | 로컬 휴리스틱 또는 명시적으로 선택한 OpenAI 실행 | 소요 시간, 안전한 완료·실패 코드 |
| 3 | `evidence_validation` | 구조화 결과와 모든 인용문이 실행 스냅숏에 존재하는지 검증 | 검증 결과, 결과 항목 수, 인용 수, 소요 시간 |
| 4 | `result_persistence` | 실행을 `succeeded`, `failed`, `cancelled`로 확정 | 소요 시간, 안전한 완료·실패 코드 |

각 단계는 append-only `started` 이벤트와 terminal 이벤트(`succeeded`, `failed`, `cancelled`)로 표현한다. 새 실행만 이벤트를 추가하며 idempotency로 재사용된 실행은 provider를 다시 호출하거나 이벤트를 덧붙이지 않는다.

실행 시작과 스냅숏 생성은 `start_analysis_run` RPC의 짧은 트랜잭션에서 처리한다. provider 네트워크 호출 중에는 DB 트랜잭션을 유지하지 않는다.

## 4. 단계 이벤트 계약

```ts
type AnalysisRunStepEventResource = {
  id: string;
  analysisRunId: string;
  sequence: number;
  eventKey: string;
  step:
    | "source_snapshot"
    | "provider_analysis"
    | "evidence_validation"
    | "result_persistence";
  status: "started" | "succeeded" | "failed" | "cancelled";
  validationOutcome: "passed" | "failed" | null;
  code: string | null;
  durationMs: number | null;
  sourceCount: number | null;
  inputCharacters: number | null;
  outputItemCount: number | null;
  evidenceReferenceCount: number | null;
  createdAt: string;
};
```

- `sequence`는 실행별 1~32이며 `(analysis_run_id, sequence)`가 유일하다.
- `eventKey`도 실행별 유일하므로 동일 이벤트 재시도는 새 행을 만들지 않는다.
- `started`에는 완료 코드·시간·검증 결과를 기록하지 않는다.
- 실패·취소에는 provider 원문 대신 대문자·숫자·밑줄로 제한한 안전한 `code`만 기록한다.
- `validationOutcome`은 `evidence_validation` 단계에서만 사용한다.
- 인증 사용자는 자신의 실행 이벤트를 조회할 수 있지만 직접 생성·수정할 수 없다.

API:

```http
GET /api/v1/analysis-runs/:runId/step-events
Authorization: Bearer <access-token>
```

응답은 `sequence` 오름차순이다. 다른 사용자 실행과 존재하지 않는 실행은 동일한 `404 NOT_FOUND`로 처리한다.

## 5. 불변 annotation 계약

annotation은 성공한 분석 결과에 남기는 사용자 검토 기록이다. 수정 이력을 덮어쓰지 않고 새로운 annotation을 추가하는 방식만 허용한다.

```ts
type AnalysisRunAnnotationResource = {
  id: string;
  analysisRunId: string;
  annotationType: "confirmation" | "correction" | "question" | "note";
  target: {
    type:
      | "run"
      | "decision"
      | "participant"
      | "question"
      | "term"
      | "knowledge_node"
      | "participant_view";
    id?: string;
  };
  body: string;
  createdAt: string;
};
```

API:

```http
GET /api/v1/analysis-runs/:runId/annotations

POST /api/v1/analysis-runs/:runId/annotations
Authorization: Bearer <access-token>
Idempotency-Key: <8..128 characters>
Content-Type: application/json

{
  "annotationType": "correction",
  "targetType": "decision",
  "targetId": "decision_0123456789abcdef",
  "body": "결정 근거의 날짜를 다시 확인해 주세요."
}
```

- `run` 대상은 `targetId`를 보내지 않는다. 나머지 대상은 실제 결과에 존재하는 안정적 ID가 필요하다.
- body는 공백을 제외하고 1~2,000자다.
- 같은 실행·사용자·Idempotency-Key와 같은 payload는 기존 annotation과 `200`을 반환한다.
- 같은 키에 다른 payload를 보내면 `409 IDEMPOTENCY_CONFLICT`다.
- 성공한 실행만 annotation을 받을 수 있으며 그 외 상태는 `409 RUN_NOT_ANNOTATABLE`이다.
- `PATCH`와 개별 `DELETE`는 제공하지 않는다. 프로젝트 또는 실행을 사용자가 삭제할 때만 FK cascade로 함께 제거된다.
- 응답은 `createdBy`, idempotency key, request fingerprint를 노출하지 않는다.

DB 쓰기는 `create_analysis_run_annotation` RPC만 허용한다. RPC가 `auth.uid()`, 프로젝트 소유권, 실행 상태, 결과 target ID와 idempotency를 원자적으로 확인한다. 테이블의 직접 `INSERT`, `UPDATE`, `DELETE` 권한은 인증 사용자에게 부여하지 않는다.

## 6. 실패·취소·개인정보 계약

- 클라이언트 연결 종료는 AbortSignal로 provider까지 전달하고 실행과 활성 단계를 `cancelled`로 종료한다.
- provider·DB 내부 메시지와 응답 본문은 이벤트, annotation 또는 API 오류에 저장하지 않는다.
- 단계 이벤트 기록 실패 시 `analysis_runs`의 terminal 상태가 최종 권위다.
- 실패한 실행은 최근 성공 결과를 덮어쓰지 않으며 annotation 대상이 될 수 없다.
- annotation은 공유 projection과 모델 입력에서 제외한다.
- 이벤트와 annotation RLS는 실행·프로젝트 소유자를 재검증하며 IDOR 탐색을 허용하지 않는다.

## 7. 필수 회귀 테스트

- 정상 실행에서 4단계의 시작·성공 이벤트 순서와 안전한 지표 확인
- provider 실패·요청 취소에서 안전한 terminal event와 원문 오류 비노출 확인
- 이벤트 JSON에 원문, prompt, reasoning, chain-of-thought가 없는지 확인
- annotation 생성·동일 요청 재사용·동일 키 충돌·잘못된 target 거부 확인
- 인증 사용자의 직접 event/annotation 쓰기와 annotation 수정 차단
- 두 사용자 사이의 event·annotation RLS 격리와 일관된 `404`
- migration 적용, down rollback, 재적용과 FK cascade 확인
- OpenAI 요청의 untrusted-source 지시문과 `store: false` 회귀 확인
