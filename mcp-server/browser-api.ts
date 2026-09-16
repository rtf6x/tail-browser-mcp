import WebSocket, { WebSocketServer } from "ws";
import type {
  ExtensionMessage,
  BrowserTab,
  BrowserHistoryItem,
  ServerMessage,
  TabContentExtensionMessage,
  ServerMessageRequest,
  ExtensionError,
} from "@tail-browser-mcp/common";
import {
  BROWSER_ID_PATTERN,
  isRegisterMessage,
  type ExtensionRegisterMessage,
} from "@tail-browser-mcp/common/handshake-messages";
import {
  hasPayloadEnvelope,
  packEnvelope,
} from "@tail-browser-mcp/common/wire-envelope";
import { isPortInUse } from "./util";
import * as crypto from "crypto";

import { DEFAULT_WS_PORT } from "@tail-browser-mcp/common/ports";
const EXTENSION_RESPONSE_TIMEOUT_MS = 15_000;
const SCRIPT_RESPONSE_TIMEOUT_MS = 15_000;

export interface ConnectedBrowserInfo {
  browserId: string;
  label?: string;
  browserType?: string;
  connected: boolean;
  connectedAt: number;
}

interface BrowserConnection {
  browserId: string;
  label?: string;
  browserType?: string;
  ws: WebSocket;
  connectedAt: number;
}

interface ExtensionRequestResolver<T extends ExtensionMessage["resource"]> {
  resource: T;
  browserId: string;
  resolve: (value: Extract<ExtensionMessage, { resource: T }>) => void;
  reject: (reason?: string) => void;
}

interface WireEnvelope {
  payload: unknown;
  signature?: string;
}

export class BrowserAPI {
  private browsers = new Map<string, BrowserConnection>();
  private wsToBrowserId = new Map<WebSocket, string>();
  private wsServer: WebSocketServer | null = null;
  private sharedSecret: string | null = null;
  private initError: string | null = null;
  private browserQueues = new Map<string, Promise<unknown>>();

  private extensionRequestMap = new Map<
    string,
    ExtensionRequestResolver<ExtensionMessage["resource"]>
  >();

  async init() {
    const { secret, port } = readConfig();
    this.sharedSecret = secret ?? null;

    if (await isPortInUse(port)) {
      this.initError = `Port ${port} is already in use (another browser-control MCP server may be running). Kill it with: lsof -i :${port}`;
      throw new Error(this.initError);
    }

    const host = process.env.CONTAINERIZED ? "0.0.0.0" : "localhost";

    this.wsServer = new WebSocketServer({ host, port });

    console.error(`Starting WebSocket server on ${host}:${port}`);
    if (!this.sharedSecret) {
      console.error(
        "WebSocket auth disabled (localhost trust mode). Set EXTENSION_SECRET to require HMAC signatures."
      );
    }
    this.wsServer.on("connection", (connection) => {
      console.error("WebSocket connection pending registration on port", port);

      connection.on("message", (message) => {
        try {
          const decoded = JSON.parse(message.toString());

          if (isErrorMessage(decoded)) {
            this.handleExtensionError(decoded);
            return;
          }

          if (!hasPayloadEnvelope(decoded)) {
            console.error("Invalid message format");
            return;
          }

          const payload = this.verifyEnvelope(decoded);
          if (payload === null) {
            console.error("Invalid or unsigned message rejected");
            return;
          }

          if (isRegisterMessage(payload)) {
            this.handleRegister(connection, payload);
            return;
          }

          const browserId = this.wsToBrowserId.get(connection);
          if (!browserId) {
            console.error("Message from unregistered connection, ignoring");
            return;
          }

          this.handleDecodedExtensionMessage(payload as ExtensionMessage);
        } catch (error) {
          console.error("Failed to handle WebSocket message:", error);
        }
      });

      connection.on("close", () => {
        const browserId = this.wsToBrowserId.get(connection);
        if (browserId) {
          const current = this.browsers.get(browserId);
          if (current?.ws === connection) {
            this.browsers.delete(browserId);
            this.rejectPendingForBrowser(
              browserId,
              `Browser "${browserId}" disconnected`
            );
            console.error(`Browser "${browserId}" disconnected`);
          }
          this.wsToBrowserId.delete(connection);
        }
      });
    });

    this.wsServer.on("error", (error) => {
      console.error("WebSocket server error:", error);
    });
  }

  close() {
    for (const { ws } of this.browsers.values()) {
      ws.close();
    }
    this.browsers.clear();
    this.wsToBrowserId.clear();
    this.wsServer?.close();
  }

  getSelectedPort() {
    return this.wsServer?.options.port;
  }

  listConnectedBrowsers(): ConnectedBrowserInfo[] {
    return [...this.browsers.values()].map((conn) => ({
      browserId: conn.browserId,
      label: conn.label,
      browserType: conn.browserType,
      connected: conn.ws.readyState === WebSocket.OPEN,
      connectedAt: conn.connectedAt,
    }));
  }

  resolveBrowserId(browserId?: string): string {
    if (browserId) {
      if (!BROWSER_ID_PATTERN.test(browserId)) {
        throw new Error(
          `Invalid browserId "${browserId}". Use 1–64 characters: letters, digits, _ or -.`
        );
      }
      const conn = this.browsers.get(browserId);
      if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
        const available = this.listConnectedBrowserIds();
        throw new Error(
          `Browser "${browserId}" is not connected.` +
            (available.length
              ? ` Connected: ${available.join(", ")}`
              : " No browsers connected.")
        );
      }
      return browserId;
    }

    const connected = this.listConnectedBrowsers().filter((b) => b.connected);
    if (connected.length === 1) {
      return connected[0].browserId;
    }
    if (connected.length === 0) {
      throw new Error(
        "No browser extensions connected. Check that the browser is running, the add-on is enabled, and the WebSocket port matches the MCP server."
      );
    }
    throw new Error(
      `browserId is required (${connected.length} browsers connected: ${connected.map((b) => b.browserId).join(", ")}). Use list-connected-browsers.`
    );
  }

  async openTab(
    browserId: string,
    url: string
  ): Promise<number | undefined> {
    const message = await this.sendAndWaitForResponse(
      browserId,
      { cmd: "open-tab", url },
      "opened-tab-id"
    );
    return message.tabId;
  }

  async closeTabs(browserId: string, tabIds: number[]) {
    await this.sendAndWaitForResponse(
      browserId,
      { cmd: "close-tabs", tabIds },
      "tabs-closed"
    );
  }

  async getTabList(browserId: string): Promise<BrowserTab[]> {
    const message = await this.sendAndWaitForResponse(
      browserId,
      { cmd: "get-tab-list" },
      "tabs"
    );
    return message.tabs;
  }

  async getBrowserRecentHistory(
    browserId: string,
    searchQuery?: string
  ): Promise<BrowserHistoryItem[]> {
    const message = await this.sendAndWaitForResponse(
      browserId,
      { cmd: "get-browser-recent-history", searchQuery },
      "history"
    );
    return message.historyItems;
  }

  async getTabContent(
    browserId: string,
    tabId: number,
    offset: number
  ): Promise<TabContentExtensionMessage> {
    return await this.sendAndWaitForResponse(
      browserId,
      { cmd: "get-tab-content", tabId, offset },
      "tab-content"
    );
  }

  async reorderTabs(
    browserId: string,
    tabOrder: number[]
  ): Promise<number[]> {
    const message = await this.sendAndWaitForResponse(
      browserId,
      { cmd: "reorder-tabs", tabOrder },
      "tabs-reordered"
    );
    return message.tabOrder;
  }

  async findHighlight(
    browserId: string,
    tabId: number,
    queryPhrase: string
  ): Promise<number> {
    const message = await this.sendAndWaitForResponse(
      browserId,
      { cmd: "find-highlight", tabId, queryPhrase },
      "find-highlight-result"
    );
    return message.noOfResults;
  }

  async groupTabs(
    browserId: string,
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: string,
    groupTitle: string
  ): Promise<number> {
    const message = await this.sendAndWaitForResponse(
      browserId,
      {
        cmd: "group-tabs",
        tabIds,
        isCollapsed,
        groupColor,
        groupTitle,
      },
      "new-tab-group"
    );
    return message.groupId;
  }

  async evaluateScript(
    browserId: string,
    tabId: number,
    fn: string,
    args?: unknown[]
  ): Promise<unknown> {
    const message = await this.sendAndWaitForResponse(
      browserId,
      { cmd: "evaluate-script", tabId, function: fn, args },
      "evaluate-script-result",
      SCRIPT_RESPONSE_TIMEOUT_MS
    );
    return message.result;
  }

  async queryDom(
    browserId: string,
    tabId: number,
    selector: string,
    mode: "text" | "html" | "list",
    limit?: number,
    maxHtmlLength?: number
  ) {
    return await this.sendAndWaitForResponse(
      browserId,
      { cmd: "query-dom", tabId, selector, mode, limit, maxHtmlLength },
      "query-dom-result",
      SCRIPT_RESPONSE_TIMEOUT_MS
    );
  }

  async getConsoleMessages(
    browserId: string,
    tabId: number,
    clear?: boolean,
    level?: "log" | "info" | "warn" | "error" | "debug",
    limit?: number
  ) {
    return await this.sendAndWaitForResponse(
      browserId,
      { cmd: "get-console-messages", tabId, clear, level, limit },
      "console-messages",
      SCRIPT_RESPONSE_TIMEOUT_MS
    );
  }

  async scrollToElement(
    browserId: string,
    tabId: number,
    selector: string,
    block?: "start" | "center" | "end" | "nearest"
  ) {
    return await this.sendAndWaitForResponse(
      browserId,
      { cmd: "scroll-to-element", tabId, selector, block },
      "scroll-to-element-result",
      SCRIPT_RESPONSE_TIMEOUT_MS
    );
  }

  async captureScreenshot(
    browserId: string,
    tabId: number,
    selector?: string,
    format?: "png" | "jpeg",
    quality?: number
  ) {
    return await this.sendAndWaitForResponse(
      browserId,
      { cmd: "capture-screenshot", tabId, selector, format, quality },
      "screenshot-result",
      SCRIPT_RESPONSE_TIMEOUT_MS
    );
  }

  async setViewportSize(
    browserId: string,
    tabId: number,
    width?: number,
    height?: number,
    deviceScaleFactor?: number,
    mobile?: boolean,
    reset?: boolean
  ) {
    return await this.sendAndWaitForResponse(
      browserId,
      {
        cmd: "set-viewport-size",
        tabId,
        width,
        height,
        deviceScaleFactor,
        mobile,
        reset,
      },
      "viewport-size-result",
      SCRIPT_RESPONSE_TIMEOUT_MS
    );
  }

  private listConnectedBrowserIds(): string[] {
    return this.listConnectedBrowsers()
      .filter((b) => b.connected)
      .map((b) => b.browserId);
  }

  private verifyEnvelope(envelope: WireEnvelope): unknown | null {
    const payloadJson = JSON.stringify(envelope.payload);
    if (this.sharedSecret) {
      if (
        !envelope.signature ||
        envelope.signature !== this.createSignature(payloadJson)
      ) {
        return null;
      }
    }
    return envelope.payload;
  }

  private handleRegister(
    connection: WebSocket,
    payload: ExtensionRegisterMessage
  ): void {
    if (!BROWSER_ID_PATTERN.test(payload.browserId)) {
      connection.close(1008, "Invalid browserId");
      return;
    }

    const existing = this.browsers.get(payload.browserId);
    if (existing && existing.ws !== connection) {
      this.wsToBrowserId.delete(existing.ws);
      existing.ws.close(1000, "Replaced by new connection");
    }

    this.browsers.set(payload.browserId, {
      browserId: payload.browserId,
      label: payload.label,
      browserType: payload.browserType,
      ws: connection,
      connectedAt: Date.now(),
    });
    this.wsToBrowserId.set(connection, payload.browserId);

    const ack = { type: "register-ack" as const, browserId: payload.browserId };
    connection.send(
      packEnvelope(
        ack,
        this.sharedSecret ? this.createSignature(JSON.stringify(ack)) : undefined
      )
    );

    console.error(
      `Browser registered: ${payload.browserId}` +
        (payload.label ? ` (${payload.label})` : "") +
        (payload.browserType ? ` [${payload.browserType}]` : "")
    );
  }

  private createSignature(payload: string): string {
    if (!this.sharedSecret) {
      return "";
    }
    const hmac = crypto.createHmac("sha256", this.sharedSecret);
    hmac.update(payload || "");
    return hmac.digest("hex");
  }

  private async enqueue<T>(
    browserId: string,
    task: () => Promise<T>
  ): Promise<T> {
    const prev = this.browserQueues.get(browserId) ?? Promise.resolve();
    const next = prev.then(() => task(), () => task());
    this.browserQueues.set(browserId, next);
    try {
      return await next;
    } finally {
      if (this.browserQueues.get(browserId) === next) {
        this.browserQueues.delete(browserId);
      }
    }
  }

  private async sendAndWaitForResponse<T extends ExtensionMessage["resource"]>(
    browserId: string,
    message: ServerMessage,
    resource: T,
    timeoutMs: number = EXTENSION_RESPONSE_TIMEOUT_MS
  ): Promise<Extract<ExtensionMessage, { resource: T }>> {
    return this.enqueue(browserId, async () => {
      if (this.initError) {
        throw new Error(this.initError);
      }

      const conn = this.browsers.get(browserId);
      if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
        throw new Error(`Browser "${browserId}" is not connected.`);
      }

      const correlationId = Math.random().toString(36).substring(2);
      const responsePromise = this.waitForResponse(
        correlationId,
        browserId,
        resource,
        timeoutMs
      );

      const req: ServerMessageRequest = { ...message, correlationId };
      const payloadJson = JSON.stringify(req);
      conn.ws.send(
        packEnvelope(
          req,
          this.sharedSecret
            ? this.createSignature(payloadJson)
            : undefined
        )
      );

      return responsePromise;
    });
  }

  private handleDecodedExtensionMessage(decoded: ExtensionMessage) {
    const { correlationId } = decoded;
    const pending = this.extensionRequestMap.get(correlationId);
    if (!pending) {
      console.error("Unexpected response for correlationId:", correlationId);
      return;
    }
    const { resolve, resource } = pending;
    if (resource !== decoded.resource) {
      console.error("Resource mismatch:", resource, decoded.resource);
      return;
    }
    this.extensionRequestMap.delete(correlationId);
    resolve(decoded);
  }

  private handleExtensionError(decoded: ExtensionError) {
    const { correlationId, errorMessage } = decoded;
    const pending = this.extensionRequestMap.get(correlationId);
    if (!pending) {
      return;
    }
    this.extensionRequestMap.delete(correlationId);
    pending.reject(errorMessage);
  }

  private rejectPendingForBrowser(browserId: string, reason: string) {
    for (const [correlationId, pending] of this.extensionRequestMap) {
      if (pending.browserId === browserId) {
        this.extensionRequestMap.delete(correlationId);
        pending.reject(reason);
      }
    }
  }

  private async waitForResponse<T extends ExtensionMessage["resource"]>(
    correlationId: string,
    browserId: string,
    resource: T,
    timeoutMs: number = EXTENSION_RESPONSE_TIMEOUT_MS
  ): Promise<Extract<ExtensionMessage, { resource: T }>> {
    return new Promise<Extract<ExtensionMessage, { resource: T }>>(
      (resolve, reject) => {
        this.extensionRequestMap.set(correlationId, {
          resolve: resolve as (value: ExtensionMessage) => void,
          resource,
          browserId,
          reject,
        });
        setTimeout(() => {
          if (this.extensionRequestMap.has(correlationId)) {
            this.extensionRequestMap.delete(correlationId);
            console.error(
              `Timed out waiting for browser "${browserId}" (${resource}, ${timeoutMs}ms)`
            );
            reject("Timed out waiting for response");
          }
        }, timeoutMs);
      }
    );
  }
}

function readConfig() {
  const secret = process.env.EXTENSION_SECRET?.trim();
  return {
    secret: secret || undefined,
    port: process.env.EXTENSION_PORT
      ? parseInt(process.env.EXTENSION_PORT, 10)
      : DEFAULT_WS_PORT,
  };
}

export function isErrorMessage(message: unknown): message is ExtensionError {
  return (
    typeof message === "object" &&
    message !== null &&
    "errorMessage" in message &&
    "correlationId" in message &&
    typeof (message as ExtensionError).errorMessage === "string"
  );
}
