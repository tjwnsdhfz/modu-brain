import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import {
  BRAIN_VIEWBOX,
  MAX_THOUGHT_EDGES,
  MAX_THOUGHT_NODES,
  buildThoughtGraph,
  layoutThoughtNodes,
} from "./thoughtGraph";

describe("thoughtGraph", () => {
  it("derives every structured thought without changing the persisted result", () => {
    const graph = buildThoughtGraph(sampleAnalysis);

    expect(graph.nodes.filter((node) => node.kind === "topic")).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.kind === "perspective")).toHaveLength(sampleAnalysis.participants.length);
    expect(graph.nodes.filter((node) => node.kind === "decision")).toHaveLength(sampleAnalysis.decisions.length);
    expect(graph.nodes.filter((node) => node.kind === "question")).toHaveLength(sampleAnalysis.questions.length);
    expect(graph.nodes.filter((node) => node.kind === "term")).toHaveLength(sampleAnalysis.keyTerms.length);
    expect(graph.nodes.find((node) => node.label === "민지")?.evidence).toEqual(sampleAnalysis.participants[0].evidence);
    expect(graph.edges.some((edge) => edge.relation === "시각화 위험 제기")).toBe(true);
  });

  it("ignores orphan links from legacy maps", () => {
    const graph = buildThoughtGraph({
      nodes: [{ id: "topic", label: "주제", type: "topic", summary: "중심" }],
      links: [{ from: "topic", to: "missing", relation: "고아" }],
    });

    expect(graph.edges).toEqual([]);
  });

  it("lays visual nodes inside the stable brain viewbox", () => {
    const graph = buildThoughtGraph(sampleAnalysis);
    const visible = [
      graph.nodes[0],
      ...graph.nodes.filter((node) => node.kind !== "topic").slice(0, 8),
    ];
    const positions = layoutThoughtNodes(visible, false);

    expect(positions.size).toBe(visible.length);
    for (const position of positions.values()) {
      expect(position.x).toBeGreaterThan(0);
      expect(position.x).toBeLessThan(BRAIN_VIEWBOX.width);
      expect(position.y).toBeGreaterThan(0);
      expect(position.y).toBeLessThan(BRAIN_VIEWBOX.height);
    }
  });

  it("keeps large maps inside the public graph node and edge budgets", () => {
    const nodes = [
      ...Array.from({ length: 119 }, (_, index) => ({
        id: `person-${index}`,
        label: `관점 ${index}`,
        type: "person" as const,
        summary: `관점 요약 ${index}`,
      })),
      { id: "topic-last", label: "중심 주제", type: "topic" as const, summary: "중심" },
    ];
    const links = Array.from({ length: 240 }, (_, index) => ({
      from: "topic-last",
      to: `person-${index % 119}`,
      relation: `연결 ${index}`,
    }));

    const graph = buildThoughtGraph({ nodes, links });
    const ids = new Set(graph.nodes.map((node) => node.id));

    expect(graph.nodes).toHaveLength(MAX_THOUGHT_NODES);
    expect(graph.edges).toHaveLength(MAX_THOUGHT_EDGES);
    expect(graph.nodes[0]).toMatchObject({ kind: "topic", label: "중심 주제" });
    expect(graph.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });

  it("lays every capped cluster node at a distinct deterministic position", () => {
    const nodes = Array.from({ length: MAX_THOUGHT_NODES }, (_, index) => ({
      id: `node-${index}`,
      kind: index === 0 ? "topic" as const : "perspective" as const,
      label: `생각 ${index}`,
      summary: "요약",
      evidence: [],
    }));

    const first = layoutThoughtNodes(nodes);
    const second = layoutThoughtNodes(nodes);
    const coordinates = [...first.values()].map(({ x, y }) => `${x}:${y}`);

    expect(first.size).toBe(MAX_THOUGHT_NODES);
    expect(new Set(coordinates).size).toBe(MAX_THOUGHT_NODES);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });
});
