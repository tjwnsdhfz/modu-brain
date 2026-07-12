import { createHash } from "node:crypto";

import { ApiError } from "./apiErrors.mjs";

export const CONTEXT_IMPORT_MAX_CHARACTERS = 100_000;
export const CONTEXT_IMPORT_MAX_SEGMENTS = 2_000;

const SUPPORTED_PROVIDERS = new Set(["paste", "kakaotalk", "teams", "notion"]);
const PROVIDER_DEFAULTS = {
  paste: { kind: "note", title: "붙여넣은 맥락" },
  kakaotalk: { kind: "meeting", title: "카카오톡 대화" },
  teams: { kind: "meeting", title: "Teams 대화" },
  notion: { kind: "note", title: "Notion 페이지" },
};

/**
 * Converts an external context export into the provider-neutral source shape used by Modu Brain.
 * This function is deliberately pure: callers decide when and where to persist the result.
 */
export function normalizeContextImport(input) {
  if (!isRecord(input)) {
    throw invalidImport("가져오기 요청은 JSON 객체여야 합니다.");
  }

  const provider = optionalString(input.provider)?.toLowerCase();
  if (!provider || !SUPPORTED_PROVIDERS.has(provider)) {
    throw new ApiError(
      400,
      "UNSUPPORTED_IMPORT_PROVIDER",
      "지원하지 않는 외부 맥락 공급자입니다.",
      { supportedProviders: [...SUPPORTED_PROVIDERS] },
    );
  }

  validateOptionalStringField(input, "title");
  validateOptionalStringField(input, "externalId");
  validateOptionalStringField(input, "occurredAt");
  validateOptionalStringField(input, "sourceUrl");

  let rawText = readInputText(input);
  let payload = readJsonPayload(input.payload);

  if (rawText && payload !== null) {
    throw invalidImport("text/content와 payload 중 하나만 입력해 주세요.");
  }
  if (!rawText && payload === null) {
    throw emptyImport();
  }
  if (provider === "paste" || provider === "kakaotalk") {
    assertCharacterLimit(rawText);
  }

  // The browser import panel transports exported JSON as text after a user
  // selects a local file. Parse that text here so no provider token or direct
  // account connection is required.
  if ((provider === "teams" || provider === "notion") && rawText && payload === null) {
    payload = readJsonPayload(rawText);
    rawText = "";
  }

  let parsed;
  if (provider === "kakaotalk") {
    parsed = parseKakaoTalk(rawText || textFromPayload(payload));
  } else if (provider === "teams" && payload !== null) {
    parsed = parseTeamsPayload(payload);
  } else if (provider === "notion" && payload !== null) {
    parsed = parseNotionPayload(payload);
  } else {
    const text = rawText || textFromPayload(payload);
    parsed = parsePlainText(provider, text, input);
  }

  return finalizeImport(parsed, input, provider);
}

// A discoverable alias for callers that naturally think of this module as a parser.
export const parseContextImport = normalizeContextImport;

function parsePlainText(provider, value, input) {
  const text = normalizeDocumentText(value);
  if (!text) throw emptyImport();

  const occurredAt = parseOptionalTimestamp(input.occurredAt, "occurredAt");
  return {
    title: PROVIDER_DEFAULTS[provider].title,
    kind: PROVIDER_DEFAULTS[provider].kind,
    occurredAt,
    participants: [],
    content: text,
    segments: [
      {
        occurredAt,
        text,
        sourceUrl: optionalString(input.sourceUrl),
      },
    ],
    metadata: { format: "plain_text" },
  };
}

function parseKakaoTalk(value) {
  const content = normalizeDocumentText(value);
  if (!content) throw emptyImport();

  const lines = content.split("\n");
  const segments = [];
  const exportDates = [];
  let currentDate = null;
  let lastMessage = null;
  let detectedTitle = "";
  let headerLineCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!detectedTitle && /카카오톡\s+대화\s*$/.test(line)) {
      detectedTitle = line;
      headerLineCount += 1;
      continue;
    }
    if (/^저장한\s+날짜\s*:/.test(line)) {
      headerLineCount += 1;
      continue;
    }

    const dateHeader = parseKakaoDateHeader(line);
    if (dateHeader) {
      currentDate = dateHeader;
      exportDates.push(formatDateParts(dateHeader));
      lastMessage = null;
      continue;
    }

    const parsedLine = parseKakaoMessageLine(line, currentDate);
    if (parsedLine) {
      segments.push(parsedLine);
      lastMessage = parsedLine;
      continue;
    }

    // Kakao exports multi-line messages without repeating the speaker/time prefix.
    // Keeping the line attached to the previous message avoids silently losing it.
    if (lastMessage) {
      lastMessage.text = `${lastMessage.text}\n${rawLine.trimEnd()}`.trim();
    } else {
      const unparsed = { text: rawLine.trimEnd() };
      segments.push(unparsed);
      lastMessage = unparsed;
    }
  }

  if (segments.length === 0) throw emptyImport();

  return {
    title: detectedTitle || PROVIDER_DEFAULTS.kakaotalk.title,
    kind: "meeting",
    occurredAt: earliestTimestamp(segments),
    participants: participantNames(segments),
    content,
    segments,
    metadata: compactRecord({
      format: "kakaotalk_text_export",
      exportDates: stableUnique(exportDates),
      headerLineCount,
    }),
  };
}

function parseKakaoDateHeader(line) {
  const korean = line.match(
    /^-+\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s+(?:\S+요일|\([월화수목금토일]\)))?\s*-+$/,
  );
  if (korean) return validDateParts(korean[1], korean[2], korean[3]);

  const numeric = line.match(
    /^-+\s*(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\.?\s*-+$/,
  );
  return numeric ? validDateParts(numeric[1], numeric[2], numeric[3]) : null;
}

function parseKakaoMessageLine(line, currentDate) {
  const koreanInline = line.match(
    /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s?(.*)$/,
  );
  if (koreanInline) {
    return kakaoSegment({
      date: validDateParts(koreanInline[1], koreanInline[2], koreanInline[3]),
      period: koreanInline[4],
      hour: koreanInline[5],
      minute: koreanInline[6],
      speaker: koreanInline[7],
      text: koreanInline[8],
    });
  }

  const numericInline = line.match(
    /^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\.?\s+(오전|오후|AM|PM)\s*(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s?(.*)$/i,
  );
  if (numericInline) {
    return kakaoSegment({
      date: validDateParts(numericInline[1], numericInline[2], numericInline[3]),
      period: numericInline[4],
      hour: numericInline[5],
      minute: numericInline[6],
      speaker: numericInline[7],
      text: numericInline[8],
    });
  }

  const bracketKorean = line.match(
    /^\[([^\]\r\n]+)]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})]\s?(.*)$/,
  );
  if (bracketKorean) {
    return kakaoSegment({
      date: currentDate,
      period: bracketKorean[2],
      hour: bracketKorean[3],
      minute: bracketKorean[4],
      speaker: bracketKorean[1],
      text: bracketKorean[5],
    });
  }

  const bracketEnglish = line.match(
    /^\[([^\]\r\n]+)]\s*\[(\d{1,2}):(\d{2})\s*(AM|PM)]\s?(.*)$/i,
  );
  if (bracketEnglish) {
    return kakaoSegment({
      date: currentDate,
      period: bracketEnglish[4],
      hour: bracketEnglish[2],
      minute: bracketEnglish[3],
      speaker: bracketEnglish[1],
      text: bracketEnglish[5],
    });
  }

  const bracket24Hour = line.match(/^\[([^\]\r\n]+)]\s*\[(\d{1,2}):(\d{2})]\s?(.*)$/);
  if (bracket24Hour) {
    return kakaoSegment({
      date: currentDate,
      period: null,
      hour: bracket24Hour[2],
      minute: bracket24Hour[3],
      speaker: bracket24Hour[1],
      text: bracket24Hour[4],
    });
  }

  return null;
}

function kakaoSegment({ date, period, hour, minute, speaker, text }) {
  const cleanSpeaker = normalizeInlineText(speaker);
  const cleanText = normalizeDocumentText(text);
  if (!cleanSpeaker || !cleanText) return null;

  return {
    speaker: cleanSpeaker,
    occurredAt: date ? kakaoTimestamp(date, hour, minute, period) : null,
    text: cleanText,
  };
}

function kakaoTimestamp(date, hourValue, minuteValue, periodValue) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue);
  const period = optionalString(periodValue)?.toUpperCase();

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  if (period) {
    if (hour < 1 || hour > 12) return null;
    const isAfternoon = period === "오후" || period === "PM";
    const isMorning = period === "오전" || period === "AM";
    if (!isAfternoon && !isMorning) return null;
    if (isAfternoon && hour < 12) hour += 12;
    if (isMorning && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  const local = `${formatDateParts(date)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`;
  return normalizeTimestamp(local);
}

function parseTeamsPayload(payload) {
  const root = isRecord(payload) ? payload : null;
  const messages = extractTeamsMessages(payload);
  if (!messages) throw malformedPayload("Teams payload에는 chatMessage 배열이 필요합니다.");

  const parsed = messages.map((message, index) => parseTeamsMessage(message, index));
  const segments = parsed
    .filter(Boolean)
    .sort((left, right) => compareDatedSegments(left, right));
  if (segments.length === 0) throw emptyImport();

  const content = segments
    .map((segment) => `${segment.speaker ? `${segment.speaker}: ` : ""}${segment.text}`)
    .join("\n");

  return {
    externalId: firstOptionalString(root?.chatId, root?.threadId, root?.id),
    title: firstOptionalString(root?.topic, root?.subject, root?.chatName) || PROVIDER_DEFAULTS.teams.title,
    kind: "meeting",
    occurredAt: earliestTimestamp(segments),
    participants: participantNames(segments),
    content,
    segments,
    metadata: compactRecord({
      format: "microsoft_graph_chat_messages",
      messageCount: segments.length,
      chatType: optionalString(root?.chatType),
      tenantId: optionalString(root?.tenantId),
      meetingId: firstOptionalString(root?.meetingId, root?.onlineMeetingId),
    }),
  };
}

function extractTeamsMessages(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;

  for (const key of ["value", "messages", "chatMessages"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  if (isRecord(payload.body) || typeof payload.content === "string") return [payload];
  return null;
}

function parseTeamsMessage(message, index) {
  if (!isRecord(message)) {
    throw malformedPayload(`Teams 메시지 ${index + 1} 형식이 올바르지 않습니다.`);
  }

  const body = isRecord(message.body) ? message.body : null;
  const bodyContent = body ? body.content : message.content;
  if (typeof bodyContent !== "string") {
    throw malformedPayload(`Teams 메시지 ${index + 1}에 body.content가 없습니다.`);
  }

  const contentType = optionalString(body?.contentType).toLowerCase();
  const text = contentType === "html"
    ? htmlToPlainText(bodyContent)
    : normalizeDocumentText(bodyContent);
  if (!text) {
    // Graph may keep tombstones for deleted messages. They carry no useful source text.
    if (message.deletedDateTime) return null;
    throw emptyImport(`Teams 메시지 ${index + 1}의 본문이 비어 있습니다.`);
  }

  const speaker = firstOptionalString(
    message.from?.user?.displayName,
    message.from?.application?.displayName,
    message.from?.device?.displayName,
    message.from?.displayName,
  );
  const occurredAt = parseOptionalTimestamp(
    firstDefined(message.createdDateTime, message.lastModifiedDateTime),
    `messages[${index}].createdDateTime`,
  );

  return compactRecord({
    externalId: optionalString(message.id),
    speaker,
    occurredAt,
    text,
    sourceUrl: firstOptionalString(message.webUrl, message.linkToMessage),
    _originalIndex: index,
  });
}

function parseNotionPayload(payload) {
  const root = isRecord(payload) ? payload : null;
  const page = isRecord(root?.page) ? root.page : root?.object === "page" ? root : null;
  const blocks = extractNotionBlocks(payload, page);
  if (!blocks) throw malformedPayload("Notion payload에는 page/block rich_text가 필요합니다.");

  const pageUrl = firstOptionalString(page?.url, root?.pageUrl, root?.url);
  const state = { blockCount: 0, visited: new WeakSet() };
  const segments = [];
  flattenNotionBlocks(blocks, segments, pageUrl, state, 0);
  if (segments.length === 0) throw emptyImport();

  const pageOccurredAt = parseOptionalTimestamp(
    firstDefined(page?.created_time, root?.created_time),
    "page.created_time",
  );
  const title =
    firstRichText(root?.title) || extractNotionPageTitle(page) || PROVIDER_DEFAULTS.notion.title;

  return {
    externalId: firstOptionalString(page?.id, root?.pageId, root?.id),
    title,
    kind: "note",
    occurredAt: pageOccurredAt || earliestTimestamp(segments),
    participants: stableUnique(
      [page?.created_by?.name, page?.last_edited_by?.name]
        .map(optionalString)
        .filter(Boolean),
    ),
    content: segments.map((segment) => segment.text).join("\n"),
    segments,
    metadata: compactRecord({
      format: "notion_blocks",
      pageUrl,
      blockCount: state.blockCount,
      hasMore: typeof root?.has_more === "boolean" ? root.has_more : undefined,
      nextCursor: optionalString(root?.next_cursor),
      lastEditedAt: parseOptionalTimestamp(
        firstDefined(page?.last_edited_time, root?.last_edited_time),
        "page.last_edited_time",
      ),
    }),
  };
}

function extractNotionBlocks(payload, page) {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;

  for (const candidate of [payload.blocks, payload.children, payload.results]) {
    const blocks = notionBlockArray(candidate);
    if (blocks) return blocks;
  }
  for (const candidate of [page?.blocks, page?.children]) {
    const blocks = notionBlockArray(candidate);
    if (blocks) return blocks;
  }
  if (looksLikeNotionBlock(payload)) return [payload];
  return null;
}

function notionBlockArray(candidate) {
  if (Array.isArray(candidate)) return candidate;
  if (isRecord(candidate) && Array.isArray(candidate.results)) return candidate.results;
  return null;
}

function looksLikeNotionBlock(value) {
  return (
    isRecord(value) &&
    (value.object === "block" || typeof value.type === "string" || Array.isArray(value.rich_text))
  );
}

function flattenNotionBlocks(blocks, segments, pageUrl, state, depth) {
  if (!Array.isArray(blocks) || depth > 100) {
    throw malformedPayload("Notion block 트리 형식이 올바르지 않습니다.");
  }

  for (const block of blocks) {
    if (!isRecord(block)) throw malformedPayload("Notion block은 JSON 객체여야 합니다.");
    if (state.visited.has(block)) throw malformedPayload("Notion block 트리에 순환 참조가 있습니다.");
    state.visited.add(block);
    state.blockCount += 1;

    const text = notionBlockText(block);
    if (text) {
      const blockId = optionalString(block.id);
      segments.push(
        compactRecord({
          externalId: blockId,
          occurredAt: parseOptionalTimestamp(block.created_time, `block ${blockId || state.blockCount}`),
          text,
          sourceUrl: notionBlockUrl(block, pageUrl),
        }),
      );
    }

    const typedValue = isRecord(block[block.type]) ? block[block.type] : null;
    const children = notionBlockArray(block.children) || notionBlockArray(typedValue?.children);
    if (children) flattenNotionBlocks(children, segments, pageUrl, state, depth + 1);
  }
}

function notionBlockText(block) {
  const typedValue = isRecord(block[block.type]) ? block[block.type] : null;
  const richText = firstRichText(
    typedValue?.rich_text,
    block.rich_text,
    typedValue?.title,
    block.title,
    typedValue?.caption,
    block.caption,
  );
  if (richText) return richText;

  if (Array.isArray(typedValue?.cells)) {
    const row = typedValue.cells.map(notionRichText).filter(Boolean).join(" | ");
    if (row) return row;
  }

  return firstOptionalString(
    typedValue?.expression,
    typedValue?.url,
    typeof block.text === "string" ? block.text : undefined,
  );
}

function firstRichText(...values) {
  for (const value of values) {
    const text = notionRichText(value);
    if (text) return text;
  }
  return "";
}

function notionRichText(value) {
  if (typeof value === "string") return normalizeDocumentText(value);
  if (!Array.isArray(value)) return "";

  return normalizeDocumentText(
    value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!isRecord(item)) return "";
        return firstString(
          item.plain_text,
          item.text?.content,
          item.equation?.expression,
          item.mention?.user?.name,
        );
      })
      .join(""),
  );
}

function extractNotionPageTitle(page) {
  if (!isRecord(page?.properties)) return "";
  for (const property of Object.values(page.properties)) {
    if (!isRecord(property)) continue;
    const title = firstRichText(property.title, property.rich_text);
    if (property.type === "title" && title) return title;
  }
  for (const property of Object.values(page.properties)) {
    if (!isRecord(property)) continue;
    const title = firstRichText(property.title);
    if (title) return title;
  }
  return "";
}

function notionBlockUrl(block, pageUrl) {
  const directUrl = optionalString(block.url);
  if (directUrl) return directUrl;
  const blockId = optionalString(block.id)?.replaceAll("-", "");
  if (!pageUrl || !blockId) return pageUrl || undefined;
  return `${pageUrl.split("#", 1)[0]}#${blockId}`;
}

function finalizeImport(parsed, input, provider) {
  const content = normalizeDocumentText(parsed.content);
  if (!content) throw emptyImport();
  assertCharacterLimit(content);

  const rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
  if (rawSegments.length > CONTEXT_IMPORT_MAX_SEGMENTS) {
    throw new ApiError(
      413,
      "IMPORT_SEGMENT_LIMIT_EXCEEDED",
      "가져올 맥락은 2,000개 세그먼트 이하여야 합니다.",
      { maxSegments: CONTEXT_IMPORT_MAX_SEGMENTS, actualSegments: rawSegments.length },
    );
  }
  const normalizedSegments = rawSegments
    .map((segment, index) => normalizeSegment(segment, index))
    .filter(Boolean);
  if (normalizedSegments.length === 0) throw emptyImport();

  const segments = normalizedSegments.map((segment, index) => {
    const externalId =
      segment.externalId ||
      deterministicId(provider, "segment", {
        index,
        speaker: segment.speaker || null,
        occurredAt: segment.occurredAt || null,
        text: segment.text,
        sourceUrl: segment.sourceUrl || null,
      });
    return compactRecord({
      externalId,
      speaker: segment.speaker,
      occurredAt: segment.occurredAt,
      text: segment.text,
      sourceUrl: segment.sourceUrl,
    });
  });

  const explicitOccurredAt = parseOptionalTimestamp(input.occurredAt, "occurredAt");
  const title = optionalString(input.title) || parsed.title || PROVIDER_DEFAULTS[provider].title;
  const structuredIdentity = (provider === "teams" || provider === "notion")
    ? segments.map((segment) => ({
        externalId: segment.externalId || null,
        sourceUrl: segment.sourceUrl || null,
      }))
    : null;
  const externalId =
    optionalString(input.externalId) ||
    optionalString(parsed.externalId) ||
    deterministicId(
      provider,
      "source",
      structuredIdentity?.some((item) => item.externalId || item.sourceUrl)
        ? structuredIdentity
        : content,
    );

  return {
    provider,
    externalId,
    title,
    kind: parsed.kind === "meeting" ? "meeting" : "note",
    occurredAt: explicitOccurredAt || normalizeTimestamp(parsed.occurredAt) || earliestTimestamp(segments),
    participants: validateParticipants(
      stableUnique(parsed.participants || participantNames(segments)),
    ),
    content,
    segments,
    metadata: isRecord(parsed.metadata) ? parsed.metadata : {},
  };
}

function normalizeSegment(segment, index) {
  if (!isRecord(segment)) return null;
  const text = normalizeDocumentText(segment.text);
  if (!text) return null;
  const speaker = optionalString(segment.speaker);
  const externalId = optionalString(segment.externalId);
  const sourceUrl = optionalString(segment.sourceUrl);
  if (speaker && unicodeLength(speaker) > 120) {
    throw invalidImport(`세그먼트 ${index + 1}의 발화자는 120자 이하여야 합니다.`);
  }
  if (externalId && unicodeLength(externalId) > 500) {
    throw invalidImport(`세그먼트 ${index + 1}의 외부 ID는 500자 이하여야 합니다.`);
  }
  if (unicodeLength(text) > CONTEXT_IMPORT_MAX_CHARACTERS) {
    throw invalidImport(`세그먼트 ${index + 1}의 본문이 너무 깁니다.`);
  }
  if (sourceUrl && (unicodeLength(sourceUrl) > 2_048 || !sourceUrl.startsWith("https://"))) {
    throw invalidImport(`세그먼트 ${index + 1}의 원문 URL은 2,048자 이하 HTTPS 주소여야 합니다.`);
  }
  return compactRecord({
    externalId,
    speaker,
    occurredAt: normalizeTimestamp(segment.occurredAt),
    text,
    sourceUrl,
    _originalIndex: Number.isInteger(segment._originalIndex) ? segment._originalIndex : undefined,
  });
}

function validateParticipants(participants) {
  if (participants.length > 200) {
    throw new ApiError(
      413,
      "IMPORT_PARTICIPANT_LIMIT_EXCEEDED",
      "가져올 맥락의 참여자는 200명 이하여야 합니다.",
      { maxParticipants: 200, actualParticipants: participants.length },
    );
  }
  if (participants.some((participant) => unicodeLength(participant) > 120)) {
    throw invalidImport("참여자 이름은 각각 120자 이하여야 합니다.");
  }
  return participants;
}

function htmlToPlainText(value) {
  const withoutUnsafeContainers = value.replace(
    /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
  const withBreaks = withoutUnsafeContainers
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|table|blockquote|pre|h[1-6])\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  return normalizeReadableText(decodeHtmlEntities(withBreaks));
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return "�";
        }
      }
      return "�";
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function readInputText(input) {
  for (const field of ["text", "content"]) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw invalidImport(`${field}는 문자열이어야 합니다.`);
    const normalized = normalizeDocumentText(value);
    if (normalized) return normalized;
  }
  return "";
}

function readJsonPayload(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (!isRecord(parsed) && !Array.isArray(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw malformedPayload("payload를 JSON 객체 또는 배열로 파싱할 수 없습니다.");
    }
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    throw malformedPayload("payload는 JSON 객체 또는 배열이어야 합니다.");
  }
  return value;
}

function textFromPayload(payload) {
  if (!isRecord(payload)) throw malformedPayload("텍스트 payload는 JSON 객체여야 합니다.");
  const value = firstDefined(payload.text, payload.content);
  if (typeof value !== "string") {
    throw malformedPayload("payload에 text 또는 content 문자열이 필요합니다.");
  }
  const text = normalizeDocumentText(value);
  if (!text) throw emptyImport();
  return text;
}

function normalizeDocumentText(value) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

function normalizeReadableText(value) {
  return normalizeDocumentText(value)
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInlineText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function participantNames(segments) {
  return stableUnique(segments.map((segment) => optionalString(segment.speaker)).filter(Boolean));
}

function stableUnique(values) {
  return [...new Set(values.map(optionalString).filter(Boolean))].sort(codePointCompare);
}

function codePointCompare(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareDatedSegments(left, right) {
  const leftDate = left.occurredAt || "9999";
  const rightDate = right.occurredAt || "9999";
  if (leftDate !== rightDate) return codePointCompare(leftDate, rightDate);
  const leftId = left.externalId || "";
  const rightId = right.externalId || "";
  if (leftId !== rightId) return codePointCompare(leftId, rightId);
  return left._originalIndex - right._originalIndex;
}

function earliestTimestamp(segments) {
  const timestamps = segments
    .map((segment) => normalizeTimestamp(segment.occurredAt))
    .filter(Boolean)
    .sort(codePointCompare);
  return timestamps[0] || null;
}

function parseOptionalTimestamp(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw malformedPayload(`${field} 날짜 형식이 올바르지 않습니다.`);
  }
  const normalized = normalizeTimestamp(value);
  if (!normalized) throw malformedPayload(`${field} 날짜 형식이 올바르지 않습니다.`);
  return normalized;
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validDateParts(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatDateParts(date) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function deterministicId(provider, scope, value) {
  const digest = createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
  return `${provider}:${scope}:${digest}`;
}

function assertCharacterLimit(value) {
  if (!value) return;
  const actualCharacters = unicodeLength(value);
  if (actualCharacters > CONTEXT_IMPORT_MAX_CHARACTERS) {
    throw new ApiError(413, "IMPORT_CONTENT_TOO_LARGE", "가져올 맥락은 100,000자 이하여야 합니다.", {
      maxCharacters: CONTEXT_IMPORT_MAX_CHARACTERS,
      actualCharacters,
    });
  }
}

function unicodeLength(value) {
  return Array.from(value).length;
}

function validateOptionalStringField(input, field) {
  const value = input[field];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw invalidImport(`${field}는 문자열이어야 합니다.`);
  }
}

function compactRecord(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  );
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function firstOptionalString(...values) {
  for (const value of values) {
    const normalized = optionalString(value);
    if (normalized) return normalized;
  }
  return "";
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidImport(message) {
  return new ApiError(400, "INVALID_CONTEXT_IMPORT", message);
}

function malformedPayload(message) {
  return new ApiError(400, "MALFORMED_IMPORT_PAYLOAD", message);
}

function emptyImport(message = "가져올 외부 맥락이 비어 있습니다.") {
  return new ApiError(400, "EMPTY_CONTEXT_IMPORT", message);
}
