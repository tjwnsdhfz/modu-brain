import type {
  ContextAnalysisResult,
  EvidenceRef,
  KnowledgeNode,
  NodeType,
} from "../types/context";

export type ThoughtKind = "topic" | "perspective" | "decision" | "question" | "term";

export type ThoughtNode = {
  id: string;
  kind: ThoughtKind;
  label: string;
  summary: string;
  evidence: EvidenceRef[];
};

export type ThoughtEdge = {
  id: string;
  from: string;
  to: string;
  relation: string;
};

export type ThoughtGraph = {
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
};

export type ThoughtGraphResult = Omit<ContextAnalysisResult, "provider">;

export type ThoughtPosition = { x: number; y: number };

export const BRAIN_VIEWBOX = { width: 960, height: 600 } as const;
export const MAX_THOUGHT_NODES = 100;
export const MAX_THOUGHT_EDGES = 180;
export const MOBILE_THOUGHT_SUMMARY_LIMIT = 21;

const kindForMapNode: Record<NodeType, ThoughtKind> = {
  topic: "topic",
  person: "perspective",
  role: "perspective",
  decision: "decision",
  question: "question",
};

const clusterBounds: Record<Exclude<ThoughtKind, "topic">, {
  left: number;
  right: number;
  top: number;
  bottom: number;
}> = {
  perspective: { left: 72, right: 374, top: 132, bottom: 528 },
  decision: { left: 586, right: 888, top: 132, bottom: 528 },
  term: { left: 226, right: 734, top: 52, bottom: 206 },
  question: { left: 226, right: 734, top: 394, bottom: 548 },
};

export function buildThoughtGraph(
  input: ThoughtGraphResult | ContextAnalysisResult["knowledgeMap"],
): ThoughtGraph {
  if (!("knowledgeMap" in input)) return buildFromKnowledgeMap(input);

  const result = input;
  const map = result.knowledgeMap ?? { nodes: [], links: [] };
  const topicNode = map.nodes.find((node) => node.type === "topic");
  const root: ThoughtNode = {
    id: thoughtId("topic", topicNode?.id || result.projectTitle || "project"),
    kind: "topic",
    label: result.projectTitle || topicNode?.label || "프로젝트 맥락",
    summary:
      topicNode?.summary ||
      result.summary?.overview?.[0] ||
      "기록에서 확인한 생각을 한곳에 연결한 중심 주제입니다.",
    evidence: topicNode?.evidence ?? [],
  };

  const participants = (result.participants ?? []).map<ThoughtNode>((item, index) => ({
    id: thoughtId("perspective", item.id || `${item.actor}-${index}`),
    kind: "perspective",
    label: item.actor || `참여자 ${index + 1}`,
    summary: joinSummary([item.role, item.focus, item.concern]),
    evidence: item.evidence ?? [],
  }));
  const decisions = (result.decisions ?? []).map<ThoughtNode>((item, index) => ({
    id: thoughtId("decision", item.id || `${item.decision}-${index}`),
    kind: "decision",
    label: item.decision || `결정 ${index + 1}`,
    summary: joinSummary([statusLabel(item.status), item.reason]),
    evidence: item.evidence ?? [],
  }));
  const questions = (result.questions ?? []).map<ThoughtNode>((item, index) => ({
    id: thoughtId("question", item.id || `${item.question}-${index}`),
    kind: "question",
    label: item.question || `질문 ${index + 1}`,
    summary: joinSummary([item.reason, item.ownerHint ? `확인: ${item.ownerHint}` : ""]),
    evidence: item.evidence ?? [],
  }));
  const terms = (result.keyTerms ?? []).map<ThoughtNode>((item, index) => ({
    id: thoughtId("term", item.id || `${item.term}-${index}`),
    kind: "term",
    label: item.term || `핵심어 ${index + 1}`,
    summary: item.meaning || "분석에서 반복해 확인된 핵심 개념입니다.",
    evidence: item.evidence ?? [],
  }));

  const nodes = [root, ...participants, ...decisions, ...questions, ...terms];
  const mappedIds = mapMapNodes(map.nodes, root, participants, decisions, questions);
  const additionalNodes: ThoughtNode[] = [];

  map.nodes.forEach((node, index) => {
    if (mappedIds.has(node.id)) return;
    const id = thoughtId(kindForMapNode[node.type], `map-${node.id || index}`);
    mappedIds.set(node.id, id);
    additionalNodes.push({
      id,
      kind: kindForMapNode[node.type],
      label: node.label || `연결된 생각 ${index + 1}`,
      summary: node.summary || "분석 지식맵에서 확인된 연결 정보입니다.",
      evidence: node.evidence ?? [],
    });
  });
  nodes.push(...additionalNodes);

  const edges: ThoughtEdge[] = [];
  map.links.forEach((link) => {
    const from = mappedIds.get(link.from);
    const to = mappedIds.get(link.to);
    if (from && to && from !== to) addEdge(edges, from, to, link.relation || "연결");
  });

  for (const node of nodes) {
    if (node.id === root.id) continue;
    if (edges.some((edge) => (
      (edge.from === root.id && edge.to === node.id) ||
      (edge.from === node.id && edge.to === root.id)
    ))) continue;
    addEdge(edges, root.id, node.id, defaultRelation(node.kind));
  }

  return capThoughtGraph({ nodes, edges });
}

export function layoutThoughtNodes(nodes: ThoughtNode[], clustered = true) {
  const positions = new Map<string, ThoughtPosition>();
  const root = nodes.find((node) => node.kind === "topic");
  if (root) positions.set(root.id, { x: BRAIN_VIEWBOX.width / 2, y: BRAIN_VIEWBOX.height / 2 });

  const nonRoot = nodes.filter((node) => node.id !== root?.id);
  if (!clustered) {
    const radiusX = 342;
    const radiusY = 224;
    nonRoot.forEach((node, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(nonRoot.length, 1);
      positions.set(node.id, {
        x: BRAIN_VIEWBOX.width / 2 + Math.cos(angle) * radiusX,
        y: BRAIN_VIEWBOX.height / 2 + Math.sin(angle) * radiusY,
      });
    });
    return positions;
  }

  for (const kind of ["perspective", "term", "decision", "question"] as const) {
    const kindNodes = nodes.filter((node) => node.kind === kind);
    const bounds = clusterBounds[kind];
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const columns = Math.max(1, Math.ceil(Math.sqrt(kindNodes.length * (width / height))));
    const rows = Math.max(1, Math.ceil(kindNodes.length / columns));

    kindNodes.forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      positions.set(node.id, {
        x: bounds.left + ((column + 0.5) * width) / columns,
        y: bounds.top + ((row + 0.5) * height) / rows,
      });
    });
  }

  const unpositioned = nodes.filter((node) => !positions.has(node.id));
  unpositioned.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(unpositioned.length, 1);
    positions.set(node.id, {
      x: BRAIN_VIEWBOX.width / 2 + Math.cos(angle) * 92,
      y: BRAIN_VIEWBOX.height / 2 + Math.sin(angle) * 82,
    });
  });
  return positions;
}

function buildFromKnowledgeMap(map: ContextAnalysisResult["knowledgeMap"]): ThoughtGraph {
  const nodes = map.nodes.map<ThoughtNode>((node, index) => ({
    id: thoughtId(kindForMapNode[node.type], node.id || `${node.label}-${index}`),
    kind: kindForMapNode[node.type],
    label: node.label || `연결된 생각 ${index + 1}`,
    summary: node.summary || "분석 지식맵에서 확인된 연결 정보입니다.",
    evidence: node.evidence ?? [],
  }));
  const idMap = new Map(map.nodes.map((node, index) => [node.id, nodes[index].id]));
  const edges: ThoughtEdge[] = [];
  map.links.forEach((link) => {
    const from = idMap.get(link.from);
    const to = idMap.get(link.to);
    if (from && to && from !== to) addEdge(edges, from, to, link.relation || "연결");
  });
  return capThoughtGraph({ nodes, edges });
}

export function capThoughtGraph(graph: ThoughtGraph): ThoughtGraph {
  const unique = uniqueNodes(graph.nodes);
  const root = unique.find((node) => node.kind === "topic");
  const remaining = unique.filter((node) => node.id !== root?.id);
  const buckets = (["perspective", "term", "decision", "question", "topic"] as const)
    .map((kind) => remaining.filter((node) => node.kind === kind));
  const prioritizedNodes = root ? [root] : [];

  while (prioritizedNodes.length < MAX_THOUGHT_NODES && buckets.some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next) prioritizedNodes.push(next);
      if (prioritizedNodes.length === MAX_THOUGHT_NODES) break;
    }
  }
  const nodes = prioritizedNodes.slice(0, MAX_THOUGHT_NODES);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set<string>();
  const edges = graph.edges.filter((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) return false;
    if (edgeIds.has(edge.id)) return false;
    edgeIds.add(edge.id);
    return true;
  }).slice(0, MAX_THOUGHT_EDGES);
  return { nodes, edges };
}

function mapMapNodes(
  mapNodes: KnowledgeNode[],
  root: ThoughtNode,
  participants: ThoughtNode[],
  decisions: ThoughtNode[],
  questions: ThoughtNode[],
) {
  const result = new Map<string, string>();
  const used = new Set<string>();
  const pools: Partial<Record<NodeType, ThoughtNode[]>> = {
    person: participants,
    role: participants,
    decision: decisions,
    question: questions,
  };

  mapNodes.forEach((node) => {
    if (node.type === "topic") {
      result.set(node.id, root.id);
      return;
    }
    const pool = pools[node.type] ?? [];
    const match = pool.find((candidate) => !used.has(candidate.id) && nodeMatches(node, candidate))
      ?? pool.find((candidate) => !used.has(candidate.id));
    if (match) {
      result.set(node.id, match.id);
      used.add(match.id);
    }
  });
  return result;
}

function nodeMatches(node: KnowledgeNode, candidate: ThoughtNode) {
  const nodeValues = [node.label, node.summary].map(normalize).filter(Boolean);
  const candidateValues = [candidate.label, candidate.summary].map(normalize).filter(Boolean);
  return nodeValues.some((left) => candidateValues.some((right) => (
    left === right || (left.length >= 4 && right.includes(left)) || (right.length >= 4 && left.includes(right))
  )));
}

function thoughtId(kind: ThoughtKind, value: string) {
  const compact = String(value)
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `brain-${kind}-${compact || "unknown"}`;
}

function addEdge(edges: ThoughtEdge[], from: string, to: string, relation: string) {
  const key = `${from}\u0000${to}\u0000${relation}`;
  if (edges.some((edge) => edge.id === key)) return;
  edges.push({ id: key, from, to, relation });
}

function uniqueNodes(nodes: ThoughtNode[]) {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function normalize(value: string) {
  return String(value || "").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
}

function joinSummary(values: string[]) {
  return values.map((value) => value?.trim()).filter(Boolean).join(" · ") || "구조화된 생각입니다.";
}

function statusLabel(status: ContextAnalysisResult["decisions"][number]["status"]) {
  return { confirmed: "확정", tentative: "검토 중", unclear: "불명확" }[status];
}

function defaultRelation(kind: ThoughtKind) {
  return {
    topic: "중심 주제",
    perspective: "관점 제공",
    decision: "결정으로 구체화",
    question: "확인 필요",
    term: "핵심 개념",
  }[kind];
}
