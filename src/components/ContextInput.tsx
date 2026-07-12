type ContextInputProps = {
  projectTitle: string;
  inputText: string;
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisNotice: string;
  onProjectTitleChange: (value: string) => void;
  onInputTextChange: (value: string) => void;
  onLoadSample: () => void;
  onAnalyze: () => void | Promise<void>;
};

const MIN_PROJECT_TITLE_LENGTH = 2;
const MAX_PROJECT_TITLE_LENGTH = 120;
const MIN_RAW_TEXT_LENGTH = 120;
const MAX_RAW_TEXT_LENGTH = 20_000;

function ContextInput({ projectTitle, inputText, isAnalyzing, analysisError, analysisNotice, onProjectTitleChange, onInputTextChange, onLoadSample, onAnalyze }: ContextInputProps) {
  const titleLength = projectTitle.trim().length;
  const textLength = inputText.trim().length;
  const validTitle = titleLength >= MIN_PROJECT_TITLE_LENGTH && titleLength <= MAX_PROJECT_TITLE_LENGTH;
  const shortText = textLength > 0 && textLength < MIN_RAW_TEXT_LENGTH;
  const longText = textLength > MAX_RAW_TEXT_LENGTH;
  const canAnalyze = validTitle && textLength >= MIN_RAW_TEXT_LENGTH && !longText && !isAnalyzing;

  return (
    <section className="input-panel" aria-labelledby="input-title">
      <div className="panel-heading">
        <p className="section-kicker">Quick paste</p>
        <h2 id="input-title">내용을 바로 붙여넣기</h2>
        <p>파일이 없어도 회의록, 조사 메모, 피드백을 붙여 넣으면 즉시 구조화합니다.</p>
      </div>
      <label className="field">
        <span>회의록 / 메모 / 피드백</span>
        <textarea id="public-context-text" aria-label="회의록 / 메모 / 피드백" value={inputText} onChange={(event) => onInputTextChange(event.target.value)} placeholder="카카오톡, Teams, Notion 등에서 필요한 대화와 회의 내용을 복사해 붙여넣으세요." maxLength={MAX_RAW_TEXT_LENGTH} aria-invalid={shortText || longText} />
        <small className={`counter ${longText ? "error" : ""}`}>{textLength.toLocaleString("ko-KR")} / {MAX_RAW_TEXT_LENGTH.toLocaleString("ko-KR")}자</small>
      </label>
      <label className="field compact-title-field">
        <span>분석 제목 <small>선택</small></span>
        <input aria-label="프로젝트 이름" value={projectTitle} maxLength={MAX_PROJECT_TITLE_LENGTH} onChange={(event) => onProjectTitleChange(event.target.value)} placeholder="예: 캠퍼스 공모전 서비스 기획" aria-invalid={titleLength > 0 && !validTitle} />
        {titleLength > 0 && !validTitle && <small className="field-guide error">분석 제목은 2자 이상 120자 이하로 입력하세요.</small>}
      </label>
      {shortText && <p className="short-guide">분석에 필요한 맥락을 위해 {MIN_RAW_TEXT_LENGTH - textLength}자 더 입력해 주세요.</p>}
      {longText && <p className="short-guide error">입력 기록을 {MAX_RAW_TEXT_LENGTH.toLocaleString("ko-KR")}자 이하로 줄여 주세요.</p>}
      <p className="privacy-note">공개 프로토타입 입력은 저장되지 않습니다. 민감정보, 개인정보, 비밀번호는 입력하지 마세요.</p>
      {analysisError ? <p className="analysis-message error" role="alert">{analysisError}</p> : <p className="analysis-message">{analysisNotice}</p>}
      <div className="action-row">
        <button className="button secondary" type="button" onClick={onLoadSample} disabled={isAnalyzing}>샘플 불러오기</button>
        <button className="button primary" type="button" onClick={onAnalyze} disabled={!canAnalyze}>{isAnalyzing ? "분석 중…" : "맥락 분석하기"}</button>
      </div>
    </section>
  );
}

export default ContextInput;
