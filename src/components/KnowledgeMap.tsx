import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ContextAnalysisResult, EvidenceRef } from "../types/context";
import {
  BRAIN_VIEWBOX,
  MAX_THOUGHT_EDGES,
  MAX_THOUGHT_NODES,
  MOBILE_THOUGHT_SUMMARY_LIMIT,
  buildThoughtGraph,
  layoutThoughtNodes,
  type ThoughtEdge,
  type ThoughtGraphResult,
  type ThoughtKind,
  type ThoughtNode,
  type ThoughtPosition,
} from "../utils/thoughtGraph";

type KnowledgeMapProps = {
  map?: ContextAnalysisResult["knowledgeMap"];
  result?: ThoughtGraphResult;
  onOpenEvidence?: (evidence: EvidenceRef[]) => void;
};

type ThoughtFilter = "all" | Exclude<ThoughtKind, "topic">;
type BrainViewMode = "graph" | "list";
type DirectionKey = "ArrowRight" | "ArrowDown" | "ArrowLeft" | "ArrowUp";

const COMPACT_BRAIN_QUERY = "(max-width: 640px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MIN_ZOOM = 75;
const MAX_ZOOM = 175;
const ZOOM_STEP = 25;

const filters: { id: ThoughtFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "perspective", label: "관점" },
  { id: "decision", label: "결정" },
  { id: "question", label: "질문" },
  { id: "term", label: "핵심어" },
];

const kindLabels: Record<ThoughtKind, string> = {
  topic: "중심 주제",
  perspective: "관점",
  decision: "결정",
  question: "질문",
  term: "핵심어",
};

function KnowledgeMap({ map, result, onOpenEvidence }: KnowledgeMapProps) {
  const headingId = useId();
  const graphTitleId = useId();
  const graphDescriptionId = useId();
  const graphHelpId = useId();
  const inspectorId = useId();
  const outlineId = useId();
  const compactView = useMediaQuery(COMPACT_BRAIN_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const graph = useMemo(
    () => buildThoughtGraph(result ?? map ?? { nodes: [], links: [] }),
    [map, result],
  );
  const [activeFilter, setActiveFilter] = useState<ThoughtFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(graph.nodes[0]?.id ?? "");
  const [focusId, setFocusId] = useState(graph.nodes[0]?.id ?? "");
  const [preferredView, setPreferredView] = useState<BrainViewMode | null>(null);
  const [zoom, setZoom] = useState(100);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const stageRef = useRef<HTMLDivElement>(null);
  const viewMode = preferredView ?? (compactView ? "list" : "graph");

  const matchingNodes = useMemo(
    () => filterThoughts(graph.nodes, activeFilter, query),
    [activeFilter, graph.nodes, query],
  );
  const visualNodes = useMemo(
    () => chooseVisualNodes(
      matchingNodes,
      compactView ? MOBILE_THOUGHT_SUMMARY_LIMIT : MAX_THOUGHT_NODES,
    ),
    [compactView, matchingNodes],
  );
  const outlineNodes = compactView
    ? matchingNodes.slice(0, MOBILE_THOUGHT_SUMMARY_LIMIT)
    : matchingNodes;
  const visualIds = new Set(visualNodes.map((node) => node.id));
  const visualEdges = graph.edges
    .filter((edge) => visualIds.has(edge.from) && visualIds.has(edge.to))
    .slice(0, MAX_THOUGHT_EDGES);
  const selectedNode = selectedId
    ? matchingNodes.find((node) => node.id === selectedId)
      ?? matchingNodes.find((node) => node.kind === "topic")
      ?? matchingNodes[0]
    : undefined;
  const effectiveSelectedId = selectedNode?.id ?? "";
  const selectedEdges = selectedNode
    ? graph.edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
    : [];
  const connectedIds = selectedNode
    ? new Set([
      selectedNode.id,
      ...selectedEdges.flatMap((edge) => [edge.from, edge.to]),
    ])
    : new Set<string>();
  const clustered = activeFilter === "all" && !query.trim();
  const positions = useMemo(
    () => layoutThoughtNodes(visualNodes, clustered),
    [clustered, visualNodes],
  );
  const rovingId = visualNodes.some((node) => node.id === focusId)
    ? focusId
    : visualNodes.some((node) => node.id === effectiveSelectedId)
      ? effectiveSelectedId
      : visualNodes[0]?.id ?? "";
  const thoughtCount = graph.nodes.length;
  const hiddenVisualCount = Math.max(0, matchingNodes.length - visualNodes.length);
  const hiddenOutlineCount = Math.max(0, matchingNodes.length - outlineNodes.length);
  const worldSize = brainWorldSize(visualNodes, zoom);

  useEffect(() => {
    if (reducedMotion || viewMode !== "graph" || !effectiveSelectedId) return;
    const stage = stageRef.current;
    const node = nodeRefs.current.get(effectiveSelectedId);
    if (!stage || !node || typeof stage.scrollTo !== "function") return;

    const timer = window.setTimeout(() => {
      const stageBounds = stage.getBoundingClientRect();
      const nodeBounds = node.getBoundingClientRect();
      const comfortablyVisible = nodeBounds.left >= stageBounds.left + 24
        && nodeBounds.right <= stageBounds.right - 24
        && nodeBounds.top >= stageBounds.top + 24
        && nodeBounds.bottom <= stageBounds.bottom - 24;
      if (comfortablyVisible) return;

      stage.scrollTo({
        left: Math.max(0, stage.scrollLeft + nodeBounds.left - stageBounds.left - (stageBounds.width - nodeBounds.width) / 2),
        top: Math.max(0, stage.scrollTop + nodeBounds.top - stageBounds.top - (stageBounds.height - nodeBounds.height) / 2),
        behavior: "smooth",
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [effectiveSelectedId, reducedMotion, viewMode, worldSize.height, worldSize.width]);

  const selectNode = (id: string) => {
    setSelectedId(id);
    setFocusId(id);
  };

  const changeZoom = (next: number | ((current: number) => number)) => {
    setZoom((current) => {
      const requested = typeof next === "function" ? next(current) : next;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requested));
    });
  };

  const handleGraphShortcut = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedId("");
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom((current) => current + ZOOM_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom((current) => current - ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      changeZoom(100);
    } else return false;
    return true;
  };

  const handleNodeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (handleGraphShortcut(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      selectNode(id);
      return;
    }

    let nextId: string | undefined;
    if (isDirectionKey(event.key)) nextId = findDirectionalNode(id, event.key, visualNodes, positions);
    else if (event.key === "Home") nextId = visualNodes[0]?.id;
    else if (event.key === "End") nextId = visualNodes.at(-1)?.id;
    else return;

    if (!nextId) return;
    event.preventDefault();
    setFocusId(nextId);
    nodeRefs.current.get(nextId)?.focus();
  };

  return (
    <section className="result-panel map-panel brain-panel" aria-labelledby={headingId}>
      <div className="panel-heading brain-heading">
        <div>
          <p className="section-kicker">Brain canvas</p>
          <h2 id={headingId}>공유 지식맵</h2>
          <p className="brain-heading-copy">
            흩어진 기록을 생각 단위로 나누고, 선택한 생각과 바로 이어진 맥락을 따라가 보세요.
          </p>
        </div>
        <div className="brain-stat" aria-label={`${thoughtCount}개 생각, ${graph.edges.length}개 연결`}>
          <strong>{thoughtCount}</strong>
          <span>개의 생각</span>
          <i aria-hidden="true" />
          <strong>{graph.edges.length}</strong>
          <span>개의 연결</span>
        </div>
      </div>

      {graph.nodes.length === 0 ? (
        <p className="knowledge-empty">분석 결과에서 표시할 생각을 찾지 못했습니다.</p>
      ) : (
        <div className="brain-shell" data-testid="brain-canvas">
          <div className="brain-toolbar" aria-label="브레인 캔버스 탐색 도구">
            <label className="brain-search">
              <span>생각 검색</span>
              <input
                type="search"
                value={query}
                placeholder="이름이나 내용으로 찾기"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="brain-toolbar-groups">
              <div className="brain-view-switch" role="group" aria-label="지식맵 보기 방식">
                <button
                  type="button"
                  aria-pressed={viewMode === "graph"}
                  onClick={() => setPreferredView("graph")}
                >
                  그래프 보기
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setPreferredView("list")}
                >
                  의미 목록
                </button>
              </div>
              <div className="brain-filters" role="group" aria-label="생각 유형 필터">
                {filters.map((filter) => {
                  const count = filter.id === "all"
                    ? graph.nodes.length
                    : graph.nodes.filter((node) => node.kind === filter.id).length;
                  return (
                    <button
                      key={filter.id}
                      className={activeFilter === filter.id ? "active" : ""}
                      type="button"
                      aria-pressed={activeFilter === filter.id}
                      onClick={() => setActiveFilter(filter.id)}
                    >
                      {filter.label} <span>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="brain-result-status" role="status" aria-live="polite" aria-atomic="true">
            {matchingNodes.length === 0
              ? "검색 조건과 일치하는 생각이 없습니다."
              : viewMode === "list" && hiddenOutlineCount > 0
                ? `${matchingNodes.length}개 중 ${outlineNodes.length}개를 모바일 의미 목록에 표시합니다.`
                : viewMode === "graph" && hiddenVisualCount > 0
                  ? `${matchingNodes.length}개 중 ${visualNodes.length}개를 그래프에 표시합니다.`
                  : `${matchingNodes.length}개 생각을 표시합니다.`}
          </p>
          <p className="brain-live" aria-live="polite" aria-atomic="true">
            {selectedNode ? `${kindLabels[selectedNode.kind]} ${selectedNode.label} 선택됨` : "선택 해제됨"}
          </p>

          <div className="brain-content" data-view={viewMode}>
            <section className="brain-outline" aria-labelledby={outlineId} hidden={viewMode !== "list"}>
              <div className="brain-outline-heading">
                <div>
                  <p>Accessible thought outline</p>
                  <h3 id={outlineId}>생각과 연결 의미 목록</h3>
                </div>
                <span>
                  {hiddenOutlineCount > 0
                    ? `${outlineNodes.length}/${matchingNodes.length}개`
                    : `${outlineNodes.length}개`}
                </span>
              </div>
              {outlineNodes.length === 0 ? (
                <p className="brain-outline-empty">일치하는 생각이 없습니다.</p>
              ) : (
                <ul aria-label="생각과 연결 관계 목록">
                  {outlineNodes.map((node) => {
                    const relationships = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
                    return (
                      <li key={`outline-${node.id}`} className={`brain-kind-${node.kind}`}>
                        <button
                          type="button"
                          aria-pressed={node.id === effectiveSelectedId}
                          aria-controls={inspectorId}
                          onClick={() => selectNode(node.id)}
                        >
                          <span>{kindLabels[node.kind]}</span>
                          <strong>{node.label}</strong>
                        </button>
                        <p>{node.summary}</p>
                        <small>{relationshipSummary(node, relationships, graph.nodes)}</small>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div
              className="brain-stage-wrap"
              hidden={viewMode !== "graph"}
            >
              <div className="brain-graph-controls">
                <p id={graphHelpId}>방향키로 생각을 이동하고 Enter로 선택합니다. Esc는 선택 해제, +/−/0은 배율 조절입니다.</p>
                <div className="brain-zoom" role="group" aria-label="그래프 배율 조절">
                  <button
                    type="button"
                    aria-label="그래프 축소"
                    disabled={zoom === MIN_ZOOM}
                    onClick={() => changeZoom((current) => current - ZOOM_STEP)}
                    onKeyDown={handleGraphShortcut}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label="그래프 배율 초기화"
                    onClick={() => changeZoom(100)}
                    onKeyDown={handleGraphShortcut}
                  >
                    0
                  </button>
                  <button
                    type="button"
                    aria-label="그래프 확대"
                    disabled={zoom === MAX_ZOOM}
                    onClick={() => changeZoom((current) => current + ZOOM_STEP)}
                    onKeyDown={handleGraphShortcut}
                  >
                    +
                  </button>
                  <span className="brain-zoom-value" aria-live="polite" aria-atomic="true">{zoom}%</span>
                </div>
              </div>

              {visualNodes.length > 0 ? (
                <div
                  ref={stageRef}
                  className="brain-stage"
                  data-testid="brain-stage"
                  role="group"
                  aria-label="생각 그래프"
                  aria-describedby={graphHelpId}
                >
                  <div
                    className={`brain-world${visualNodes.length > 24 ? " is-dense" : ""}`}
                    style={{ width: worldSize.width, height: worldSize.height }}
                  >
                    <svg
                      className="brain-connections"
                      viewBox={`0 0 ${BRAIN_VIEWBOX.width} ${BRAIN_VIEWBOX.height}`}
                      role="img"
                      aria-labelledby={`${graphTitleId} ${graphDescriptionId}`}
                    >
                      <title id={graphTitleId}>프로젝트 맥락 지도</title>
                      <desc id={graphDescriptionId}>
                        {`${visualNodes.length}개 노드와 ${visualEdges.length}개 연결로 구성된 프로젝트 맥락 지도입니다. 의미 목록 보기에서도 관계를 확인할 수 있습니다.`}
                      </desc>
                      {visualEdges.map((edge) => {
                        const from = positions.get(edge.from);
                        const to = positions.get(edge.to);
                        if (!from || !to) return null;
                        const active = edge.from === effectiveSelectedId || edge.to === effectiveSelectedId;
                        return (
                          <g key={edge.id} className={active ? "is-active" : connectedIds.size > 1 ? "is-muted" : ""}>
                            <path d={connectionPath(from, to)} />
                            {active && visualEdges.length <= 24 && (
                              <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 8} textAnchor="middle">
                                {edge.relation}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                    <div className="brain-hemisphere left" aria-hidden="true" />
                    <div className="brain-hemisphere right" aria-hidden="true" />
                    <div className="brain-node-layer">
                      {visualNodes.map((node) => {
                        const position = positions.get(node.id);
                        if (!position) return null;
                        const selected = node.id === effectiveSelectedId;
                        const muted = !selected && connectedIds.size > 1 && !connectedIds.has(node.id);
                        return (
                          <button
                            key={node.id}
                            ref={(element) => {
                              if (element) nodeRefs.current.set(node.id, element);
                              else nodeRefs.current.delete(node.id);
                            }}
                            className={`brain-node brain-kind-${node.kind}${selected ? " is-selected" : ""}${muted ? " is-muted" : ""}`}
                            style={{
                              left: `${(position.x / BRAIN_VIEWBOX.width) * 100}%`,
                              top: `${(position.y / BRAIN_VIEWBOX.height) * 100}%`,
                            }}
                            type="button"
                            tabIndex={node.id === rovingId ? 0 : -1}
                            aria-label={`${kindLabels[node.kind]} 생각: ${node.label}`}
                            aria-pressed={selected}
                            aria-controls={inspectorId}
                            aria-describedby={graphHelpId}
                            data-testid={`brain-node-${node.id}`}
                            onClick={() => selectNode(node.id)}
                            onFocus={() => setFocusId(node.id)}
                            onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
                          >
                            <span>{kindLabels[node.kind]}</span>
                            <strong>{clipLabel(node.label)}</strong>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="brain-no-results">필터나 검색어를 바꿔 다른 생각을 찾아보세요.</div>
              )}
            </div>

            <BrainInspector
              id={inspectorId}
              node={selectedNode}
              edges={selectedEdges}
              nodes={graph.nodes}
              onSelect={selectNode}
              onOpenEvidence={onOpenEvidence}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function BrainInspector({
  id,
  node,
  edges,
  nodes,
  onSelect,
  onOpenEvidence,
}: {
  id: string;
  node?: ThoughtNode;
  edges: ThoughtEdge[];
  nodes: ThoughtNode[];
  onSelect: (id: string) => void;
  onOpenEvidence?: (evidence: EvidenceRef[]) => void;
}) {
  return (
    <aside className="brain-inspector" id={id} aria-live="polite" aria-label="선택한 생각 상세">
      {node ? (
        <>
          <div className={`brain-inspector-type brain-kind-${node.kind}`}>{kindLabels[node.kind]}</div>
          <h3>{node.label}</h3>
          <p>{node.summary}</p>
          <div className="brain-related">
            <strong>직접 연결된 생각 {edges.length}개</strong>
            {edges.length > 0 ? (
              <ul>
                {edges.slice(0, 8).map((edge) => {
                  const relatedId = edge.from === node.id ? edge.to : edge.from;
                  const related = nodes.find((item) => item.id === relatedId);
                  if (!related) return null;
                  return (
                    <li key={`${node.id}-${edge.id}`}>
                      <button
                        type="button"
                        aria-label={`${edge.relation}: ${kindLabels[related.kind]} ${related.label}`}
                        onClick={() => onSelect(related.id)}
                      >
                        <span>{edge.relation} · {kindLabels[related.kind]}</span>
                        <strong>{related.label}</strong>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p>아직 직접 연결된 생각이 없습니다.</p>}
          </div>
          {onOpenEvidence && node.evidence.length > 0 && (
            <button className="brain-evidence-button" type="button" onClick={() => onOpenEvidence(node.evidence)}>
              근거 {node.evidence.length}개 열기
            </button>
          )}
        </>
      ) : <p>생각을 선택하면 내용과 연결 관계가 여기에 표시됩니다.</p>}
    </aside>
  );
}

function filterThoughts(nodes: ThoughtNode[], filter: ThoughtFilter, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const allowed = nodes.filter((node) => filter === "all" || node.kind === filter || node.kind === "topic");
  if (!normalizedQuery) return allowed;

  const matches = allowed.filter((node) => (
    `${node.label} ${node.summary}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery)
  ));
  const topic = allowed.find((node) => node.kind === "topic");
  if (!topic || matches.some((node) => node.id === topic.id) || matches.length === 0) return matches;
  return [topic, ...matches];
}

function chooseVisualNodes(nodes: ThoughtNode[], limit: number) {
  if (nodes.length <= limit) return nodes;
  const topic = nodes.find((node) => node.kind === "topic");
  const remaining = nodes.filter((node) => node.id !== topic?.id);
  return [...(topic ? [topic] : []), ...remaining.slice(0, Math.max(0, limit - (topic ? 1 : 0)))];
}

function brainWorldSize(nodes: ThoughtNode[], zoom: number) {
  const largestCluster = Math.max(
    1,
    ...(["perspective", "term", "decision", "question"] as const)
      .map((kind) => nodes.filter((node) => node.kind === kind).length),
  );
  const densityScale = Math.min(5, Math.max(1, Math.sqrt(largestCluster / 4)));
  const zoomScale = zoom / 100;
  return {
    width: Math.round(BRAIN_VIEWBOX.width * densityScale * zoomScale),
    height: Math.round(BRAIN_VIEWBOX.height * densityScale * zoomScale),
  };
}

function findDirectionalNode(
  currentId: string,
  direction: DirectionKey,
  nodes: ThoughtNode[],
  positions: Map<string, ThoughtPosition>,
) {
  const current = positions.get(currentId);
  if (!current) return undefined;

  const candidates = nodes.flatMap((node) => {
    if (node.id === currentId) return [];
    const position = positions.get(node.id);
    if (!position) return [];
    const dx = position.x - current.x;
    const dy = position.y - current.y;
    const inDirection = direction === "ArrowRight"
      ? dx > 0
      : direction === "ArrowLeft"
        ? dx < 0
        : direction === "ArrowDown"
          ? dy > 0
          : dy < 0;
    if (!inDirection) return [];
    const primaryDistance = direction === "ArrowRight" || direction === "ArrowLeft" ? Math.abs(dx) : Math.abs(dy);
    const crossDistance = direction === "ArrowRight" || direction === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
    return [{ id: node.id, score: primaryDistance + crossDistance * 0.42 }];
  }).sort((left, right) => left.score - right.score);
  if (candidates[0]) return candidates[0].id;

  const index = nodes.findIndex((node) => node.id === currentId);
  const offset = direction === "ArrowRight" || direction === "ArrowDown" ? 1 : -1;
  return nodes[(index + offset + nodes.length) % nodes.length]?.id;
}

function isDirectionKey(value: string): value is DirectionKey {
  return value === "ArrowRight" || value === "ArrowDown" || value === "ArrowLeft" || value === "ArrowUp";
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false
  ));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function connectionPath(from: ThoughtPosition, to: ThoughtPosition) {
  const midpoint = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} C ${midpoint} ${from.y}, ${midpoint} ${to.y}, ${to.x} ${to.y}`;
}

function clipLabel(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 18 ? `${compact.slice(0, 17)}…` : compact;
}

function relationshipSummary(node: ThoughtNode, edges: ThoughtEdge[], nodes: ThoughtNode[]) {
  if (edges.length === 0) return "직접 연결 없음";
  return edges.slice(0, 3).map((edge) => {
    const relatedId = edge.from === node.id ? edge.to : edge.from;
    const related = nodes.find((item) => item.id === relatedId);
    return `${edge.relation} · ${related?.label ?? "연결된 생각"}`;
  }).join(" / ");
}

export default KnowledgeMap;
