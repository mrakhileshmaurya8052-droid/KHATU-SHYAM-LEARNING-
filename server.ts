import crypto from 'crypto';
import dns from 'dns';
import fs from 'fs';
import os from 'os';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || 'Shivkumari872@';
const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`${ADMIN_ACCESS_CODE}|${process.env.GEMINI_API_KEY || 'ksl-fortress-2026'}`)
    .digest('hex');

const ADMIN_SESSION_COOKIE = 'ksl_admin_sig';
const ADMIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

const telegramCache = new Map<
  string,
  { count: number; label: string; live: boolean; fetchedAt: number }
>();

// Sliding-window rate limiters
const failedCodeAttempts = new Map<string, { count: number; resetAt: number }>();
const apiRateBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  const fwd = req.get('x-forwarded-for');
  if (fwd) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function signSessionPayload(encodedPayload: string): string {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function issueAdminToken(userAgent: string): string {
  const uaHash = crypto
    .createHash('sha256')
    .update(userAgent || 'unknown')
    .digest('hex')
    .slice(0, 16);
  const payloadObj = {
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
    ua: uaHash,
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = signSessionPayload(encoded);
  return `${encoded}.${sig}`;
}

function verifyAdminToken(token: string | undefined, userAgent: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return false;

  const expectedSig = signSessionPayload(encoded);
  if (!timingSafeEqualStrings(providedSig, expectedSig)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      exp?: number;
      ua?: string;
    };
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return false;
    }
    const expectedUaHash = crypto
      .createHash('sha256')
      .update(userAgent || 'unknown')
      .digest('hex')
      .slice(0, 16);
    if (parsed.ua !== expectedUaHash) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    result[key] = decodeURIComponent(val);
  }
  return result;
}

function extractAdminToken(req: Request): string | undefined {
  const headerToken = req.get('x-admin-session');
  if (headerToken) return headerToken.trim();
  const cookies = parseCookies(req.get('cookie'));
  return cookies[ADMIN_SESSION_COOKIE];
}

function isRequestHttps(req: Request): boolean {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

function setAdminSessionCookie(req: Request, res: Response, token: string): void {
  const maxAgeSec = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  const https = isRequestHttps(req);
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
    ...(https ? ['Secure'] : []),
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAdminSessionCookie(req: Request, res: Response): void {
  const https = isRequestHttps(req);
  const parts = [
    `${ADMIN_SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
    ...(https ? ['Secure'] : []),
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function checkRateBucket(key: string, windowMs: number, maxHits: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = apiRateBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    apiRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= maxHits) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function isHostMatch(urlStr: string, requestHost: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const normalizedReqHost = requestHost.toLowerCase();
    const parsedHost = parsed.host.toLowerCase();
    if (parsedHost === normalizedReqHost) return true;
    const isLocalA = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isLocalB = normalizedReqHost.startsWith('localhost:') || normalizedReqHost.startsWith('127.0.0.1:');
    return isLocalA && isLocalB;
  } catch {
    return false;
  }
}

const AUTHORIZED_CUSTOM_HOSTS = [
  'khatushyamlearning.vercel.app',
  'www.khatushyamlearning.vercel.app',
  'khatushyamlearning.publicvm.com',
  'www.khatushyamlearning.publicvm.com',
  'gen-lang-client-0442544308.web.app',
  'gen-lang-client-0442544308.firebaseapp.com',
];

const AUTHORIZED_HOST_SUFFIXES = [
  '.run.app',
  '.web.app',
  '.firebaseapp.com',
  '.googleusercontent.com',
];

let runtimeCustomHosts: string[] = [];

function syncRuntimeCustomHosts(customDomainValue: unknown): void {
  if (typeof customDomainValue !== 'string') {
    runtimeCustomHosts = [];
    return;
  }
  const cleaned = customDomainValue
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .split(':')[0]
    .replace(/^\.+|\.+$/g, '');
  if (!cleaned) {
    runtimeCustomHosts = [];
    return;
  }
  runtimeCustomHosts = cleaned.startsWith('www.')
    ? [cleaned, cleaned.slice(4)]
    : [cleaned, `www.${cleaned}`];
}

function getRequestCandidateHosts(req: Request): string[] {
  const fwdHeader = req.get('forwarded') || '';
  const fwdHostMatch = fwdHeader.match(/host=([^;,\s"]+)/i);
  const xFwdHosts = (req.get('x-forwarded-host') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return [
    req.get('host'),
    req.get('x-original-host'),
    fwdHostMatch?.[1],
    ...xFwdHosts,
    ...AUTHORIZED_CUSTOM_HOSTS,
    ...runtimeCustomHosts,
  ].filter((h): h is string => Boolean(h));
}

function isAuthorizedAppUrl(urlStr: string, candidateHosts: string[]): boolean {
  if (candidateHosts.some((h) => isHostMatch(urlStr, h))) {
    return true;
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      return true;
    }
    if (AUTHORIZED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function apiSecurityGuard(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Origin');

  // Block all cross-origin CORS preflights and foreign browser requests
  if (req.method === 'OPTIONS') {
    res.status(403).json({ error: 'Cross-origin requests are forbidden.' });
    return;
  }

  const candidateHosts = getRequestCandidateHosts(req);
  const matchesAnyHost = (urlStr: string) => isAuthorizedAppUrl(urlStr, candidateHosts);

  const origin = req.get('origin');
  const referer = req.get('referer');

  if (origin && !matchesAnyHost(origin)) {
    console.warn('[apiSecurityGuard] Blocked origin:', req.method, req.path, { origin, host: req.get('host') });
    res.status(403).json({ error: 'Forbidden origin.' });
    return;
  }

  const hasSameHostOrigin = Boolean(origin && matchesAnyHost(origin));
  const hasSameHostReferer = Boolean(referer && matchesAnyHost(referer));

  if (referer && !hasSameHostReferer && !hasSameHostOrigin) {
    const refLower = referer.toLowerCase();
    // Allow native Android WebView app package referers on GET requests, block foreign web referers
    if (!(req.method === 'GET' && refLower.startsWith('android-app://'))) {
      console.warn('[apiSecurityGuard] Blocked referer:', req.method, req.path, { referer, origin });
      res.status(403).json({ error: 'Invalid request referer.' });
      return;
    }
  }

  const secFetchSite = req.get('sec-fetch-site');
  if (
    secFetchSite &&
    secFetchSite !== 'same-origin' &&
    secFetchSite !== 'none' &&
    !(hasSameHostOrigin || hasSameHostReferer)
  ) {
    console.warn('[apiSecurityGuard] Blocked sec-fetch-site:', req.method, req.path, { secFetchSite, origin, referer });
    res.status(403).json({ error: 'Cross-site API requests are blocked.' });
    return;
  }

  const secFetchMode = req.get('sec-fetch-mode');
  const secFetchDest = req.get('sec-fetch-dest');
  if (secFetchMode === 'navigate' || secFetchDest === 'document') {
    res.status(403).json({ error: 'Direct browser navigation to API is forbidden.' });
    return;
  }

  if (req.method === 'POST' && !origin && !referer) {
    res.status(403).json({ error: 'Origin verification failed.' });
    return;
  }

  const ua = (req.get('user-agent') || '').trim();
  if (
    !ua ||
    /(curl\/|wget\/|postmanruntime|insomnia|python-|httpx|aiohttp|okhttp|retrofit|go-http-client|axios\/|node-fetch|undici|scrapy|libwww-perl|java\/|dalvik\/|apache-httpclient)/i.test(
      ua,
    )
  ) {
    res.status(403).json({ error: 'External API clients are blocked.' });
    return;
  }

  if (req.get('x-ksl-client') !== 'ksl-v1') {
    res.status(403).json({ error: 'Direct external API connection blocked.' });
    return;
  }

  next();
}

function requireAdminSession(req: Request, res: Response, next: NextFunction): void {
  const token = extractAdminToken(req);
  const ua = req.get('user-agent') || '';
  if (!verifyAdminToken(token, ua)) {
    res.status(401).json({ ok: false, error: 'Admin authorization required.' });
    return;
  }
  next();
}

function sanitizeTelegramUrl(raw?: unknown): string {
  if (typeof raw !== 'string') return 'https://t.me/Cheatestbatchwallah';
  const trimmed = raw.trim();
  if (/^https?:\/\/(t\.me|telegram\.me)\/[a-zA-Z0-9_]{3,80}\/?$/i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  return 'https://t.me/Cheatestbatchwallah';
}

const WEBVIEW_ENC_KEY = crypto
  .createHash('sha256')
  .update(`wv:${SESSION_SECRET}`)
  .digest();
const WEBVIEW_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

function isPrivateOrUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1'
  ) {
    return true;
  }

  // IPv6 ULA / link-local / mapped IPv4 checks
  if (host.includes(':')) {
    if (
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:')
    ) {
      return true;
    }
    return false;
  }

  // IPv4 dotted quad checks
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if ([a, b, c, d].some((n) => n < 0 || n > 255)) return true;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  return false;
}

function isSafePublicHttpUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 1000) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (isPrivateOrUnsafeHost(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function sealWebViewToken(safeUrl: string, userAgent: string): string {
  const uaHash = crypto
    .createHash('sha256')
    .update(userAgent || 'unknown')
    .digest('hex')
    .slice(0, 16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', WEBVIEW_ENC_KEY, iv);
  const plaintext = JSON.stringify({
    u: safeUrl,
    exp: Date.now() + WEBVIEW_TOKEN_TTL_MS,
    ua: uaHash,
  });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function unsealWebViewToken(token: unknown, userAgent: string): string | null {
  if (typeof token !== 'string' || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      return null;
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', WEBVIEW_ENC_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as { u?: string; exp?: number; ua?: string };
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    const expectedUaHash = crypto
      .createHash('sha256')
      .update(userAgent || 'unknown')
      .digest('hex')
      .slice(0, 16);
    if (parsed.ua !== expectedUaHash) {
      return null;
    }
    return isSafePublicHttpUrl(parsed.u);
  } catch {
    return null;
  }
}

function parseTelegramCountToken(raw: string): number {
  const cleaned = raw.replace(/\s+/g, '').replace(/,/g, '').toUpperCase();
  const suffixMatch = cleaned.match(/^(\d+(?:\.\d+)?)([KM])?$/);
  if (!suffixMatch) {
    const digitsMatch = raw.match(/([\d\s,]+)/);
    return digitsMatch ? Number(digitsMatch[1].replace(/[\s,]+/g, '')) : NaN;
  }
  const base = Number(suffixMatch[1]);
  if (!Number.isFinite(base)) return NaN;
  if (suffixMatch[2] === 'K') return Math.round(base * 1000);
  if (suffixMatch[2] === 'M') return Math.round(base * 1000000);
  return Math.round(base);
}

const BLOCKED_SENSITIVE_PATTERNS = [
  /\.map$/i,
  /^\/\.env/i,
  /^\/\.git/i,
  /^\/\.data/i,
  /^\/server\.ts$/i,
  /^\/package(?:-lock)?\.json$/i,
  /^\/tsconfig\.json$/i,
  /^\/vite\.config\.ts$/i,
  /^\/firestore\.rules$/i,
  /^\/firebase-blueprint\.json$/i,
  /^\/firebase-applet-config\.json$/i,
  /^\/security_spec\.md$/i,
  /^\/eslint\.config\.js$/i,
];

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Global security headers (Storefront & WebView embeddable in any app/store; Admin stays frame-restricted)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    if (req.path.startsWith('/ksl-admin-872')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.setHeader(
        'Content-Security-Policy',
        "frame-ancestors 'self' https://*.google.com https://*.googleusercontent.com https://*.run.app",
      );
    } else {
      if (req.path.startsWith('/wv/')) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      }
      res.setHeader('Content-Security-Policy', 'frame-ancestors *');
    }
    next();
  });

  // Block probing for internal config, rules, source maps, or env files
  app.use((req, res, next) => {
    if (BLOCKED_SENSITIVE_PATTERNS.some((rx) => rx.test(req.path))) {
      res.status(404).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '4mb' }));

  // Harden every /api/* endpoint against external cloning / cross-origin connections
  app.use('/api', apiSecurityGuard);

  const DATA_DIR = path.resolve(__dirname, '.data');
  const STORE_FILE = path.join(DATA_DIR, 'ksl-store.json');
  const FALLBACK_TMP_STORE = path.join(os.tmpdir(), 'ksl-store-fallback.json');
  const LEGACY_TMP_CACHE = path.join(os.tmpdir(), 'ksl-catalog-cache.json');

  interface StoredBatchSecret {
    targetUrl: string;
    accessInstructions: string;
    updatedAt: string;
  }

  interface ServerStore {
    settings: Record<string, unknown> | null;
    batches: Record<string, unknown>[];
    batchSecrets: Record<string, StoredBatchSecret>;
    offers: Record<string, unknown>[];
    orders: Record<string, unknown>[];
    deletedBatchIds: string[];
    deletedOfferIds: string[];
    firestoreSynced: boolean;
    updatedAt: number;
  }

  const ensureStoreDir = () => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch {
      // ignore
    }
  };

  let storeState: ServerStore = (() => {
    ensureStoreDir();
    try {
      const sourceFile = fs.existsSync(STORE_FILE)
        ? STORE_FILE
        : fs.existsSync(FALLBACK_TMP_STORE)
          ? FALLBACK_TMP_STORE
          : '';
      if (sourceFile) {
        const parsed = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) as Partial<ServerStore>;
        return {
          settings: parsed.settings ?? null,
          batches: Array.isArray(parsed.batches) ? parsed.batches : [],
          batchSecrets:
            parsed.batchSecrets && typeof parsed.batchSecrets === 'object'
              ? parsed.batchSecrets
              : {},
          offers: Array.isArray(parsed.offers) ? parsed.offers : [],
          orders: Array.isArray(parsed.orders) ? parsed.orders : [],
          deletedBatchIds: Array.isArray(parsed.deletedBatchIds) ? parsed.deletedBatchIds : [],
          deletedOfferIds: Array.isArray(parsed.deletedOfferIds) ? parsed.deletedOfferIds : [],
          firestoreSynced: Boolean(parsed.firestoreSynced),
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        };
      }
      if (fs.existsSync(LEGACY_TMP_CACHE)) {
        const legacy = JSON.parse(fs.readFileSync(LEGACY_TMP_CACHE, 'utf8')) as {
          settings?: Record<string, unknown> | null;
          batches?: Record<string, unknown>[];
          offers?: Record<string, unknown>[];
        };
        return {
          settings: legacy.settings ?? null,
          batches: Array.isArray(legacy.batches) ? legacy.batches : [],
          batchSecrets: {},
          offers: Array.isArray(legacy.offers) ? legacy.offers : [],
          orders: [],
          deletedBatchIds: [],
          deletedOfferIds: [],
          firestoreSynced: false,
          updatedAt: Date.now(),
        };
      }
    } catch {
      // Fall back to empty store
    }
    return {
      settings: null,
      batches: [],
      batchSecrets: {},
      offers: [],
      orders: [],
      deletedBatchIds: [],
      deletedOfferIds: [],
      firestoreSynced: false,
      updatedAt: Date.now(),
    };
  })();

  syncRuntimeCustomHosts(storeState.settings?.customDomain);

  const persistStore = () => {
    storeState.updatedAt = Date.now();
    syncRuntimeCustomHosts(storeState.settings?.customDomain);
    ensureStoreDir();
    const serialized = JSON.stringify(storeState);
    try {
      const tmpPath = `${STORE_FILE}.tmp`;
      fs.writeFileSync(tmpPath, serialized, 'utf8');
      fs.renameSync(tmpPath, STORE_FILE);
    } catch {
      try {
        fs.writeFileSync(FALLBACK_TMP_STORE, serialized, 'utf8');
      } catch {
        // Ignore write error if both are unavailable
      }
    }
  };

  let lastFirestoreSyncAttempt = 0;
  let lastFirestoreQuotaBlocked = false;

  const getFirebaseConfigMeta = (): { projectId: string; databaseId: string } | null => {
    try {
      const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      };
      if (!raw.projectId || !raw.firestoreDatabaseId) return null;
      return { projectId: raw.projectId, databaseId: raw.firestoreDatabaseId };
    } catch {
      return null;
    }
  };

  const decodeFirestoreValue = (val: Record<string, unknown> | undefined): unknown => {
    if (!val || typeof val !== 'object') return undefined;
    if ('stringValue' in val) return String(val.stringValue ?? '');
    if ('booleanValue' in val) return Boolean(val.booleanValue);
    if ('integerValue' in val) return Number(val.integerValue);
    if ('doubleValue' in val) return Number(val.doubleValue);
    if ('timestampValue' in val) return String(val.timestampValue ?? '');
    if ('nullValue' in val) return null;
    if ('arrayValue' in val && val.arrayValue && typeof val.arrayValue === 'object') {
      const values = (val.arrayValue as { values?: Record<string, unknown>[] }).values || [];
      return values.map((v) => decodeFirestoreValue(v));
    }
    if ('mapValue' in val && val.mapValue && typeof val.mapValue === 'object') {
      const fields = (val.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields || {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        out[k] = decodeFirestoreValue(v);
      }
      return out;
    }
    return undefined;
  };

  const decodeFirestoreDocument = (docObj: {
    name?: string;
    fields?: Record<string, Record<string, unknown>>;
  }): Record<string, unknown> => {
    const id = typeof docObj.name === 'string' ? docObj.name.split('/').pop() || '' : '';
    const decoded: Record<string, unknown> = id ? { id } : {};
    if (docObj.fields && typeof docObj.fields === 'object') {
      for (const [k, v] of Object.entries(docObj.fields)) {
        decoded[k] = decodeFirestoreValue(v);
      }
    }
    return decoded;
  };

  const parseTimestampMs = (value: unknown): number => {
    if (typeof value === 'string') {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    }
    if (value && typeof value === 'object' && 'seconds' in value) {
      const sec = Number((value as { seconds?: number }).seconds || 0);
      return Number.isFinite(sec) ? sec * 1000 : 0;
    }
    return 0;
  };

  const trySyncFromFirestoreIfNeeded = async (force = false): Promise<{
    synced: boolean;
    quotaExceeded: boolean;
    addedBatches: number;
    addedOffers: number;
  }> => {
    const cooldownMs = lastFirestoreQuotaBlocked
      ? 180_000
      : storeState.firestoreSynced && storeState.batches.length > 0
        ? 300_000
        : 15_000;
    if (!force && Date.now() - lastFirestoreSyncAttempt < cooldownMs) {
      return {
        synced: storeState.firestoreSynced,
        quotaExceeded: lastFirestoreQuotaBlocked,
        addedBatches: 0,
        addedOffers: 0,
      };
    }
    lastFirestoreSyncAttempt = Date.now();
    const meta = getFirebaseConfigMeta();
    if (!meta) {
      return { synced: storeState.firestoreSynced, quotaExceeded: false, addedBatches: 0, addedOffers: 0 };
    }

    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(meta.projectId)}/databases/${encodeURIComponent(meta.databaseId)}/documents`;
    try {
      const [settingsRes, batchesRes, offersRes] = await Promise.all([
        fetch(`${base}/site_settings/global`, { signal: AbortSignal.timeout(5500) }),
        fetch(`${base}:runQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'batches' }],
              limit: 250,
            },
          }),
          signal: AbortSignal.timeout(5500),
        }),
        fetch(`${base}:runQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'offers' }],
              limit: 100,
            },
          }),
          signal: AbortSignal.timeout(5500),
        }),
      ]);
      if (settingsRes.status === 429 || batchesRes.status === 429 || offersRes.status === 429) {
        lastFirestoreQuotaBlocked = true;
        return { synced: storeState.firestoreSynced, quotaExceeded: true, addedBatches: 0, addedOffers: 0 };
      }

      lastFirestoreQuotaBlocked = false;
      let changed = false;
      let addedBatches = 0;
      let addedOffers = 0;

      if (settingsRes.ok) {
        const sJson = (await settingsRes.json()) as {
          name?: string;
          fields?: Record<string, Record<string, unknown>>;
        };
        if (sJson.fields) {
          const decoded = decodeFirestoreDocument(sJson);
          delete decoded.id;
          const remoteMs = parseTimestampMs(decoded.updatedAt);
          const localMs = parseTimestampMs(storeState.settings?.updatedAt);
          if (!storeState.settings || force || remoteMs > localMs) {
            storeState.settings = decoded;
            changed = true;
          }
        }
      }

      if (batchesRes.ok) {
        const bRows = (await batchesRes.json()) as Array<{
          document?: { name?: string; fields?: Record<string, Record<string, unknown>> };
        }>;
        if (Array.isArray(bRows)) {
          const indexById = new Map<string, number>();
          storeState.batches.forEach((b, idx) => indexById.set(String(b.id || ''), idx));
          const deletedIds = new Set(storeState.deletedBatchIds);

          for (const row of bRows) {
            if (!row?.document) continue;
            const item = decodeFirestoreDocument(row.document);
            const id = String(item.id || '');
            if (!id) continue;
            const existingIdx = indexById.get(id);
            if (existingIdx === undefined) {
              if (force || !deletedIds.has(id)) {
                if (force && deletedIds.has(id)) {
                  storeState.deletedBatchIds = storeState.deletedBatchIds.filter((d) => d !== id);
                }
                indexById.set(id, storeState.batches.length);
                storeState.batches.push(item);
                addedBatches += 1;
                changed = true;
              }
            } else {
              const localItem = storeState.batches[existingIdx];
              const remoteMs = parseTimestampMs(item.updatedAt);
              const localMs = parseTimestampMs(localItem?.updatedAt);
              if (remoteMs > localMs) {
                storeState.batches[existingIdx] = item;
                changed = true;
              }
            }
          }
        }
      }

      if (offersRes.ok) {
        const oRows = (await offersRes.json()) as Array<{
          document?: { name?: string; fields?: Record<string, Record<string, unknown>> };
        }>;
        if (Array.isArray(oRows)) {
          const indexById = new Map<string, number>();
          storeState.offers.forEach((o, idx) => indexById.set(String(o.id || ''), idx));
          const deletedIds = new Set(storeState.deletedOfferIds);

          for (const row of oRows) {
            if (!row?.document) continue;
            const item = decodeFirestoreDocument(row.document);
            const id = String(item.id || '');
            if (!id) continue;
            const existingIdx = indexById.get(id);
            if (existingIdx === undefined) {
              if (force || !deletedIds.has(id)) {
                if (force && deletedIds.has(id)) {
                  storeState.deletedOfferIds = storeState.deletedOfferIds.filter((d) => d !== id);
                }
                indexById.set(id, storeState.offers.length);
                storeState.offers.push(item);
                addedOffers += 1;
                changed = true;
              }
            } else {
              const localItem = storeState.offers[existingIdx];
              const remoteMs = parseTimestampMs(item.updatedAt);
              const localMs = parseTimestampMs(localItem?.updatedAt);
              if (remoteMs > localMs) {
                storeState.offers[existingIdx] = item;
                changed = true;
              }
            }
          }
        }
      }

      if (batchesRes.ok && offersRes.ok) {
        if (!storeState.firestoreSynced) {
          storeState.firestoreSynced = true;
          changed = true;
        }
      }

      if (changed) persistStore();
      return {
        synced: storeState.firestoreSynced,
        quotaExceeded: false,
        addedBatches,
        addedOffers,
      };
    } catch {
      return { synced: storeState.firestoreSynced, quotaExceeded: lastFirestoreQuotaBlocked, addedBatches: 0, addedOffers: 0 };
    }
  };

  app.get('/api/public-catalog', async (req, res) => {
    const ip = getClientIp(req);
    const rate = checkRateBucket(`cat:${ip}`, 60_000, 180);
    if (!rate.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    await trySyncFromFirestoreIfNeeded(false);

    res.json({
      ok: true,
      source: 'server',
      firestoreSynced: storeState.firestoreSynced,
      firestoreQuotaBlocked: lastFirestoreQuotaBlocked,
      deletedBatchIds: storeState.deletedBatchIds,
      deletedOfferIds: storeState.deletedOfferIds,
      settings: storeState.settings,
      batches: storeState.batches,
      offers: storeState.offers,
    });
  });

  app.post('/api/batches/:batchId/free-access', (req, res) => {
    const ip = getClientIp(req);
    const rate = checkRateBucket(`free:${ip}`, 60_000, 90);
    if (!rate.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s.` });
      return;
    }
    const batchId = String(req.params.batchId || '').trim();
    const batch = storeState.batches.find((b) => String(b.id) === batchId);
    if (!batch || batch.isActive === false) {
      res.status(404).json({ ok: false, error: 'Batch not found or inactive.' });
      return;
    }
    const isFree = batch.requirePayment === false || Number(batch.price || 0) === 0;
    if (!isFree) {
      res.status(403).json({ ok: false, error: 'Payment required for this batch.' });
      return;
    }
    const secret = storeState.batchSecrets[batchId] || { targetUrl: '', accessInstructions: '' };
    const openType = (batch.openType as string) || 'webview';
    const rawUrl = secret.targetUrl || '';
    let sealedFramePath = '';
    if (openType === 'webview' && rawUrl) {
      const safeUrl = isSafePublicHttpUrl(rawUrl);
      if (safeUrl) {
        const token = sealWebViewToken(safeUrl, req.get('user-agent') || '');
        sealedFramePath = `/wv/open?t=${encodeURIComponent(token)}`;
      }
    }
    res.json({
      ok: true,
      openType,
      unlockedUrl: rawUrl,
      unlockedInstructions: secret.accessInstructions || '',
      sealedFramePath,
    });
  });

  app.post('/api/orders', (req, res) => {
    const ip = getClientIp(req);
    const rate = checkRateBucket(`ord:${ip}`, 60_000, 30);
    if (!rate.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : '';
    const studentName = typeof body.studentName === 'string' ? body.studentName.trim().slice(0, 100) : '';
    const studentPhone = typeof body.studentPhone === 'string' ? body.studentPhone.trim().slice(0, 30) : '';
    const utrNumber = typeof body.utrNumber === 'string' ? body.utrNumber.trim().slice(0, 100) : '';
    const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim().slice(0, 60) : 'UPI QR Scan';

    if (!batchId || !studentName || studentPhone.length < 5 || !utrNumber) {
      res.status(400).json({ ok: false, error: 'Please fill Name, Phone, and UTR number.' });
      return;
    }

    const batch = storeState.batches.find((b) => String(b.id) === batchId);
    if (!batch || batch.isActive === false) {
      res.status(404).json({ ok: false, error: 'Selected batch is not available.' });
      return;
    }

    const basePrice = Math.max(0, Number(batch.price) || 0);
    const plan2Price =
      typeof batch.plan2Price === 'number' ? Math.max(0, batch.plan2Price) : basePrice + 10;
    const plan3Price =
      typeof batch.plan3Price === 'number' ? Math.max(0, batch.plan3Price) : basePrice + 20;
    const submittedAmount = Number(body.amount);

    if (
      !Number.isFinite(submittedAmount) ||
      ![basePrice, plan2Price, plan3Price].includes(submittedAmount)
    ) {
      res.status(400).json({ ok: false, error: 'Selected plan amount does not match batch pricing.' });
      return;
    }

    const orderId = `ord_${crypto.randomUUID().replace(/-/g, '')}`;
    const nowIso = new Date().toISOString();
    const orderRecord: Record<string, unknown> = {
      id: orderId,
      userId:
        typeof body.userId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(body.userId)
          ? body.userId
          : `stu_${crypto.randomUUID().replace(/-/g, '')}`,
      userEmail: typeof body.userEmail === 'string' ? body.userEmail.trim().slice(0, 160) : '',
      studentName,
      studentPhone,
      batchId,
      batchTitle: String(batch.title || '').slice(0, 140),
      planLabel: typeof body.planLabel === 'string' ? body.planLabel.trim().slice(0, 60) : '1 Year',
      amount: submittedAmount,
      paymentMethod: paymentMethod || 'UPI QR Scan',
      utrNumber,
      screenshotUrl:
        typeof body.screenshotUrl === 'string' ? body.screenshotUrl.slice(0, 500000) : '',
      studentNote: typeof body.studentNote === 'string' ? body.studentNote.trim().slice(0, 500) : '',
      status: 'pending',
      adminNote: '',
      openType: batch.openType || 'webview',
      unlockedUrl: '',
      unlockedInstructions: '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    storeState.orders.unshift(orderRecord);
    if (storeState.orders.length > 500) {
      storeState.orders = storeState.orders.slice(0, 500);
    }
    persistStore();
    res.json({ ok: true, order: orderRecord });
  });

  app.post('/api/orders/status', (req, res) => {
    const rawIds: unknown[] = Array.isArray(req.body?.orderIds) ? req.body.orderIds : [];
    const safeIds = rawIds
      .filter((id: unknown): id is string => typeof id === 'string' && /^ord_[a-zA-Z0-9_-]{20,128}$/.test(id))
      .slice(0, 15);
    if (safeIds.length === 0) {
      res.json({ ok: true, orders: [] });
      return;
    }
    const idSet = new Set(safeIds);
    const ua = req.get('user-agent') || '';
    const matched = storeState.orders
      .filter((o) => idSet.has(String(o.id || '')))
      .map((o) => {
        if (o.status === 'approved' && o.openType === 'webview' && typeof o.unlockedUrl === 'string' && o.unlockedUrl) {
          const safeUrl = isSafePublicHttpUrl(o.unlockedUrl);
          if (safeUrl) {
            const token = sealWebViewToken(safeUrl, ua);
            return { ...o, sealedFramePath: `/wv/open?t=${encodeURIComponent(token)}` };
          }
        }
        return o;
      });
    res.json({ ok: true, orders: matched });
  });

  // Admin full-control endpoints (protected by verified HMAC Admin session)
  app.get('/api/admin/bootstrap', requireAdminSession, async (_req, res) => {
    await trySyncFromFirestoreIfNeeded(false);
    res.json({
      ok: true,
      firestoreSynced: storeState.firestoreSynced,
      settings: storeState.settings,
      batches: storeState.batches,
      batchSecrets: storeState.batchSecrets,
      offers: storeState.offers,
      orders: storeState.orders,
    });
  });

  app.post('/api/admin/sync-firestore', requireAdminSession, async (_req, res) => {
    const result = await trySyncFromFirestoreIfNeeded(true);
    res.json({
      ok: true,
      ...result,
      settings: storeState.settings,
      batches: storeState.batches,
      offers: storeState.offers,
    });
  });

  app.post('/api/admin/merge-cache', requireAdminSession, (req, res) => {
    const body = (req.body ?? {}) as {
      settings?: Record<string, unknown> | null;
      batches?: Record<string, unknown>[];
      offers?: Record<string, unknown>[];
      batchSecrets?: Record<string, { targetUrl?: string; accessInstructions?: string }>;
    };
    let changed = false;

    if (!storeState.settings && body.settings && typeof body.settings === 'object') {
      storeState.settings = { ...body.settings };
      changed = true;
    }

    if (Array.isArray(body.batches)) {
      const existingIds = new Set(storeState.batches.map((b) => String(b.id || '')));
      const deletedIds = new Set(storeState.deletedBatchIds);
      for (const b of body.batches.slice(0, 100)) {
        const id = typeof b?.id === 'string' ? b.id.trim() : '';
        if (!id || existingIds.has(id) || deletedIds.has(id)) continue;
        const copy: Record<string, unknown> = { ...b, id };
        delete copy.targetUrl;
        delete copy.accessInstructions;
        storeState.batches.push(copy);
        existingIds.add(id);
        changed = true;
      }
    }

    if (Array.isArray(body.offers)) {
      const existingOfferIds = new Set(storeState.offers.map((o) => String(o.id || '')));
      const deletedOfferIds = new Set(storeState.deletedOfferIds);
      for (const o of body.offers.slice(0, 50)) {
        const id = typeof o?.id === 'string' ? o.id.trim() : '';
        if (!id || existingOfferIds.has(id) || deletedOfferIds.has(id)) continue;
        storeState.offers.push({ ...o, id });
        existingOfferIds.add(id);
        changed = true;
      }
    }

    if (body.batchSecrets && typeof body.batchSecrets === 'object') {
      for (const [id, secret] of Object.entries(body.batchSecrets)) {
        if (!storeState.batchSecrets[id] && secret && typeof secret.targetUrl === 'string' && secret.targetUrl.trim()) {
          storeState.batchSecrets[id] = {
            targetUrl: secret.targetUrl.trim().slice(0, 1000),
            accessInstructions:
              typeof secret.accessInstructions === 'string'
                ? secret.accessInstructions.trim().slice(0, 1000)
                : '',
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
      }
    }

    if (changed) persistStore();
    res.json({
      ok: true,
      merged: changed,
      settings: storeState.settings,
      batches: storeState.batches,
      batchSecrets: storeState.batchSecrets,
      offers: storeState.offers,
    });
  });

  app.post('/api/admin/batches', requireAdminSession, (req, res) => {
    const body = (req.body ?? {}) as {
      batch?: Record<string, unknown>;
      targetUrl?: string;
      accessInstructions?: string;
    };
    const b = body.batch;
    if (!b || typeof b.id !== 'string' || !b.id.trim() || typeof b.title !== 'string' || !b.title.trim()) {
      res.status(400).json({ ok: false, error: 'Valid batch ID and title are required.' });
      return;
    }
    const batchId = b.id.trim().slice(0, 128);
    const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim().slice(0, 1000) : '';
    const accessInstructions =
      typeof body.accessInstructions === 'string'
        ? body.accessInstructions.trim().slice(0, 1000)
        : '';

    const cleanBatch: Record<string, unknown> = { ...b, id: batchId };
    delete cleanBatch.targetUrl;
    delete cleanBatch.accessInstructions;
    cleanBatch.updatedAt = new Date().toISOString();
    if (!cleanBatch.createdAt) {
      cleanBatch.createdAt = cleanBatch.updatedAt;
    }

    storeState.deletedBatchIds = storeState.deletedBatchIds.filter((id) => id !== batchId);

    const idx = storeState.batches.findIndex((item) => String(item.id) === batchId);
    if (idx >= 0) {
      storeState.batches[idx] = cleanBatch;
    } else {
      storeState.batches.push(cleanBatch);
    }

    if (targetUrl) {
      storeState.batchSecrets[batchId] = {
        targetUrl,
        accessInstructions,
        updatedAt: new Date().toISOString(),
      };
    }

    persistStore();
    res.json({ ok: true, batch: cleanBatch, batches: storeState.batches });
  });

  app.delete('/api/admin/batches/:batchId', requireAdminSession, (req, res) => {
    const batchId = String(req.params.batchId || '').trim();
    storeState.batches = storeState.batches.filter((b) => String(b.id) !== batchId);
    delete storeState.batchSecrets[batchId];
    if (batchId && !storeState.deletedBatchIds.includes(batchId)) {
      storeState.deletedBatchIds = [batchId, ...storeState.deletedBatchIds].slice(0, 200);
    }
    persistStore();
    res.json({ ok: true, batches: storeState.batches });
  });

  app.post('/api/admin/offers', requireAdminSession, (req, res) => {
    const offer = (req.body ?? {}).offer as Record<string, unknown> | undefined;
    if (!offer || typeof offer.id !== 'string' || !offer.id.trim() || typeof offer.title !== 'string' || !offer.title.trim()) {
      res.status(400).json({ ok: false, error: 'Valid offer ID and title are required.' });
      return;
    }
    const offerId = offer.id.trim().slice(0, 128);
    const cleanOffer: Record<string, unknown> = {
      ...offer,
      id: offerId,
      updatedAt: new Date().toISOString(),
    };
    if (!cleanOffer.createdAt) cleanOffer.createdAt = cleanOffer.updatedAt;

    storeState.deletedOfferIds = storeState.deletedOfferIds.filter((id) => id !== offerId);

    const idx = storeState.offers.findIndex((item) => String(item.id) === offerId);
    if (idx >= 0) {
      storeState.offers[idx] = cleanOffer;
    } else {
      storeState.offers.push(cleanOffer);
    }
    persistStore();
    res.json({ ok: true, offer: cleanOffer, offers: storeState.offers });
  });

  app.delete('/api/admin/offers/:offerId', requireAdminSession, (req, res) => {
    const offerId = String(req.params.offerId || '').trim();
    storeState.offers = storeState.offers.filter((o) => String(o.id) !== offerId);
    if (offerId && !storeState.deletedOfferIds.includes(offerId)) {
      storeState.deletedOfferIds = [offerId, ...storeState.deletedOfferIds].slice(0, 200);
    }
    persistStore();
    res.json({ ok: true, offers: storeState.offers });
  });

  app.post('/api/admin/orders/:orderId/decision', requireAdminSession, (req, res) => {
    const orderId = String(req.params.orderId || '').trim();
    const status = req.body?.status === 'approved' ? 'approved' : req.body?.status === 'rejected' ? 'rejected' : '';
    const adminNote = typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim().slice(0, 500) : '';
    const clientOrder = req.body?.order && typeof req.body.order === 'object' ? (req.body.order as Record<string, unknown>) : null;
    if (!status) {
      res.status(400).json({ ok: false, error: 'Invalid decision status.' });
      return;
    }
    const idx = storeState.orders.findIndex((o) => String(o.id) === orderId);
    const existing = idx >= 0 ? storeState.orders[idx] : clientOrder ? { ...clientOrder, id: orderId } : null;
    if (!existing) {
      res.status(404).json({ ok: false, error: 'Order not found.' });
      return;
    }
    const batchId = String(existing.batchId || '');
    const batch = storeState.batches.find((b) => String(b.id) === batchId);
    const secret = storeState.batchSecrets[batchId] || { targetUrl: '', accessInstructions: '' };
    const resolvedTargetUrl =
      String(secret.targetUrl || '').trim() ||
      (typeof req.body?.unlockedUrl === 'string' ? req.body.unlockedUrl.trim() : '');
    const resolvedInstructions =
      String(secret.accessInstructions || '').trim() ||
      (typeof req.body?.unlockedInstructions === 'string' ? req.body.unlockedInstructions.trim() : '');

    const updated: Record<string, unknown> = {
      ...existing,
      status,
      adminNote:
        adminNote ||
        (status === 'approved'
          ? 'Verified & Approved'
          : 'Payment UTR could not be verified. Contact support.'),
      openType: batch?.openType || existing.openType || 'webview',
      unlockedUrl: status === 'approved' ? resolvedTargetUrl.slice(0, 1000) : '',
      unlockedInstructions:
        status === 'approved'
          ? (resolvedInstructions ||
              'Approved by Admin. Click the launch button below to access your batch.').slice(0, 1000)
          : '',
      updatedAt: new Date().toISOString(),
    };

    if (idx >= 0) {
      storeState.orders[idx] = updated;
    } else {
      storeState.orders.unshift(updated);
      if (storeState.orders.length > 500) {
        storeState.orders = storeState.orders.slice(0, 500);
      }
    }
    persistStore();
    res.json({ ok: true, order: updated, orders: storeState.orders });
  });

  app.post('/api/admin/sync-orders', requireAdminSession, (req, res) => {
    const incoming = Array.isArray(req.body?.orders) ? (req.body.orders as Record<string, unknown>[]) : [];
    const byId = new Map<string, Record<string, unknown>>();
    for (const o of storeState.orders) {
      const id = String(o?.id || '');
      if (id) byId.set(id, o);
    }
    let changed = false;
    for (const ord of incoming.slice(0, 250)) {
      const id = String(ord?.id || '');
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { ...ord, id });
        changed = true;
      } else {
        const remoteMs = parseTimestampMs(ord.updatedAt);
        const localMs = parseTimestampMs(existing.updatedAt);
        if (remoteMs > localMs) {
          byId.set(id, { ...existing, ...ord, id });
          changed = true;
        }
      }
    }
    const merged = Array.from(byId.values())
      .sort((a, b) => parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt))
      .slice(0, 500);
    if (changed) {
      storeState.orders = merged;
      persistStore();
    }
    res.json({ ok: true, orders: storeState.orders });
  });

  app.post('/api/admin/settings', requireAdminSession, (req, res) => {
    const nextSettings = (req.body ?? {}).settings as Record<string, unknown> | undefined;
    if (!nextSettings || typeof nextSettings !== 'object') {
      res.status(400).json({ ok: false, error: 'Valid settings object required.' });
      return;
    }
    storeState.settings = {
      ...nextSettings,
      updatedAt: new Date().toISOString(),
    };
    persistStore();
    res.json({ ok: true, settings: storeState.settings });
  });

  app.post('/api/admin/catalog-snapshot', requireAdminSession, (req, res) => {
    const body = (req.body ?? {}) as {
      settings?: Record<string, unknown> | null;
      batches?: Record<string, unknown>[];
      offers?: Record<string, unknown>[];
    };
    if (Array.isArray(body.batches)) {
      storeState.batches = body.batches.slice(0, 100).map((b) => {
        const copy = { ...b };
        delete copy.targetUrl;
        delete copy.accessInstructions;
        return copy;
      });
    }
    if (Array.isArray(body.offers)) {
      storeState.offers = body.offers.slice(0, 50);
    }
    if (body.settings && typeof body.settings === 'object') {
      storeState.settings = { ...body.settings };
    }
    persistStore();
    res.json({ ok: true });
  });

  app.post('/api/webview/seal', (req, res) => {
    const ip = getClientIp(req);
    const rate = checkRateBucket(`wv:${ip}`, 60_000, 60);
    if (!rate.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    const { targetUrl } = req.body ?? {};
    const safeUrl = isSafePublicHttpUrl(targetUrl);
    if (!safeUrl) {
      res.status(400).json({ error: 'Invalid or unsafe WebView URL.' });
      return;
    }

    const token = sealWebViewToken(safeUrl, req.get('user-agent') || '');
    res.json({
      framePath: `/wv/open?t=${encodeURIComponent(token)}`,
    });
  });

  app.get('/api/telegram-stats', async (req, res) => {
    const ip = getClientIp(req);
    const rate = checkRateBucket(`tg:${ip}`, 60_000, 40);
    if (!rate.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    const targetUrl = sanitizeTelegramUrl(req.query.url);
    const cached = telegramCache.get(targetUrl);
    if (cached && Date.now() - cached.fetchedAt < 15000) {
      res.json(cached);
      return;
    }

    const usernameMatch = targetUrl.match(/^https:\/\/(?:t|telegram)\.me\/([a-zA-Z0-9_]{3,80})\/?$/i);
    const previewUrl = usernameMatch ? `https://t.me/s/${usernameMatch[1]}` : null;

    try {
      if (previewUrl) {
        const previewRes = await fetch(previewUrl, { signal: AbortSignal.timeout(5000) });
        const previewHtml = await previewRes.text();
        const counterMatch = previewHtml.match(/class="counter_value"[^>]*>([^<]+)</i);
        if (counterMatch?.[1]) {
          const parsedCount = parseTelegramCountToken(counterMatch[1]);
          if (Number.isFinite(parsedCount) && parsedCount > 0) {
            const payload = {
              count: parsedCount,
              label: `${parsedCount.toLocaleString('en-IN')} subscribers`,
              live: true,
              fetchedAt: Date.now(),
            };
            telegramCache.set(targetUrl, payload);
            res.json(payload);
            return;
          }
        }
      }

      const response = await fetch(targetUrl, {
        signal: AbortSignal.timeout(5000),
      });
      const html = await response.text();
      const extraMatch = html.match(/tgme_page_extra[^>]*>([^<]+)</i);
      const rawExtra = extraMatch ? extraMatch[1].trim() : '';
      const parsedCount = rawExtra ? parseTelegramCountToken(rawExtra) : NaN;

      if (Number.isFinite(parsedCount) && parsedCount > 0) {
        const payload = {
          count: parsedCount,
          label: rawExtra || `${parsedCount.toLocaleString('en-IN')} joined`,
          live: true,
          fetchedAt: Date.now(),
        };
        telegramCache.set(targetUrl, payload);
        res.json(payload);
        return;
      }
    } catch {
      // Fallback below
    }

    const fallback = cached
      ? { ...cached, live: false }
      : { count: 703, label: '703 subscribers', live: false, fetchedAt: Date.now() };
    res.json(fallback);
  });

  app.get('/api/admin/session', (req, res) => {
    const token = extractAdminToken(req);
    const ua = req.get('user-agent') || '';
    if (verifyAdminToken(token, ua)) {
      res.json({ ok: true });
      return;
    }
    res.status(401).json({ ok: false });
  });

  app.post('/api/admin/logout', (req, res) => {
    clearAdminSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/admin/verify-code', (req, res) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const attemptState = failedCodeAttempts.get(ip);
    if (attemptState && now < attemptState.resetAt && attemptState.count >= 5) {
      const waitMin = Math.max(1, Math.ceil((attemptState.resetAt - now) / 60000));
      res.status(429).json({
        ok: false,
        error: `Too many wrong attempts. Locked for ${waitMin} minute(s).`,
      });
      return;
    }

    const { code } = req.body ?? {};
    if (typeof code !== 'string' || !code.trim()) {
      res.status(400).json({ ok: false, error: 'Access code is required.' });
      return;
    }

    if (timingSafeEqualStrings(code.trim(), ADMIN_ACCESS_CODE)) {
      failedCodeAttempts.delete(ip);
      const token = issueAdminToken(req.get('user-agent') || '');
      setAdminSessionCookie(req, res, token);
      res.json({ ok: true, sessionToken: token });
      return;
    }

    if (!attemptState || now > attemptState.resetAt) {
      failedCodeAttempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    } else {
      attemptState.count += 1;
    }
    res.status(401).json({ ok: false, error: 'Invalid admin access code.' });
  });

  app.post('/api/thumbnail-copy', requireAdminSession, async (req, res) => {
    const ip = getClientIp(req);
    const rate = checkRateBucket(`thumb:${ip}`, 60_000, 20);
    if (!rate.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    const { title, glowAccent } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Batch title is required.' });
      return;
    }

    const safeTitle = title.trim().slice(0, 140);

    if (!ai) {
      res.json({
        headline: safeTitle.slice(0, 38),
        kicker: 'VERIFIED BATCH',
        tagline: 'KHATU SHYAM LEARNING',
        accentHint: typeof glowAccent === 'string' ? glowAccent : 'amber',
      });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Generate ultra-concise, high-impact cover artwork text for an online learning batch thumbnail. Do NOT invent any person names or extra subject categories.
Batch Name: ${safeTitle}
Brand: KHATU SHYAM LEARNING`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: {
                type: Type.STRING,
                description: 'Batch name cover title (max 36 characters).',
              },
              kicker: {
                type: Type.STRING,
                description: '2-3 word uppercase badge label like VERIFIED BATCH (max 20 characters).',
              },
              tagline: {
                type: Type.STRING,
                description: 'Short label like OFFICIAL BATCH ACCESS (max 36 characters).',
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({
        headline: typeof parsed.headline === 'string' && parsed.headline ? parsed.headline.slice(0, 40) : safeTitle.slice(0, 38),
        kicker: typeof parsed.kicker === 'string' && parsed.kicker ? parsed.kicker.slice(0, 24) : 'VERIFIED BATCH',
        tagline: typeof parsed.tagline === 'string' && parsed.tagline ? parsed.tagline.slice(0, 48) : 'KHATU SHYAM LEARNING',
        accentHint: typeof glowAccent === 'string' ? glowAccent : 'amber',
      });
    } catch {
      res.status(500).json({
        error: 'Failed to generate thumbnail concept.',
      });
    }
  });

  app.post('/api/admin/check-domain', requireAdminSession, async (req, res) => {
    const ip = getClientIp(req);
    const rate = checkRateBucket(`dom:${ip}`, 60_000, 20);
    if (!rate.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    const raw = typeof req.body?.domain === 'string' ? req.body.domain : '';
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
      .split(':')[0]
      .replace(/^\.+|\.+$/g, '');

    if (
      !cleaned ||
      cleaned.length > 180 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(cleaned) ||
      isPrivateOrUnsafeHost(cleaned)
    ) {
      res.status(400).json({ error: 'Enter a valid public domain (e.g. batches.yourdomain.com).' });
      return;
    }

    let cnameRecords: string[] = [];
    let aRecords: string[] = [];
    try {
      cnameRecords = await dns.promises.resolveCname(cleaned);
    } catch {
      cnameRecords = [];
    }
    try {
      aRecords = await dns.promises.resolve4(cleaned);
    } catch {
      aRecords = [];
    }

    const pointsToGoogleHost = cnameRecords.some((c) => {
      const lc = c.toLowerCase();
      return (
        lc.includes('ghs.googlehosted.com') ||
        lc.endsWith('.run.app') ||
        lc.endsWith('.web.app') ||
        lc.endsWith('.firebaseapp.com')
      );
    });

    res.json({
      domain: cleaned,
      cnameRecords: cnameRecords.slice(0, 6),
      aRecords: aRecords.slice(0, 6),
      pointsToGoogleHost,
      connected: pointsToGoogleHost || aRecords.length > 0,
    });
  });

  // Sealed in-app WebView launcher route (keeps target URL hidden from DOM/UI)
  app.get('/wv/open', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

    const candidateHosts = getRequestCandidateHosts(req);

    const referer = req.get('referer');
    const hasSameHostReferer = Boolean(referer && isAuthorizedAppUrl(referer, candidateHosts));
    if (referer && !hasSameHostReferer) {
      res.status(403).type('html').send('<!doctype html><html><body style="background:#030307;color:#f472b6;font-family:sans-serif;text-align:center;padding:48px">Invalid request origin.</body></html>');
      return;
    }

    const secFetchSite = req.get('sec-fetch-site');
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none' && !hasSameHostReferer) {
      res.status(403).type('html').send('<!doctype html><html><body style="background:#030307;color:#f472b6;font-family:sans-serif;text-align:center;padding:48px">Cross-site access blocked.</body></html>');
      return;
    }

    const secFetchDest = req.get('sec-fetch-dest');
    if (secFetchDest && secFetchDest === 'document') {
      res.status(403).type('html').send('<!doctype html><html><body style="background:#030307;color:#f472b6;font-family:sans-serif;text-align:center;padding:48px">In-app WebView only. Direct opening is disabled.</body></html>');
      return;
    }

    const token = typeof req.query.t === 'string' ? req.query.t : '';
    const safeUrl = unsealWebViewToken(token, req.get('user-agent') || '');
    if (!safeUrl) {
      res.status(403).type('html').send('<!doctype html><html><body style="background:#030307;color:#f472b6;font-family:sans-serif;text-align:center;padding:48px">WebView session expired. Please reopen the batch inside the app.</body></html>');
      return;
    }

    const serializedUrl = JSON.stringify(safeUrl)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="referrer" content="no-referrer" />
  <title>Batch Portal</title>
</head>
<body style="margin:0;background:#030307;color:#a3e635;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div id="msg" style="font-size:13px;letter-spacing:0.04em;opacity:0.85;">Loading batch inside app...</div>
  <script>
    (function(){
      if (window.self === window.top) {
        document.getElementById('msg').style.color = '#f472b6';
        document.getElementById('msg').textContent = 'In-app WebView only. Direct opening is disabled.';
        return;
      }
      window.location.replace(${serializedUrl});
    })();
  </script>
</body>
</html>`);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        index: false,
        maxAge: '7d',
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
