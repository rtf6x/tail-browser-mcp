import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BrowserAPI } from "./browser-api";
import { BROWSER_ID_PATTERN } from "@tail-browser-mcp/common/handshake-messages";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const browserIdSchema = z
  .string()
  .regex(BROWSER_ID_PATTERN)
  .optional()
  .describe(
    "Target browser ID. Required when multiple browsers are connected; optional if exactly one is connected. Use list-connected-browsers to discover IDs."
  );

export function createBrowserControlServer(browserApi: BrowserAPI): McpServer {
  const mcpServer = new McpServer({
    name: "BrowserControl",
    version: "1.6.1",
  });

  mcpServer.tool(
    "list-connected-browsers",
    "List browser extension installs currently connected to this MCP server. Use browserId from the result in other tools.",
    {},
    async () => {
      const browsers = browserApi.listConnectedBrowsers();
      if (browsers.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No browsers connected. Ensure the extension is enabled, WebSocket URL matches the MCP server (default ws://127.0.0.1:18789), and browserId is registered.",
            },
          ],
        };
      }
      return {
        content: browsers.map((b) => ({
          type: "text" as const,
          text: [
            `browserId=${b.browserId}`,
            b.label ? `label="${b.label}"` : null,
            b.browserType ? `type=${b.browserType}` : null,
            `connected=${b.connected}`,
          ]
            .filter(Boolean)
            .join(", "),
        })),
      };
    }
  );

  mcpServer.tool(
    "open-browser-tab",
    "Open a new tab in the user's browser (useful when the user asks to open a website)",
    { browserId: browserIdSchema, url: z.string() },
    async ({ browserId, url }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const openedTabId = await browserApi.openTab(id, url);
      if (openedTabId !== undefined) {
        return {
          content: [
            {
              type: "text",
              text: `[${id}] ${url} opened in tab id ${openedTabId}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: "Failed to open tab", isError: true }],
      };
    }
  );

  mcpServer.tool(
    "close-browser-tabs",
    "Close tabs in the user's browser by tab IDs",
    {
      browserId: browserIdSchema,
      tabIds: z.array(z.number()),
    },
    async ({ browserId, tabIds }) => {
      const id = browserApi.resolveBrowserId(browserId);
      await browserApi.closeTabs(id, tabIds);
      return {
        content: [{ type: "text", text: `[${id}] Closed tabs` }],
      };
    }
  );

  mcpServer.tool(
    "get-list-of-open-tabs",
    "Get the list of open tabs in the user's browser. Use offset and limit parameters for pagination when there are many tabs.",
    {
      browserId: browserIdSchema,
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Starting index for pagination (0-based, must be >= 0)"),
      limit: z
        .number()
        .default(100)
        .describe("Maximum number of tabs to return (default: 100, max: 500)"),
    },
    async ({ browserId, offset, limit }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const effectiveLimit = Math.min(Math.max(1, limit), 500);

      const openTabs = await browserApi.getTabList(id);
      const totalTabs = openTabs.length;

      const paginatedTabs = openTabs.slice(offset, offset + effectiveLimit);
      const hasMore = offset + effectiveLimit < totalTabs;

      const paginationInfo = {
        type: "text" as const,
        text: `[${id}] Showing tabs ${offset + 1}-${offset + paginatedTabs.length} of ${totalTabs} total tabs${hasMore ? ` (use offset=${offset + effectiveLimit} to see more)` : ""}`,
      };

      const tabContent = paginatedTabs.map((tab) => {
        let lastAccessed = "unknown";
        if (tab.lastAccessed) {
          lastAccessed = dayjs(tab.lastAccessed).fromNow();
        }
        return {
          type: "text" as const,
          text: `tab id=${tab.id}, tab url=${tab.url}, tab title=${tab.title}, last accessed=${lastAccessed}`,
        };
      });

      return {
        content: [paginationInfo, ...tabContent],
      };
    }
  );

  mcpServer.tool(
    "get-recent-browser-history",
    "Get the list of recent browser history (to get all, don't use searchQuery)",
    {
      browserId: browserIdSchema,
      searchQuery: z.string().optional(),
    },
    async ({ browserId, searchQuery }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const browserHistory = await browserApi.getBrowserRecentHistory(
        id,
        searchQuery
      );
      if (browserHistory.length > 0) {
        return {
          content: browserHistory.map((item) => {
            let lastVisited = "unknown";
            if (item.lastVisitTime) {
              lastVisited = dayjs(item.lastVisitTime).fromNow();
            }
            return {
              type: "text",
              text: `[${id}] url=${item.url}, title="${item.title}", lastVisitTime=${lastVisited}`,
            };
          }),
        };
      }
      const hint = searchQuery ? "Try without a searchQuery" : "";
      return {
        content: [{ type: "text", text: `[${id}] No history found. ${hint}` }],
      };
    }
  );

  mcpServer.tool(
    "get-tab-web-content",
    `
    Get the full text content of the webpage and the list of links in the webpage, by tab ID. 
    Use "offset" only for larger documents when the first call was truncated and if you require more content in order to assist the user.
  `,
    {
      browserId: browserIdSchema,
      tabId: z.number(),
      offset: z.number().default(0),
    },
    async ({ browserId, tabId, offset }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const content = await browserApi.getTabContent(id, tabId, offset);
      let links: { type: "text"; text: string }[] = [];
      if (offset === 0) {
        links = content.links.map((link: { text: string; url: string }) => ({
          type: "text",
          text: `Link text: ${link.text}, Link URL: ${link.url}`,
        }));
      }

      let text = content.fullText;
      let hint: { type: "text"; text: string }[] = [];
      if (content.isTruncated || offset > 0) {
        const rangeString = `${offset}-${offset + text.length}`;
        hint = [
          {
            type: "text",
            text:
              `The following text content is truncated due to size (includes character range ${rangeString} out of ${content.totalLength}). ` +
              "If you want to read characters beyond this range, please use the 'get-tab-web-content' tool with an offset. ",
          },
        ];
      }

      return {
        content: [...hint, { type: "text", text }, ...links],
      };
    }
  );

  mcpServer.tool(
    "reorder-browser-tabs",
    "Change the order of open browser tabs",
    {
      browserId: browserIdSchema,
      tabOrder: z.array(z.number()),
    },
    async ({ browserId, tabOrder }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const newOrder = await browserApi.reorderTabs(id, tabOrder);
      return {
        content: [
          { type: "text", text: `[${id}] Tabs reordered: ${newOrder.join(", ")}` },
        ],
      };
    }
  );

  mcpServer.tool(
    "find-highlight-in-browser-tab",
    "Find and highlight text in a browser tab (use a query phrase that exists in the web content)",
    {
      browserId: browserIdSchema,
      tabId: z.number(),
      queryPhrase: z.string(),
    },
    async ({ browserId, tabId, queryPhrase }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const noOfResults = await browserApi.findHighlight(
        id,
        tabId,
        queryPhrase
      );
      return {
        content: [
          {
            type: "text",
            text: `[${id}] Number of results found and highlighted in the tab: ${noOfResults}`,
          },
        ],
      };
    }
  );

  mcpServer.tool(
    "group-browser-tabs",
    "Organize opened browser tabs in a new tab group",
    {
      browserId: browserIdSchema,
      tabIds: z.array(z.number()),
      isCollapsed: z.boolean().default(false),
      groupColor: z
        .enum([
          "grey",
          "blue",
          "red",
          "yellow",
          "green",
          "pink",
          "purple",
          "cyan",
          "orange",
        ])
        .default("grey"),
      groupTitle: z.string().default("New Group"),
    },
    async ({ browserId, tabIds, isCollapsed, groupColor, groupTitle }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const groupId = await browserApi.groupTabs(
        id,
        tabIds,
        isCollapsed,
        groupColor,
        groupTitle
      );
      return {
        content: [
          {
            type: "text",
            text: `[${id}] Created tab group "${groupTitle}" with ${tabIds.length} tabs (group ID: ${groupId})`,
          },
        ],
      };
    }
  );

  mcpServer.tool(
    "evaluate-script-in-tab",
    "Evaluate a JavaScript function in a browser tab. The function must be JSON-serializable. Example function: () => document.title",
    {
      browserId: browserIdSchema,
      tabId: z.number(),
      function: z
        .string()
        .describe(
          'JavaScript function expression, e.g. "() => document.title" or "(selector) => document.querySelector(selector)?.innerText"'
        ),
      args: z
        .array(z.unknown())
        .optional()
        .describe("Optional arguments passed to the function"),
    },
    async ({ browserId, tabId, function: fn, args }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const result = await browserApi.evaluateScript(id, tabId, fn, args);
      if (
        result &&
        typeof result === "object" &&
        "__error" in result &&
        typeof (result as { __error?: string }).__error === "string"
      ) {
        return {
          content: [
            {
              type: "text",
              text: (result as { __error: string }).__error,
              isError: true,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "query-dom-in-tab",
    "Query DOM elements in a browser tab using a CSS selector. Modes: text (innerText of first match), html (outerHTML fragment), list (summary of all matches).",
    {
      browserId: browserIdSchema,
      tabId: z.number(),
      selector: z.string().describe("CSS selector, e.g. #main or .article h1"),
      mode: z
        .enum(["text", "html", "list"])
        .default("text")
        .describe("text=innerText, html=outerHTML, list=all matching elements"),
      limit: z
        .number()
        .default(20)
        .describe("Max elements returned in list mode"),
      maxHtmlLength: z
        .number()
        .default(5000)
        .describe("Max HTML characters per element in html/list modes"),
    },
    async ({ browserId, tabId, selector, mode, limit, maxHtmlLength }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const result = await browserApi.queryDom(
        id,
        tabId,
        selector,
        mode,
        limit,
        maxHtmlLength
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "get-console-messages-in-tab",
    "Read console.log/info/warn/error/debug messages from a browser tab. Installs a console interceptor on first use. Re-run after page navigation to capture logs on the new document.",
    {
      browserId: browserIdSchema,
      tabId: z.number(),
      clear: z
        .boolean()
        .default(false)
        .describe("Clear buffered console messages after reading"),
      level: z
        .enum(["log", "info", "warn", "error", "debug"])
        .optional()
        .describe("Filter by console level"),
      limit: z
        .number()
        .default(100)
        .describe("Maximum number of messages to return"),
    },
    async ({ browserId, tabId, clear, level, limit }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const result = await browserApi.getConsoleMessages(
        id,
        tabId,
        clear,
        level,
        limit
      );
      if (result.entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No console messages captured yet. Messages logged after this tool runs will appear here.",
            },
          ],
        };
      }
      return {
        content: result.entries.map((entry) => ({
          type: "text" as const,
          text: `[${entry.level}] ${entry.messages.map(String).join(" ")}`,
        })),
      };
    }
  );

  mcpServer.tool(
    "scroll-to-element-in-tab",
    "Scroll a browser tab so a CSS selector's first matching element is in view. Useful before capture-screenshot-in-tab to bring an off-screen area into the viewport.",
    {
      browserId: browserIdSchema,
      tabId: z.number(),
      selector: z.string().describe("CSS selector, e.g. #footer or .card:nth-child(2)"),
      block: z
        .enum(["start", "center", "end", "nearest"])
        .default("center")
        .describe("Vertical alignment of the element after scrolling"),
    },
    async ({ browserId, tabId, selector, block }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const result = await browserApi.scrollToElement(id, tabId, selector, block);
      if (!result.found) {
        return {
          content: [
            {
              type: "text",
              text: `[${id}] No element matched selector "${selector}"`,
              isError: true,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `[${id}] Scrolled to "${selector}". Viewport rect: x=${result.rect?.x}, y=${result.rect?.y}, width=${result.rect?.width}, height=${result.rect?.height}`,
          },
        ],
      };
    }
  );

  mcpServer.tool(
    "capture-screenshot-in-tab",
    "Take a screenshot of a browser tab. Without 'selector', captures the visible viewport. With 'selector', scrolls the matching element into view first and crops the screenshot to it — the most reliable way for an agent to inspect a specific area of a page.",
    {
      browserId: browserIdSchema,
      tabId: z.number(),
      selector: z
        .string()
        .optional()
        .describe("Optional CSS selector to scroll into view and crop the screenshot to"),
      format: z.enum(["png", "jpeg"]).default("png"),
      quality: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("JPEG quality 0-100 (ignored for png)"),
    },
    async ({ browserId, tabId, selector, format, quality }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const result = await browserApi.captureScreenshot(
        id,
        tabId,
        selector,
        format,
        quality
      );
      if (result.elementNotFound) {
        return {
          content: [
            {
              type: "text",
              text: `[${id}] No element matched selector "${selector}". Captured full viewport instead.`,
            },
            {
              type: "image",
              data: result.dataUrl,
              mimeType: result.mimeType,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "image",
            data: result.dataUrl,
            mimeType: result.mimeType,
          },
        ],
      };
    }
  );

  mcpServer.tool(
    "set-viewport-size-in-tab",
    "Resize the effective viewport of a browser tab to test responsive/mobile layouts. On Chrome this emulates the viewport via DevTools protocol (like the Device Toolbar) without touching the real browser window. On Firefox, which has no such API, it falls back to resizing the containing browser window, which affects other tabs in that window. Returns the size actually applied, which may differ slightly from the request. Call with 'reset: true' to restore normal behavior.",
    {
      browserId: browserIdSchema,
      tabId: z.number(),
      width: z.number().optional().describe("Viewport width in CSS pixels, e.g. 375 for iPhone"),
      height: z.number().optional().describe("Viewport height in CSS pixels, e.g. 667 for iPhone"),
      deviceScaleFactor: z
        .number()
        .optional()
        .describe("Device pixel ratio to emulate (Chrome only), e.g. 2 or 3 for a phone"),
      mobile: z
        .boolean()
        .optional()
        .describe("Emulate a mobile device (touch, mobile viewport meta handling; Chrome only)"),
      reset: z
        .boolean()
        .optional()
        .describe("Restore the tab/window to its normal, non-emulated size"),
    },
    async ({ browserId, tabId, width, height, deviceScaleFactor, mobile, reset }) => {
      const id = browserApi.resolveBrowserId(browserId);
      const result = await browserApi.setViewportSize(
        id,
        tabId,
        width,
        height,
        deviceScaleFactor,
        mobile,
        reset
      );
      return {
        content: [
          {
            type: "text",
            text: `[${id}] Viewport now ${result.width}x${result.height} (deviceScaleFactor=${result.deviceScaleFactor}, mobile=${result.mobile}, method=${result.method})`,
          },
        ],
      };
    }
  );

  return mcpServer;
}
