const api = location.origin;
let authToken = sessionStorage.getItem("visitor_console_token") || null;

const tableShell = document.getElementById("tableShell");
const badgeStatus = document.getElementById("badgeStatus");
const authHint = document.getElementById("authHint");
const statusLine = document.getElementById("status");

function formatExpiry(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "soon";
  }
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function updateLockState(isLocked) {
  tableShell.classList.toggle("locked", isLocked);
  badgeStatus.textContent = isLocked ? "Lock engaged" : "Live feed";
  badgeStatus.style.color = isLocked ? "var(--muted)" : "var(--ok)";
  statusLine.textContent = isLocked ? "Locked" : "Streaming";
  if (isLocked) {
    authHint.textContent = "Telemetry is redacted until authentication succeeds.";
  }
}

function render(rows) {
  const tbody = document.querySelector("#tbl tbody");
  tbody.innerHTML = "";

  const query = (document.getElementById("search").value || "").trim().toLowerCase();
  const filtered = !query
    ? rows
    : rows.filter((row) => {
        const haystack = [
          row.ip,
          row.geo?.country,
          row.geo?.country_code,
          row.geo?.region,
          row.geo?.city,
          row.geo?.org,
          row.geo?.asn,
          row.ua,
          row.page,
          row.referrer,
          row.tz,
          (row.languages || []).join(","),
          row.screen
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });

  for (const row of filtered) {
    const tr = document.createElement("tr");

    const tdTs = document.createElement("td");
    tdTs.textContent = new Date(row.ts).toISOString().replace("T", " ").replace("Z", "Z");
    tr.appendChild(tdTs);

    const tdIp = document.createElement("td");
    tdIp.innerHTML = `
      <div class="ip">${row.ip || ""}</div>
      <div class="meta">
        ${row.geo?.country ? `<span>${row.geo.country}</span>` : ""}
        ${row.geo?.region ? `<span>${row.geo.region}</span>` : ""}
        ${row.geo?.city ? `<span>${row.geo.city}</span>` : ""}
        ${row.geo?.org ? `<span class="pill">${row.geo.org}</span>` : ""}
      </div>`;
    tr.appendChild(tdIp);

    const tdUa = document.createElement("td");
    tdUa.innerHTML = `
      <div class="ua">${row.ua || ""}</div>
      <div class="small">${row.screen ? `Viewport: ${row.screen}` : ""}</div>`;
    tr.appendChild(tdUa);

    const tdPage = document.createElement("td");
    tdPage.innerHTML = `
      ${row.page ? `<div class="pill">Page</div> <span class="small">${row.page}</span>` : ""}
      ${row.referrer ? `<div class="pill" style="margin-top:6px;">Ref</div> <span class="small">${row.referrer}</span>` : ""}`;
    tr.appendChild(tdPage);

    const tdClient = document.createElement("td");
    tdClient.innerHTML = `
      ${row.tz ? `<div class="pill">TZ</div> <span class="small">${row.tz}</span>` : ""}
      ${row.languages?.length ? `<div class="pill" style="margin-top:6px;">Lang</div> <span class="small">${row.languages.join(", ")}</span>` : ""}`;
    tr.appendChild(tdClient);

    tbody.appendChild(tr);
  }

  statusLine.textContent = `Showing ${filtered.length} of ${rows.length}`;
}

async function loadVisitors() {
  if (!authToken) {
    updateLockState(true);
    return;
  }
  try {
    const limit = document.getElementById("limit").value;
    statusLine.textContent = "Decrypting…";
    const res = await fetch(`${api}/api/visitors?limit=${encodeURIComponent(limit)}`, {
      headers: {
        Authorization: `Bearer ${authToken}`
      },
      cache: "no-store"
    });
    if (res.status === 401) {
      handleUnauthorised();
      return;
    }
    if (!res.ok) throw new Error("Request failed");
    const data = await res.json();
    render(Array.isArray(data) ? data : []);
    updateLockState(false);
  } catch (err) {
    console.error("loadVisitors", err);
    statusLine.innerHTML = '<span class="flash">Failed to load telemetry</span>';
  }
}

function handleUnauthorised() {
  authToken = null;
  sessionStorage.removeItem("visitor_console_token");
  updateLockState(true);
  authHint.innerHTML = '<span class="flash">Authentication expired.</span> Re-enter the operator passphrase.';
}

async function attemptLogin(password) {
  const res = await fetch(`${api}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });
  if (!res.ok) {
    throw new Error(res.status === 401 ? "Unauthorized" : "Login failed");
  }
  return res.json();
}

async function trackVisit() {
  const body = {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: navigator.languages || [navigator.language].filter(Boolean),
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`,
    referrer: document.referrer || null,
    page: location.pathname + location.search
  };
  try {
    await fetch(`${api}/api/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      keepalive: true
    });
  } catch (err) {
    console.warn("trackVisit failed", err);
  }
}

document.getElementById("refresh").addEventListener("click", loadVisitors);
document.getElementById("limit").addEventListener("change", loadVisitors);
document.getElementById("search").addEventListener("input", loadVisitors);
document.getElementById("lockBtn").addEventListener("click", () => {
  handleUnauthorised();
});

document.getElementById("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("password").value;
  if (!password) {
    authHint.innerHTML = '<span class="flash">Passphrase is required.</span>';
    return;
  }
  try {
    const payload = await attemptLogin(password);
    authToken = payload.token;
    sessionStorage.setItem("visitor_console_token", authToken);
    document.getElementById("password").value = "";
  const expiryValue = Number(payload.expiresAt);
  authHint.innerHTML = `Access granted. Token expires at <strong>${formatExpiry(expiryValue)}</strong>.`;
    await loadVisitors();
  } catch (err) {
    console.error("login error", err);
    authHint.innerHTML = '<span class="flash">Invalid passphrase.</span>';
    handleUnauthorised();
  }
});

(async () => {
  updateLockState(!authToken);
  await trackVisit();
  if (authToken) {
    await loadVisitors();
  }
  setInterval(() => {
    if (authToken) {
      loadVisitors();
    }
  }, 20000);
})();
