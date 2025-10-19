## Analytics Dashboard (GitHub Pages Edition)## Visitor Intelligence Console



Privacy-focused visitor analytics dashboard designed for GitHub Pages static hosting. All data is stored **locally in your browser** with AES-256-GCM encryption, protected by a strong passphrase.Hardened dashboard that records every visit, writes telemetry into a single-file SQLite datastore, and exposes a GitHub-inspired operator console. All personally identifiable details are blurred until a valid passphrase unlocks the feed.



### Features### Bootstrapping



- 🔒 **Client-side encryption** - All analytics data encrypted with AES-256-GCM1. Install dependencies

- 🎯 **Passphrase protection** - Minimum 12-character passphrase required	```pwsh

- 👁️ **Blur-by-default** - Data stays blurred until authenticated	npm install

- 📊 **Comprehensive tracking** - Device, timing, referrer, location (with permission)	```

- 🎨 **GitHub-inspired UI** - Clean, professional minimalist design2. Generate a secret (creates a random 384-bit passphrase by default)

- 💾 **Local storage** - Up to 1000 visits stored in encrypted localStorage	```pwsh

- 🚫 **No server required** - Works entirely on GitHub Pages	npm run generate-secret

	```

### Quick Start	Export the printed `ADMIN_PASSWORD_SECRET` before starting the server. The passphrase is only shown once—store it in a secure vault.

3. (Optional) Trust proxy headers if you sit behind a load balancer:

1. **Clone and deploy**	```pwsh

   ```bash	$env:TRUST_PROXY = "true"  # defaults to true

   git clone https://github.com/breda25/breda25.github.io.git	```

   cd breda25.github.io4. Launch

   git checkout 1st	```pwsh

   ```	npm run dev

	```

2. **Enable GitHub Pages**

   - Go to repository Settings → Pages### Security posture

   - Source: Deploy from branch `1st`

   - Folder: `/ (root)` or `/public`- **Passphrase gating**: Operator access is protected by a scrypt-derived secret. Tokens are short-lived and stored in-memory with rolling expiry.

   - Save and wait for deployment- **Single-file datastore**: Visitor records are stored in `data/visitors.db` (SQLite, WAL mode) so the entire history can be backed up or rotated atomically.

- **Threat-aware hygiene**: Requests are rate-limited, sanitised, and wrapped in Helmet’s defensive headers. Private-network IPs skip geolocation calls.

3. **Visit your site**- **Redacted-by-default UI**: All rows remain blurred until the passphrase is accepted, preventing shoulder surfing during ops reviews.

   ```

   https://breda25.github.ioTune retention by setting `MAX_RECORDS` (default 5000) and `SESSION_MINUTES` (default 30). Override `DATA_DIR` and/or `DATA_FILE` to back the encrypted SQLite database by a remote-mounted path. Set `GEOLOOKUP=off` to disable outbound lookups entirely.

   ```

Deploy responsibly; add consent banners, retention policies, and encryption-at-rest according to your jurisdiction before going live.

4. **First-time setup**

   - Enter a **strong passphrase** (minimum 12 characters, recommend 20+)
   - This passphrase encrypts all your analytics data
   - **Don't lose it!** There's no password recovery

### How It Works

1. **Visit tracking** - Every page load captures:
   - Timestamp
   - User agent & device info
   - Screen resolution & platform
   - Referrer & page path
   - Timezone & languages
   - Optional: Geolocation (requires browser permission)

2. **Encryption** - Data is encrypted using:
   - PBKDF2 key derivation (100,000 iterations)
   - AES-256-GCM encryption
   - Random salt & IV per encryption
   - SHA-256 passphrase hashing

3. **Storage** - Encrypted data stored in:
   - `localStorage` for persistent analytics
   - `sessionStorage` for queued visits
   - Maximum 1000 visits retained

4. **Authentication** - Access controlled by:
   - Client-side passphrase verification
   - No backend, no server, no database
   - Re-lock any time for privacy

### Security Notes

⚠️ **Important Limitations**
- Data stored in browser localStorage (can be cleared)
- No server-side IP logging (shows "Client-side tracking")
- Passphrase stored as SHA-256 hash in localStorage
- If you forget passphrase, you lose access to encrypted data
- Each browser/device has separate encrypted storage

✅ **Best Practices**
- Use a unique, strong passphrase (20+ characters)
- Don't share your passphrase
- Lock dashboard when not in use
- Backup localStorage if needed
- Add cookie consent banner for compliance

### File Structure

```
/public/
  ├── index.html    # Main dashboard UI
  └── app.js        # Client-side analytics & encryption
/
  ├── index.html    # Redirect to /public
  └── README.md     # This file
```

### Deployment Notes

This is a **static site** designed for GitHub Pages. The `server.js`, `package.json`, and backend dependencies are **not used** in production - they were part of an earlier architecture that required Node.js hosting.

For GitHub Pages, only the `/public` folder matters:
- Pure HTML, CSS, JavaScript
- No build step required
- No npm install needed
- Works immediately after push

---

**Built with privacy in mind** • No tracking scripts • No external dependencies • Your data stays yours
