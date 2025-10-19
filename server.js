import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { nanoid } from "nanoid";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const app = express();
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const TRUST_PROXY = (process.env.TRUST_PROXY ?? "true") === "true";
const DATA_ROOT = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const DB_FILE = process.env.DATA_FILE ?? "visitors.db";
const DATA_DIR = path.dirname(path.join(DATA_ROOT, DB_FILE));
const DB_PATH = path.join(DATA_ROOT, DB_FILE);
const GEOLOOKUP = (process.env.GEOLOOKUP ?? "ipapi").toLowerCase(); // ipapi|off
const MAX_RECORDS = Math.max(100, Number.parseInt(process.env.MAX_RECORDS ?? "5000", 10));
const SESSION_MINUTES = Math.max(5, Number.parseInt(process.env.SESSION_MINUTES ?? "30", 10));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ADMIN_SECRET = process.env.ADMIN_PASSWORD_SECRET;
if (!ADMIN_SECRET) {
  throw new Error(
    "ADMIN_PASSWORD_SECRET is required. Run `npm run generate-secret` and export the value before starting the server." 
  );
}

const parts = ADMIN_SECRET.split(":");
if (parts.length !== 6 || parts[0] !== "scrypt") {
  throw new Error(
    "ADMIN_PASSWORD_SECRET must follow: scrypt:N:r:p:saltHex:hashHex"
  );
}
const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
const scryptParams = {
  N: Number.parseInt(nStr, 10),
  r: Number.parseInt(rStr, 10),
  p: Number.parseInt(pStr, 10)
};
if (!Number.isFinite(scryptParams.N) || !Number.isFinite(scryptParams.r) || !Number.isFinite(scryptParams.p)) {
  throw new Error("Invalid scrypt parameters in ADMIN_PASSWORD_SECRET");
}
const salt = Buffer.from(saltHex, "hex");
const storedHash = Buffer.from(hashHex, "hex");
if (salt.length < 16 || storedHash.length < 32) {
  throw new Error("Salt or hash in ADMIN_PASSWORD_SECRET is too short");
}

function verifyPassword(candidate) {
  if (typeof candidate !== "string" || candidate.length < 12) {
    return false;
  }
  const derived = crypto.scryptSync(candidate, salt, storedHash.length, scryptParams);
  return crypto.timingSafeEqual(derived, storedHash);
}

const sessions = new Map();
const SESSION_TTL_MS = SESSION_MINUTES * 60 * 1000;

function issueSession() {
  const token = crypto.randomBytes(48).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, expiresAt);
  return { token, expiresAt };
}

function authenticate(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt < now) {
      sessions.delete(token);
    }
  }
}, 60_000).unref();

const db = new Database(DB_PATH, { fileMustExist: false, timeout: 5000 });
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    ip TEXT,
    ua TEXT,
    page TEXT,
    referrer TEXT,
    tz TEXT,
    languages TEXT,
    screen TEXT,
    geo TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_visits_ip ON visits(ip);
`);

const insertVisit = db.prepare(`
  INSERT INTO visits (id, ts, ip, ua, page, referrer, tz, languages, screen, geo)
  VALUES (@id, @ts, @ip, @ua, @page, @referrer, @tz, @languages, @screen, @geo)
`);
const selectVisits = db.prepare(`
  SELECT id, ts, ip, ua, page, referrer, tz, languages, screen, geo
  FROM visits
  ORDER BY ts DESC
  LIMIT ?
`);
const countVisits = db.prepare("SELECT COUNT(1) as total FROM visits");
const pruneVisits = db.prepare(`
  DELETE FROM visits
  WHERE rowid IN (
    SELECT rowid FROM visits
    ORDER BY ts ASC, rowid ASC
    LIMIT ?
  )
`);

function pruneIfNeeded() {
  const total = countVisits.get().total;
  if (total <= MAX_RECORDS) return;
  const excess = total - MAX_RECORDS;
  pruneVisits.run(excess);
}

function getClientIp(req) {
  const hdr = req.headers;
  const xfwd = (hdr["x-forwarded-for"] || "").toString();
  const cf = hdr["cf-connecting-ip"];
  const real = hdr["x-real-ip"];
  const candidates = [
    cf && cf.toString(),
    xfwd && xfwd.split(",")[0].trim(),
    real && real.toString(),
    req.socket.remoteAddress
  ].filter(Boolean);
  return candidates[0] || "";
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("::ffff:")) {
    return isPrivateIp(ip.replace("::ffff:", ""));
  }
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) ||
    ip.startsWith("127.") ||
    ip.startsWith("fe80:") ||
    ip.startsWith("fd")
  );
}

async function geolocate(ip) {
  if (GEOLOOKUP === "off" || !ip || isPrivateIp(ip)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000).unref();
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const j = await res.json();
    return {
      country: j.country_name || null,
      country_code: j.country || null,
      region: j.region || null,
      city: j.city || null,
      org: j.org || j.org_name || null,
      asn: j.asn || null,
      latitude: j.latitude ?? null,
      longitude: j.longitude ?? null
    };
  } catch {
    return null;
  }
}

function sanitizeString(value, max = 1024) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

app.set("trust proxy", TRUST_PROXY);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "connect-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'"],
      "frame-ancestors": ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "8kb" }));
app.use(express.static(path.join(process.cwd(), "public"), { extensions: ["html"] }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

app.post("/api/login", loginLimiter, (req, res) => {
  const password = sanitizeString(req.body?.password ?? "", 256);
  if (!password) {
    return res.status(400).json({ ok: false, error: "Password required" });
  }
  if (!verifyPassword(password)) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  }
  const session = issueSession();
  return res.status(200).json({
    ok: true,
    token: session.token,
    expiresIn: Math.floor(SESSION_TTL_MS / 1000),
    expiresAt: session.expiresAt
  });
});

app.post("/api/logout", (req, res) => {
  const token = authenticate(req);
  if (token) {
    sessions.delete(token);
  }
  return res.status(204).send();
});

app.post("/api/track", trackLimiter, async (req, res) => {
  try {
    const ip = getClientIp(req);
    const ua = sanitizeString(req.headers["user-agent"]?.toString() ?? "", 1024);
    const now = new Date().toISOString();
    const consentedLanguages = Array.isArray(req.body?.languages)
      ? req.body.languages.map((lang) => sanitizeString(String(lang), 32)).filter(Boolean).slice(0, 10)
      : [];

    const payload = {
      id: nanoid(12),
      ts: now,
      ip,
      ua,
      page: sanitizeString(req.body?.page, 512),
      referrer: sanitizeString(req.body?.referrer, 512),
      tz: sanitizeString(req.body?.tz, 128),
      languages: JSON.stringify(consentedLanguages),
      screen: sanitizeString(req.body?.screen, 64),
      geo: null
    };

    const geo = await geolocate(ip);
    if (geo) {
      payload.geo = JSON.stringify(geo);
    }

    insertVisit.run(payload);
    pruneIfNeeded();

    res.status(201).json({ ok: true, id: payload.id });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message ?? "server error" });
  }
});

app.get("/api/visitors", (req, res) => {
  const token = authenticate(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  const limit = Number.parseInt((req.query.limit ?? "200").toString(), 10);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 200;
  const rows = selectVisits.all(safeLimit).map((row) => ({
    id: row.id,
    ts: row.ts,
    ip: row.ip,
    ua: row.ua,
    page: row.page,
    referrer: row.referrer,
    tz: row.tz,
    languages: row.languages ? JSON.parse(row.languages) : [],
    screen: row.screen,
    geo: row.geo ? JSON.parse(row.geo) : null
  }));
  res.json(rows);
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  return res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`Visitor console listening on http://localhost:${PORT}`);
});