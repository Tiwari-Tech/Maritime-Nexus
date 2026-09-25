/**
 * Translates backend API error responses (FastAPI / Axios) into safe, user-friendly messages.
 * Prevents exposure of internal stack traces, database credentials, or server secrets.
 */
export function getApiErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred. Please try again."
): string {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const err = error as {
    isAxiosError?: boolean;
    code?: string;
    message?: string;
    response?: {
      status?: number;
      data?: {
        detail?: string | Array<{ msg?: string; loc?: string[] }>;
        message?: string;
      };
    };
  };

  // Network / Connection Error or Timeout
  if (
    err.code === "ERR_NETWORK" ||
    (!err.response && (err.message?.includes("Network Error") || err.code === "ECONNABORTED"))
  ) {
    return "Unable to connect to Maritime Nexus. Please verify your network connection and backend service.";
  }

  const status = err.response?.status;
  const data = err.response?.data;

  // Extract message/detail from FastAPI response
  let detailStr: string | undefined;
  if (typeof data?.detail === "string") {
    detailStr = data.detail;
  } else if (Array.isArray(data?.detail)) {
    // FastAPI 422 validation error list
    detailStr = data.detail
      .map((d) => d.msg || "")
      .filter(Boolean)
      .join("; ");
  } else if (typeof data?.message === "string") {
    detailStr = data.message;
  }

  // Security sanitize: prevent raw tracebacks, DB internals, or credentials from reaching the UI
  if (
    detailStr &&
    (detailStr.includes("Traceback") ||
      detailStr.includes("postgresql://") ||
      detailStr.includes("password") ||
      detailStr.includes("secret") ||
      detailStr.includes("credential"))
  ) {
    detailStr = undefined;
  }

  switch (status) {
    case 401:
      return "Your session has expired or you are not authenticated. Please refresh or sign in again.";
    case 403:
      return detailStr || "You do not have permission to perform this action.";
    case 404:
      return detailStr || "The requested resource could not be found.";
    case 409:
      return detailStr || "A conflict occurred with an existing resource.";
    case 422:
      return (
        detailStr ||
        "The submitted data is invalid. Please check your inputs and try again."
      );
    case 500:
    case 502:
    case 503:
      return (
        detailStr ||
        "The Maritime Nexus service is temporarily unavailable. Please try again shortly."
      );
    case 504:
      return (
        detailStr ||
        "The server request timed out. The operation took too long to complete."
      );
    default:
      return detailStr || fallback;
  }
}
