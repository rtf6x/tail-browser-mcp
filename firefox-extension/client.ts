import { getMessageSignature } from "./auth";
import { WebsocketClient } from "@tail-browser-mcp/common/websocket-client";

export { WebsocketClient };

export function createWebsocketClient(
  wsUrl: string,
  browserId: string,
  secret: string,
  label?: string,
  browserType?: string
): WebsocketClient {
  return new WebsocketClient(
    wsUrl,
    secret,
    getMessageSignature,
    undefined,
    browserId,
    label,
    browserType
  );
}
