/**
 * Options page script for Tail MCP extension
 */
import {
  AVAILABLE_TOOLS,
  getAllToolSettings,
  setToolEnabled,
  getDomainDenyList,
  setDomainDenyList,
  getWsUrls,
  setWsUrls,
  getBrowserId,
  getBrowserLabel,
  setBrowserIdentity,
  getAuditLog,
  clearAuditLog,
  getToolNameById,
} from "./extension-config";
import {
  hostPermissionsForWsUrls,
  parseWsUrlList,
} from "@tail-browser-mcp/common/ws-endpoints";


interface PermissionModalHandlers {
  handleGrant: () => void;
  handleCancel: () => void;
  grantBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
}

let activePermissionHandlers: PermissionModalHandlers | undefined;
const toolSettingsContainer = document.getElementById(
  "tool-settings-container"
) as HTMLDivElement;
const domainDenyListTextarea = document.getElementById(
  "domain-deny-list"
) as HTMLTextAreaElement;
const saveDomainListsButton = document.getElementById(
  "save-domain-lists"
) as HTMLButtonElement;
const domainStatusElement = document.getElementById(
  "domain-status"
) as HTMLDivElement;
const wsUrlsInput = document.getElementById("ws-urls-input") as HTMLInputElement;
const saveWsUrlsButton = document.getElementById("save-ws-urls") as HTMLButtonElement;
const wsUrlsStatusElement = document.getElementById("ws-urls-status") as HTMLDivElement;
const browserIdInput = document.getElementById("browser-id-input") as HTMLInputElement;
const browserLabelInput = document.getElementById("browser-label-input") as HTMLInputElement;
const saveBrowserIdButton = document.getElementById("save-browser-id") as HTMLButtonElement;
const browserIdStatusElement = document.getElementById("browser-id-status") as HTMLDivElement;
const auditLogContainer = document.getElementById("audit-log-container") as HTMLDivElement;
const clearAuditLogButton = document.getElementById("clear-audit-log") as HTMLButtonElement;
const auditLogStatusElement = document.getElementById("audit-log-status") as HTMLDivElement;

/**
 * Creates the tool settings UI
 */
async function createToolSettingsUI() {
  const toolSettings = await getAllToolSettings();

  // Clear existing content
  toolSettingsContainer.innerHTML = "";

  // Create a toggle switch for each tool
  AVAILABLE_TOOLS.forEach((tool) => {
    const isEnabled = toolSettings[tool.id] !== false; // Default to true if not set

    const toolRow = document.createElement("div");
    toolRow.className = "tool-row";

    const labelContainer = document.createElement("div");
    labelContainer.className = "tool-label-container";

    const toolName = document.createElement("div");
    toolName.className = "tool-name";
    toolName.textContent = tool.name;

    const toolDescription = document.createElement("div");
    toolDescription.className = "tool-description";
    toolDescription.textContent = tool.description;

    labelContainer.appendChild(toolName);
    labelContainer.appendChild(toolDescription);

    const toggleContainer = document.createElement("label");
    toggleContainer.className = "toggle-switch";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isEnabled;
    checkbox.dataset.toolId = tool.id;
    checkbox.addEventListener("change", handleToolToggle);

    const slider = document.createElement("span");
    slider.className = "slider";

    toggleContainer.appendChild(checkbox);
    toggleContainer.appendChild(slider);

    toolRow.appendChild(labelContainer);
    toolRow.appendChild(toggleContainer);

    toolSettingsContainer.appendChild(toolRow);
  });
}

/**
 * Handles toggling a tool on/off
 */
async function handleToolToggle(event: Event) {
  const checkbox = event.target as HTMLInputElement;
  const toolId = checkbox.dataset.toolId;
  const isEnabled = checkbox.checked;

  if (!toolId) {
    console.error("Tool ID not found");
    return;
  }

  try {
    await setToolEnabled(toolId, isEnabled);
    // No status message displayed
  } catch (error) {
    console.error("Error saving tool setting:", error);

    // Revert the checkbox state
    checkbox.checked = !isEnabled;
  }
}

/**
 * Loads the domain lists from storage and displays them
 */
async function loadDomainLists() {
  try {
    // Load deny list
    const denyList = await getDomainDenyList();
    domainDenyListTextarea.value = denyList.join("\n");
  } catch (error) {
    console.error("Error loading domain lists:", error);
    domainStatusElement.textContent =
      "Error loading domain lists. Please check console for details.";
    domainStatusElement.style.color = "red";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Saves the domain lists to storage
 */
async function saveDomainLists(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }

  try {
    // Parse deny list (split by newlines and filter out empty lines)
    const denyListText = domainDenyListTextarea.value.trim();
    const denyList = denyListText
      ? denyListText
          .split("\n")
          .map((domain) => domain.trim())
          .filter(Boolean)
      : [];

    // Save to storage
    await setDomainDenyList(denyList);

    // Show success message
    domainStatusElement.textContent = "Domain deny list saved successfully!";
    domainStatusElement.style.color = "#4caf50";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  } catch (error) {
    console.error("Error saving domain lists:", error);
    domainStatusElement.textContent = "Failed to save domain lists";
    domainStatusElement.style.color = "red";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Loads browser ID and label from storage
 */
async function loadBrowserIdentity() {
  try {
    browserIdInput.value = await getBrowserId();
    browserLabelInput.value = (await getBrowserLabel()) ?? "";
  } catch (error) {
    console.error("Error loading browser ID:", error);
    browserIdStatusElement.textContent =
      "Error loading browser ID. Please check console for details.";
    browserIdStatusElement.style.color = "red";
  }
}

/**
 * Saves browser ID and label; reloads extension to re-register with MCP server
 */
async function saveBrowserIdentity(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }

  try {
    const browserId = browserIdInput.value.trim();
    const label = browserLabelInput.value.trim();
    await setBrowserIdentity(browserId, label || undefined);
    browser.runtime.reload();
  } catch (error) {
    console.error("Error saving browser ID:", error);
    browserIdStatusElement.textContent =
      error instanceof Error ? error.message : "Failed to save browser ID";
    browserIdStatusElement.style.color = "red";
    setTimeout(() => {
      browserIdStatusElement.textContent = "";
      browserIdStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Loads WebSocket URLs from storage and displays them
 */
async function loadWsUrls() {
  try {
    const wsUrls = await getWsUrls();
    wsUrlsInput.value = wsUrls.join("\n");
  } catch (error) {
    console.error("Error loading WebSocket URLs:", error);
    wsUrlsStatusElement.textContent =
      "Error loading WebSocket URLs. Please check console for details.";
    wsUrlsStatusElement.style.color = "red";
    setTimeout(() => {
      wsUrlsStatusElement.textContent = "";
      wsUrlsStatusElement.style.color = "";
    }, 3000);
  }
}

async function ensureHostPermissions(wsUrls: string[]): Promise<void> {
  const origins = hostPermissionsForWsUrls(wsUrls).filter(
    (origin) =>
      !origin.includes("127.0.0.1") && !origin.includes("localhost")
  );
  if (origins.length === 0) {
    return;
  }

  const granted = await browser.permissions.request({ origins });
  if (!granted) {
    throw new Error(
      "Host permission is required to reach the MCP server at a remote address."
    );
  }
}

/**
 * Saves WebSocket URLs to storage
 */
async function saveWsUrls(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }

  try {
    const wsUrls = parseWsUrlList(wsUrlsInput.value);
    await ensureHostPermissions(wsUrls);
    await setWsUrls(wsUrls);
    browser.runtime.reload();
  } catch (error) {
    console.error("Error saving WebSocket URLs:", error);
    wsUrlsStatusElement.textContent =
      error instanceof Error ? error.message : "Failed to save WebSocket URLs";
    wsUrlsStatusElement.style.color = "red";
    setTimeout(() => {
      wsUrlsStatusElement.textContent = "";
      wsUrlsStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Loads the audit log from storage and displays it
 */
async function loadAuditLog() {
  try {
    const auditLog = await getAuditLog();
    
    // Clear existing content
    auditLogContainer.innerHTML = "";
    
    if (auditLog.length === 0) {
      // Show empty state
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "audit-log-empty";
      emptyDiv.textContent = "No tool usage recorded yet.";
      auditLogContainer.appendChild(emptyDiv);
      return;
    }
    
    // Create table
    const table = document.createElement("table");
    table.className = "audit-log-table";
    
    // Create header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    
    const headers = ["Tool", "Timestamp", "Domain"];
    headers.forEach(headerText => {
      const th = document.createElement("th");
      th.textContent = headerText;
      headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create body
    const tbody = document.createElement("tbody");
    
    auditLog.forEach(entry => {
      const row = document.createElement("tr");
      
      // Tool name
      const toolCell = document.createElement("td");
      toolCell.textContent = getToolNameById(entry.toolId);
      row.appendChild(toolCell);
      
      // Timestamp
      const timestampCell = document.createElement("td");
      timestampCell.className = "audit-log-timestamp";
      const date = new Date(entry.timestamp);
      timestampCell.textContent = date.toLocaleString();
      row.appendChild(timestampCell);
      
      // URL Domain
      const urlCell = document.createElement("td");
      urlCell.className = "audit-log-url";
      if (entry.url) {
        // Show only the domain part of the URL
        try {
          const urlObj = new URL(entry.url);
          urlCell.textContent = urlObj.hostname;
        } catch (e) {
          console.error("Invalid URL in audit log entry:", e);
          urlCell.textContent = "Invalid URL";
        }
      } else {
        urlCell.textContent = "-";
      }
      row.appendChild(urlCell);
      
      tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    auditLogContainer.appendChild(table);
    
  } catch (error) {
    console.error("Error loading audit log:", error);
    auditLogContainer.innerHTML = '<div class="audit-log-empty">Error loading audit log. Please check console for details.</div>';
  }
}

/**
 * Clears the audit log
 */
async function handleClearAuditLog(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }

  try {
    await clearAuditLog();
    
    // Reload the audit log display
    await loadAuditLog();
    
    // Show success message
    auditLogStatusElement.textContent = "Audit log cleared successfully!";
    auditLogStatusElement.style.color = "#4caf50";
    setTimeout(() => {
      auditLogStatusElement.textContent = "";
      auditLogStatusElement.style.color = "";
    }, 3000);
  } catch (error) {
    console.error("Error clearing audit log:", error);
    auditLogStatusElement.textContent = "Failed to clear audit log";
    auditLogStatusElement.style.color = "red";
    setTimeout(() => {
      auditLogStatusElement.textContent = "";
      auditLogStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Initializes the collapsible sections
 */
function initializeCollapsibleSections() {
  const sectionHeaders = document.querySelectorAll(".section-container > h2");

  sectionHeaders.forEach((header) => {
    // Add click event listener to toggle section visibility
    header.addEventListener("click", (event) => {
      event.preventDefault();

      // Toggle the collapsed class on the header
      header.classList.toggle("collapsed");

      // Toggle the collapsed class on the section content
      const sectionContent = header.nextElementSibling as HTMLElement;
      sectionContent.classList.toggle("collapsed");
    });
  });
}

function showPermissionRequest(url: string) {
  const domain = new URL(url).hostname;
  const origin = new URL(url).origin;

  // Show the modal and hide the main content
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  const domainElement = document.getElementById("permission-domain") as HTMLDivElement;
  const grantBtn = document.getElementById("grant-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;
  const permissionText = document.getElementById("permission-text") as HTMLParagraphElement;

  // Set the domain in the modal
  domainElement.textContent = domain;
  
  // Update permission text for URL permission
  permissionText.textContent = "This will allow the extension to interact with pages on this domain as requested by the MCP server.";

  // Show modal and blur main content
  modal.classList.remove("hidden");
  mainContent.classList.add("modal-open");

  // Handle grant permission button click
  const handleGrant = async () => {
    try {
      const granted = await browser.permissions.request({
        origins: [`${origin}/*`],
      });

      if (granted) {
        // Permission granted, close the window or redirect back
        window.close();
      } else {
        // Permission denied, hide modal and show main content
        hidePermissionModal();
      }
    } catch (error) {
      console.error("Error requesting permission:", error);
      hidePermissionModal();
    }
  };

  // Handle cancel button click
  const handleCancel = () => {
    hidePermissionModal();
  };

  // Add event listeners
  grantBtn.addEventListener("click", handleGrant);
  cancelBtn.addEventListener("click", handleCancel);

  // Store references to remove listeners later
  activePermissionHandlers = {
    handleGrant,
    handleCancel,
    grantBtn,
    cancelBtn
  };
}

function showOriginPermissionRequest(originPattern: string) {
  // Show the modal and hide the main content
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  const domainElement = document.getElementById("permission-domain") as HTMLDivElement;
  const grantBtn = document.getElementById("grant-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;
  const permissionText = document.getElementById("permission-text") as HTMLParagraphElement;

  // Set the pattern in the modal
  domainElement.textContent = "All websites";

  // Explain why the broad permission is needed
  permissionText.textContent = "Firefox requires access to all websites to take tab screenshots (capture-screenshot-in-tab), even for a page you've already approved individually. This will allow that tool to work.";

  // Show modal and blur main content
  modal.classList.remove("hidden");
  mainContent.classList.add("modal-open");

  // Handle grant permission button click
  const handleGrant = async () => {
    try {
      const granted = await browser.permissions.request({
        origins: [originPattern],
      });

      if (granted) {
        // Permission granted, close the window or redirect back
        window.close();
      } else {
        // Permission denied, hide modal and show main content
        hidePermissionModal();
      }
    } catch (error) {
      console.error("Error requesting permission:", error);
      hidePermissionModal();
    }
  };

  // Handle cancel button click
  const handleCancel = () => {
    hidePermissionModal();
  };

  // Add event listeners
  grantBtn.addEventListener("click", handleGrant);
  cancelBtn.addEventListener("click", handleCancel);

  // Store references to remove listeners later
  activePermissionHandlers = {
    handleGrant,
    handleCancel,
    grantBtn,
    cancelBtn
  };
}

function showGlobalPermissionRequest(permissions: string[]) {
  // Show the modal and hide the main content
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  const domainElement = document.getElementById("permission-domain") as HTMLDivElement;
  const grantBtn = document.getElementById("grant-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;
  const permissionText = document.getElementById("permission-text") as HTMLParagraphElement;

  // Set the permissions in the modal
  domainElement.textContent = permissions.join(", ");
  
  // Update permission text for global permissions
  permissionText.textContent = "This will allow the extension to use these browser capabilities as requested by the MCP server.";

  // Show modal and blur main content
  modal.classList.remove("hidden");
  mainContent.classList.add("modal-open");

  // Handle grant permission button click
  const handleGrant = async () => {
    try {
      const granted = await browser.permissions.request({
        permissions: permissions as browser.permissions.Permissions["permissions"],
      });

      if (granted) {
        // Permission granted, close the window or redirect back
        window.close();
      } else {
        // Permission denied, hide modal and show main content
        hidePermissionModal();
      }
    } catch (error) {
      console.error("Error requesting permission:", error);
      hidePermissionModal();
    }
  };

  // Handle cancel button click
  const handleCancel = () => {
    hidePermissionModal();
  };

  // Add event listeners
  grantBtn.addEventListener("click", handleGrant);
  cancelBtn.addEventListener("click", handleCancel);

  // Store references to remove listeners later
  activePermissionHandlers = {
    handleGrant,
    handleCancel,
    grantBtn,
    cancelBtn
  };
}

function hidePermissionModal() {
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;

  // Hide modal and restore main content
  modal.classList.add("hidden");
  mainContent.classList.remove("modal-open");

  // Clean up event listeners
  const handlers = activePermissionHandlers;
  if (handlers) {
    handlers.grantBtn.removeEventListener("click", handlers.handleGrant);
    handlers.cancelBtn.removeEventListener("click", handlers.handleCancel);
    activePermissionHandlers = undefined;
  }
}

// Initialize the page
saveDomainListsButton.addEventListener("click", saveDomainLists);
saveWsUrlsButton.addEventListener("click", saveWsUrls);
saveBrowserIdButton.addEventListener("click", saveBrowserIdentity);
clearAuditLogButton.addEventListener("click", handleClearAuditLog);
document.addEventListener("DOMContentLoaded", () => {
  const versionEl = document.getElementById("extension-version");
  if (versionEl) {
    versionEl.textContent = `(v${browser.runtime.getManifest().version})`;
  }
  loadBrowserIdentity();
  createToolSettingsUI();
  loadDomainLists();
  loadWsUrls();
  loadAuditLog();
  initializeCollapsibleSections();

  // Ensure modal is hidden by default
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  modal.classList.add("hidden");
  mainContent.classList.remove("modal-open");

  const params = new URLSearchParams(window.location.search);
  const requestUrl = params.get("requestUrl");
  const requestOrigin = params.get("requestOrigin");
  const requestPermissions = params.get("requestPermissions");

  if (requestUrl) {
    // Show UI for requesting permission for this specific URL
    showPermissionRequest(requestUrl);
  } else if (requestOrigin) {
    // Show UI for requesting the broad host permission tab screenshots need
    showOriginPermissionRequest(requestOrigin);
  } else if (requestPermissions) {
    // Show UI for requesting global permissions
    try {
      const permissions = JSON.parse(decodeURIComponent(requestPermissions));
      showGlobalPermissionRequest(permissions);
    } catch (error) {
      console.error("Error parsing requestPermissions:", error);
    }
  }

  // Add interval to refresh the audit log every 5 seconds:
  setInterval(() => {
    loadAuditLog();
  }, 5000);
});
