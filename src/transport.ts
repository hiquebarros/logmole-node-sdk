import { computeBackoffMs, sleep } from "./backoff";
import { IngestionAcceptedResponse, IngestionRequestBody, LogmoleHttpError } from "./types";

export interface TransportOptions {
  baseUrl: string;
  apiKey: string;
  /**
   * Optional: if set, sent in request body; server will 403 if it mismatches the token scope.
   */
  applicationId?: string;
  userAgent?: string;
  /**
   * Abort signal used for in-flight requests during shutdown.
   */
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("baseUrl is required");
  }
  return trimmed;
}

export async function postLogs(
  body: IngestionRequestBody,
  options: TransportOptions
): Promise<IngestionAcceptedResponse> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const url = `${baseUrl}/logs`;
  const maxRetries = options.maxRetries ?? 5;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const payload: IngestionRequestBody = options.applicationId
    ? { ...body, applicationId: options.applicationId }
    : body;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const abortListener = () => controller.abort();
      options.signal?.addEventListener("abort", abortListener, { once: true });

      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
            "user-agent": options.userAgent ?? "logmole-node-sdk"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (res.ok) {
          return (await res.json()) as IngestionAcceptedResponse;
        }

        const text = await res.text().catch(() => undefined);

        // Retry on 429 / 5xx only
        if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
          if (attempt < maxRetries) {
            await sleep(computeBackoffMs(attempt), options.signal);
            continue;
          }
        }

        throw new LogmoleHttpError(
          `Logmole ingestion failed (${res.status})`,
          res.status,
          text
        );
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortListener);
      }
    } catch (err) {
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";

      if (isAbort) {
        throw err;
      }

      if (attempt < maxRetries) {
        await sleep(computeBackoffMs(attempt), options.signal);
        continue;
      }
      throw err;
    }
  }

  // Unreachable, but keeps TS happy
  throw new Error("Failed to post logs");
}

