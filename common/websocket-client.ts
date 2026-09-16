import type {
  ExtensionMessage,
  ExtensionError,
} from "./extension-messages";
import type { ServerMessageRequest } from "./server-messages";
import {
  isRegisterAckMessage,
  type ExtensionRegisterMessage,
} from "./handshake-messages";
import {
  hasPayloadEnvelope,
  packEnvelope,
} from "./wire-envelope";
import {
  healthUrlFromWsUrl,
  normalizeWsUrl,
} from "./ws-endpoints";

export type { ServerMessageRequest };

const MIN_RECONNECT_MS = 3_000;
const MAX_RECONNECT_MS = 60_000;
const HEALTH_PROBE_TIMEOUT_MS = 2_000;

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export class WebsocketClient {
  private socket: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly healthUrl: string;
  private readonly secret: string;
  private readonly getMessageSignature: (
    message: string,
    secretKey: string
  ) => Promise<string>;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = MIN_RECONNECT_MS;
  private offlineNoticeShown = false;
  private connectInFlight = false;
  private readonly browserId: string;
  private readonly label?: string;
  private readonly browserType?: string;
  private messageCallback: ((data: ServerMessageRequest) => void) | null = null;
  private status: ConnectionStatus = "disconnected";
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(
    wsUrl: string,
    secret: string,
    getMessageSignature: (message: string, secretKey: string) => Promise<string>,
    healthUrl?: string,
    browserId?: string,
    label?: string,
    browserType?: string
  ) {
    this.wsUrl = normalizeWsUrl(wsUrl);
    this.healthUrl = healthUrl ?? healthUrlFromWsUrl(this.wsUrl);
    this.secret = secret;
    this.getMessageSignature = getMessageSignature;
    this.browserId = browserId ?? "default";
    this.label = label;
    this.browserType = browserType;
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public addStatusListener(
    callback: (status: ConnectionStatus) => void
  ): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  /** Start or retry connection. Safe to call when MCP server is offline. */
  public connect(): void {
    if (
      this.connectInFlight ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    void this.tryConnect();
  }

  public addMessageListener(
    callback: (data: ServerMessageRequest) => void
  ): void {
    this.messageCallback = callback;
  }

  public async sendResourceToServer(resource: ExtensionMessage): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      const signature = this.secret
        ? await this.getMessageSignature(JSON.stringify(resource), this.secret)
        : undefined;
      this.socket.send(packEnvelope(resource, signature));
    } catch (error) {
      console.warn("Tail MCP: failed to send response", error);
    }
  }

  public async sendErrorToServer(
    correlationId: string,
    errorMessage: string
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const extensionError: ExtensionError = {
      correlationId,
      errorMessage,
    };
    try {
      this.socket.send(JSON.stringify(extensionError));
    } catch {
      // MCP server went away mid-request
    }
  }

  public disconnect(): void {
    this.clearReconnectTimeout();
    this.detachSocket();
    this.setStatus("disconnected");
    this.connectInFlight = false;
  }

  private async tryConnect(): Promise<void> {
    if (
      this.connectInFlight ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.connectInFlight = true;
    this.clearReconnectTimeout();
    this.detachSocket();
    this.setStatus("connecting");

    try {
      const serverUp = await this.probeHealth();
      if (!serverUp) {
        this.setStatus("disconnected");
        this.noteOffline();
        this.scheduleReconnect();
        this.connectInFlight = false;
        return;
      }

      this.openWebSocket();
    } catch {
      this.setStatus("disconnected");
      this.connectInFlight = false;
      this.scheduleReconnect();
    }
  }

  /** HTTP health check — avoids WebSocket ERR_CONNECTION_REFUSED when server is offline. */
  private async probeHealth(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      HEALTH_PROBE_TIMEOUT_MS
    );
    try {
      const response = await fetch(this.healthUrl, {
        signal: controller.signal,
        cache: "no-store",
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private openWebSocket(): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.wsUrl);
    } catch {
      this.connectInFlight = false;
      this.setStatus("disconnected");
      this.noteOffline();
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.connectInFlight = false;
      this.setStatus("connected");
      this.reconnectDelayMs = MIN_RECONNECT_MS;
      this.offlineNoticeShown = false;
      console.log(
        "Tail MCP: connected to",
        this.wsUrl,
        "as",
        this.browserId
      );
      void this.sendRegister();
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.connectInFlight = false;
      this.setStatus("disconnected");
      this.socket = null;
      this.noteOffline();
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose runs next; WebSocket may still log a network error if server drops mid-flight
    };

    socket.onmessage = (event) => {
      void this.handleMessage(event);
    };
  }

  private async sendRegister(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const payload: ExtensionRegisterMessage = {
      type: "register",
      browserId: this.browserId,
      label: this.label,
      browserType: this.browserType,
    };
    try {
      const signature = this.secret
        ? await this.getMessageSignature(JSON.stringify(payload), this.secret)
        : undefined;
      this.socket.send(packEnvelope(payload, signature));
    } catch (error) {
      console.warn("Tail MCP: failed to register", error);
    }
  }

  private async verifyPayload(envelope: unknown): Promise<unknown | null> {
    if (!hasPayloadEnvelope(envelope)) {
      return null;
    }
    const payloadJson = JSON.stringify(envelope.payload);
    if (!this.secret) {
      return envelope.payload;
    }
    if (!envelope.signature) {
      return null;
    }
    const messageSig = await this.getMessageSignature(payloadJson, this.secret);
    return messageSig === envelope.signature ? envelope.payload : null;
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    try {
      const raw = JSON.parse(String(event.data));
      const payload = await this.verifyPayload(raw);
      if (payload === null) {
        if (hasPayloadEnvelope(raw) && this.messageCallback) {
          console.warn("Tail MCP: invalid message signature");
          const req = raw.payload as ServerMessageRequest;
          if (req?.correlationId) {
            await this.sendErrorToServer(
              req.correlationId,
              "Invalid message signature - extension and server not in sync"
            );
          }
        }
        return;
      }

      if (isRegisterAckMessage(payload)) {
        console.log("Tail MCP: registered as", payload.browserId);
        return;
      }

      if (this.messageCallback === null) {
        return;
      }
      await this.messageCallback(payload as ServerMessageRequest);
    } catch (error) {
      console.warn("Tail MCP: failed to handle message", error);
    }
  }

  private noteOffline(): void {
    if (this.offlineNoticeShown) {
      return;
    }
    this.offlineNoticeShown = true;
    console.warn(
      `Tail MCP: MCP server offline (${this.wsUrl}, health ${this.healthUrl}). Will retry without opening WebSocket.`
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout !== null) {
      return;
    }
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      MAX_RECONNECT_MS
    );
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private detachSocket(): void {
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    this.socket = null;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
  }
}
