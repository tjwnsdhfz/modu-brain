# 외부 회의 맥락 수집과 백링크

## 목표

카카오톡, Microsoft Teams, Notion 또는 임의의 텍스트에서 사용자가 직접 선택한 회의 기록을 가져와 Modu Brain의 공통 `source_record`로 저장한다. 개인 계정이나 OAuth 연결은 이번 단계에서 요구하지 않는다.

## 수집 방식

| 공급자 | 데모 입력 | 정규화 결과 |
| --- | --- | --- |
| 카카오톡 | 대화방 내보내기 TXT | 날짜, 발화자, 시간, 메시지 |
| Teams | Microsoft Graph `chatMessage` 형태 JSON | 발화자, 시간, 본문, 메시지 URL |
| Notion | 페이지와 블록 형태 JSON | 페이지 제목, 블록 순서, 블록 URL |
| 직접 붙여넣기 | 일반 텍스트 | 단일 맥락 세그먼트 |

브라우저는 파일 내용을 JSON 요청으로만 전달한다. 서버의 `contextImport` 모듈이 공급자별 입력을 공통 구조로 정규화하고, `import_source_context` 데이터베이스 함수가 원문·가져오기 이력·세그먼트를 한 트랜잭션으로 저장한다.

```text
내보내기 파일/붙여넣기
  → 공급자별 파서
  → 공통 원문 + 세그먼트 + 참여자
  → 내용 해시 중복 검사
  → source_records/source_imports/source_segments
  → 기존 분석 실행
  → 지식맵 + 원문 백링크
```

## 공통 저장 모델

- `source_records`: 분석에 사용하는 정규화된 전체 원문
- `source_imports`: 공급자, 외부 ID, 내용 해시, 참여자, 메타데이터
- `source_segments`: 원문 내부의 발화자·시각·문장·외부 링크
- `context_entities`: 사람, 주제, 결정, 질문 등 프로젝트 단위 노드
- `context_entity_aliases`: `김서준`, `서준`, `Seojun` 같은 별칭
- `context_edges`: 노드 사이 관계와 근거 세그먼트

원문 데이터의 기준은 PostgreSQL이며 Markdown은 향후 내보내기 형식으로만 사용한다. 동일 공급자·동일 가져오기 해시는 기존 원문을 반환하여 중복 생성을 막는다.

현재 공개 데모의 지식맵은 불변 분석 실행의 `result_jsonb`에서 읽고, 원문 백링크는 `source_segments`의 외부 URL·시각과 연결한다. `context_entities`, 별칭, typed edge를 편집·병합하는 공개 API와 그래프 materialization은 다음 증분 범위이며 이번 데모에서는 쓰기 가능한 사용자 화면으로 노출하지 않는다.

## 보안 경계

- 사용자가 명시적으로 선택한 파일과 붙여넣은 텍스트만 처리한다.
- 브라우저에 공급자 토큰을 저장하지 않는다.
- 모든 가져오기·세그먼트·그래프 테이블에 프로젝트 소유권 기반 RLS를 적용한다.
- 원문은 공유 링크 응답에 포함하지 않는다.
- JSON 본문은 256KB, 정규화된 원문은 100,000자로 제한한다.
- Teams/Notion 자동 동기화는 별도 버전에서 최소 권한 OAuth와 서명된 webhook 검증을 추가한 뒤 활성화한다.

## API

`POST /api/v1/projects/:projectId/imports`

```json
{
  "provider": "kakaotalk | teams | notion | paste",
  "title": "선택 제목",
  "text": "내보낸 TXT, JSON 문자열 또는 붙여넣은 텍스트"
}
```

신규 가져오기는 `201`, 같은 입력의 재시도는 기존 리소스와 함께 `200`을 반환한다.

`GET /api/v1/sources/:sourceId/segments`는 분석 근거와 일치하는 발화의 시각, 발화자, Teams 메시지 URL 또는 Notion 블록 URL을 근거 패널에 제공한다. 분석 스냅숏의 인용문은 원본 기록을 보관 처리한 뒤에도 백링크 목록에 남는다.
