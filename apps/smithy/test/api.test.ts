import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiClient } from "../src/api.js";

test("API client adds the JSON content type only for requests with a body", async () => {
  const token = randomUUID();
  const cases: Array<{ init: RequestInit; contentType: string | null }> = [
    { init: {}, contentType: null },
    { init: { method: "POST" }, contentType: null },
    { init: { method: "POST", body: null }, contentType: null },
    { init: { method: "DELETE" }, contentType: null },
    { init: { method: "POST", body: "{}" }, contentType: "application/json" },
    { init: { method: "PATCH", body: JSON.stringify({ status: "IN_PROGRESS" }) }, contentType: "application/json" },
    { init: { method: "POST", body: "text", headers: { "Content-Type": "text/plain" } }, contentType: "text/plain" },
  ];
  for (const { init, contentType } of cases) {
    const client = new ApiClient("http://taskforge.test", token, async (_url, request) => {
      const headers = new Headers(request?.headers);
      assert.equal(headers.get("content-type"), contentType);
      assert.ok(headers.get("authorization") === `Bearer ${token}`);
      assert.equal(request?.body, init.body);
      assert.equal(request?.method, init.method);
      return new Response("{}");
    });
    await client.request("/api/example", init);
  }
});
