export const BRIDGE_ERROR_CODES = [
  "INVALID_INPUT",
  "CODEX_NOT_FOUND",
  "CODEX_AUTH_REQUIRED",
  "WEB_SEARCH_UNAVAILABLE",
  "WORKER_TIMEOUT",
  "WORKER_CANCELLED",
  "WORKER_FAILED",
  "OUTPUT_LIMIT_EXCEEDED",
  "INVALID_STRUCTURED_OUTPUT",
  "EVIDENCE_VERIFICATION_FAILED",
  "QUEUE_FULL",
] as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

export type BridgeErrorOptions = {
  cause?: unknown;
  remediation?: string;
};

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly remediation: string | undefined;

  constructor(
    code: BridgeErrorCode,
    message: string,
    options: BridgeErrorOptions = {},
  ) {
    super(`[${code}] ${message}`, { cause: options.cause });
    this.name = "BridgeError";
    this.code = code;
    this.remediation = options.remediation;
  }
}

export type PublicBridgeError = {
  code: BridgeErrorCode;
  message: string;
  remediation?: string;
};

export function toPublicBridgeError(error: unknown): PublicBridgeError {
  if (error instanceof BridgeError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.remediation === undefined
        ? {}
        : { remediation: error.remediation }),
    };
  }

  return {
    code: "WORKER_FAILED",
    message: "[WORKER_FAILED] The research worker failed unexpectedly.",
  };
}
