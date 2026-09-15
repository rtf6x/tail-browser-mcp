export interface ServerMessageBase {
  cmd: string;
}

export interface OpenTabServerMessage extends ServerMessageBase {
  cmd: "open-tab";
  url: string;
}

export interface CloseTabsServerMessage extends ServerMessageBase {
  cmd: "close-tabs";
  tabIds: number[];
}

export interface GetTabListServerMessage extends ServerMessageBase {
  cmd: "get-tab-list";
}

export interface GetBrowserRecentHistoryServerMessage extends ServerMessageBase {
  cmd: "get-browser-recent-history";
  searchQuery?: string;
}

export interface GetTabContentServerMessage extends ServerMessageBase {
  cmd: "get-tab-content";
  tabId: number;
  offset?: number;
}

export interface ReorderTabsServerMessage extends ServerMessageBase {
  cmd: "reorder-tabs";
  tabOrder: number[];
}

export interface FindHighlightServerMessage extends ServerMessageBase {
  cmd: "find-highlight";
  tabId: number;
  queryPhrase: string;
}

export interface GroupTabsServerMessage extends ServerMessageBase {
  cmd: "group-tabs";
  tabIds: number[];
  isCollapsed: boolean;
  groupColor: string;
  groupTitle: string;
}

export interface EvaluateScriptServerMessage extends ServerMessageBase {
  cmd: "evaluate-script";
  tabId: number;
  function: string;
  args?: unknown[];
}

export type DomQueryMode = "text" | "html" | "list";

export interface QueryDomServerMessage extends ServerMessageBase {
  cmd: "query-dom";
  tabId: number;
  selector: string;
  mode: DomQueryMode;
  limit?: number;
  maxHtmlLength?: number;
}

export interface GetConsoleMessagesServerMessage extends ServerMessageBase {
  cmd: "get-console-messages";
  tabId: number;
  clear?: boolean;
  level?: "log" | "info" | "warn" | "error" | "debug";
  limit?: number;
}

export type ScrollBlockPosition = "start" | "center" | "end" | "nearest";

export interface ScrollToElementServerMessage extends ServerMessageBase {
  cmd: "scroll-to-element";
  tabId: number;
  selector: string;
  block?: ScrollBlockPosition;
}

export type ScreenshotFormat = "png" | "jpeg";

export interface CaptureScreenshotServerMessage extends ServerMessageBase {
  cmd: "capture-screenshot";
  tabId: number;
  selector?: string;
  format?: ScreenshotFormat;
  quality?: number;
}

export interface SetViewportSizeServerMessage extends ServerMessageBase {
  cmd: "set-viewport-size";
  tabId: number;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  reset?: boolean;
}

export type ServerMessage =
  | OpenTabServerMessage
  | CloseTabsServerMessage
  | GetTabListServerMessage
  | GetBrowserRecentHistoryServerMessage
  | GetTabContentServerMessage
  | ReorderTabsServerMessage
  | FindHighlightServerMessage
  | GroupTabsServerMessage
  | EvaluateScriptServerMessage
  | QueryDomServerMessage
  | GetConsoleMessagesServerMessage
  | ScrollToElementServerMessage
  | CaptureScreenshotServerMessage
  | SetViewportSizeServerMessage;

export type ServerMessageRequest = ServerMessage & { correlationId: string };
