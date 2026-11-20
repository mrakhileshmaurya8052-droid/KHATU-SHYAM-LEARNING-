const ALLOWED_HOST_SUFFIXES = [
  '.run.app',
  '.web.app',
  '.firebaseapp.com',
  '.google.com',
  '.googleusercontent.com',
];

const ALLOWED_EXACT_HOSTS = [
  'khatushyamlearning.publicvm.com',
  'www.khatushyamlearning.publicvm.com',
];

export function normalizeCustomDomain(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
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
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(cleaned)
  ) {
    return '';
  }
  return cleaned;
}

export function isBuiltInAuthorizedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]') {
    return true;
  }
  if (ALLOWED_EXACT_HOSTS.includes(lower)) {
    return true;
  }
  return ALLOWED_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function doesHostnameMatchCustomDomain(
  currentHostname: string,
  configuredDomain?: string,
): boolean {
  const cur = currentHostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  const cfg = normalizeCustomDomain(configuredDomain);
  if (!cur || !cfg) return false;
  if (cur === cfg) return true;
  if (cur === `www.${cfg}`) return true;
  if (cfg.startsWith('www.') && `www.${cur}` === cfg) return true;
  return false;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.isContentEditable || target.closest('[data-allow-copy="true"]'));
}

export function initAntiCloneProtection(): boolean {
  if (typeof window === 'undefined') return true;

  // 1. Unauthorized third-party iframe clickjacking / mirror protection (preserves AI Studio preview)
  if (window.top !== window.self && document.referrer) {
    try {
      const refHost = new URL(document.referrer).hostname;
      if (refHost !== window.location.hostname && !isBuiltInAuthorizedHost(refHost)) {
        document.body.innerHTML =
          '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050508;color:#f87171;font-family:sans-serif;text-align:center;padding:24px;"><div><h1 style="font-size:20px;margin-bottom:8px;">Unauthorized Embed Blocked</h1><p style="font-size:13px;color:#a1a1aa;">External framing is not permitted.</p></div></div>';
        throw new Error('Unauthorized iframe origin.');
      }
    } catch {
      // Ignore unparseable referrer
    }
  }

  // 2. Deter casual right-click saving, image dragging, and view-source shortcuts
  document.addEventListener('contextmenu', (e) => {
    if (!isEditableElement(e.target)) {
      e.preventDefault();
    }
  });

  document.addEventListener('dragstart', (e) => {
    if (e.target instanceof HTMLImageElement) {
      e.preventDefault();
    }
  });

  document.addEventListener('keydown', (e) => {
    const key = e.key.toUpperCase();
    const ctrlOrMeta = e.ctrlKey || e.metaKey;

    // Allow normal copy/paste/select inside form inputs
    if (isEditableElement(e.target) && ctrlOrMeta && ['C', 'V', 'X', 'A', 'Z', 'Y'].includes(key)) {
      return;
    }

    if (
      key === 'F12' ||
      (ctrlOrMeta && ['U', 'S'].includes(key)) ||
      (ctrlOrMeta && e.shiftKey && ['I', 'J', 'C', 'K'].includes(key))
    ) {
      e.preventDefault();
    }
  });

  return isBuiltInAuthorizedHost(window.location.hostname);
}
