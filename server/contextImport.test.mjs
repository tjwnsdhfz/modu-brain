// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ApiError } from "./apiErrors.mjs";
import {
  CONTEXT_IMPORT_MAX_CHARACTERS,
  normalizeContextImport,
  parseContextImport,
} from "./contextImport.mjs";

describe("external context import normalization", () => {
  it("normalizes pasted text and generates stable source and segment IDs", () => {
    const input = {
      provider: "paste",
      title: "회의 후속 메모",
      content: "  첫 번째 결정\r\n두 번째 할 일  ",
      occurredAt: "2026-07-11T10:00:00+09:00",
      sourceUrl: "https://example.com/context",
    };

    const first = normalizeContextImport(input);
    const second = parseContextImport(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      provider: "paste",
      title: "회의 후속 메모",
      kind: "note",
      occurredAt: "2026-07-11T01:00:00.000Z",
      participants: [],
      content: "첫 번째 결정\n두 번째 할 일",
      metadata: { format: "plain_text" },
    });
    expect(first.externalId).toMatch(/^paste:source:[a-f0-9]{24}$/);
    expect(first.segments).toEqual([
      expect.objectContaining({
        externalId: expect.stringMatching(/^paste:segment:[a-f0-9]{24}$/),
        text: "첫 번째 결정\n두 번째 할 일",
        sourceUrl: "https://example.com/context",
      }),
    ]);
  });

  it("accepts a plain-text JSON payload and explicit external ID", () => {
    const result = normalizeContextImport({
      provider: "paste",
      externalId: "clipboard-42",
      payload: JSON.stringify({ content: "JSON으로 전달된 메모" }),
    });

    expect(result.externalId).toBe("clipboard-42");
    expect(result.content).toBe("JSON으로 전달된 메모");
  });

  it("omits empty optional segment fields before database validation", () => {
    const result = normalizeContextImport({
      provider: "paste",
      text: "선택한 회의 맥락을 직접 붙여넣습니다.",
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      externalId: expect.stringMatching(/^paste:segment:[a-f0-9]{24}$/),
      text: "선택한 회의 맥락을 직접 붙여넣습니다.",
    });
    expect(result.segments[0]).not.toHaveProperty("speaker");
    expect(result.segments[0]).not.toHaveProperty("occurredAt");
    expect(result.segments[0]).not.toHaveProperty("sourceUrl");
  });

  it("rejects unsupported, ambiguous, empty, and malformed imports with ApiError", () => {
    const cases = [
      [{ provider: "slack", text: "hello" }, "UNSUPPORTED_IMPORT_PROVIDER"],
      [{ provider: "paste", text: "  " }, "EMPTY_CONTEXT_IMPORT"],
      [{ provider: "paste", text: "hello", payload: { content: "duplicate" } }, "INVALID_CONTEXT_IMPORT"],
      [{ provider: "teams", payload: "{not json" }, "MALFORMED_IMPORT_PAYLOAD"],
      [{ provider: "teams", payload: { unexpected: true } }, "MALFORMED_IMPORT_PAYLOAD"],
    ];

    for (const [input, code] of cases) {
      let caught;
      try {
        normalizeContextImport(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ApiError);
      expect(caught).toMatchObject({ status: 400, code });
    }
  });

  it("enforces the 100,000 character limit", () => {
    expect(
      normalizeContextImport({
        provider: "paste",
        text: "a".repeat(CONTEXT_IMPORT_MAX_CHARACTERS),
      }).content,
    ).toHaveLength(CONTEXT_IMPORT_MAX_CHARACTERS);

    expect(() =>
      normalizeContextImport({
        provider: "paste",
        text: "a".repeat(CONTEXT_IMPORT_MAX_CHARACTERS + 1),
      }),
    ).toThrowError(expect.objectContaining({ status: 413, code: "IMPORT_CONTENT_TOO_LARGE" }));
  });

  it("parses common KakaoTalk desktop exports and keeps unparsed multi-line text", () => {
    const result = normalizeContextImport({
      provider: "kakaotalk",
      text: [
        "프로젝트방 님과 카카오톡 대화",
        "저장한 날짜 : 2026년 7월 11일 오전 10:00",
        "--------------- 2026년 7월 11일 토요일 ---------------",
        "[서준] [오전 10:15] 오늘 범위를 확정하겠습니다.",
        "이 문장은 같은 메시지의 두 번째 줄입니다.",
        "[민지] [오후 1:05] Notion 자료도 연결해요.",
      ].join("\n"),
    });

    expect(result).toMatchObject({
      provider: "kakaotalk",
      title: "프로젝트방 님과 카카오톡 대화",
      kind: "meeting",
      occurredAt: "2026-07-11T01:15:00.000Z",
      participants: ["민지", "서준"],
      metadata: {
        format: "kakaotalk_text_export",
        exportDates: ["2026-07-11"],
        headerLineCount: 2,
      },
    });
    expect(result.content).toContain("이 문장은 같은 메시지의 두 번째 줄입니다.");
    expect(result.segments).toEqual([
      expect.objectContaining({
        speaker: "서준",
        occurredAt: "2026-07-11T01:15:00.000Z",
        text: "오늘 범위를 확정하겠습니다.\n이 문장은 같은 메시지의 두 번째 줄입니다.",
      }),
      expect.objectContaining({
        speaker: "민지",
        occurredAt: "2026-07-11T04:05:00.000Z",
        text: "Notion 자료도 연결해요.",
      }),
    ]);
  });

  it("parses KakaoTalk inline timestamps and preserves otherwise unknown lines", () => {
    const result = normalizeContextImport({
      provider: "kakaotalk",
      text: [
        "알 수 없는 시스템 공지",
        "2026년 7월 11일 오후 2:03, Alex : Teams 회의 링크를 확인했습니다.",
      ].join("\n"),
    });

    expect(result.content).toContain("알 수 없는 시스템 공지");
    expect(result.segments[0]).toEqual(expect.objectContaining({ text: "알 수 없는 시스템 공지" }));
    expect(result.segments[1]).toEqual(
      expect.objectContaining({
        speaker: "Alex",
        occurredAt: "2026-07-11T05:03:00.000Z",
      }),
    );
  });

  it("normalizes Graph chatMessage arrays chronologically and strips unsafe HTML", () => {
    const result = normalizeContextImport({
      provider: "teams",
      title: "디자인 리뷰",
      payload: {
        chatId: "19:meeting_NDI@thread.v2",
        chatType: "meeting",
        value: [
          {
            id: "message-2",
            createdDateTime: "2026-07-11T02:02:00Z",
            from: { user: { displayName: "Bob" } },
            body: { contentType: "html", content: "<p>두 번째 &amp; 확인</p><script>secret()</script>" },
            webUrl: "https://teams.microsoft.com/l/message/message-2",
          },
          {
            id: "message-1",
            createdDateTime: "2026-07-11T02:01:00Z",
            from: { user: { displayName: "Alice" } },
            body: { contentType: "html", content: "<div>첫 번째<br>결정</div>" },
            webUrl: "https://teams.microsoft.com/l/message/message-1",
          },
        ],
      },
    });

    expect(result).toMatchObject({
      provider: "teams",
      externalId: "19:meeting_NDI@thread.v2",
      title: "디자인 리뷰",
      kind: "meeting",
      occurredAt: "2026-07-11T02:01:00.000Z",
      participants: ["Alice", "Bob"],
      metadata: {
        format: "microsoft_graph_chat_messages",
        messageCount: 2,
        chatType: "meeting",
      },
    });
    expect(result.content).toBe("Alice: 첫 번째\n결정\nBob: 두 번째 & 확인");
    expect(result.content).not.toContain("secret");
    expect(result.segments.map(({ externalId }) => externalId)).toEqual(["message-1", "message-2"]);
    expect(result.segments[0]).toEqual(
      expect.objectContaining({
        sourceUrl: "https://teams.microsoft.com/l/message/message-1",
        text: "첫 번째\n결정",
      }),
    );
  });

  it("parses Teams JSON transported as browser file text", () => {
    const result = normalizeContextImport({
      provider: "teams",
      text: JSON.stringify([
        {
          id: "message-from-file",
          from: { user: { displayName: "민지" } },
          body: { contentType: "text", content: "브라우저에서 선택한 파일" },
        },
      ]),
    });

    expect(result).toMatchObject({
      provider: "teams",
      participants: ["민지"],
      content: "민지: 브라우저에서 선택한 파일",
    });
  });

  it("uses structured message identity when a Teams export has no root chat ID", () => {
    const first = normalizeContextImport({
      provider: "teams",
      payload: [{ id: "chat-one-message", content: "같은 회의 문장" }],
    });
    const second = normalizeContextImport({
      provider: "teams",
      payload: [{ id: "chat-two-message", content: "같은 회의 문장" }],
    });

    expect(first.content).toBe(second.content);
    expect(first.externalId).not.toBe(second.externalId);
  });

  it("limits normalized Teams content rather than JSON envelope overhead", () => {
    const text = JSON.stringify({
      padding: "x".repeat(20_000),
      value: [{ id: "large-message", content: "가".repeat(90_000) }],
    });
    expect(text.length).toBeGreaterThan(100_000);

    const result = normalizeContextImport({ provider: "teams", text });
    expect(Array.from(result.content)).toHaveLength(90_000);
  });

  it("rejects malformed Teams messages instead of silently dropping them", () => {
    expect(() =>
      normalizeContextImport({
        provider: "teams",
        payload: { value: [{ id: "missing-body" }] },
      }),
    ).toThrowError(expect.objectContaining({ code: "MALFORMED_IMPORT_PAYLOAD" }));
  });

  it("does not treat Graph plain-text message bodies as HTML", () => {
    const result = normalizeContextImport({
      provider: "teams",
      payload: [
        {
          id: "plain-1",
          body: { contentType: "text", content: "비교값 < 3 > 1" },
        },
      ],
    });

    expect(result.content).toBe("비교값 < 3 > 1");
  });

  it("defaults missing Teams contentType to plain text", () => {
    const result = normalizeContextImport({
      provider: "teams",
      payload: [{ id: "plain-fallback", content: "비교값 < 3 > 1" }],
    });

    expect(result.content).toBe("비교값 < 3 > 1");
  });

  it("applies the 100,000 character limit by Unicode code point", () => {
    expect(() =>
      normalizeContextImport({ provider: "paste", text: "😀".repeat(100_000) }),
    ).not.toThrow();
    expect(() =>
      normalizeContextImport({ provider: "paste", text: "😀".repeat(100_001) }),
    ).toThrowError(expect.objectContaining({ code: "IMPORT_CONTENT_TOO_LARGE" }));
  });

  it("mirrors database segment count and field limits", () => {
    const messages = Array.from({ length: 2_001 }, (_, index) => ({
      id: `message-${index}`,
      content: `message ${index}`,
    }));
    expect(() =>
      normalizeContextImport({ provider: "teams", payload: messages }),
    ).toThrowError(expect.objectContaining({ code: "IMPORT_SEGMENT_LIMIT_EXCEEDED" }));

    expect(() =>
      normalizeContextImport({
        provider: "teams",
        payload: [{
          id: "bad-url",
          from: { user: { displayName: "x".repeat(121) } },
          content: "검증",
          webUrl: "http://example.test/message",
        }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONTEXT_IMPORT" }));
  });

  it("recursively flattens Notion rich_text blocks and retains page/block links", () => {
    const pageUrl = "https://www.notion.so/Project-Kickoff-aabbcc";
    const result = normalizeContextImport({
      provider: "notion",
      payload: {
        page: {
          object: "page",
          id: "page-1",
          url: pageUrl,
          created_time: "2026-07-10T04:00:00Z",
          last_edited_time: "2026-07-11T05:00:00Z",
          created_by: { name: "Editor" },
          properties: {
            Name: {
              type: "title",
              title: [{ plain_text: "Project Kickoff" }],
            },
          },
        },
        blocks: [
          {
            object: "block",
            id: "block-1",
            type: "heading_1",
            heading_1: { rich_text: [{ plain_text: "핵심 결정" }] },
            children: [
              {
                object: "block",
                id: "block-2",
                type: "paragraph",
                paragraph: {
                  rich_text: [
                    { text: { content: "출시일은 " } },
                    { plain_text: "8월 1일" },
                  ],
                },
              },
            ],
          },
          {
            object: "block",
            id: "block-3",
            type: "to_do",
            to_do: { rich_text: [{ plain_text: "데모 데이터 준비" }] },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      provider: "notion",
      externalId: "page-1",
      title: "Project Kickoff",
      kind: "note",
      occurredAt: "2026-07-10T04:00:00.000Z",
      participants: ["Editor"],
      content: "핵심 결정\n출시일은 8월 1일\n데모 데이터 준비",
      metadata: {
        format: "notion_blocks",
        pageUrl,
        blockCount: 3,
        lastEditedAt: "2026-07-11T05:00:00.000Z",
      },
    });
    expect(result.segments.map(({ externalId }) => externalId)).toEqual([
      "block-1",
      "block-2",
      "block-3",
    ]);
    expect(result.segments[1].sourceUrl).toBe(`${pageUrl}#block2`);
  });

  it("accepts Notion block-children list responses and preserves depth-first ordering", () => {
    const result = normalizeContextImport({
      provider: "notion",
      payload: {
        object: "list",
        results: [
          {
            id: "a",
            type: "paragraph",
            paragraph: { rich_text: [{ plain_text: "A" }] },
            paragraph_children: [],
          },
          {
            id: "b",
            type: "child_page",
            child_page: { title: "B" },
          },
          {
            id: "c",
            type: "table_row",
            table_row: {
              cells: [[{ plain_text: "C1" }], [{ plain_text: "C2" }]],
            },
          },
        ],
      },
    });

    expect(result.content).toBe("A\nB\nC1 | C2");
    expect(result.segments.map(({ externalId }) => externalId)).toEqual(["a", "b", "c"]);
  });

  it("rejects Notion payloads that contain no usable source text", () => {
    expect(() =>
      normalizeContextImport({
        provider: "notion",
        payload: {
          object: "list",
          results: [{ id: "divider", type: "divider", divider: {} }],
        },
      }),
    ).toThrowError(expect.objectContaining({ status: 400, code: "EMPTY_CONTEXT_IMPORT" }));
  });
});
