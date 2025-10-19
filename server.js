import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";

const app = express();
const PORT = process.env.PORT || 3000;
const TRUST_PROXY = (process.env.TRUST_PROXY ?? "true") === "true"; // set to true if behind proxy/CDN
const DATA_DIR = path.join(process.cwd(), "data");
const STORE = path.join(DATA_DIR, "visitors.json");
const GEOLOOKUP = (process.env.GEOLOOKUP ?? "ipapi").toLowerCase(); // ipapi|off

// Ensure storage exists
if (!fssync.existsSync(DATA_DIR)) {
  fssync.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fssync.existsSync(STORE)) {
  fssync.writeFileSync(STORE, "[]", "utf8");
}

app.set("trust proxy", TRUST_PROXY);
app.use(cors()); // tighten origins in production
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(process.cwd(), "public"), { extensions: ["html"] }));

function getClientIp(req) {
  // Prefer well-known headers if behind proxy/CDN
  const hdr = req.headers;
  const xfwd = (hdr["x-forwarded-for"] || "").toString();
  const cf = hdr["cf-connecting-ip"];
  const real = hdr["x-real-ip"];
  return (
    (cf && cf.toString()) ||
    (xfwd && xfwd.split(",")[0].trim()) ||
    (real && real.toString()) ||
    req.socket.remoteAddress ||
    ""
  );
}

async function geolocate(ip) {
  if (GEOLOOKUP === "off") return null;
  try {
    // ipapi.co has a free JSON endpoint; do not abuse. Consider caching or turning off in prod.
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { timeout: 3000 });
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

async function readStore() {
  const buf = await fs.readFile(STORE, "utf8");
  return JSON.parse(buf);
}
async function writeStore(arr) {
  await fs.writeFile(STORE, JSON.stringify(arr, null, 2) + os.EOL, "utf8");
}

// Called by the page on load to record details
app.post("/api/track", async (req, res) => {
  try {
    const ip = getClientIp(req);
    const ua = (req.headers["user-agent"] || "").toString();
    const now = new Date().toISOString();

    const geo = await geolocate(ip);

    const payload = {
      id: nanoid(10),
      ts: now,
      ip,
      geo,                // may be null if lookup off/fails
      ua,
      page: req.body?.page || null,
      referrer: req.body?.referrer || null,
      tz: req.body?.tz || null,
      languages: req.body?.languages || [],
      screen: req.body?.screen || null
    };

    const arr = await readStore();
    arr.unshift(payload); // newest first
    // Optional: cap size
    const limit = Math.max(0, parseInt(process.env.MAX_RECORDS || "1000", 10));
    const trimmed = limit ? arr.slice(0, limit) : arr;
    await writeStore(trimmed);

    res.status(201).json({ ok: true, id: payload.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});

// List visitors (optionally limit=?)
app.get("/api/visitors", async (req, res) => {
  try {
    const all = await readStore();
    const limit = parseInt((req.query.limit ?? "200").toString(), 10);
    res.json(all.slice(0, isNaN(limit) ? 200 : limit));
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Visitor logger listening on http://localhost:${PORT}`);
});