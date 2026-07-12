export class ApiError extends Error {
  constructor(status, code, message, details = undefined, headers = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export function toApiError(error) {
  if (error instanceof ApiError) return error;

  const status = Number(error?.status);
  const code = String(error?.code || "");
  if (Number.isInteger(status) && status >= 400 && status <= 599 && /^[A-Z0-9_]{3,80}$/.test(code)) {
    return new ApiError(
      status,
      code,
      status >= 500 ? "외부 분석 서비스를 완료하지 못했습니다." : "요청을 처리할 수 없습니다.",
    );
  }

  if (error?.name === "AbortError") {
    return new ApiError(499, "REQUEST_CANCELLED", "요청이 취소되었습니다.");
  }

  return new ApiError(500, "INTERNAL_SERVER_ERROR", "요청을 처리하지 못했습니다.");
}
