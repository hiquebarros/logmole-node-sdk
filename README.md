# logmole-node-sdk

Node.js SDK for ingesting logs into Logmole.

## Install

```bash
npm install logmole-node-sdk
```

## Quickstart

```ts
import { LogmoleClient } from "logmole-node-sdk";

const logmole = new LogmoleClient({
  baseUrl: process.env.LOGMOLE_INGEST_URL ?? "https://your-ingest-host",
  apiKey: process.env.LOGMOLE_API_KEY ?? "",
  // Optional (only include if you want to pin it; server will 403 if mismatched)
  applicationId: process.env.LOGMOLE_APPLICATION_ID
});

logmole.info("server started", { env: process.env.NODE_ENV });
logmole.error("something went wrong", { requestId: "abc123" });

// On shutdown:
await logmole.shutdown();
```

## How it works

- Sends `POST /logs`
- Uses `Authorization: Bearer <apiKey>`
- Payload format:

```json
{
  "applicationId": "optional",
  "logs": [
    {
      "timestamp": "2026-03-23T12:00:00.000Z",
      "level": "info",
      "message": "hello",
      "metadata": { "service": "api" }
    }
  ]
}
```

## Options

- `flushIntervalMs` (default `1000`): auto-flush interval
- `maxBatchSize` (default `100`): max logs per request
- `maxQueueSize` (default `10000`): max buffered logs (new logs drop after this)
- `timeoutMs` (default `10000`): request timeout per batch
- `maxRetries` (default `5`): retries for `429` and `5xx`
- `onError(error)`: called when a batch send fails
- `onDrop(event)`: called when a log event is dropped due to a full queue

