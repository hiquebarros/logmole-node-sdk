export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

export type LogMetadata = Record<string, unknown>;

export interface LogEvent {
  timestamp: string;
  level: LogLevel | (string & {});
  message: string;
  metadata?: LogMetadata | null;
}

export interface IngestionRequestBody {
  /**
   * Optional: your server validates that if provided it must match the application id
   * that owns the API key (bearer token). If omitted, ingestion uses token scope.
   */
  applicationId?: string;
  logs: LogEvent[];
}

export interface IngestionAcceptedResponse {
  accepted: true;
  jobId: string;
}

export class LogmoleError extends Error {
  override name: string = "LogmoleError";

  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
  }
}

export class LogmoleHttpError extends LogmoleError {
  override name: string = "LogmoleHttpError";

  constructor(
    message: string,
    readonly status: number,
    readonly bodyText?: string
  ) {
    super(message);
  }
}

