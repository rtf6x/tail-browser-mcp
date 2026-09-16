import type { QueryDomExtensionMessage, ServerMessageRequest } from "@tail-browser-mcp/common";
import { WebsocketClient } from "./client";
import { isCommandAllowed, isDomainInDenyList, COMMAND_TO_TOOL_ID, addAuditLogEntry } from "./extension-config";
import {
  buildEvaluateScript,
  buildGetConsoleMessagesScript,
  buildMeasureViewportScript,
  buildQueryDomScript,
  buildScrollToElementScript,
  ensureTabPageAccess,
  executeInTab,
  installConsoleCapture,
  type DomQueryMode,
  type ScrollBlockPosition,
} from "./tab-page-access";

async function cropDataUrl(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  devicePixelRatio: number,
  mimeType: string,
  quality?: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);

  const sx = Math.max(0, Math.round(rect.x * devicePixelRatio));
  const sy = Math.max(0, Math.round(rect.y * devicePixelRatio));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.width * devicePixelRatio)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.height * devicePixelRatio)));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const croppedBlob = await canvas.convertToBlob({
    type: mimeType,
    quality: quality !== undefined ? quality / 100 : undefined,
  });
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(croppedBlob);
  const croppedDataUrl = await promise;

  return { dataUrl: croppedDataUrl, width: sw, height: sh };
}

const originalWindowSizes = new Map<number, { width: number; height: number }>();

export class MessageHandler {
  private client: WebsocketClient;

  constructor(client: WebsocketClient) {
    this.client = client;
  }

  public async handleDecodedMessage(req: ServerMessageRequest): Promise<void> {
    const isAllowed = await isCommandAllowed(req.cmd);
    if (!isAllowed) {
      throw new Error(`Command '${req.cmd}' is disabled in extension settings`);
    }

    this.addAuditLogForReq(req).catch((error) => {
      console.error("Failed to add audit log entry:", error);
    });

    switch (req.cmd) {
      case "open-tab":
        await this.openUrl(req.correlationId, req.url);
        break;
      case "close-tabs":
        await this.closeTabs(req.correlationId, req.tabIds);
        break;
      case "get-tab-list":
        await this.sendTabs(req.correlationId);
        break;
      case "get-browser-recent-history":
        await this.sendRecentHistory(req.correlationId, req.searchQuery);
        break;
      case "get-tab-content":
        await this.sendTabsContent(req.correlationId, req.tabId, req.offset);
        break;
      case "reorder-tabs":
        await this.reorderTabs(req.correlationId, req.tabOrder);
        break;
      case "find-highlight":
        await this.findAndHighlightText(
          req.correlationId,
          req.tabId,
          req.queryPhrase
        );
        break;
      case "group-tabs":
        await this.groupTabs(
          req.correlationId,
          req.tabIds,
          req.isCollapsed,
          req.groupColor as browser.tabGroups.Color,
          req.groupTitle
        );
        break;
      case "evaluate-script":
        await this.evaluateScript(
          req.correlationId,
          req.tabId,
          req.function,
          req.args
        );
        break;
      case "query-dom":
        await this.queryDom(
          req.correlationId,
          req.tabId,
          req.selector,
          req.mode,
          req.limit,
          req.maxHtmlLength
        );
        break;
      case "get-console-messages":
        await this.getConsoleMessages(
          req.correlationId,
          req.tabId,
          req.clear,
          req.level,
          req.limit
        );
        break;
      case "scroll-to-element":
        await this.scrollToElement(
          req.correlationId,
          req.tabId,
          req.selector,
          req.block
        );
        break;
      case "capture-screenshot":
        await this.captureScreenshot(
          req.correlationId,
          req.tabId,
          req.selector,
          req.format,
          req.quality
        );
        break;
      case "set-viewport-size":
        await this.setViewportSize(
          req.correlationId,
          req.tabId,
          req.width,
          req.height,
          req.deviceScaleFactor,
          req.mobile,
          req.reset
        );
        break;
      default:
        const _exhaustiveCheck: never = req;
        console.error("Invalid message received:", req);
    }
  }

  private async addAuditLogForReq(req: ServerMessageRequest) {
    // Get the URL in context (either from param or from the tab)
    let contextUrl: string | undefined;
    if ("url" in req && req.url) {
      contextUrl = req.url;
    }
    if ("tabId" in req) {
      try {
        const tab = await browser.tabs.get(req.tabId);
        contextUrl = tab.url;
      } catch (error) {
        console.error("Failed to get tab URL for audit log:", error);
      }
    }

    const toolId = COMMAND_TO_TOOL_ID[req.cmd];
    const auditEntry = {
      toolId,
      command: req.cmd,
      timestamp: Date.now(),
      url: contextUrl
    };
    
    await addAuditLogEntry(auditEntry);
  }

  private async openUrl(correlationId: string, url: string): Promise<void> {
    if (await isDomainInDenyList(url)) {
      throw new Error("Domain in user defined deny list");
    }

    const tab = await browser.tabs.create({
      url,
    });

    await this.client.sendResourceToServer({
      resource: "opened-tab-id",
      correlationId,
      tabId: tab.id,
    });
  }

  private async closeTabs(
    correlationId: string,
    tabIds: number[]
  ): Promise<void> {
    await browser.tabs.remove(tabIds);
    await this.client.sendResourceToServer({
      resource: "tabs-closed",
      correlationId,
    });
  }

  private async sendTabs(correlationId: string): Promise<void> {
    const tabs = await browser.tabs.query({});
    await this.client.sendResourceToServer({
      resource: "tabs",
      correlationId,
      tabs,
    });
  }

  private async sendRecentHistory(
    correlationId: string,
    searchQuery: string | null = null
  ): Promise<void> {
    const historyItems = await browser.history.search({
      text: searchQuery ?? "", // Search for all URLs (empty string matches everything)
      maxResults: 200, // Limit to 200 results
      startTime: 0, // Search from the beginning of time
    });
    const filteredHistoryItems = historyItems.filter((item) => {
      return !!item.url;
    });
    await this.client.sendResourceToServer({
      resource: "history",
      correlationId,
      historyItems: filteredHistoryItems,
    });
  }

  // Check that the user has granted permission to access the URL's domain.
  // This will open the options page with a URL parameter to request permission
  // and throw an error to indicate that the request cannot proceed until permission is granted.
  private async checkForUrlPermission(url: string | undefined): Promise<void> {
    if (url) {
      const origin = new URL(url).origin;
      const granted = await browser.permissions.contains({
        origins: [`${origin}/*`],
      });

      if (!granted) {
        // Open the options page with a URL parameter to request permission:
        const optionsUrl = browser.runtime.getURL("options.html");
        const urlWithParams = `${optionsUrl}?requestUrl=${encodeURIComponent(
          url
        )}`;

        await browser.tabs.create({ url: urlWithParams });
        throw new Error(
          `The user has not yet granted permission to access the domain "${origin}". A dialog is now being opened to request permission. If the user grants permission, you can try the request again.`
        );
      }
    }
  }

  private async checkForGlobalPermission(permissions: string[]): Promise<void> {
    const granted = await browser.permissions.contains({
      permissions,
    });

    if (!granted) {
      // Open the options page with a URL parameter to request permission:
      const optionsUrl = browser.runtime.getURL("options.html");
      const urlWithParams = `${optionsUrl}?requestPermissions=${encodeURIComponent(
        JSON.stringify(permissions)
      )}`;

      await browser.tabs.create({ url: urlWithParams });
      throw new Error(
        `The user has not yet granted permission for the following operations: ${permissions.join(
          ", "
        )}. A dialog is now being opened to request permission. If the user grants permission, you can try the request again.`
      );
    }
  }

  private async sendTabsContent(
    correlationId: string,
    tabId: number,
    offset?: number
  ): Promise<void> {
    const tab = await browser.tabs.get(tabId);
    if (tab.url && (await isDomainInDenyList(tab.url))) {
      throw new Error(`Domain in tab URL is in the deny list`);
    }

    await this.checkForUrlPermission(tab.url);

    const MAX_CONTENT_LENGTH = 50_000;
    const results = await browser.tabs.executeScript(tabId, {
      code: `
      (function () {
        function getLinks() {
          const linkElements = document.querySelectorAll('a[href]');
          return Array.from(linkElements).map(el => ({
            url: el.href,
            text: el.innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || ''
          })).filter(link => link.text !== '' && link.url.startsWith('https://') && !link.url.includes('#'));
        }

        function getTextContent() {
          let isTruncated = false;
          let text = document.body.innerText.substring(${Number(offset) || 0});
          if (text.length > ${MAX_CONTENT_LENGTH}) {
            text = text.substring(0, ${MAX_CONTENT_LENGTH});
            isTruncated = true;
          }
          return {
            text, isTruncated
          }
        }

        const textContent = getTextContent();

        return {
          links: getLinks(),
          fullText: textContent.text,
          isTruncated: textContent.isTruncated,
          totalLength: document.body.innerText.length
        };
      })();
    `,
    });
    const { isTruncated, fullText, links, totalLength } = results[0];
    await this.client.sendResourceToServer({
      resource: "tab-content",
      tabId,
      correlationId,
      isTruncated,
      fullText,
      links,
      totalLength,
    });
  }

  private async reorderTabs(
    correlationId: string,
    tabOrder: number[]
  ): Promise<void> {
    // Reorder the tabs sequentially
    for (let newIndex = 0; newIndex < tabOrder.length; newIndex++) {
      const tabId = tabOrder[newIndex];
      await browser.tabs.move(tabId, { index: newIndex });
    }
    await this.client.sendResourceToServer({
      resource: "tabs-reordered",
      correlationId,
      tabOrder,
    });
  }

  private async findAndHighlightText(
    correlationId: string,
    tabId: number,
    queryPhrase: string
  ): Promise<void> {
    const tab = await browser.tabs.get(tabId);

    if (tab.url && (await isDomainInDenyList(tab.url))) {
      throw new Error(`Domain in tab URL is in the deny list`);
    }

    await this.checkForGlobalPermission(["find"]);

    const findResults = await browser.find.find(queryPhrase, {
      tabId,
      caseSensitive: true,
    });

    // If there are results, highlight them
    if (findResults.count > 0) {
      // But first, activate the tab. In firefox, this would also enable
      // auto-scrolling to the highlighted result.
      await browser.tabs.update(tabId, { active: true });
      browser.find.highlightResults({
        tabId,
      });
    }

    await this.client.sendResourceToServer({
      resource: "find-highlight-result",
      correlationId,
      noOfResults: findResults.count,
    });
  }

  private async groupTabs(
    correlationId: string,
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: browser.tabGroups.Color,
    groupTitle: string
  ): Promise<void> {
    const groupId = await browser.tabs.group({
      tabIds,
    });

    let tabGroup = await browser.tabGroups.update(groupId, {
      collapsed: isCollapsed,
      color: groupColor,
      title: groupTitle,
    });

    await this.client.sendResourceToServer({
      resource: "new-tab-group",
      correlationId,
      groupId: tabGroup.id,
    });
  }

  private async evaluateScript(
    correlationId: string,
    tabId: number,
    functionSource: string,
    args?: unknown[]
  ): Promise<void> {
    await installConsoleCapture(tabId);
    const result = await executeInTab<unknown>(
      tabId,
      buildEvaluateScript(functionSource, args ?? [])
    );

    await this.client.sendResourceToServer({
      resource: "evaluate-script-result",
      correlationId,
      tabId,
      result,
    });
  }

  private async queryDom(
    correlationId: string,
    tabId: number,
    selector: string,
    mode: DomQueryMode,
    limit?: number,
    maxHtmlLength?: number
  ): Promise<void> {
    const result = await executeInTab<{
      found: boolean;
      matchCount: number;
      innerText?: string;
      outerHTML?: string;
      isTruncated?: boolean;
      totalLength?: number;
      elements?: QueryDomExtensionMessage["elements"];
    }>(
      tabId,
      buildQueryDomScript(selector, mode, limit ?? 20, maxHtmlLength ?? 5000)
    );

    await this.client.sendResourceToServer({
      resource: "query-dom-result",
      correlationId,
      tabId,
      ...result,
    });
  }
  private async getConsoleMessages(
    correlationId: string,
    tabId: number,
    clear?: boolean,
    level?: "log" | "info" | "warn" | "error" | "debug",
    limit?: number
  ): Promise<void> {
    await installConsoleCapture(tabId);
    const result = await executeInTab<{
      entries: Array<{ level: string; timestamp: number; messages: unknown[] }>;
      totalBuffered: number;
    }>(tabId, buildGetConsoleMessagesScript(!!clear, level, limit ?? 100));

    await this.client.sendResourceToServer({
      resource: "console-messages",
      correlationId,
      tabId,
      entries: result.entries,
      totalBuffered: result.totalBuffered,
    });
  }

  private async scrollToElement(
    correlationId: string,
    tabId: number,
    selector: string,
    block?: ScrollBlockPosition
  ): Promise<void> {
    await ensureTabPageAccess(tabId);
    const result = await executeInTab<{
      found: boolean;
      rect?: { x: number; y: number; width: number; height: number };
    }>(tabId, buildScrollToElementScript(selector, block ?? "center"));

    await this.client.sendResourceToServer({
      resource: "scroll-to-element-result",
      correlationId,
      tabId,
      found: result.found,
      rect: result.rect,
    });
  }

  private async captureScreenshot(
    correlationId: string,
    tabId: number,
    selector?: string,
    format?: "png" | "jpeg",
    quality?: number
  ): Promise<void> {
    const tab = await ensureTabPageAccess(tabId);
    await browser.tabs.update(tabId, { active: true });

    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    let elementNotFound = false;
    let cropRect: { x: number; y: number; width: number; height: number } | undefined;
    let devicePixelRatio = 1;

    if (selector) {
      const scrollResult = await executeInTab<{
        found: boolean;
        rect?: { x: number; y: number; width: number; height: number };
        devicePixelRatio?: number;
      }>(tabId, buildScrollToElementScript(selector, "center"));
      if (scrollResult.found) {
        cropRect = scrollResult.rect;
        devicePixelRatio = scrollResult.devicePixelRatio ?? 1;
        const { promise: settled, resolve: resolveSettled } = Promise.withResolvers<void>();
        setTimeout(resolveSettled, 150);
        await settled;
      } else {
        elementNotFound = true;
      }
    }

    const rawDataUrl = await browser.tabs.captureVisibleTab(
      tab.windowId ?? browser.windows.WINDOW_ID_CURRENT,
      format === "jpeg"
        ? { format: "jpeg", quality: quality ?? 90 }
        : { format: "png" }
    );

    let finalDataUrl = rawDataUrl;
    let width: number;
    let height: number;
    if (cropRect) {
      const cropped = await cropDataUrl(rawDataUrl, cropRect, devicePixelRatio, mimeType, quality);
      finalDataUrl = cropped.dataUrl;
      width = cropped.width;
      height = cropped.height;
    } else {
      const bitmap = await createImageBitmap(await (await fetch(rawDataUrl)).blob());
      width = bitmap.width;
      height = bitmap.height;
    }

    await this.client.sendResourceToServer({
      resource: "screenshot-result",
      correlationId,
      tabId,
      dataUrl: finalDataUrl.split(",")[1] ?? "",
      mimeType,
      width,
      height,
      elementNotFound,
    });
  }

  private async setViewportSize(
    correlationId: string,
    tabId: number,
    width?: number,
    height?: number,
    _deviceScaleFactor?: number,
    _mobile?: boolean,
    reset?: boolean
  ): Promise<void> {
    const tab = await ensureTabPageAccess(tabId);
    const windowId = tab.windowId;
    if (windowId === undefined) {
      throw new Error("Tab has no containing window — cannot resize its viewport");
    }

    if (reset || width === undefined || height === undefined) {
      const original = originalWindowSizes.get(windowId);
      if (original) {
        await browser.windows.update(windowId, {
          width: original.width,
          height: original.height,
        });
        originalWindowSizes.delete(windowId);
      }
      const measured = await executeInTab<{
        innerWidth: number;
        innerHeight: number;
        devicePixelRatio: number;
      }>(tabId, buildMeasureViewportScript());
      await this.client.sendResourceToServer({
        resource: "viewport-size-result",
        correlationId,
        tabId,
        width: measured.innerWidth,
        height: measured.innerHeight,
        deviceScaleFactor: measured.devicePixelRatio,
        mobile: false,
        method: "window-resize",
      });
      return;
    }

    const before = await executeInTab<{
      innerWidth: number;
      innerHeight: number;
      outerWidth: number;
      outerHeight: number;
    }>(tabId, buildMeasureViewportScript());

    if (!originalWindowSizes.has(windowId)) {
      const win = await browser.windows.get(windowId);
      originalWindowSizes.set(windowId, {
        width: win.width ?? before.outerWidth,
        height: win.height ?? before.outerHeight,
      });
    }

    const widthDelta = before.outerWidth - before.innerWidth;
    const heightDelta = before.outerHeight - before.innerHeight;
    await browser.windows.update(windowId, {
      width: Math.round(width + widthDelta),
      height: Math.round(height + heightDelta),
    });

    const { promise: settled, resolve: resolveSettled } = Promise.withResolvers<void>();
    setTimeout(resolveSettled, 150);
    await settled;

    const after = await executeInTab<{
      innerWidth: number;
      innerHeight: number;
      devicePixelRatio: number;
    }>(tabId, buildMeasureViewportScript());

    await this.client.sendResourceToServer({
      resource: "viewport-size-result",
      correlationId,
      tabId,
      width: after.innerWidth,
      height: after.innerHeight,
      deviceScaleFactor: after.devicePixelRatio,
      mobile: false,
      method: "window-resize",
    });
  }
}
