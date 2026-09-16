import { browser } from "./browser";

const OFFSCREEN_URL = "offscreen.html";

export async function ensureOffscreenDocument(): Promise<void> {
  if (!browser.offscreen?.createDocument) {
    throw new Error("chrome.offscreen API is unavailable");
  }

  if (browser.runtime.getContexts) {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (contexts.some((ctx) => ctx.documentUrl?.endsWith(OFFSCREEN_URL))) {
      return;
    }
  }

  try {
    await browser.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["WORKERS"],
      justification:
        "Maintain a persistent WebSocket connection to the Tail MCP server",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Only a single offscreen document")) {
      return;
    }
    throw error;
  }
}
