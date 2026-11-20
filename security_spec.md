# Security Specification — KHATU SHYAM LEARNING

## 1. Data & API Invariants
1. **Batch Ownership & Secret Isolation**: Public `batches/{batchId}` documents NEVER store `targetUrl` or private access instructions. Private links live in `batches/{batchId}/private/access` (readable/writable only by verified admins for paid batches, and readable only for active `price == 0` or `requirePayment == false` no-payment batches so WebView links can load inside `/wv/open` without displaying the URL) and are copied into `orders/{orderId}.unlockedUrl` ONLY by an admin upon approving a payment.
2. **Order Price & Entropy Integrity**: An `orders/{orderId}` creation MUST use a high-entropy `ord_...` ID (`>= 32` chars), set `status == 'pending'`, `unlockedUrl == ''`, `unlockedInstructions == ''`, `adminNote == ''`, reference an active `batches/{batchId}` document, and match the server-stored `price` and `title` of that batch.
3. **PII Protection**: `orders/{orderId}` contains student phone, email, and UTR. `allow list` is strictly `isAdmin()`, and `allow get` requires knowing the exact 24–36+ char random `orderId`.
4. **Server Timestamp Integrity**: `createdAt` and `updatedAt` MUST equal `request.time` on creation, `createdAt` is immutable on update, and `updatedAt` MUST equal `request.time` on update.
5. **Admin Privileges**: Only verified admin accounts (`mrakhileshmaurya8052@gmail.com` with `email_verified == true` or UIDs in `/admins/{uid}`) can create/update/delete `batches`, `batches/*/private/*`, `offers`, `site_settings`, or approve/reject `orders`.
6. **API Same-Origin & Session Enforcement**: All `/api/*` endpoints block cross-origin requests (`Origin` / `Referer` / `Sec-Fetch-Site` checks, `OPTIONS` -> `403`, no wildcard CORS), enforce `X-KSL-Client`, apply per-IP rate limits (with 15-minute lockout after 5 wrong admin code attempts), verify the admin code using SHA-256 + `crypto.timingSafeEqual`, and require an HMAC-SHA256 signed Admin session token before calling the Gemini API (`/api/thumbnail-copy`).
7. **Anti-Clone & Build Hardening**: Production builds disable source maps (`sourcemap: false`), sensitive project/config/rules paths return `404`, and runtime checks block unauthorized cloned domains or third-party phishing frames while permitting only verified hosting suffixes or an Admin-configured `site_settings/global.customDomain`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED / 401 / 403)
1. **Self-Approved Order on Create**: Attacker submits `orders/ord_...` with `status: 'approved'` and `unlockedUrl: 'https://t.me/secret'`.
2. **Price Tampering on Create**: Attacker submits `orders/ord_...` with `amount: 0` or `1` for a ₹1499 batch.
3. **Shadow Ghost Field Injection**: Attacker creates `orders/ord_...` with valid fields plus `isAdmin: true`.
4. **Orphan or Inactive Batch Reference**: Attacker creates `orders/ord_...` referencing a missing or `isActive: false` batch.
5. **Student Self-Updating Order to Approved**: Attacker updates `orders/ord_...` changing `status` to `'approved'`.
6. **Orders PII Scraping**: Non-admin calls `getDocs(collection(db, 'orders'))`.
7. **Private Batch Link Extraction**: Non-admin attempts `getDoc(doc(db, 'batches/b1/private/access'))`.
8. **Non-Admin Modifying Batch Price**: Non-admin updates `batches/b1` setting `price: 0`.
9. **Non-Admin Modifying UPI QR Code**: Non-admin updates `site_settings/global` setting `upiId: 'attacker@upi'`.
10. **Short / Predictable Order ID**: Attacker creates `orders/ord_123` (`< 32` chars).
11. **Oversized String Denial-of-Wallet**: Attacker sets `studentName` to a 50,000-character string.
12. **Unverified Admin Email Spoof & External API Connection**: Request with `email_verified == false` tries to write Firestore, or external cloned site calls `POST /api/thumbnail-copy` without the server-signed HMAC Admin session.
