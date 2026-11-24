import { useCallback, useEffect, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  isQuotaExceededError,
  logFirestoreError,
  OperationType,
} from './firebase';
import { Batch, Offer, Order, SiteSettings } from './types';
import { DEFAULT_SITE_SETTINGS } from './constants/defaults';
import {
  doesHostnameMatchCustomDomain,
  isBuiltInAuthorizedHost,
  isUnauthorizedAdminEmbed,
} from './utils/antiClone';
import { readCachedCatalog, writeCachedCatalog } from './utils/catalogCache';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Storefront } from './pages/Storefront';
import { AdminPanel } from './pages/AdminPanel';

function loadSavedOrderIds(): string[] {
  try {
    const raw = localStorage.getItem('ksl_my_order_ids');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length >= 24).slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

function isPersonalAdminPath(pathname: string): boolean {
  return pathname.startsWith('/ksl-admin-872');
}

function normalizeSettingsData(data?: Partial<SiteSettings> | null): SiteSettings {
  if (!data) return DEFAULT_SITE_SETTINGS;
  const rawTg = typeof data.supportTelegramUrl === 'string' ? data.supportTelegramUrl.trim() : '';
  const normalizedTg =
    !rawTg || rawTg === 'https://t.me/'
      ? DEFAULT_SITE_SETTINGS.supportTelegramUrl
      : rawTg;
  const rawWa = typeof data.supportWhatsapp === 'string' ? data.supportWhatsapp.trim() : '';
  const normalizedWa = rawWa || DEFAULT_SITE_SETTINGS.supportWhatsapp;
  return {
    ...DEFAULT_SITE_SETTINGS,
    ...data,
    supportTelegramUrl: normalizedTg,
    supportWhatsapp: normalizedWa,
    customDomain:
      typeof data.customDomain === 'string' && data.customDomain.trim()
        ? data.customDomain.trim()
        : DEFAULT_SITE_SETTINGS.customDomain,
    popupCtaText:
      data.popupCtaText && data.popupCtaText !== 'View Batches'
        ? data.popupCtaText
        : DEFAULT_SITE_SETTINGS.popupCtaText,
    supportedMethods: Array.isArray(data.supportedMethods)
      ? data.supportedMethods
      : DEFAULT_SITE_SETTINGS.supportedMethods,
  };
}

function sortBatches(list: Batch[]): Batch[] {
  return [...list].sort(
    (a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0),
  );
}

function sortOffers(list: Offer[]): Offer[] {
  return [...list].sort(
    (a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0),
  );
}

function AppContent() {
  const initialCache = readCachedCatalog();

  const [route, setRoute] = useState<'storefront' | 'admin'>(() =>
    typeof window !== 'undefined' && isPersonalAdminPath(window.location.pathname)
      ? 'admin'
      : 'storefront',
  );

  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(() =>
    normalizeSettingsData(initialCache.settings),
  );
  const [dbBatches, setDbBatches] = useState<Batch[]>(() =>
    sortBatches(initialCache.batches),
  );
  const [offers, setOffers] = useState<Offer[]>(() =>
    sortOffers(initialCache.offers),
  );
  const [loadingBatches, setLoadingBatches] = useState(() =>
    initialCache.batches.length === 0,
  );
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [myOrderIds, setMyOrderIds] = useState<string[]>(loadSavedOrderIds);
  const [studentOrdersMap, setStudentOrdersMap] = useState<Record<string, Order>>({});
  const [domainCheckStatus, setDomainCheckStatus] = useState<'checking' | 'allowed' | 'blocked'>(() => {
    if (typeof window === 'undefined') return 'allowed';
    if (isBuiltInAuthorizedHost(window.location.hostname)) return 'allowed';
    if (
      initialCache.settings?.customDomain &&
      doesHostnameMatchCustomDomain(window.location.hostname, initialCache.settings.customDomain)
    ) {
      return 'allowed';
    }
    return 'checking';
  });

  useEffect(() => {
    const handlePop = () => {
      setRoute(isPersonalAdminPath(window.location.pathname) ? 'admin' : 'storefront');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const navigateTo = (target: 'storefront' | 'admin') => {
    const path = target === 'admin' ? '/ksl-admin-872' : '/';
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setRoute(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const [authError, setAuthError] = useState('');

  useEffect(() => {
    void getRedirectResult(auth)
      .then((res) => {
        if (res?.user) setAuthError('');
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Google Sign-In redirect failed.';
        setAuthError(msg);
      });
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) setAuthError('');
    });
    return () => unsub();
  }, []);

  const applyCatalogSnapshot = useCallback(
    (payload: {
      settings?: Partial<SiteSettings> | null;
      batches?: Batch[];
      offers?: Offer[];
    }) => {
      if (payload.settings) {
        const nextSettings = normalizeSettingsData(payload.settings);
        setSettings(nextSettings);
        writeCachedCatalog({ settings: nextSettings });
        if (typeof window !== 'undefined' && !isBuiltInAuthorizedHost(window.location.hostname)) {
          setDomainCheckStatus(
            doesHostnameMatchCustomDomain(window.location.hostname, payload.settings.customDomain)
              ? 'allowed'
              : 'blocked',
          );
        }
      } else if (typeof window !== 'undefined' && !isBuiltInAuthorizedHost(window.location.hostname)) {
        setDomainCheckStatus((prev) => (prev === 'checking' ? 'allowed' : prev));
      }

      if (Array.isArray(payload.batches)) {
        const sorted = sortBatches(payload.batches);
        setDbBatches(sorted);
        writeCachedCatalog({ batches: sorted });
        setLoadingBatches(false);
      }

      if (Array.isArray(payload.offers)) {
        const sorted = sortOffers(payload.offers);
        setOffers(sorted);
        writeCachedCatalog({ offers: sorted });
      }
    },
    [],
  );

  // Live catalog loader: local IndexedDB cache (0 quota reads) -> server datastore (/api/public-catalog) -> Firestore fallback
  useEffect(() => {
    let active = true;

    const recoverIndexedDbCache = async (): Promise<{
      batches: Batch[];
      offers: Offer[];
      settings: Partial<SiteSettings> | null;
    }> => {
      try {
        const [bSnap, oSnap, sSnap] = await Promise.all([
          getDocsFromCache(collection(db, 'batches')).catch(() => null),
          getDocsFromCache(collection(db, 'offers')).catch(() => null),
          getDocFromCache(doc(db, 'site_settings', 'global')).catch(() => null),
        ]);
        const batches = bSnap
          ? bSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Batch, 'id'>) }))
          : [];
        const offers = oSnap
          ? oSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Offer, 'id'>) }))
          : [];
        const settingsData =
          sSnap && sSnap.exists() ? (sSnap.data() as Partial<SiteSettings>) : null;
        return { batches, offers, settings: settingsData };
      } catch {
        return { batches: [], offers: [], settings: null };
      }
    };

    const loadFromFirestoreFallback = async () => {
      const cached = readCachedCatalog();
      if (cached.batches.length > 0 && Date.now() - cached.ts < 45_000) {
        if (active) setLoadingBatches(false);
        return;
      }

      try {
        const [settingsSnap, batchesSnap, offersSnap] = await Promise.all([
          getDoc(doc(db, 'site_settings', 'global')),
          getDocs(collection(db, 'batches')),
          getDocs(collection(db, 'offers')),
        ]);
        if (!active) return;

        setQuotaExceeded(false);
        applyCatalogSnapshot({
          settings: settingsSnap.exists()
            ? (settingsSnap.data() as Partial<SiteSettings>)
            : null,
          batches: batchesSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Batch, 'id'>),
          })),
          offers: offersSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Offer, 'id'>),
          })),
        });
      } catch (err) {
        if (!active) return;
        if (isQuotaExceededError(err)) {
          setQuotaExceeded(true);
        }
        logFirestoreError(err, OperationType.LIST, 'batches');
        if (typeof window !== 'undefined' && !isBuiltInAuthorizedHost(window.location.hostname)) {
          setDomainCheckStatus((prev) => (prev === 'checking' ? 'allowed' : prev));
        }
      } finally {
        if (active) setLoadingBatches(false);
      }
    };

    const loadLiveCatalog = async () => {
      const idb = await recoverIndexedDbCache();
      if (!active) return;
      if (idb.batches.length > 0 || idb.offers.length > 0 || idb.settings) {
        const currentLocal = readCachedCatalog();
        const mergedBatches = [...idb.batches];
        const seenB = new Set(mergedBatches.map((b) => b.id));
        for (const cb of currentLocal.batches) {
          if (!seenB.has(cb.id)) mergedBatches.push(cb);
        }
        const mergedOffers = [...idb.offers];
        const seenO = new Set(mergedOffers.map((o) => o.id));
        for (const co of currentLocal.offers) {
          if (!seenO.has(co.id)) mergedOffers.push(co);
        }
        applyCatalogSnapshot({
          settings: idb.settings ?? currentLocal.settings,
          batches: mergedBatches.length > 0 ? mergedBatches : undefined,
          offers: mergedOffers.length > 0 ? mergedOffers : undefined,
        });
      }

      try {
        const res = await fetch('/api/public-catalog', {
          credentials: 'same-origin',
          headers: { 'X-KSL-Client': 'ksl-v1' },
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = (await res.json()) as {
            ok?: boolean;
            firestoreSynced?: boolean;
            firestoreQuotaBlocked?: boolean;
            deletedBatchIds?: string[];
            deletedOfferIds?: string[];
            settings?: Partial<SiteSettings> | null;
            batches?: Batch[];
            offers?: Offer[];
          };

          if (!active) return;

          if (res.ok && data.ok) {
            const serverBatches = Array.isArray(data.batches) ? data.batches : [];
            const serverOffers = Array.isArray(data.offers) ? data.offers : [];
            const deletedBatches = new Set(
              Array.isArray(data.deletedBatchIds) ? data.deletedBatchIds : [],
            );
            const deletedOffers = new Set(
              Array.isArray(data.deletedOfferIds) ? data.deletedOfferIds : [],
            );
            const cachedNow = readCachedCatalog();

            // Merge server batches with any local cached batches not yet synced if Firestore hit 429
            const mergedBatches = [...serverBatches];
            if (data.firestoreQuotaBlocked && cachedNow.batches.length > 0) {
              const seen = new Set(mergedBatches.map((b) => b.id));
              for (const cb of cachedNow.batches) {
                if (cb?.id && !seen.has(cb.id) && !deletedBatches.has(cb.id)) {
                  mergedBatches.push(cb);
                }
              }
            }

            const mergedOffers = [...serverOffers];
            if (data.firestoreQuotaBlocked && cachedNow.offers.length > 0) {
              const seenO = new Set(mergedOffers.map((o) => o.id));
              for (const co of cachedNow.offers) {
                if (co?.id && !seenO.has(co.id) && !deletedOffers.has(co.id)) {
                  mergedOffers.push(co);
                }
              }
            }

            setQuotaExceeded(
              mergedBatches.length === 0 && Boolean(data.firestoreQuotaBlocked),
            );
            applyCatalogSnapshot({
              settings: data.settings ?? cachedNow.settings ?? null,
              batches: mergedBatches,
              offers: mergedOffers,
            });
            return;
          }
        }
      } catch {
        // Fall through to static Firestore fallback if backend route is unavailable
      }

      await loadFromFirestoreFallback();
    };

    void loadLiveCatalog();

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void loadLiveCatalog();
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    const handleCrossTabSync = () => {
      void loadLiveCatalog();
    };
    window.addEventListener('storage', handleCrossTabSync);
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('ksl_catalog_sync');
        bc.onmessage = () => {
          void loadLiveCatalog();
        };
      }
    } catch {
      bc = null;
    }

    const pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadLiveCatalog();
      }
    }, 20000);

    return () => {
      active = false;
      clearInterval(pollTimer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('storage', handleCrossTabSync);
      if (bc) bc.close();
    };
  }, [route, applyCatalogSnapshot]);

  // Fetch & auto-refresh student's tracked orders from server datastore (/api/orders/status)
  useEffect(() => {
    if (myOrderIds.length === 0) {
      setStudentOrdersMap({});
      return;
    }
    let active = true;
    const recentIds = myOrderIds.slice(0, 10);

    const refreshOrderStatuses = async () => {
      try {
        const res = await fetch('/api/orders/status', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-KSL-Client': 'ksl-v1',
          },
          body: JSON.stringify({ orderIds: recentIds }),
        });
        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean; orders?: Order[] };
          if (active && data.ok && Array.isArray(data.orders)) {
            setStudentOrdersMap((prev) => {
              const next = { ...prev };
              for (const ord of data.orders!) {
                if (ord && ord.id) {
                  next[ord.id] = ord;
                }
              }
              return next;
            });
            return;
          }
        }
        if (res.status !== 404) return;
      } catch {
        // Fallback below only if backend route is unavailable
      }

      try {
        const snaps = await Promise.all(
          recentIds.slice(0, 6).map((id) => getDoc(doc(db, 'orders', id))),
        );
        if (!active) return;
        setStudentOrdersMap((prev) => {
          const next = { ...prev };
          for (const snap of snaps) {
            if (snap.exists()) {
              next[snap.id] = {
                id: snap.id,
                ...(snap.data() as Omit<Order, 'id'>),
              };
            }
          }
          return next;
        });
      } catch {
        // Ignore fallback failure cleanly
      }
    };

    void refreshOrderStatuses();

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        void refreshOrderStatuses();
      }
    };
    window.addEventListener('focus', handleFocus);

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshOrderStatuses();
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [myOrderIds]);

  const handleOrderCreated = (orderId: string, initialOrder?: Order) => {
    if (initialOrder) {
      setStudentOrdersMap((prev) => ({
        ...prev,
        [orderId]: initialOrder,
      }));
    }
    setMyOrderIds((prev) => {
      const next = (prev.includes(orderId) ? prev : [orderId, ...prev]).slice(0, 10);
      try {
        localStorage.setItem('ksl_my_order_ids', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleAdminSignIn = async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      const inIframe = typeof window !== 'undefined' && window.self !== window.top;
      if (
        !inIframe &&
        (code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment')
      ) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      const msg =
        inIframe
          ? 'Google login popup was blocked inside preview frame. Open the Admin link in a full Chrome tab to connect.'
          : code === 'auth/popup-closed-by-user'
            ? 'Sign-in popup closed. Tap "Open in Chrome" (⋮ menu) if popups fail inside an in-app browser.'
            : err instanceof Error
              ? err.message
              : 'Google Sign-In failed.';
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const handleAdminSignOut = async () => {
    await signOut(auth);
  };

  const storefrontBatches: Batch[] = dbBatches;
  const studentOrders = Object.values(studentOrdersMap);

  if (domainCheckStatus === 'checking') {
    return (
      <div className="min-h-screen bg-[#030307] text-zinc-200 flex items-center justify-center p-6">
        <div className="px-6 py-3.5 rounded-2xl hd-glass-surface border border-pink-400/40 text-xs font-bold tracking-wide">
          Verifying domain...
        </div>
      </div>
    );
  }

  if (domainCheckStatus === 'blocked') {
    return (
      <div className="min-h-screen bg-[#050508] text-rose-400 flex items-center justify-center p-6 text-center">
        <div className="space-y-2 max-w-md">
          <h1 className="text-xl font-bold">Unauthorized Clone Blocked</h1>
          <p className="text-xs text-zinc-400">
            This application can only run on its verified origin or an Admin-authorized custom domain.
          </p>
        </div>
      </div>
    );
  }

  if (route === 'admin') {
    if (isUnauthorizedAdminEmbed()) {
      return (
        <div className="min-h-screen bg-[#050508] text-rose-400 flex items-center justify-center p-6 text-center">
          <div className="space-y-2 max-w-md">
            <h1 className="text-xl font-bold">Unauthorized Admin Embed Blocked</h1>
            <p className="text-xs text-zinc-400">
              Admin Panel can only be opened directly or on authorized app hosts.
            </p>
          </div>
        </div>
      );
    }
    return (
      <AdminPanel
        user={user}
        authError={authError}
        settings={settings}
        batches={dbBatches}
        offers={offers}
        quotaExceeded={quotaExceeded}
        onSyncCatalog={applyCatalogSnapshot}
        onSignIn={handleAdminSignIn}
        onSignOut={handleAdminSignOut}
        onBackToStorefront={() => navigateTo('storefront')}
      />
    );
  }

  return (
    <Storefront
      settings={settings}
      batches={storefrontBatches}
      offers={offers}
      orders={studentOrders}
      loadingData={loadingBatches}
      quotaExceeded={quotaExceeded}
      onOrderCreated={handleOrderCreated}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
