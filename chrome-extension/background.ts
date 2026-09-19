import { MessageHandler } from "./message-handler";
import { browser } from "./browser";
import { getConfig } from "./extension-config";
import { ensureOffscreenDocument } from "./ensure-offscreen";
import { OffscreenTransport } from "./offscreen-transport";
import { updateConnectionIcon } from "./connection-icon";
import type { ConnectionStatus } from "@tail-browser-mcp/common/websocket-client";
import type { ServerMessageRequest } from "@tail-browser-mcp/common/server-messages";

const RECONNECT_ALARM = "tail-mcp-reconnect";
const BRIDGE_PORT_NAME = "tail-mcp-bridge";
const handlers: MessageHandler[] = [];
let startPromise: Promise<void> | null = null;
let reconnectAlarmRegistered = false;
let initializedConfigKey = "";

function configKey(config: Awaited<ReturnType<typeof getConfig>>): string {
  return `${config.browserId ?? ""}\0${config.label ?? ""}\0${(config.wsUrls ?? []).join("\n")}`;
}

function rebuildHandlers(config: Awaited<ReturnType<typeof getConfig>>): void {
  const wsUrls = config.wsUrls ?? [];
  handlers.splice(0, handlers.length);
  wsUrls.forEach((_wsUrl, index) => {
    handlers.push(new MessageHandler(new OffscreenTransport(index)));
  });
}

async function ensureHandlersReady(): Promise<void> {
  if (handlers.length > 0) {
    return;
  }
  await startExtension();
  if (handlers.length === 0) {
    throw new Error("Tail MCP handlers not initialized");
  }
}

async function handleServerCommand(
  clientIndex: number,
  message: ServerMessageRequest
): Promise<void> {
  await ensureHandlersReady();
  const handler = handlers[clientIndex];
  if (!handler) {
    throw new Error(`No handler for MCP client index ${clientIndex}`);
  }
  await handler.handleDecodedMessage(message);
}

browser.runtime.onInstalled.addListener((details) => {
  void updateConnectionIcon("disconnected");
  if (details.reason === "install") {
    void browser.runtime.openOptionsPage();
  }
});

browser.action.onClicked.addListener(() => {
  void browser.runtime.openOptionsPage();
});

browser.runtime.onStartup.addListener(() => {
  void startExtension();
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== BRIDGE_PORT_NAME) {
    return;
  }

  port.onMessage.addListener((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      message.type !== "mcp-bridge-command"
    ) {
      return;
    }

    const requestId = message.requestId as string;
    const clientIndex = message.clientIndex as number;
    const cmd = message.message as ServerMessageRequest;

    void handleServerCommand(clientIndex, cmd)
      .then(() => {
        port.postMessage({ type: "mcp-bridge-result", requestId, ok: true });
      })
      .catch(async (error: unknown) => {
        console.warn("Tail MCP: command handler error", error);
        const transport = new OffscreenTransport(clientIndex);
        if (error instanceof Error && cmd?.correlationId) {
          await transport.sendErrorToServer(cmd.correlationId, error.message);
        }
        port.postMessage({
          type: "mcp-bridge-result",
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  if (message.type === "mcp-offscreen-ready") {
    void startExtension().then(
      () => sendResponse({ ok: true }),
      (error) => {
        console.error("Tail MCP: start after offscreen ready failed", error);
        sendResponse({ ok: false });
      }
    );
    return true;
  }

  if (message.type === "mcp-connection-status") {
    void updateConnectionIcon(message.status as ConnectionStatus).then(
      () => sendResponse({ ok: true }),
      (error) => {
        console.warn("Tail MCP: failed to update toolbar icon", error);
        sendResponse({ ok: false });
      }
    );
    return true;
  }

  if (message.type === "mcp-offscreen-server-command") {
    void handleServerCommand(
      message.clientIndex as number,
      message.message as ServerMessageRequest
    )
      .then(() => sendResponse({ ok: true }))
      .catch(async (error: unknown) => {
        console.warn("Tail MCP: command handler error", error);
        const transport = new OffscreenTransport(message.clientIndex as number);
        if (error instanceof Error && message.message?.correlationId) {
          await transport.sendErrorToServer(
            message.message.correlationId,
            error.message
          );
        }
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  return false;
});

async function sendOffscreenInit(config: Awaited<ReturnType<typeof getConfig>>): Promise<void> {
  const wsUrls = config.wsUrls ?? [];
  if (wsUrls.length === 0) {
    throw new Error("No WebSocket URLs configured");
  }

  rebuildHandlers(config);

  await browser.runtime.sendMessage({
    type: "mcp-offscreen-init",
    wsUrls,
    browserId: config.browserId,
    label: config.label,
  });
}

async function reconnectOffscreen(): Promise<void> {
  await browser.runtime.sendMessage({ type: "mcp-offscreen-reconnect" });
}

async function bootstrap(config: Awaited<ReturnType<typeof getConfig>>): Promise<void> {
  const key = configKey(config);
  rebuildHandlers(config);

  if (initializedConfigKey === key) {
    await reconnectOffscreen();
    return;
  }

  await sendOffscreenInit(config);
  initializedConfigKey = key;
  await setupReconnectAlarm();
  console.log("Tail MCP initialized via offscreen document");
}

async function startExtension(): Promise<void> {
  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    await ensureOffscreenDocument();
    const config = await getConfig();
    rebuildHandlers(config);
    await bootstrapWithRetry(config);
  })().finally(() => {
    startPromise = null;
  });

  return startPromise;
}

async function bootstrapWithRetry(
  config: Awaited<ReturnType<typeof getConfig>>,
  attempts = 5
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await bootstrap(config);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Receiving end does not exist")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function setupReconnectAlarm(): Promise<void> {
  await browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
  if (reconnectAlarmRegistered) {
    return;
  }
  reconnectAlarmRegistered = true;
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== RECONNECT_ALARM) {
      return;
    }
    void (async () => {
      try {
        await ensureOffscreenDocument();
        const config = await getConfig();
        rebuildHandlers(config);
        await reconnectOffscreen();
      } catch (error) {
        console.warn("Tail MCP: reconnect alarm failed", error);
        initializedConfigKey = "";
        void startExtension();
      }
    })();
  });
}

void ensureOffscreenDocument()
  .then(() => startExtension())
  .catch((error) => {
    console.error("Tail MCP: failed to create offscreen document", error);
  });

void updateConnectionIcon("disconnected");
