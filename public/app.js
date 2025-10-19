// Client-side analytics for GitHub Pages (static hosting)
// All data stored in localStorage with client-side encryption

const STORAGE_KEY = "breda25_analytics_data";
const tableShell = document.getElementById("tableShell");
const badgeStatus = document.getElementById("badgeStatus");
const statusLine = document.getElementById("status");

// Storage functions (no encryption, no passphrase)
function saveVisits(visits) {
  try {
    const json = JSON.stringify(visits);
    localStorage.setItem(STORAGE_KEY, json);
    return true;
  } catch (e) {
    console.error("Failed to save visits:", e);
    return false;
  }
}

function loadVisits() {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return [];
    return JSON.parse(json);
  } catch (e) {
    console.error("Failed to load visits:", e);
    return [];
  }
}

// Analytics tracking (no passphrase, always save)
function trackVisit() {
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
    navigator.geolocation.getCurrentPosition(
      (position) => {
        visit.geo = {
          latitude: position.coords.latitude.toFixed(4),
          longitude: position.coords.longitude.toFixed(4),
          accuracy: Math.round(position.coords.accuracy)
        };
        saveVisitAndRender(visit);
      },
      () => saveVisitAndRender(visit),
      { timeout: 2000 }
    );
  } else {
    saveVisitAndRender(visit);
  }
}

function saveVisitAndRender(visit) {
  const visits = loadVisits();
  visits.unshift(visit);
  if (visits.length > 1000) visits.length = 1000;
  saveVisits(visits);
  render(visits);
}

// No lock state or authentication UI

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

function refreshData() {
  statusLine.textContent = "Loading...";
  const visits = loadVisits();
  render(visits);
}

function handleLock() {
  currentPassphrase = null;
  sessionStorage.removeItem("session_active");
  updateLockState(true);
  document.getElementById("password").value = "";
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";
}


// Event listeners (no auth, no lock)
document.getElementById("refresh").addEventListener("click", refreshData);
document.getElementById("limit").addEventListener("change", refreshData);
document.getElementById("search").addEventListener("input", refreshData);

// Initialize
trackVisit();
setInterval(refreshData, 30000);