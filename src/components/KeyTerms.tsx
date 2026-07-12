import type { ContextAnalysisResult } from "../types/context";

function KeyTerms({ terms }: { terms: ContextAnalysisResult["keyTerms"] }) {
  return <section className="result-panel" aria-labelledby="terms-title"><div className="panel-heading compact"><p className="section-kicker">Key terms</p><h2 id="terms-title">핵심 용어</h2></div>{terms.length > 0 ? <div className="term-grid">{terms.map((item) => <article key={item.id ?? item.term}><strong>{item.term}</strong><p>{item.meaning}</p></article>)}</div> : <p className="result-empty-state">입력 기록에서 별도로 정의할 핵심 용어가 없습니다.</p>}</section>;
}

export default KeyTerms;
