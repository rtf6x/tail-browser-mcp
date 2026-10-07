import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MCP_PORT = 28790;
const WS_PORT = 28789;
const url = `http://127.0.0.1:${MCP_PORT}/mcp`;
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
let child;

const rpc = (method, params = {}, id = 1) =>
  fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
const rssMb = () =>
  Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)])) / 1024;

before(async () => {
  child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../dist/http-server.js", import.meta.url))],
    {
      env: {
        ...process.env,
        MCP_HTTP_PORT: String(MCP_PORT),
        EXTENSION_PORT: String(WS_PORT),
      },
      stdio: "ignore",
    }
  );
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${MCP_PORT}/health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
});

after(() => child.kill("SIGTERM"));

test("a request needs no session and none is issued", async () => {
  const res = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("mcp-session-id"), null);
  await res.text();

  const list = await rpc("tools/list", {}, 2);
  assert.equal(list.status, 200);
  assert.match(await list.text(), /list-connected-browsers/);
});

test("GET and DELETE are not allowed", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = await fetch(url, { method, headers });
    assert.equal(res.status, 405, method);
  }
});

test("abandoned clients do not accumulate memory", async () => {
  const init = {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  };
  for (let i = 0; i < 50; i++) await (await rpc("initialize", init)).text();
  const before = rssMb();
  for (let i = 0; i < 500; i++) await (await rpc("initialize", init)).text();
  const growth = rssMb() - before;
  assert.ok(growth < 150, `RSS grew ${growth.toFixed(0)} MB over 500 sessions`);
});
