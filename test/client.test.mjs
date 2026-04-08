import test from "node:test";
import assert from "node:assert/strict";

import { LogmoleClient } from "../dist/index.js";

function makeJsonResponse(status, jsonValue) {
  return {
    ok: status >= 200 && status <= 299,
    status,
    async json() {
      return jsonValue;
    },
    async text() {
      return JSON.stringify(jsonValue);
    }
  };
}

test("batches logs and posts to /logs", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return makeJsonResponse(200, { accepted: true, jobId: "job_123" });
  };

  try {
    const client = new LogmoleClient({
      baseUrl: "https://ingest.example",
      apiKey: "key",
      flushIntervalMs: 0,
      maxBatchSize: 2
    });

    client.info("a");
    client.info("b");

    await client.flush();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://ingest.example/logs");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.authorization, "Bearer key");

    const payload = JSON.parse(calls[0].init.body);
    assert.equal(payload.logs.length, 2);

    await client.shutdown();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("drops new events when queue is full", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => makeJsonResponse(200, { accepted: true, jobId: "job_123" });

  const dropped = [];

  try {
    const client = new LogmoleClient({
      baseUrl: "https://ingest.example",
      apiKey: "key",
      flushIntervalMs: 0,
      maxQueueSize: 1,
      onDrop: (evt) => dropped.push(evt)
    });

    client.info("first");
    client.info("second");

    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].message, "second");

    await client.shutdown();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails fast on 5xx when maxRetries=0", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => makeJsonResponse(500, { error: "nope" });

  try {
    const client = new LogmoleClient({
      baseUrl: "https://ingest.example",
      apiKey: "key",
      flushIntervalMs: 0,
      maxRetries: 0
    });

    client.error("boom");

    await assert.rejects(() => client.flush());
    await client.shutdown();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

