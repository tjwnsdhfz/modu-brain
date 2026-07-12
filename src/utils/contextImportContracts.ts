export type ContextImportProvider = "kakaotalk" | "teams" | "notion" | "paste";

export const CONTEXT_IMPORT_PARSER_VERSIONS: Record<ContextImportProvider, string> = {
  paste: "paste@1",
  kakaotalk: "kakaotalk@1",
  teams: "teams@1",
  notion: "notion@1",
};
