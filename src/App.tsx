import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase';
import { Batch, Offer, Order, SiteSettings } from './types';
import { DEFAULT_SITE_SETTINGS, STARTER_BATCHES } from './constants/defaults';
import {
  doesHostnameMatchCustomDomain,
  isBuiltInAuthorizedHost,
} from './utils/antiClone';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Storefront } from './pages/Storefront';
import { AdminPanel } from './pages/AdminPanel';

function loadSavedOrderIds(): string[] {
  try {
    const raw = localStorage.getItem('ksl_my_order_ids');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length >= 24)
      : [];
  } catch {
    return [];
  }
}

function isPersonalAdminPath(pathname: string): boolean {
  return pathname.startsWith('/ksl-admin-872');
}

function AppContent() {
  const [route, setRoute] = useState<'storefront' | 'admin'>(() =>
    typeof window !== 'undefined' && isPersonalAdminPath(window.location.pathname)
      ? 'admin'
      : 'storefront',
  );

  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [dbBatches, setDbBatches] = useState<Batch[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [myOrderIds, setMyOrderIds] = useState<string[]>(loadSavedOrderIds);
  const [studentOrdersMap, setStudentOrdersMap] = useState<Record<string, Order>>({});
  const [domainCheckStatus, setDomainCheckStatus] = useState<'checking' | 'allowed' | 'blocked'>(() =>
    typeof window !== 'undefined' && !isBuiltInAuthorizedHost(window.location.hostname)
      ? 'checking'
      : 'allowed',
  );

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
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsub();
  }, []);

  // Live site_settings/global
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'site_settings', 'global'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<SiteSettings>;
          const rawTg = typeof data.supportTelegramUrl === 'string' ? data.supportTelegramUrl.trim() : '';
          const normalizedTg =
            !rawTg || rawTg === 'https://t.me/'
              ? DEFAULT_SITE_SETTINGS.supportTelegramUrl
              : rawTg;
          setSettings({
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
          });
          if (typeof window !== 'undefined' && !isBuiltInAuthorizedHost(window.location.hostname)) {
            setDomainCheckStatus(
              doesHostnameMatchCustomDomain(window.location.hostname, data.customDomain)
                ? 'allowed'
                : 'blocked',
            );
          }
        } else if (typeof window !== 'undefined' && !isBuiltInAuthorizedHost(window.location.hostname)) {
          setDomainCheckStatus('blocked');
        }
      },
      (err) => {
        if (typeof window !== 'undefined' && !isBuiltInAuthorizedHost(window.location.hostname)) {
          setDomainCheckStatus('blocked');
        }
        handleFirestoreError(err, OperationType.GET, 'site_settings/global');
      },
    );
    return () => unsub();
  }, []);

  // Live public batches catalog
  useEffect(() => {
    const q = query(collection(db, 'batches'), orderBy('displayOrder', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Batch[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Batch, 'id'>),
        }));
        setDbBatches(items);
        setLoadingBatches(false);
      },
      (err) => {
        setLoadingBatches(false);
        handleFirestoreError(err, OperationType.LIST, 'batches');
      },
    );
    return () => unsub();
  }, []);

  // Live promotional offers
  useEffect(() => {
    const q = query(collection(db, 'offers'), orderBy('displayOrder', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Offer[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Offer, 'id'>),
        }));
        setOffers(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'offers');
      },
    );
    return () => unsub();
  }, []);

  // Watch student's own submitted order docs directly without requiring student login
  useEffect(() => {
    if (myOrderIds.length === 0) {
      setStudentOrdersMap({});
      return;
    }
    const unsubs = myOrderIds.map((orderId) =>
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
          // Ignore missing/removed order doc cleanly
        },
      ),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [myOrderIds]);

  const handleOrderCreated = (orderId: string) => {
    setMyOrderIds((prev) => {
      const next = prev.includes(orderId) ? prev : [orderId, ...prev];
      try {
        localStorage.setItem('ksl_my_order_ids', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleAdminSignIn = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const handleAdminSignOut = async () => {
    await signOut(auth);
  };

  const storefrontBatches: Batch[] =
    dbBatches.length > 0
      ? dbBatches
      : STARTER_BATCHES.map(({ targetUrl: _t, accessInstructions: _a, ...rest }) => rest);

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
    return (
      <AdminPanel
        user={user}
        settings={settings}
        batches={dbBatches}
        offers={offers}
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
