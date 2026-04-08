import { postLogs } from "./transport";
import { IngestionAcceptedResponse, LogEvent, LogLevel, LogMetadata, LogmoleError } from "./types";

export interface LogmoleClientOptions {
  baseUrl: string;
  apiKey: string;
  /**
   * Optional: if set, sent in request body; server will 403 if mismatched.
   */
  applicationId?: string;
  /**
   * Flush interval for auto-batching.
   */
  flushIntervalMs?: number;
  /**
   * Max events per request.
   */
  maxBatchSize?: number;
  /**
   * Max buffered events before dropping new ones.
   */
  maxQueueSize?: number;
  /**
   * Request timeout per batch.
   */
  timeoutMs?: number;
  /**
   * Retries for 429/5xx.
   */
  maxRetries?: number;
  /**
   * Called when a batch fails permanently (after retries) or encounters a non-retryable error.
   */
  onError?: (error: unknown) => void;
  /**
   * Called when an event is dropped due to backpressure.
   */
  onDrop?: (dropped: LogEvent) => void;
}

export class LogmoleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly applicationId?: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxQueueSize: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onError?: (error: unknown) => void;
  private readonly onDrop?: (dropped: LogEvent) => void;

  private queue: LogEvent[] = [];
  private flushTimer?: NodeJS.Timeout;
  private flushing: Promise<IngestionAcceptedResponse | void> | null = null;
  private closed = false;
  private readonly shutdownController = new AbortController();

  constructor(options: LogmoleClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.applicationId = options.applicationId;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.maxQueueSize = options.maxQueueSize ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 5;
    this.onError = options.onError;
    this.onDrop = options.onDrop;

    if (!this.baseUrl?.trim()) throw new LogmoleError("baseUrl is required");
    if (!this.apiKey?.trim()) throw new LogmoleError("apiKey is required");

    if (this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flush().catch((err) => this.onError?.(err));
      }, this.flushIntervalMs);
      // Don't keep the process alive just for the timer.
      this.flushTimer.unref?.();
    }
  }

  log(level: LogLevel | (string & {}), message: string, metadata?: LogMetadata): void {
    if (this.closed) return;
    if (!message || message.trim().length === 0) return;

    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata: metadata ?? null
    };

    if (this.queue.length >= this.maxQueueSize) {
      this.onDrop?.(event);
      return;
    }

    this.queue.push(event);

    if (this.queue.length >= this.maxBatchSize) {
      void this.flush().catch((err) => this.onError?.(err));
    }
  }

  trace(message: string, metadata?: LogMetadata): void {
    this.log("trace", message, metadata);
  }
  debug(message: string, metadata?: LogMetadata): void {
    this.log("debug", message, metadata);
  }
  info(message: string, metadata?: LogMetadata): void {
    this.log("info", message, metadata);
  }
  warn(message: string, metadata?: LogMetadata): void {
    this.log("warn", message, metadata);
  }
  error(message: string, metadata?: LogMetadata): void {
    this.log("error", message, metadata);
  }
  fatal(message: string, metadata?: LogMetadata): void {
    this.log("fatal", message, metadata);
  }

  /**
   * Flush buffered logs. Safe to call concurrently.
   */
  async flush(): Promise<IngestionAcceptedResponse | void> {
    if (this.closed) return;
    if (this.queue.length === 0) return;

    if (this.flushing) {
      return this.flushing;
    }

    const batch = this.queue.splice(0, this.maxBatchSize);
    if (batch.length === 0) return;

    this.flushing = (async () => {
      try {
        return await postLogs(
          { logs: batch },
          {
            baseUrl: this.baseUrl,
            apiKey: this.apiKey,
            applicationId: this.applicationId,
            timeoutMs: this.timeoutMs,
            maxRetries: this.maxRetries,
            signal: this.shutdownController.signal,
            userAgent: "logmole-node-sdk"
          }
        );
      } catch (err) {
        // Put the batch back at the front if we're still open (best-effort).
        if (!this.closed) {
          this.queue = batch.concat(this.queue);
        }
        this.onError?.(err);
        throw err;
      } finally {
        this.flushing = null;
      }
    })();

    return this.flushing;
  }

  /**
   * Stop background flushing and attempt a final flush.
   */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    try {
      while (this.queue.length > 0) {
        await this.flush();
      }
    } finally {
      this.shutdownController.abort();
    }
  }
}

