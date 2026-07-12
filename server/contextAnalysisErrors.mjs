export class ContextAnalysisApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "ContextAnalysisApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toContextAnalysisApiError(error) {
  if (error instanceof ContextAnalysisApiError) {
    return error;
  }

  const status = Number(error?.status);

  if (status === 401 || status === 403) {
    return new ContextAnalysisApiError(
      503,
      "EXTERNAL_PROVIDER_AUTH_ERROR",
      "외부 분석 provider 인증에 실패했습니다. 서버의 API 키와 프로젝트 권한을 확인하세요.",
    );
  }

  if (status === 429) {
    return new ContextAnalysisApiError(
      503,
      "EXTERNAL_PROVIDER_RATE_LIMITED",
      "외부 분석 provider의 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.",
    );
  }

  if (
    error?.name === "AbortError" ||
    /timeout/i.test(String(error?.name || "")) ||
    error?.code === "ETIMEDOUT"
  ) {
    return new ContextAnalysisApiError(
      504,
      "EXTERNAL_PROVIDER_TIMEOUT",
      "외부 분석 provider의 응답 시간이 초과되었습니다.",
    );
  }

  return new ContextAnalysisApiError(
    502,
    "EXTERNAL_PROVIDER_ERROR",
    "외부 분석 provider 호출에 실패했습니다.",
  );
}
