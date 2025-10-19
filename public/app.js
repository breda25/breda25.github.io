// Client-side analytics for GitHub Pages (static hosting)
// All data stored in localStorage with client-side encryption

const STORAGE_KEY = "breda25_analytics_data";
const PASSPHRASE_HASH_KEY = "breda25_passphrase_hash";

let isUnlocked = false;
let currentPassphrase = null;

const tableShell = document.getElementById("tableShell");
const badgeStatus = document.getElementById("badgeStatus");
const authHint = document.getElementById("authHint");
const statusLine = document.getElementById("status");

// Crypto utilities
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function deriveKey(passphrase, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(plaintext, passphrase) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encoder.encode(plaintext)
  );
  
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(ciphertext, passphrase) {
  try {
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const data = combined.slice(28);
    
    const key = await deriveKey(passphrase, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      data
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (e) {
    console.error("Decryption failed:", e);
    return null;
  }
}

// Storage functions
function getStoredHash() {
  return localStorage.getItem(PASSPHRASE_HASH_KEY);
}

async function setPassphraseHash(passphrase) {
  const hash = await hashPassword(passphrase);
  localStorage.setItem(PASSPHRASE_HASH_KEY, hash);
}

async function verifyPassphrase(passphrase) {
  const storedHash = getStoredHash();
  if (!storedHash) {
    // First time setup
    await setPassphraseHash(passphrase);
    return true;
  }
  const hash = await hashPassword(passphrase);
  return hash === storedHash;
}

async function saveVisits(visits) {
  if (!currentPassphrase) {
    console.error("No passphrase set");
    return false;
  }
  try {
    const json = JSON.stringify(visits);
    const encrypted = await encryptData(json, currentPassphrase);
    localStorage.setItem(STORAGE_KEY, encrypted);
    return true;
  } catch (e) {
    console.error("Failed to save visits:", e);
    return false;
  }
}

async function loadVisits() {
  if (!currentPassphrase) {
    return [];
  }
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY);
    if (!encrypted) {
      return [];
    }
    const decrypted = await decryptData(encrypted, currentPassphrase);
    if (!decrypted) {
      throw new Error("Decryption failed");
    }
    return JSON.parse(decrypted);
  } catch (e) {
    console.error("Failed to load visits:", e);
    return [];
  }
}

// Analytics tracking
async function trackVisit() {
  const visit = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ip: "Client-side tracking", // Can't get real IP from browser
    ua: navigator.userAgent,
    page: location.pathname + location.search,
    referrer: document.referrer || null,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: navigator.languages || [navigator.language].filter(Boolean),
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`,
    platform: navigator.platform,
    connection: navigator.connection ? {
      effectiveType: navigator.connection.effectiveType,
      downlink: navigator.connection.downlink,
      rtt: navigator.connection.rtt
    } : null
  };
  
  // Try to get approximate location from browser (requires permission)
  if (navigator.geolocation) {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2000 });
      });
      visit.geo = {
        latitude: position.coords.latitude.toFixed(4),
        longitude: position.coords.longitude.toFixed(4),
        accuracy: Math.round(position.coords.accuracy)
      };
    } catch (e) {
      // Geolocation denied or timed out
    }
  }
  
  // Only save if we have a passphrase (user has unlocked before)
  if (currentPassphrase || getStoredHash()) {
    // If locked, we need to queue this for later
    if (!currentPassphrase) {
      const queue = JSON.parse(sessionStorage.getItem("visit_queue") || "[]");
      queue.push(visit);
      sessionStorage.setItem("visit_queue", JSON.stringify(queue));
    } else {
      const visits = await loadVisits();
      visits.unshift(visit);
      // Keep last 1000 visits
      if (visits.length > 1000) {
        visits.length = 1000;
      }
      await saveVisits(visits);
    }
  }
}

// Process queued visits after unlock
async function processQueuedVisits() {
  const queue = JSON.parse(sessionStorage.getItem("visit_queue") || "[]");
  if (queue.length > 0 && currentPassphrase) {
    const visits = await loadVisits();
    visits.unshift(...queue);
    if (visits.length > 1000) {
      visits.length = 1000;
    }
    await saveVisits(visits);
    sessionStorage.removeItem("visit_queue");
  }
}

// UI functions
function updateLockState(locked) {
  isUnlocked = !locked;
  tableShell.classList.toggle("locked", locked);
  badgeStatus.textContent = locked ? "Lock engaged" : "Live feed";
  badgeStatus.style.color = locked ? "var(--muted)" : "var(--ok)";
  statusLine.textContent = locked ? "Locked" : "Ready";
  if (locked) {
    authHint.textContent = "Analytics data is protected. Enter passphrase to reveal.";
  }
}

function formatTimestamp(iso) {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return iso;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function render(visits) {
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";

  const query = (document.getElementById("search").value || "").trim().toLowerCase();
  const limitValue = document.getElementById("limit").value;
  
  let filtered = visits;
  
  if (query) {
    filtered = visits.filter((row) => {
      const haystack = [
        row.ip,
        row.geo?.country,
        row.geo?.city,
        row.ua,
        row.page,
        row.referrer,
        row.tz,
        (row.languages || []).join(","),
        row.screen,
        row.platform
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }
  
  if (limitValue !== "all") {
    const limit = parseInt(limitValue, 10);
    filtered = filtered.slice(0, limit);
  }

  for (const row of filtered) {
    const tr = document.createElement("tr");

    const tdTs = document.createElement("td");
    tdTs.className = "nowrap";
    tdTs.textContent = formatTimestamp(row.ts);
    tr.appendChild(tdTs);

    const tdVisitor = document.createElement("td");
    const visitorParts = [];
    if (row.ip) visitorParts.push(`<div class="ip">${escapeHtml(row.ip)}</div>`);
    if (row.geo) {
      const geoParts = [];
      if (row.geo.country) geoParts.push(escapeHtml(row.geo.country));
      if (row.geo.city) geoParts.push(escapeHtml(row.geo.city));
      if (row.geo.latitude) geoParts.push(`📍 ${row.geo.latitude}, ${row.geo.longitude}`);
      if (geoParts.length) {
        visitorParts.push(`<div class="small">${geoParts.join(" · ")}</div>`);
      }
    }
    tdVisitor.innerHTML = visitorParts.join("");
    tr.appendChild(tdVisitor);

    const tdDevice = document.createElement("td");
    tdDevice.innerHTML = `
      <div class="ua small">${escapeHtml(row.ua || "")}</div>
      ${row.screen ? `<div class="small">Screen: ${escapeHtml(row.screen)}</div>` : ""}
      ${row.platform ? `<div class="small">Platform: ${escapeHtml(row.platform)}</div>` : ""}
      ${row.connection ? `<div class="small">Connection: ${escapeHtml(row.connection.effectiveType || "unknown")}</div>` : ""}
    `;
    tr.appendChild(tdDevice);

    const tdPage = document.createElement("td");
    tdPage.innerHTML = `
      ${row.page ? `<div class="pill">Page</div> <span class="small">${escapeHtml(row.page)}</span>` : ""}
      ${row.referrer ? `<div class="pill" style="margin-top:4px;">Ref</div> <span class="small">${escapeHtml(row.referrer)}</span>` : ""}
    `;
    tr.appendChild(tdPage);

    const tdContext = document.createElement("td");
    tdContext.innerHTML = `
      ${row.tz ? `<div class="pill">TZ</div> <span class="small">${escapeHtml(row.tz)}</span>` : ""}
      ${row.languages?.length ? `<div class="pill" style="margin-top:4px;">Lang</div> <span class="small">${escapeHtml(row.languages.join(", "))}</span>` : ""}
    `;
    tr.appendChild(tdContext);

    tbody.appendChild(tr);
  }

  statusLine.textContent = `Showing ${filtered.length} of ${visits.length} visits`;
}

async function refreshData() {
  if (!isUnlocked || !currentPassphrase) {
    updateLockState(true);
    return;
  }
  
  try {
    statusLine.textContent = "Loading...";
    const visits = await loadVisits();
    await render(visits);
    updateLockState(false);
  } catch (err) {
    console.error("Failed to load data:", err);
    statusLine.innerHTML = '<span class="flash">Failed to load data</span>';
  }
}

function handleLock() {
  currentPassphrase = null;
  sessionStorage.removeItem("session_active");
  updateLockState(true);
  document.getElementById("password").value = "";
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";
}


// Event listeners
document.getElementById("refresh").addEventListener("click", refreshData);
document.getElementById("limit").addEventListener("change", refreshData);
document.getElementById("search").addEventListener("input", refreshData);
document.getElementById("lockBtn").addEventListener("click", handleLock);

document.getElementById("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("password").value.trim();
  
  if (!password) {
    authHint.innerHTML = '<span class="flash">Passphrase is required.</span>';
    return;
  }
  
  if (password.length < 12) {
    authHint.innerHTML = '<span class="flash">Passphrase must be at least 12 characters.</span>';
    return;
  }
  
  try {
    authHint.textContent = "Verifying...";
    const valid = await verifyPassphrase(password);
    
    if (!valid) {
      authHint.innerHTML = '<span class="flash">Invalid passphrase.</span>';
      return;
    }
    
    currentPassphrase = password;
    sessionStorage.setItem("session_active", "1");
    document.getElementById("password").value = "";
    authHint.innerHTML = '<span style="color: var(--ok);">✓ Access granted. Data is now visible.</span>';
    
    await processQueuedVisits();
    await refreshData();
  } catch (err) {
    console.error("Auth error:", err);
    authHint.innerHTML = '<span class="flash">Authentication failed.</span>';
    handleLock();
  }
});

// Initialize
(async () => {
  updateLockState(true);
  await trackVisit();
  
  // Auto-refresh if unlocked
  setInterval(() => {
    if (isUnlocked && currentPassphrase) {
      refreshData();
    }
  }, 30000);
})();