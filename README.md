## Visitor Intelligence Console

Hardened dashboard that records every visit, writes telemetry into a single-file SQLite datastore, and exposes a GitHub-inspired operator console. All personally identifiable details are blurred until a valid passphrase unlocks the feed.

### Bootstrapping

1. Install dependencies
	```pwsh
	npm install
	```
2. Generate a secret (creates a random 384-bit passphrase by default)
	```pwsh
	npm run generate-secret
	```
	Export the printed `ADMIN_PASSWORD_SECRET` before starting the server. The passphrase is only shown once—store it in a secure vault.
3. (Optional) Trust proxy headers if you sit behind a load balancer:
	```pwsh
	$env:TRUST_PROXY = "true"  # defaults to true
	```
4. Launch
	```pwsh
	npm run dev
	```

### Security posture

- **Passphrase gating**: Operator access is protected by a scrypt-derived secret. Tokens are short-lived and stored in-memory with rolling expiry.
- **Single-file datastore**: Visitor records are stored in `data/visitors.db` (SQLite, WAL mode) so the entire history can be backed up or rotated atomically.
- **Threat-aware hygiene**: Requests are rate-limited, sanitised, and wrapped in Helmet’s defensive headers. Private-network IPs skip geolocation calls.
- **Redacted-by-default UI**: All rows remain blurred until the passphrase is accepted, preventing shoulder surfing during ops reviews.

Tune retention by setting `MAX_RECORDS` (default 5000) and `SESSION_MINUTES` (default 30). Override `DATA_DIR` and/or `DATA_FILE` to back the encrypted SQLite database by a remote-mounted path. Set `GEOLOOKUP=off` to disable outbound lookups entirely.

Deploy responsibly; add consent banners, retention policies, and encryption-at-rest according to your jurisdiction before going live.

