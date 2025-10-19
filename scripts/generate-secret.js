#!/usr/bin/env node
import crypto from "node:crypto";

const params = {
  N: 16384,
  r: 8,
  p: 1
};

const suppliedPassphrase = process.argv[2] ? String(process.argv[2]) : null;
const passphrase = suppliedPassphrase ?? crypto.randomBytes(48).toString("base64url");

if (!suppliedPassphrase) {
  console.info("Generated random 384-bit passphrase. Supply your own as argv[2] to reuse a secret.");
}

const salt = crypto.randomBytes(16);
const derived = crypto.scryptSync(passphrase, salt, 64, params);

console.log("Passphrase:");
console.log(passphrase);
console.log("\nExport this as ADMIN_PASSWORD_SECRET:");
console.log(`scrypt:${params.N}:${params.r}:${params.p}:${salt.toString("hex")}:${derived.toString("hex")}`);
console.log("\nExample (PowerShell):");
console.log(`$env:ADMIN_PASSWORD_SECRET = \"scrypt:${params.N}:${params.r}:${params.p}:${salt.toString("hex")}:${derived.toString("hex")}\"`);
