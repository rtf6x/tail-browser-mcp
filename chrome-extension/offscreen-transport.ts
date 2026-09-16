import type { ExtensionMessage } from "@tail-browser-mcp/common/extension-messages";
import { browser } from "./browser";

/** Forwards MCP responses from the service worker to the offscreen WebSocket client. */
export class OffscreenTransport {
  constructor(private readonly clientIndex: number) {}

  async sendResourceToServer(resource: ExtensionMessage): Promise<void> {
    await browser.runtime.sendMessage({
      type: "mcp-offscreen-send-resource",
      clientIndex: this.clientIndex,
      resource,
    });
  }

  async sendErrorToServer(
    correlationId: string,
    errorMessage: string
  ): Promise<void> {
    await browser.runtime.sendMessage({
      type: "mcp-offscreen-send-error",
      clientIndex: this.clientIndex,
      correlationId,
      errorMessage,
    });
  }
}
