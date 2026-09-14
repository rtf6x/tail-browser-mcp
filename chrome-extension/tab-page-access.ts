import { browser } from "./browser";
import { isDomainInDenyList } from "./extension-config";

const MAX_HTML_LENGTH = 50_000;
const MAX_LIST_ITEMS = 100;
const MAX_CONSOLE_ENTRIES = 500;

export const CONSOLE_BUFFER_KEY = "__browserControlMcpConsoleLogs";
export const CONSOLE_INSTALLED_KEY = "__browserControlMcpConsoleInstalled";

export function getConsoleCaptureScript(): string {
  return `
(function () {
  if (window.${CONSOLE_INSTALLED_KEY}) return;
  window.${CONSOLE_INSTALLED_KEY} = true;
  window.${CONSOLE_BUFFER_KEY} = [];
  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    var original = console[level].bind(console);
    console[level] = function () {
      var serialized = [];
      for (var i = 0; i < arguments.length; i++) {
        var value = arguments[i];
        try {
          serialized.push(
            typeof value === "object" && value !== null
              ? JSON.parse(JSON.stringify(value))
              : String(value)
          );
        } catch (e) {
          serialized.push(String(value));
        }
      }
      window.${CONSOLE_BUFFER_KEY}.push({
        level: level,
        timestamp: Date.now(),
        messages: serialized,
      });
      if (window.${CONSOLE_BUFFER_KEY}.length > ${MAX_CONSOLE_ENTRIES}) {
        window.${CONSOLE_BUFFER_KEY}.shift();
      }
      original.apply(console, arguments);
    };
  });
})();
`;
}

export function validateFunctionSource(functionSource: string): void {
  const trimmed = functionSource.trim();
  if (
    !/^function\s*\(|^\([^)]*\)\s*=>|^async\s+function\s*\(|^async\s*\([^)]*\)\s*=>/.test(
      trimmed
    )
  ) {
    throw new Error(
      "Function must be a JavaScript function expression, e.g. () => document.title"
    );
  }
}

export function buildEvaluateScript(functionSource: string, args: unknown[]): string {
  validateFunctionSource(functionSource);
  const argsJson = JSON.stringify(args ?? []);
  return `
(function () {
  function serialize(value) {
    if (value === undefined) return { __undefined: true };
    return JSON.parse(JSON.stringify(value, function (_key, current) {
      if (typeof current === "bigint") return current.toString();
      if (typeof current === "function") return "[Function]";
      return current;
    }));
  }

  try {
    var fn = (${functionSource});
    var args = ${argsJson};
    var result = fn.apply(null, args);
    if (result && typeof result.then === "function") {
      return result.then(serialize).catch(function (error) {
        return { __error: error && error.message ? error.message : String(error) };
      });
    }
    return serialize(result);
  } catch (error) {
    return { __error: error && error.message ? error.message : String(error) };
  }
})();
`;
}

export type DomQueryMode = "text" | "html" | "list";

export function buildQueryDomScript(
  selector: string,
  mode: DomQueryMode,
  limit: number,
  maxHtmlLength: number
): string {
  const selectorJson = JSON.stringify(selector);
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIST_ITEMS);
  const effectiveHtmlLength = Math.min(Math.max(1, maxHtmlLength), MAX_HTML_LENGTH);

  if (mode === "text") {
    return `
(function () {
  var el = document.querySelector(${selectorJson});
  if (!el) return { found: false, matchCount: 0 };
  return {
    found: true,
    matchCount: document.querySelectorAll(${selectorJson}).length,
    innerText: el.innerText,
  };
})();
`;
  }

  if (mode === "html") {
    return `
(function () {
  var el = document.querySelector(${selectorJson});
  if (!el) return { found: false, matchCount: 0 };
  var html = el.outerHTML || "";
  var truncated = html.length > ${effectiveHtmlLength};
  if (truncated) html = html.substring(0, ${effectiveHtmlLength});
  return {
    found: true,
    matchCount: document.querySelectorAll(${selectorJson}).length,
    outerHTML: html,
    isTruncated: truncated,
    totalLength: (el.outerHTML || "").length,
  };
})();
`;
  }

  return `
(function () {
  var nodes = Array.from(document.querySelectorAll(${selectorJson})).slice(0, ${effectiveLimit});
  return {
    found: nodes.length > 0,
    matchCount: document.querySelectorAll(${selectorJson}).length,
    elements: nodes.map(function (el, index) {
      var html = el.outerHTML || "";
      var truncated = html.length > ${effectiveHtmlLength};
      if (truncated) html = html.substring(0, ${effectiveHtmlLength});
      return {
        index: index,
        tagName: el.tagName,
        id: el.id || null,
        className: el.className || null,
        innerText: (el.innerText || "").substring(0, 500),
        outerHTML: html,
        isHtmlTruncated: truncated,
      };
    }),
  };
})();
`;
}

export function buildGetConsoleMessagesScript(
  clear: boolean,
  level: string | undefined,
  limit: number
): string {
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_CONSOLE_ENTRIES);
  const levelJson = level ? JSON.stringify(level) : "null";
  const clearFlag = clear ? "true" : "false";

  return `
(function () {
  var logs = window.${CONSOLE_BUFFER_KEY} || [];
  var levelFilter = ${levelJson};
  if (levelFilter) {
    logs = logs.filter(function (entry) { return entry.level === levelFilter; });
  }
  var limited = logs.slice(-${effectiveLimit});
  if (${clearFlag}) {
    window.${CONSOLE_BUFFER_KEY} = [];
  }
  return {
    entries: limited,
    totalBuffered: (window.${CONSOLE_BUFFER_KEY} || []).length,
  };
})();
`;
}

export function buildFindHighlightScript(queryPhrase: string): string {
  const queryJson = JSON.stringify(queryPhrase);
  return `
(function () {
  var query = ${queryJson};
  var body = document.body;
  if (!body || !query) return 0;
  var text = body.innerText || "";
  var count = 0;
  var idx = 0;
  while ((idx = text.indexOf(query, idx)) !== -1) {
    count++;
    idx += query.length;
  }
  if (count > 0 && typeof window.find === "function") {
    window.find(query, false, false, false, false, false, false);
  }
  return count;
})();
`;
}

export function buildTabContentScript(offset: number, maxLength: number): string {
  return `
(function () {
  function getLinks() {
    var linkElements = document.querySelectorAll("a[href]");
    return Array.from(linkElements).map(function (el) {
      return {
        url: el.href,
        text: el.innerText.trim() || el.getAttribute("aria-label") || el.getAttribute("title") || "",
      };
    }).filter(function (link) {
      return link.text !== "" && link.url.startsWith("https://") && link.url.indexOf("#") === -1;
    });
  }

  function getTextContent() {
    var isTruncated = false;
    var text = (document.body ? document.body.innerText : "").substring(${Number(offset) || 0});
    if (text.length > ${maxLength}) {
      text = text.substring(0, ${maxLength});
      isTruncated = true;
    }
    return { text: text, isTruncated: isTruncated };
  }

  var textContent = getTextContent();
  return {
    links: getLinks(),
    fullText: textContent.text,
    isTruncated: textContent.isTruncated,
    totalLength: document.body ? document.body.innerText.length : 0,
  };
})();
`;
}

export type ScrollBlockPosition = "start" | "center" | "end" | "nearest";

export function buildScrollToElementScript(
  selector: string,
  block: ScrollBlockPosition
): string {
  const selectorJson = JSON.stringify(selector);
  const blockJson = JSON.stringify(block);
  return `
(function () {
  var el = document.querySelector(${selectorJson});
  if (!el) return { found: false };
  el.scrollIntoView({ block: ${blockJson}, inline: "nearest" });
  var rect = el.getBoundingClientRect();
  return {
    found: true,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    devicePixelRatio: window.devicePixelRatio || 1,
  };
})();
`;
}

async function checkForUrlPermission(url: string | undefined): Promise<void> {
  if (!url) {
    throw new Error("Tab has no URL — cannot access page content");
  }

  const origin = new URL(url).origin;
  const granted = await browser.permissions.contains({
    origins: [`${origin}/*`],
  });

  if (!granted) {
    const optionsUrl = browser.runtime.getURL("options.html");
    const urlWithParams = `${optionsUrl}?requestUrl=${encodeURIComponent(url)}`;
    await browser.tabs.create({ url: urlWithParams });
    throw new Error(
      `The user has not yet granted permission to access the domain "${origin}". A dialog is now being opened to request permission. If the user grants permission, you can try the request again.`
    );
  }
}

export async function ensureTabPageAccess(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await browser.tabs.get(tabId);
  if (tab.url && (await isDomainInDenyList(tab.url))) {
    throw new Error("Domain in tab URL is in the deny list");
  }
  await checkForUrlPermission(tab.url);
  return tab;
}

async function runScriptInTab<T>(tabId: number, source: string): Promise<T> {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (code: string) => {
      // eslint-disable-next-line no-eval
      return eval(code);
    },
    args: [source],
  });
  return injection?.result as T;
}

export async function executeInTab<T>(tabId: number, code: string): Promise<T> {
  await ensureTabPageAccess(tabId);
  const result = await runScriptInTab<T>(tabId, code);
  if (result !== undefined && typeof result === "object" && result !== null && "then" in result) {
    return await (result as Promise<T>);
  }
  return result;
}

export async function installConsoleCapture(tabId: number): Promise<void> {
  await executeInTab(tabId, getConsoleCaptureScript());
}
