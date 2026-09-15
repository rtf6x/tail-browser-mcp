export interface ExtensionMessageBase {
  resource: string;
  correlationId: string;
}

export interface TabContentExtensionMessage extends ExtensionMessageBase {
  resource: "tab-content";
  tabId: number;
  fullText: string;
  isTruncated: boolean;
  totalLength: number;
  links: { url: string; text: string }[];
}

export interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
  lastAccessed?: number;
}

export interface TabsExtensionMessage extends ExtensionMessageBase {
  resource: "tabs";
  tabs: BrowserTab[];
}

export interface OpenedTabIdExtensionMessage extends ExtensionMessageBase {
  resource: "opened-tab-id";
  tabId: number | undefined;
}

export interface BrowserHistoryItem {
  url?: string;
  title?: string;
  lastVisitTime?: number;
}

export interface BrowserHistoryExtensionMessage extends ExtensionMessageBase {
  resource: "history";

  historyItems: BrowserHistoryItem[];
}

export interface ReorderedTabsExtensionMessage extends ExtensionMessageBase {
  resource: "tabs-reordered";
  tabOrder: number[];
}

export interface FindHighlightExtensionMessage extends ExtensionMessageBase {
  resource: "find-highlight-result";
  noOfResults: number;
}

export interface TabsClosedExtensionMessage extends ExtensionMessageBase {
  resource: "tabs-closed";
}

export interface TabGroupCreatedExtensionMessage extends ExtensionMessageBase {
  resource: "new-tab-group";
  groupId: number;
}

export interface EvaluateScriptExtensionMessage extends ExtensionMessageBase {
  resource: "evaluate-script-result";
  tabId: number;
  result: unknown;
}

export interface QueryDomExtensionMessage extends ExtensionMessageBase {
  resource: "query-dom-result";
  tabId: number;
  found: boolean;
  matchCount: number;
  innerText?: string;
  outerHTML?: string;
  isTruncated?: boolean;
  totalLength?: number;
  elements?: Array<{
    index: number;
    tagName: string;
    id: string | null;
    className: string | null;
    innerText: string;
    outerHTML: string;
    isHtmlTruncated: boolean;
  }>;
}

export interface ConsoleMessageEntry {
  level: string;
  timestamp: number;
  messages: unknown[];
}

export interface ConsoleMessagesExtensionMessage extends ExtensionMessageBase {
  resource: "console-messages";
  tabId: number;
  entries: ConsoleMessageEntry[];
  totalBuffered: number;
}

export interface ScrollToElementExtensionMessage extends ExtensionMessageBase {
  resource: "scroll-to-element-result";
  tabId: number;
  found: boolean;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface CaptureScreenshotExtensionMessage extends ExtensionMessageBase {
  resource: "screenshot-result";
  tabId: number;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  elementNotFound?: boolean;
}

export interface SetViewportSizeExtensionMessage extends ExtensionMessageBase {
  resource: "viewport-size-result";
  tabId: number;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  method: "cdp" | "window-resize";
}

export type ExtensionMessage =
  | TabContentExtensionMessage
  | TabsExtensionMessage
  | OpenedTabIdExtensionMessage
  | BrowserHistoryExtensionMessage
  | ReorderedTabsExtensionMessage
  | FindHighlightExtensionMessage
  | TabsClosedExtensionMessage
  | TabGroupCreatedExtensionMessage
  | EvaluateScriptExtensionMessage
  | QueryDomExtensionMessage
  | ConsoleMessagesExtensionMessage
  | ScrollToElementExtensionMessage
  | CaptureScreenshotExtensionMessage
  | SetViewportSizeExtensionMessage;

export interface ExtensionError {
  correlationId: string;
  errorMessage: string;
}