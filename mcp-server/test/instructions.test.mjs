// The server tells a client how to use it: the instructions reach the client in the initialize result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBrowserControlServer, INSTRUCTIONS } from "../dist/mcp-tools.js";

test("the instructions are sent in the initialize result, short, and name only tools that exist", async () => {
  const server = createBrowserControlServer({ listConnectedBrowsers: () => [] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const text = client.getInstructions();
  assert.equal(text, INSTRUCTIONS);
  assert.ok(text.split("\n").length <= 12, "a host keeps this in every session: it stays short");
  const tools = new Set((await client.listTools()).tools.map((t) => t.name));
  for (const name of text.match(/\b[a-z]+(?:-[a-z]+)+\b/g) ?? []) {
    if (/^(?:list-connected-browsers|open-browser-tab|get-list-of-open-tabs)$/.test(name)) assert.ok(tools.has(name), `${name} is named by the instructions and must exist`);
  }
  await client.close();
});
