import { useCallback, useEffect, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore';
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
  return {
    ...DEFAULT_SITE_SETTINGS,
    ...data,
    supportTelegramUrl: normalizedTg,
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

  useEffect(() => {
    void getRedirectResult(auth).catch(() => {
      // Ignore redirect auth errors on storefront load
    });
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
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

  // Storefront data loader: server cache (/api/public-catalog) first -> single Firestore fallback if needed
  useEffect(() => {
    if (route !== 'storefront') return;
    let active = true;

    const loadFromFirestoreFallback = async () => {
      const cached = readCachedCatalog();
      // Avoid redundant reads on rapid reloads within 45s when we already have cached batches
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

    const loadStorefrontCatalog = async () => {
      try {
        const res = await fetch('/api/public-catalog', {
          credentials: 'same-origin',
          headers: { 'X-KSL-Client': 'ksl-v1' },
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = (await res.json()) as {
            ok?: boolean;
            quotaLimited?: boolean;
            quotaExceeded?: boolean;
            settings?: Partial<SiteSettings> | null;
            batches?: Batch[];
            offers?: Offer[];
          };

          if (!active) return;

          if (res.ok && data.ok) {
            setQuotaExceeded(Boolean(data.quotaLimited));
            applyCatalogSnapshot({
              settings: data.settings ?? null,
              batches: Array.isArray(data.batches) ? data.batches : [],
              offers: Array.isArray(data.offers) ? data.offers : [],
            });
            return;
          }

          if (data.quotaExceeded) {
            setQuotaExceeded(true);
            setLoadingBatches(false);
            if (typeof window !== 'undefined' && !isBuiltInAuthorizedHost(window.location.hostname)) {
              setDomainCheckStatus((prev) => (prev === 'checking' ? 'allowed' : prev));
            }
            return;
          }
        }
      } catch {
        // Fallback cleanly to Firestore when backend route is unavailable (e.g. static deploy)
      }

      await loadFromFirestoreFallback();
    };

    void loadStorefrontCatalog();

    return () => {
      active = false;
    };
  }, [route, applyCatalogSnapshot]);

  // Admin Console live Firestore listeners (single listener per collection, no duplicate getDocs)
  useEffect(() => {
    if (route !== 'admin') return;
    let active = true;

    const unsubSettings = onSnapshot(
      doc(db, 'site_settings', 'global'),
      (snap) => {
        if (!active) return;
        setQuotaExceeded(false);
        if (snap.exists()) {
          applyCatalogSnapshot({
            settings: snap.data() as Partial<SiteSettings>,
          });
        }
      },
      (err) => {
        if (!active) return;
        if (isQuotaExceededError(err)) setQuotaExceeded(true);
        logFirestoreError(err, OperationType.GET, 'site_settings/global');
      },
    );

    const unsubBatches = onSnapshot(
      collection(db, 'batches'),
      (snap) => {
        if (!active) return;
        setQuotaExceeded(false);
        applyCatalogSnapshot({
          batches: snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Batch, 'id'>),
          })),
        });
      },
      (err) => {
        if (!active) return;
        if (isQuotaExceededError(err)) setQuotaExceeded(true);
        setLoadingBatches(false);
        logFirestoreError(err, OperationType.LIST, 'batches');
      },
    );

    const unsubOffers = onSnapshot(
      collection(db, 'offers'),
      (snap) => {
        if (!active) return;
        applyCatalogSnapshot({
          offers: snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Offer, 'id'>),
          })),
        });
      },
      (err) => {
        if (!active) return;
        if (isQuotaExceededError(err)) setQuotaExceeded(true);
        logFirestoreError(err, OperationType.LIST, 'offers');
      },
    );

    return () => {
      active = false;
      unsubSettings();
      unsubBatches();
      unsubOffers();
    };
  }, [route, applyCatalogSnapshot]);

  // Watch student's active order docs cleanly without polling/spamming quota
  useEffect(() => {
    if (myOrderIds.length === 0) {
      setStudentOrdersMap({});
      return;
    }
    const recentIds = myOrderIds.slice(0, 6);
    const unsubs = recentIds.map((orderId) =>
      onSnapshot(
        doc(db, 'orders', orderId),
        (snap) => {
          if (snap.exists()) {
            setStudentOrdersMap((prev) => ({
              ...prev,
              [orderId]: {
                id: snap.id,
                ...(snap.data() as Omit<Order, 'id'>),
              },
            }));
          }
        },
        () => {
          // Ignore missing/quota/removed order doc cleanly
        },
      ),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [myOrderIds]);

  const handleOrderCreated = (orderId: string) => {
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
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      throw err;
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
              Admin Panel can only be opened directly or inside authorized preview hosts.
            </p>
          </div>
        </div>
      );
    }
    return (
      <AdminPanel
        user={user}
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
