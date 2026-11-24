import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  getDocsFromCache,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Edit3,
  ExternalLink,
  Flame,
  Globe,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  Layers,
  LogOut,
  Plus,
  QrCode,
  RefreshCw,
  Settings,
  Trash2,
  Users,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  ALL_PAYMENT_METHODS,
  Batch,
  GlowTheme,
  Offer,
  OpenType,
  Order,
  SiteSettings,
  ThumbnailAspect,
  ThumbnailSize,
} from '../types';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  FIRESTORE_UPGRADE_URL,
  logFirestoreError,
  OperationType,
} from '../firebase';
import { readCachedCatalog } from '../utils/catalogCache';
import { DEFAULT_SITE_SETTINGS } from '../constants/defaults';
import {
  compressImageFile,
  generateHdThumbnailDataUrl,
} from '../utils/imageTools';
import { normalizeCustomDomain } from '../utils/antiClone';
import { VerifiedMark } from '../components/VerifiedMark';
import { BatchThumbnail } from '../components/BatchThumbnail';

type AdminTab = 'overview' | 'batches' | 'offers' | 'approvals' | 'payments' | 'settings';

interface BatchFormState {
  id: string;
  title: string;
  price: string;
  originalPrice: string;
  thumbnailUrl: string;
  thumbnailSize: ThumbnailSize;
  thumbnailAspect: ThumbnailAspect;
  glowAccent: GlowTheme;
  openType: OpenType;
  targetUrl: string;
  accessInstructions: string;
  isActive: boolean;
  isFeatured: boolean;
  showCheckmark: boolean;
  requirePayment: boolean;
  plan1Label: string;
  plan2Label: string;
  plan2Price: string;
  plan3Label: string;
  plan3Price: string;
  displayOrder: string;
}

const EMPTY_BATCH_FORM: BatchFormState = {
  id: '',
  title: '',
  price: '49',
  originalPrice: '199',
  thumbnailUrl: '',
  thumbnailSize: 'standard',
  thumbnailAspect: '16:9',
  glowAccent: 'amber',
  openType: 'telegram',
  targetUrl: '',
  accessInstructions: 'Approved! Click the button below to access your batch.',
  isActive: true,
  isFeatured: false,
  showCheckmark: true,
  requirePayment: true,
  plan1Label: '1 Year',
  plan2Label: '2 Years',
  plan2Price: '59',
  plan3Label: 'Lifetime',
  plan3Price: '69',
  displayOrder: '1',
};

export function AdminPanel({
  user,
  authError = '',
  settings,
  batches,
  offers,
  quotaExceeded: _quotaExceeded = false,
  onSyncCatalog,
  onSignIn,
  onSignOut,
  onBackToStorefront,
}: {
  user: User | null;
  authError?: string;
  settings: SiteSettings;
  batches: Batch[];
  offers: Offer[];
  quotaExceeded?: boolean;
  onSyncCatalog?: (payload: {
    settings?: Partial<SiteSettings> | null;
    batches?: Batch[];
    offers?: Offer[];
  }) => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onBackToStorefront: () => void;
}) {
  const [codeInput, setCodeInput] = useState('');
  const [adminToken, setAdminToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem('ksl_admin_token') || '';
    } catch {
      return '';
    }
  });
  const [codeVerified, setCodeVerified] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [codeError, setCodeError] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);

  const [isDbAdmin, setIsDbAdmin] = useState(false);
  const [connectingSync, setConnectingSync] = useState(false);
  const [pushingToVercel, setPushingToVercel] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [serverOrders, setServerOrders] = useState<Order[]>([]);
  const [firestoreOrders, setFirestoreOrders] = useState<Order[]>([]);
  const [firestoreSynced, setFirestoreSynced] = useState<boolean>(true);
  const [syncingFirestore, setSyncingFirestore] = useState<boolean>(false);
  const [secretTargets, setSecretTargets] = useState<
    Record<string, { targetUrl?: string; accessInstructions?: string }>
  >({});
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Batch Editor State
  const [batchForm, setBatchForm] = useState<BatchFormState>(EMPTY_BATCH_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingBatch, setSavingBatch] = useState(false);
  const [thumbStyle, setThumbStyle] = useState<
    'aura_grid' | 'prism_beams' | 'crimson_horizon' | 'obsidian_crest'
  >('aura_grid');
  const [generatingThumb, setGeneratingThumb] = useState(false);

  // Offer Editor State
  const [offerForm, setOfferForm] = useState({
    title: '',
    badge: 'LIMITED',
    description: '',
    isActive: true,
    displayOrder: '1',
  });
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [savingOffer, setSavingOffer] = useState(false);

  // Approvals filter state
  const [orderFilter, setOrderFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [orderSearch, setOrderSearch] = useState('');
  const [adminRemarks, setAdminRemarks] = useState<Record<string, string>>({});
  const [previewScreenshot, setPreviewScreenshot] = useState<string | null>(null);

  // Settings & Payments Editor State
  const [settingsForm, setSettingsForm] = useState<SiteSettings>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedStorefrontLink, setCopiedStorefrontLink] = useState(false);
  const [copiedCustomType, setCopiedCustomType] = useState<'storefront' | 'admin' | null>(null);
  const [checkingDns, setCheckingDns] = useState(false);
  const [dnsError, setDnsError] = useState('');
  const [dnsResult, setDnsResult] = useState<{
    domain: string;
    cnameRecords: string[];
    aRecords: string[];
    pointsToGoogleHost: boolean;
    connected: boolean;
  } | null>(null);

  const lastSettingsJsonRef = React.useRef<string>('');
  useEffect(() => {
    const serialized = JSON.stringify(settings);
    if (serialized !== lastSettingsJsonRef.current) {
      lastSettingsJsonRef.current = serialized;
      setSettingsForm(settings);
    }
  }, [settings]);

  // Verify optional Firestore cloud backup role silently when signed in
  useEffect(() => {
    if (!user) {
      setIsDbAdmin(false);
      return;
    }
    if (
      user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase() &&
      user.emailVerified
    ) {
      setIsDbAdmin(true);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'admins', user.uid))
      .then((snap) => {
        if (!cancelled) setIsDbAdmin(snap.exists());
      })
      .catch(() => {
        if (!cancelled) setIsDbAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const unlocked = codeVerified;

  const adminHeaders = useCallback(
    (includeJson = true): Record<string, string> => {
      let token = adminToken;
      if (!token) {
        try {
          token = sessionStorage.getItem('ksl_admin_token') || '';
        } catch {
          token = '';
        }
      }
      return {
        ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
        'X-KSL-Client': 'ksl-v1',
        ...(token ? { 'X-Admin-Session': token } : {}),
      };
    },
    [adminToken],
  );

  const handleSessionExpired = useCallback(() => {
    try {
      sessionStorage.removeItem('ksl_admin_token');
    } catch {
      // ignore
    }
    setAdminToken('');
    setCodeVerified(false);
    setCodeError('Session expired. Please enter Admin Access Code to continue.');
  }, []);

  const fetchAdminBootstrap = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/bootstrap', {
        credentials: 'same-origin',
        headers: adminHeaders(false),
      });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        firestoreSynced?: boolean;
        settings?: Partial<SiteSettings> | null;
        batches?: Batch[];
        batchSecrets?: Record<string, { targetUrl?: string; accessInstructions?: string }>;
        offers?: Offer[];
        orders?: Order[];
      };
      if (!data.ok) return;
      setFirestoreSynced(Boolean(data.firestoreSynced));

      let currentBatches = Array.isArray(data.batches) ? data.batches : [];
      let currentOffers = Array.isArray(data.offers) ? data.offers : [];
      let currentSettings = data.settings ?? null;
      let currentSecrets =
        data.batchSecrets && typeof data.batchSecrets === 'object' ? data.batchSecrets : {};

      // Rescue any old batches/offers/secrets cached in browser IndexedDB or localStorage
      try {
        const localCached = readCachedCatalog();
        const [bSnap, oSnap, sSnap] = await Promise.all([
          getDocsFromCache(collection(db, 'batches')).catch(() => null),
          getDocsFromCache(collection(db, 'offers')).catch(() => null),
          getDocFromCache(doc(db, 'site_settings', 'global')).catch(() => null),
        ]);

        const cachedBatches: Batch[] = [
          ...(bSnap ? bSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Batch, 'id'>) })) : []),
          ...localCached.batches,
        ];
        const cachedOffers: Offer[] = [
          ...(oSnap ? oSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Offer, 'id'>) })) : []),
          ...localCached.offers,
        ];
        const cachedSettings =
          sSnap && sSnap.exists() ? (sSnap.data() as Partial<SiteSettings>) : localCached.settings;

        const serverBatchIds = new Set(currentBatches.map((b) => b.id));
        const serverOfferIds = new Set(currentOffers.map((o) => o.id));
        const extraBatches = cachedBatches.filter((b) => b && b.id && !serverBatchIds.has(b.id));
        const extraOffers = cachedOffers.filter((o) => o && o.id && !serverOfferIds.has(o.id));
        const extraSecrets: Record<string, { targetUrl?: string; accessInstructions?: string }> = {};

        for (const b of cachedBatches) {
          if (b && b.id && !currentSecrets[b.id]) {
            const sec = await getDocFromCache(
              doc(db, 'batches', b.id, 'private', 'access'),
            ).catch(() => null);
            if (sec && sec.exists()) {
              const sd = sec.data();
              if (sd?.targetUrl) {
                extraSecrets[b.id] = {
                  targetUrl: String(sd.targetUrl || ''),
                  accessInstructions: String(sd.accessInstructions || ''),
                };
              }
            }
          }
        }

        if (
          extraBatches.length > 0 ||
          extraOffers.length > 0 ||
          (!currentSettings && cachedSettings) ||
          Object.keys(extraSecrets).length > 0
        ) {
          const mergeRes = await fetch('/api/admin/merge-cache', {
            method: 'POST',
            credentials: 'same-origin',
            headers: adminHeaders(),
            body: JSON.stringify({
              settings: !currentSettings ? cachedSettings : null,
              batches: extraBatches,
              offers: extraOffers,
              batchSecrets: extraSecrets,
            }),
          });
          if (mergeRes.ok) {
            const mergedData = (await mergeRes.json()) as {
              ok?: boolean;
              settings?: Partial<SiteSettings> | null;
              batches?: Batch[];
              batchSecrets?: Record<string, { targetUrl?: string; accessInstructions?: string }>;
              offers?: Offer[];
            };
            if (mergedData.ok) {
              if (Array.isArray(mergedData.batches)) currentBatches = mergedData.batches;
              if (Array.isArray(mergedData.offers)) currentOffers = mergedData.offers;
              if (mergedData.settings) currentSettings = mergedData.settings;
              if (mergedData.batchSecrets) currentSecrets = mergedData.batchSecrets;
            }
          }
        }
      } catch {
        // Ignore browser cache lookup issues cleanly
      }

      if (Array.isArray(data.orders)) {
        setServerOrders(data.orders);
      }
      setSecretTargets(currentSecrets);
      onSyncCatalog?.({
        settings: currentSettings,
        batches: currentBatches,
        offers: currentOffers,
      });
    } catch {
      // Keep current state if transient network hiccup occurs
    }
  }, [adminHeaders, handleSessionExpired, onSyncCatalog]);

  // Load live batches, offers, secrets, settings & orders directly from server store once unlocked
  useEffect(() => {
    if (!unlocked) {
      setServerOrders([]);
      setFirestoreOrders([]);
      return;
    }
    void fetchAdminBootstrap();
    const timer = setInterval(() => {
      void fetchAdminBootstrap();
    }, 10000);
    return () => clearInterval(timer);
  }, [unlocked, fetchAdminBootstrap]);

  // Listen in real time to student orders placed on https://khatushyamlearning.vercel.app/ via Firestore
  useEffect(() => {
    if (!unlocked || !user || !isDbAdmin) {
      setFirestoreOrders([]);
      return;
    }
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Order, 'id'>),
        }));
        setFirestoreOrders(docs);
        if (docs.length > 0) {
          void fetch('/api/admin/sync-orders', {
            method: 'POST',
            credentials: 'same-origin',
            headers: adminHeaders(),
            body: JSON.stringify({ orders: docs }),
          }).catch(() => {});
        }
      },
      (err) => {
        const msg = logFirestoreError(err, OperationType.LIST, 'orders');
        setErrorMessage(msg);
      },
    );
    return () => unsub();
  }, [unlocked, user, isDbAdmin, adminHeaders]);

  const toTimestampMs = (value: unknown): number => {
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

  const allOrders = useMemo(() => {
    const byId = new Map<string, Order>();
    for (const o of serverOrders) {
      if (o?.id) byId.set(o.id, o);
    }
    for (const fo of firestoreOrders) {
      if (!fo?.id) continue;
      const existing = byId.get(fo.id);
      if (!existing || toTimestampMs(fo.updatedAt) >= toTimestampMs(existing.updatedAt)) {
        byId.set(fo.id, fo);
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt),
    );
  }, [serverOrders, firestoreOrders]);

  const adminUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/ksl-admin-872`
      : '/ksl-admin-872';

  const storefrontShareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/` : '/';

  // Verify server-issued HMAC admin session on mount so DevTools sessionStorage tampering cannot unlock the panel
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const verifyServerSession = async () => {
      try {
        const res = await fetch('/api/admin/session', {
          credentials: 'same-origin',
          signal: controller.signal,
          headers: {
            'X-KSL-Client': 'ksl-v1',
            ...(adminToken ? { 'X-Admin-Session': adminToken } : {}),
          },
        });
        if (!active) return;
        const ct = res.headers.get('content-type') || '';
        const data = ct.includes('application/json')
          ? ((await res.json().catch(() => ({}))) as { ok?: boolean })
          : { ok: false };
        const valid = res.ok && data.ok === true;
        setCodeVerified(valid);
        if (!valid) {
          setAdminToken('');
          try {
            sessionStorage.removeItem('ksl_admin_token');
          } catch {
            // ignore
          }
        }
      } catch {
        if (active) setCodeVerified(false);
      } finally {
        clearTimeout(timeoutId);
        if (active) setCheckingSession(false);
      }
    };
    void verifyServerSession();
    return () => {
      active = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError('');
    setVerifyingCode(true);
    try {
      const res = await fetch('/api/admin/verify-code', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-KSL-Client': 'ksl-v1',
        },
        body: JSON.stringify({ code: codeInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCodeError(data.error || 'Invalid access code.');
        return;
      }
      const nextToken = typeof data.sessionToken === 'string' ? data.sessionToken : '';
      setAdminToken(nextToken);
      setCodeVerified(true);
      setCodeInput('');
      try {
        if (nextToken) {
          sessionStorage.setItem('ksl_admin_token', nextToken);
        }
      } catch {
        // ignore storage restrictions
      }
    } catch {
      setCodeError('Could not verify code. Please check server connection.');
    } finally {
      setVerifyingCode(false);
    }
  };

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setErrorMessage('');
    setTimeout(() => setStatusMessage(''), 4500);
  };

  const resolveExistingCreatedAt = async (colName: 'batches' | 'offers', docId: string) => {
    try {
      const snap = await getDoc(doc(db, colName, docId));
      if (snap.exists() && snap.data()?.createdAt) {
        return snap.data().createdAt;
      }
    } catch {
      // fallback to serverTimestamp if doc doesn't exist or lookup fails
    }
    return serverTimestamp();
  };

  const handleConnectVercelSync = async () => {
    setConnectingSync(true);
    setErrorMessage('');
    try {
      if (user && !isDbAdmin) {
        await onSignOut();
      }
      await onSignIn();
      showToast('Connected live sync with khatushyamlearning.vercel.app!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In was cancelled or blocked.';
      setErrorMessage(`Could not connect Google Admin Sync: ${msg}`);
    } finally {
      setConnectingSync(false);
    }
  };

  const handleSyncOldFirebaseBatches = async () => {
    setSyncingFirestore(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/admin/sync-firestore', {
        method: 'POST',
        credentials: 'same-origin',
        headers: adminHeaders(),
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        synced?: boolean;
        quotaExceeded?: boolean;
        addedBatches?: number;
        addedOffers?: number;
        batches?: Batch[];
        offers?: Offer[];
        settings?: Partial<SiteSettings> | null;
      };
      if (data.synced || (Array.isArray(data.batches) && data.batches.length > 0)) {
        setFirestoreSynced(true);
        onSyncCatalog?.({
          batches: Array.isArray(data.batches) ? data.batches : batches,
          offers: Array.isArray(data.offers) ? data.offers : offers,
          settings: data.settings ?? settings,
        });
        showToast(
          `Synced live from khatushyamlearning.vercel.app (${Array.isArray(data.batches) ? data.batches.length : 0} batches, ${Array.isArray(data.offers) ? data.offers.length : 0} offers).`,
        );
      } else if (data.quotaExceeded) {
        setErrorMessage(
          'Firebase Firestore free daily read quota is currently full. Quota resets tomorrow.',
        );
      } else {
        setErrorMessage('Could not pull catalog from Firebase right now. Please try again shortly.');
      }
    } catch {
      setErrorMessage('Failed to reach server for Vercel/Firebase sync.');
    } finally {
      setSyncingFirestore(false);
    }
  };

  const handlePushAllToVercel = async () => {
    if (!user || !isDbAdmin) {
      setErrorMessage(`Click "Connect Vercel Sync" with ${BOOTSTRAPPED_ADMIN_EMAIL} first.`);
      return;
    }
    setPushingToVercel(true);
    setErrorMessage('');
    try {
      const rawCustomDomain = (settingsForm.customDomain || '').trim();
      const normalizedCustomDomain = rawCustomDomain ? normalizeCustomDomain(rawCustomDomain) : '';
      const cleanSettings = {
        brandName: (settingsForm.brandName.trim() || 'KHATU SHYAM LEARNING').slice(0, 100),
        showCheckmark: Boolean(settingsForm.showCheckmark),
        popupEnabled: Boolean(settingsForm.popupEnabled),
        popupText: settingsForm.popupText.trim().slice(0, 240),
        popupCtaText: settingsForm.popupCtaText.trim().slice(0, 60),
        heroTitle: (settingsForm.heroTitle.trim() || DEFAULT_SITE_SETTINGS.heroTitle).slice(0, 160),
        heroSubtitle: settingsForm.heroSubtitle.trim().slice(0, 400),
        glowTheme: settingsForm.glowTheme,
        upiId: settingsForm.upiId.trim().slice(0, 120),
        merchantName: settingsForm.merchantName.trim().slice(0, 100),
        qrImageUrl: settingsForm.qrImageUrl,
        bankDetails: settingsForm.bankDetails.trim().slice(0, 500),
        paymentInstructions: settingsForm.paymentInstructions.trim().slice(0, 600),
        gatewayPaymentUrl: settingsForm.gatewayPaymentUrl.trim().slice(0, 500),
        supportTelegramUrl: settingsForm.supportTelegramUrl.trim().slice(0, 300),
        supportWhatsapp: settingsForm.supportWhatsapp.trim().slice(0, 300),
        supportedMethods: settingsForm.supportedMethods.slice(0, 10),
        customDomain: normalizedCustomDomain.slice(0, 180),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(doc(db, 'site_settings', 'global'), cleanSettings);
      } catch (err) {
        setErrorMessage(logFirestoreError(err, OperationType.WRITE, 'site_settings/global'));
        return;
      }

      for (const b of batches) {
        try {
          const createdAt = await resolveExistingCreatedAt('batches', b.id);
          const bw = writeBatch(db);
          bw.set(doc(db, 'batches', b.id), {
            title: String(b.title || '').slice(0, 140),
            subtitle: String(b.subtitle || '').slice(0, 240),
            description: String(b.description || '').slice(0, 2000),
            category: String(b.category || 'Batch').slice(0, 60),
            instructor: String(b.instructor || '').slice(0, 80),
            price: Math.max(0, Number(b.price) || 0),
            originalPrice: Math.max(0, Number(b.originalPrice) || 0),
            thumbnailUrl: String(b.thumbnailUrl || '').slice(0, 500000),
            thumbnailSize: b.thumbnailSize || 'standard',
            thumbnailAspect: b.thumbnailAspect || '16:9',
            glowAccent: b.glowAccent || 'amber',
            openType: b.openType || 'webview',
            isActive: b.isActive !== false,
            isFeatured: Boolean(b.isFeatured),
            showCheckmark: b.showCheckmark !== false,
            requirePayment: b.requirePayment !== false && Number(b.price) > 0,
            plan1Label: String(b.plan1Label || '1 Year').slice(0, 40),
            plan2Label: String(b.plan2Label || '2 Years').slice(0, 40),
            plan2Price:
              typeof b.plan2Price === 'number'
                ? Math.max(0, b.plan2Price)
                : Math.max(0, (Number(b.price) || 0) + 10),
            plan3Label: String(b.plan3Label || 'Lifetime').slice(0, 40),
            plan3Price:
              typeof b.plan3Price === 'number'
                ? Math.max(0, b.plan3Price)
                : Math.max(0, (Number(b.price) || 0) + 20),
            displayOrder: Math.max(0, Number(b.displayOrder) || 1),
            createdAt,
            updatedAt: serverTimestamp(),
          });
          const sec = secretTargets[b.id];
          if (sec?.targetUrl) {
            bw.set(doc(db, 'batches', b.id, 'private', 'access'), {
              targetUrl: sec.targetUrl.slice(0, 1000),
              accessInstructions: String(sec.accessInstructions || '').slice(0, 1000),
              updatedAt: serverTimestamp(),
            });
          }
          await bw.commit();
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.WRITE, `batches/${b.id}`));
          return;
        }
      }

      for (const o of offers) {
        try {
          const createdAt = await resolveExistingCreatedAt('offers', o.id);
          await setDoc(doc(db, 'offers', o.id), {
            title: String(o.title || '').slice(0, 120),
            badge: String(o.badge || '').slice(0, 40),
            description: String(o.description || '').slice(0, 300),
            isActive: o.isActive !== false,
            displayOrder: Math.max(0, Number(o.displayOrder) || 1),
            createdAt,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.WRITE, `offers/${o.id}`));
          return;
        }
      }

      showToast(
        `All ${batches.length} batches, ${offers.length} offers & settings synced LIVE to khatushyamlearning.vercel.app!`,
      );
    } finally {
      setPushingToVercel(false);
    }
  };

  const handleUploadThumbnail = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 800, 0.78);
      setBatchForm((prev) => ({ ...prev, thumbnailUrl: compressed }));
      showToast('Thumbnail uploaded & optimized.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Thumbnail upload failed.');
    }
  };

  const handleGenerateThumbnail = async () => {
    if (!batchForm.title.trim()) {
      setErrorMessage('Enter a Batch Title first to generate its HD thumbnail.');
      return;
    }
    setGeneratingThumb(true);
    setErrorMessage('');
    try {
      let kicker = 'VERIFIED BATCH';
      let headline = batchForm.title;
      let tagline = settingsForm.brandName || 'KHATU SHYAM LEARNING';

      try {
        const res = await fetch('/api/thumbnail-copy', {
          method: 'POST',
          credentials: 'same-origin',
          headers: adminHeaders(),
          body: JSON.stringify({
            title: batchForm.title,
            glowAccent: batchForm.glowAccent,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.kicker) kicker = data.kicker;
          if (data.headline) headline = data.headline;
          if (data.tagline) tagline = data.tagline;
        }
      } catch {
        // Fallback to direct user title
      }

      const generatedUrl = generateHdThumbnailDataUrl({
        headline,
        kicker,
        tagline,
        instructor: '',
        price: Number(batchForm.price || 0),
        aspectRatio: batchForm.thumbnailAspect,
        glowAccent: batchForm.glowAccent,
        styleVariant: thumbStyle,
        brandName: settingsForm.brandName,
      });

      setBatchForm((prev) => ({ ...prev, thumbnailUrl: generatedUrl }));
      showToast('HD glowing thumbnail generated.');
    } finally {
      setGeneratingThumb(false);
    }
  };

  const handleEditBatch = async (batch: Batch) => {
    setEditingId(batch.id);
    setActiveTab('batches');
    const localSecret = secretTargets[batch.id];
    let targetUrl = String(localSecret?.targetUrl || '');
    let accessInstructions = String(localSecret?.accessInstructions || '');

    if (!targetUrl && user && isDbAdmin) {
      try {
        const secretSnap = await getDoc(doc(db, 'batches', batch.id, 'private', 'access'));
        if (secretSnap.exists()) {
          const d = secretSnap.data();
          targetUrl = String(d.targetUrl || '');
          accessInstructions = String(d.accessInstructions || '');
          if (targetUrl) {
            setSecretTargets((prev) => ({
              ...prev,
              [batch.id]: { targetUrl, accessInstructions },
            }));
            void fetch('/api/admin/merge-cache', {
              method: 'POST',
              credentials: 'same-origin',
              headers: adminHeaders(),
              body: JSON.stringify({
                batchSecrets: {
                  [batch.id]: { targetUrl, accessInstructions },
                },
              }),
            }).catch(() => {});
          }
        }
      } catch (err) {
        setErrorMessage(logFirestoreError(err, OperationType.GET, `batches/${batch.id}/private/access`));
      }
    }

    setBatchForm({
      id: batch.id,
      title: batch.title,
      price: String(batch.price),
      originalPrice: String(batch.originalPrice),
      thumbnailUrl: batch.thumbnailUrl,
      thumbnailSize: batch.thumbnailSize,
      thumbnailAspect: batch.thumbnailAspect,
      glowAccent: batch.glowAccent,
      openType: batch.openType,
      targetUrl,
      accessInstructions,
      isActive: batch.isActive,
      isFeatured: batch.isFeatured,
      showCheckmark: batch.showCheckmark !== false,
      requirePayment: batch.requirePayment !== false && batch.price > 0,
      plan1Label: batch.plan1Label || '1 Year',
      plan2Label: batch.plan2Label || '2 Years',
      plan2Price:
        typeof batch.plan2Price === 'number'
          ? String(batch.plan2Price)
          : String((Number(batch.price) || 0) + 10),
      plan3Label: batch.plan3Label || 'Lifetime',
      plan3Price:
        typeof batch.plan3Price === 'number'
          ? String(batch.plan3Price)
          : String((Number(batch.price) || 0) + 20),
      displayOrder: String(batch.displayOrder),
    });
  };

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedTitle = batchForm.title.trim();
    let trimmedTargetUrl = batchForm.targetUrl.trim();

    if (!trimmedTitle) {
      setErrorMessage('Batch Name is required.');
      return;
    }
    if (!trimmedTargetUrl) {
      setErrorMessage('Target URL (WebView / Website / Telegram link) is required.');
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmedTargetUrl)) {
      trimmedTargetUrl = `https://${trimmedTargetUrl.replace(/^\/+/, '')}`;
    }
    try {
      const parsedUrl = new URL(trimmedTargetUrl);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        setErrorMessage('Target URL must use https:// or http://');
        return;
      }
      trimmedTargetUrl = parsedUrl.toString();
    } catch {
      setErrorMessage('Enter a valid URL (e.g. https://t.me/... or https://example.com)');
      return;
    }
    if (batchForm.thumbnailUrl.length > 495000) {
      setErrorMessage('Thumbnail image is too large. Please re-upload a smaller image or click Generate Thumbnail.');
      return;
    }

    const batchId =
      editingId ||
      `batch_${trimmedTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32)}_${Date.now().toString(36)}`;

    const numericPrice = batchForm.requirePayment
      ? Math.max(0, Number(batchForm.price) || 0)
      : 0;
    const finalRequirePayment = batchForm.requirePayment && numericPrice > 0;
    const numericPlan2Price = finalRequirePayment
      ? Math.max(0, Number(batchForm.plan2Price) || numericPrice + 10)
      : 0;
    const numericPlan3Price = finalRequirePayment
      ? Math.max(0, Number(batchForm.plan3Price) || numericPrice + 20)
      : 0;

    const existingBatch = batches.find((b) => b.id === batchId);

    const nextBatchPayload: Batch = {
      id: batchId,
      title: trimmedTitle.slice(0, 140),
      subtitle: '',
      description: '',
      category: 'Batch',
      instructor: '',
      price: numericPrice,
      originalPrice: Math.max(0, Number(batchForm.originalPrice) || 0),
      thumbnailUrl: batchForm.thumbnailUrl,
      thumbnailSize: batchForm.thumbnailSize,
      thumbnailAspect: batchForm.thumbnailAspect,
      glowAccent: batchForm.glowAccent,
      openType: batchForm.openType,
      isActive: batchForm.isActive,
      isFeatured: batchForm.isFeatured,
      showCheckmark: batchForm.showCheckmark,
      requirePayment: finalRequirePayment,
      plan1Label: (batchForm.plan1Label.trim() || '1 Year').slice(0, 40),
      plan2Label: (batchForm.plan2Label.trim() || '2 Years').slice(0, 40),
      plan2Price: numericPlan2Price,
      plan3Label: (batchForm.plan3Label.trim() || 'Lifetime').slice(0, 40),
      plan3Price: numericPlan3Price,
      displayOrder: Math.max(0, Number(batchForm.displayOrder) || 1),
    };

    const safeTargetUrl = trimmedTargetUrl.slice(0, 1000);
    const safeInstructions = batchForm.accessInstructions.trim().slice(0, 1000);

    setSavingBatch(true);
    try {
      const res = await fetch('/api/admin/batches', {
        method: 'POST',
        credentials: 'same-origin',
        headers: adminHeaders(),
        body: JSON.stringify({
          batch: nextBatchPayload,
          targetUrl: safeTargetUrl,
          accessInstructions: safeInstructions,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        batches?: Batch[];
      };
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || `Could not publish batch (HTTP ${res.status}).`);
        return;
      }

      setSecretTargets((prev) => ({
        ...prev,
        [batchId]: { targetUrl: safeTargetUrl, accessInstructions: safeInstructions },
      }));
      onSyncCatalog?.({
        batches: Array.isArray(data.batches)
          ? data.batches
          : existingBatch
            ? batches.map((b) => (b.id === batchId ? nextBatchPayload : b))
            : [...batches, nextBatchPayload],
        offers,
        settings,
      });

      setBatchForm(EMPTY_BATCH_FORM);
      setEditingId(null);

      // Sync directly to Firestore so https://khatushyamlearning.vercel.app/ updates immediately
      if (user && isDbAdmin) {
        try {
          const resolvedCreatedAt = await resolveExistingCreatedAt('batches', batchId);
          const bw = writeBatch(db);
          bw.set(doc(db, 'batches', batchId), {
            title: nextBatchPayload.title,
            subtitle: nextBatchPayload.subtitle,
            description: nextBatchPayload.description,
            category: nextBatchPayload.category,
            instructor: nextBatchPayload.instructor,
            price: nextBatchPayload.price,
            originalPrice: nextBatchPayload.originalPrice,
            thumbnailUrl: nextBatchPayload.thumbnailUrl,
            thumbnailSize: nextBatchPayload.thumbnailSize,
            thumbnailAspect: nextBatchPayload.thumbnailAspect,
            glowAccent: nextBatchPayload.glowAccent,
            openType: nextBatchPayload.openType,
            isActive: nextBatchPayload.isActive,
            isFeatured: nextBatchPayload.isFeatured,
            showCheckmark: nextBatchPayload.showCheckmark,
            requirePayment: nextBatchPayload.requirePayment,
            plan1Label: nextBatchPayload.plan1Label,
            plan2Label: nextBatchPayload.plan2Label,
            plan2Price: nextBatchPayload.plan2Price,
            plan3Label: nextBatchPayload.plan3Label,
            plan3Price: nextBatchPayload.plan3Price,
            displayOrder: nextBatchPayload.displayOrder,
            createdAt: resolvedCreatedAt,
            updatedAt: serverTimestamp(),
          });
          bw.set(doc(db, 'batches', batchId, 'private', 'access'), {
            targetUrl: safeTargetUrl,
            accessInstructions: safeInstructions,
            updatedAt: serverTimestamp(),
          });
          await bw.commit();
          showToast(
            editingId
              ? 'Batch updated LIVE on App & khatushyamlearning.vercel.app!'
              : 'Batch published LIVE on App & khatushyamlearning.vercel.app!',
          );
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.WRITE, `batches/${batchId}`));
        }
      } else {
        showToast(
          'Saved locally! Click "Connect Vercel Sync" above to push this batch live to khatushyamlearning.vercel.app.',
        );
      }
    } catch {
      setErrorMessage('Server connection error while saving batch.');
    } finally {
      setSavingBatch(false);
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    setErrorMessage('');
    try {
      const res = await fetch(`/api/admin/batches/${encodeURIComponent(batchId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: adminHeaders(false),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        batches?: Batch[];
      };
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Could not delete batch.');
        return;
      }

      setSecretTargets((prev) => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });
      onSyncCatalog?.({
        batches: Array.isArray(data.batches)
          ? data.batches
          : batches.filter((b) => b.id !== batchId),
        offers,
        settings,
      });

      if (editingId === batchId) {
        setEditingId(null);
        setBatchForm(EMPTY_BATCH_FORM);
      }

      if (user && isDbAdmin) {
        try {
          await deleteDoc(doc(db, 'batches', batchId, 'private', 'access'));
          await deleteDoc(doc(db, 'batches', batchId));
          showToast('Batch deleted LIVE from App & khatushyamlearning.vercel.app.');
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.DELETE, `batches/${batchId}`));
        }
      } else {
        showToast('Deleted locally. Click "Connect Vercel Sync" above to delete from khatushyamlearning.vercel.app.');
      }
    } catch {
      setErrorMessage('Server connection error while deleting batch.');
    }
  };

  const handleSaveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!offerForm.title.trim()) {
      setErrorMessage('Offer title is required.');
      return;
    }
    const offerId =
      editingOfferId ||
      `offer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    setSavingOffer(true);
    try {
      const existingOffer = offers.find((o) => o.id === offerId);
      const nextOffer: Offer = {
        id: offerId,
        title: offerForm.title.trim().slice(0, 120),
        badge: offerForm.badge.trim().slice(0, 40),
        description: offerForm.description.trim().slice(0, 300),
        isActive: offerForm.isActive,
        displayOrder: Math.max(0, Number(offerForm.displayOrder) || 1),
      };

      const res = await fetch('/api/admin/offers', {
        method: 'POST',
        credentials: 'same-origin',
        headers: adminHeaders(),
        body: JSON.stringify({ offer: nextOffer }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        offers?: Offer[];
      };
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Could not publish offer.');
        return;
      }

      onSyncCatalog?.({
        batches,
        offers: Array.isArray(data.offers)
          ? data.offers
          : existingOffer
            ? offers.map((o) => (o.id === offerId ? nextOffer : o))
            : [...offers, nextOffer],
        settings,
      });
      setOfferForm({
        title: '',
        badge: 'LIMITED',
        description: '',
        isActive: true,
        displayOrder: '1',
      });
      setEditingOfferId(null);

      if (user && isDbAdmin) {
        try {
          const resolvedCreatedAt = await resolveExistingCreatedAt('offers', offerId);
          await setDoc(doc(db, 'offers', offerId), {
            title: nextOffer.title,
            badge: nextOffer.badge,
            description: nextOffer.description,
            isActive: nextOffer.isActive,
            displayOrder: nextOffer.displayOrder,
            createdAt: resolvedCreatedAt,
            updatedAt: serverTimestamp(),
          });
          showToast(
            editingOfferId
              ? 'Offer updated LIVE on App & khatushyamlearning.vercel.app!'
              : 'Limited Offer published LIVE on App & khatushyamlearning.vercel.app!',
          );
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.WRITE, `offers/${offerId}`));
        }
      } else {
        showToast('Offer saved locally. Click "Connect Vercel Sync" above to push live to khatushyamlearning.vercel.app.');
      }
    } catch {
      setErrorMessage('Server connection error while saving offer.');
    } finally {
      setSavingOffer(false);
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    setErrorMessage('');
    try {
      const res = await fetch(`/api/admin/offers/${encodeURIComponent(offerId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: adminHeaders(false),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        offers?: Offer[];
      };
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Could not delete offer.');
        return;
      }

      onSyncCatalog?.({
        batches,
        offers: Array.isArray(data.offers) ? data.offers : offers.filter((o) => o.id !== offerId),
        settings,
      });
      if (editingOfferId === offerId) {
        setEditingOfferId(null);
        setOfferForm({
          title: '',
          badge: 'LIMITED',
          description: '',
          isActive: true,
          displayOrder: '1',
        });
      }

      if (user && isDbAdmin) {
        try {
          await deleteDoc(doc(db, 'offers', offerId));
          showToast('Offer deleted LIVE from App & khatushyamlearning.vercel.app.');
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.DELETE, `offers/${offerId}`));
        }
      } else {
        showToast('Offer deleted locally. Click "Connect Vercel Sync" above to delete from khatushyamlearning.vercel.app.');
      }
    } catch {
      setErrorMessage('Server connection error while deleting offer.');
    }
  };

  const handleApproveOrder = async (order: Order) => {
    setErrorMessage('');
    try {
      const adminNote = (adminRemarks[order.id] || 'Verified & Approved').slice(0, 500);
      let resolvedUrl = String(secretTargets[order.batchId]?.targetUrl || '').trim();
      let resolvedInstructions = String(secretTargets[order.batchId]?.accessInstructions || '').trim();

      if (!resolvedUrl && user && isDbAdmin) {
        try {
          const secSnap = await getDoc(doc(db, 'batches', order.batchId, 'private', 'access'));
          if (secSnap.exists()) {
            const sd = secSnap.data();
            resolvedUrl = String(sd.targetUrl || '').trim();
            resolvedInstructions = String(sd.accessInstructions || '').trim();
          }
        } catch {
          // continue cleanly
        }
      }

      const batchObj = batches.find((b) => b.id === order.batchId);
      const finalOpenType = batchObj?.openType || order.openType || 'webview';
      const finalInstructions = (
        resolvedInstructions || 'Approved by Admin. Click the launch button below to access your batch.'
      ).slice(0, 1000);

      const res = await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}/decision`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: adminHeaders(),
        body: JSON.stringify({
          status: 'approved',
          adminNote,
          order,
          unlockedUrl: resolvedUrl,
          unlockedInstructions: finalInstructions,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        order?: Order;
        orders?: Order[];
      };
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (res.ok && data.ok) {
        if (Array.isArray(data.orders)) {
          setServerOrders(data.orders);
        } else if (data.order) {
          setServerOrders((prev) => prev.map((o) => (o.id === order.id ? data.order! : o)));
        }
      }

      if (user && isDbAdmin) {
        try {
          await updateDoc(doc(db, 'orders', order.id), {
            status: 'approved',
            adminNote,
            openType: data.order?.openType || finalOpenType,
            unlockedUrl: (data.order?.unlockedUrl || resolvedUrl).slice(0, 1000),
            unlockedInstructions: (data.order?.unlockedInstructions || finalInstructions).slice(0, 1000),
            updatedAt: serverTimestamp(),
          });
          showToast(`Approved ${order.studentName} LIVE on App & khatushyamlearning.vercel.app!`);
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`));
        }
      } else if (res.ok && data.ok) {
        showToast(`Approved ${order.studentName} locally. Connect Vercel Sync above to approve on Vercel.`);
      } else {
        setErrorMessage(data.error || 'Could not approve order.');
      }
    } catch {
      setErrorMessage('Server connection error while approving order.');
    }
  };

  const handleRejectOrder = async (order: Order) => {
    setErrorMessage('');
    try {
      const adminNote = (
        adminRemarks[order.id] || 'Payment UTR could not be verified. Contact support.'
      ).slice(0, 500);
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}/decision`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: adminHeaders(),
        body: JSON.stringify({ status: 'rejected', adminNote, order }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        order?: Order;
        orders?: Order[];
      };
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (res.ok && data.ok) {
        if (Array.isArray(data.orders)) {
          setServerOrders(data.orders);
        } else if (data.order) {
          setServerOrders((prev) => prev.map((o) => (o.id === order.id ? data.order! : o)));
        }
      }

      if (user && isDbAdmin) {
        try {
          await updateDoc(doc(db, 'orders', order.id), {
            status: 'rejected',
            adminNote,
            unlockedUrl: '',
            unlockedInstructions: '',
            updatedAt: serverTimestamp(),
          });
          showToast(`Declined order from ${order.studentName} LIVE.`);
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`));
        }
      } else if (res.ok && data.ok) {
        showToast(`Declined ${order.studentName} locally. Connect Vercel Sync above to update Vercel.`);
      } else {
        setErrorMessage(data.error || 'Could not reject order.');
      }
    } catch {
      setErrorMessage('Server connection error while rejecting order.');
    }
  };

  const handleCheckDomainDns = async () => {
    setDnsError('');
    setDnsResult(null);
    const cleaned = normalizeCustomDomain(settingsForm.customDomain);
    if (!cleaned) {
      setDnsError('Enter a valid domain first (e.g. batches.yourdomain.com).');
      return;
    }
    setSettingsForm((prev) => ({ ...prev, customDomain: cleaned }));
    setCheckingDns(true);
    try {
      const res = await fetch('/api/admin/check-domain', {
        method: 'POST',
        credentials: 'same-origin',
        headers: adminHeaders(),
        body: JSON.stringify({ domain: cleaned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDnsError(data.error || 'Could not verify DNS for this domain.');
        return;
      }
      setDnsResult(data);
    } catch {
      setDnsError('Could not reach DNS verification server.');
    } finally {
      setCheckingDns(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setErrorMessage('');
    const rawCustomDomain = (settingsForm.customDomain || '').trim();
    const normalizedCustomDomain = rawCustomDomain ? normalizeCustomDomain(rawCustomDomain) : '';
    if (rawCustomDomain && !normalizedCustomDomain) {
      setErrorMessage('Custom Domain format is invalid. Example: batches.yourdomain.com');
      setSavingSettings(false);
      return;
    }
    if (settingsForm.qrImageUrl.length > 495000) {
      setErrorMessage('Custom QR image is too large. Please upload a smaller image.');
      setSavingSettings(false);
      return;
    }
    try {
      const savedSettings: SiteSettings = {
        brandName: (settingsForm.brandName.trim() || 'KHATU SHYAM LEARNING').slice(0, 100),
        showCheckmark: Boolean(settingsForm.showCheckmark),
        popupEnabled: Boolean(settingsForm.popupEnabled),
        popupText: settingsForm.popupText.trim().slice(0, 240),
        popupCtaText: settingsForm.popupCtaText.trim().slice(0, 60),
        heroTitle: (settingsForm.heroTitle.trim() || DEFAULT_SITE_SETTINGS.heroTitle).slice(0, 160),
        heroSubtitle: settingsForm.heroSubtitle.trim().slice(0, 400),
        glowTheme: settingsForm.glowTheme,
        upiId: settingsForm.upiId.trim().slice(0, 120),
        merchantName: settingsForm.merchantName.trim().slice(0, 100),
        qrImageUrl: settingsForm.qrImageUrl,
        bankDetails: settingsForm.bankDetails.trim().slice(0, 500),
        paymentInstructions: settingsForm.paymentInstructions.trim().slice(0, 600),
        gatewayPaymentUrl: settingsForm.gatewayPaymentUrl.trim().slice(0, 500),
        supportTelegramUrl: settingsForm.supportTelegramUrl.trim().slice(0, 300),
        supportWhatsapp: settingsForm.supportWhatsapp.trim().slice(0, 300),
        supportedMethods: settingsForm.supportedMethods.slice(0, 10),
        customDomain: normalizedCustomDomain.slice(0, 180),
      };

      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: adminHeaders(),
        body: JSON.stringify({ settings: savedSettings }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        settings?: SiteSettings;
      };
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error || 'Could not save settings.');
        return;
      }

      setSettingsForm((prev) => ({ ...prev, customDomain: normalizedCustomDomain }));
      onSyncCatalog?.({ batches, offers, settings: data.settings || savedSettings });

      if (user && isDbAdmin) {
        try {
          await setDoc(doc(db, 'site_settings', 'global'), {
            ...savedSettings,
            updatedAt: serverTimestamp(),
          });
          showToast('Storefront, custom domain & payment settings saved LIVE to khatushyamlearning.vercel.app!');
        } catch (err) {
          setErrorMessage(logFirestoreError(err, OperationType.WRITE, 'site_settings/global'));
        }
      } else {
        showToast('Settings saved locally. Click "Connect Vercel Sync" above to push live to khatushyamlearning.vercel.app.');
      }
    } catch {
      setErrorMessage('Server connection error while saving settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 900, 0.85);
      setSettingsForm((prev) => ({ ...prev, qrImageUrl: compressed }));
      showToast('Custom QR image uploaded. Remember to Save Settings.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to upload QR image.');
    }
  };

  const togglePaymentMethod = (methodId: string) => {
    setSettingsForm((prev) => {
      const exists = prev.supportedMethods.includes(methodId);
      const next = exists
        ? prev.supportedMethods.filter((id) => id !== methodId)
        : [...prev.supportedMethods, methodId].slice(0, 10);
      return { ...prev, supportedMethods: next };
    });
  };

  const stats = useMemo(() => {
    const pending = allOrders.filter((o) => o.status === 'pending').length;
    const approvedList = allOrders.filter((o) => o.status === 'approved');
    const revenue = approvedList.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);
    return {
      pending,
      approvedCount: approvedList.length,
      revenue,
      activeBatches: batches.filter((b) => b.isActive).length,
    };
  }, [allOrders, batches]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return allOrders.filter((ord) => {
      const statusOk = orderFilter === 'all' || ord.status === orderFilter;
      const textOk =
        !q ||
        ord.studentName.toLowerCase().includes(q) ||
        ord.studentPhone.toLowerCase().includes(q) ||
        ord.utrNumber.toLowerCase().includes(q) ||
        ord.batchTitle.toLowerCase().includes(q);
      return statusOk && textOk;
    });
  }, [allOrders, orderFilter, orderSearch]);

  // Reusable ultra-dark neon input & panel classes
  const glowInputClass =
    'w-full px-3.5 py-2.5 rounded-xl bg-[#070911] border border-pink-300/30 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-300 focus:shadow-[0_0_20px_-6px_rgba(244,114,182,0.55)] transition-all';
  const glowCompactInputClass =
    'w-full px-3 py-2 rounded-xl bg-[#070911] border border-white/15 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-lime-300 focus:shadow-[0_0_18px_-6px_rgba(74,222,128,0.5)] transition-all';
  const glowCardClass =
    'relative rounded-3xl hd-glass-surface border border-pink-300/35 shadow-[0_0_48px_-14px_rgba(244,114,182,0.3)] overflow-hidden';
  const glowPrimaryBtnClass =
    'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 hover:brightness-105 text-zinc-950 text-xs font-extrabold transition-all shadow-[0_0_26px_-4px_rgba(244,114,182,0.55)] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60';

  // Separate Admin Gate Screen (Opens directly with server-verified Access Code)
  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#030307] dark-hd-studio text-zinc-100 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute -top-36 left-1/4 w-[520px] h-[320px] rounded-full blur-[150px] bg-pink-500/18" />
          <div className="absolute bottom-0 right-1/4 w-[520px] h-[320px] rounded-full blur-[150px] bg-lime-400/14" />
        </div>
        <div className="relative z-10 px-6 py-3.5 rounded-2xl hd-glass-surface border border-pink-300/45 shadow-[0_0_36px_rgba(244,114,182,0.38)] text-xs font-extrabold text-pink-200 tracking-wide">
          Verifying secure session...
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-[#030307] dark-hd-studio text-zinc-100 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute -top-36 left-1/4 w-[580px] h-[360px] rounded-full blur-[150px] bg-pink-500/20" />
          <div className="absolute -bottom-32 right-1/4 w-[580px] h-[360px] rounded-full blur-[150px] bg-lime-400/15" />
          <div className="absolute top-1/2 -left-24 w-[400px] h-[400px] rounded-full blur-[160px] bg-cyan-400/12" />
        </div>

        <div className="relative z-10 max-w-md w-full rounded-3xl hd-glass-surface border border-pink-300/45 p-7 space-y-6 shadow-[0_0_72px_-10px_rgba(244,114,182,0.45),0_0_54px_-12px_rgba(74,222,128,0.28)] overflow-hidden">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-display text-lg font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent truncate">
                {settings.brandName}
              </span>
              {settings.showCheckmark && <VerifiedMark theme={settings.glowTheme} size="sm" />}
            </div>
            <button
              type="button"
              onClick={onBackToStorefront}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/15 text-xs font-semibold text-zinc-200 hover:text-white transition-colors shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Storefront
            </button>
          </div>

          <div className="space-y-1">
            <h1 className="font-display text-2xl font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent">
              Personal Admin Panel
            </h1>
            <p className="text-xs text-zinc-400">
              Enter your private Admin Access Code to open the control panel.
            </p>
          </div>

          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-pink-200 mb-1.5">
                Admin Access Code
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-pink-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  autoFocus
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="Enter access code"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#070911] border border-pink-300/40 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-lime-300 focus:shadow-[0_0_24px_-6px_rgba(74,222,128,0.55)] transition-all"
                />
              </div>
            </div>
            {codeError && (
              <p className="text-xs font-semibold text-rose-300">
                {codeError}
              </p>
            )}
            <button
              type="submit"
              disabled={verifyingCode}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 hover:brightness-105 text-zinc-950 text-sm font-extrabold transition-all shadow-[0_0_32px_-4px_rgba(244,114,182,0.55)] cursor-pointer"
            >
              {verifyingCode ? 'Checking Code...' : 'Open Admin Panel'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#030307] dark-hd-studio text-zinc-100 flex flex-col lg:flex-row relative overflow-x-hidden">
      {/* Ultra-Dark Multi-Glow Ambient Lights */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-36 left-1/5 w-[600px] h-[360px] rounded-full blur-[150px] bg-pink-500/14" />
        <div className="absolute -top-28 right-1/5 w-[560px] h-[340px] rounded-full blur-[150px] bg-lime-400/12" />
        <div className="absolute top-[45%] -left-28 w-[440px] h-[440px] rounded-full blur-[160px] bg-cyan-400/10" />
        <div className="absolute bottom-0 right-[-8%] w-[480px] h-[380px] rounded-full blur-[160px] bg-pink-500/10" />
      </div>

      {/* Neon Dark Sidebar */}
      <aside className="relative z-10 w-full lg:w-72 hd-glass-surface border-b lg:border-b-0 lg:border-r border-pink-300/30 shadow-[0_0_48px_-14px_rgba(244,114,182,0.28)] p-5 flex flex-col justify-between gap-6 shrink-0">
        <span className="pointer-events-none hidden lg:block absolute inset-y-0 right-0 w-[1.5px] bg-gradient-to-b from-pink-400 via-amber-200 to-lime-300 opacity-65" />
        <div className="space-y-6">
          <div className="p-3.5 rounded-2xl ultra-glow-topbar border border-pink-300/40 space-y-1 relative overflow-hidden">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent truncate">
                {settings.brandName}
              </span>
              {settings.showCheckmark && <VerifiedMark theme={settings.glowTheme} size="sm" />}
            </div>
            <p className="text-xs font-bold text-lime-300">
              Admin Control Console
            </p>
          </div>

          <nav className="flex lg:flex-col gap-2 overflow-x-auto pb-1 lg:pb-0">
            {[
              { id: 'overview' as AdminTab, label: 'Overview', icon: LayoutDashboard },
              { id: 'batches' as AdminTab, label: 'Batches & Thumbnails', icon: Layers },
              { id: 'offers' as AdminTab, label: `Offers & Telegram (${offers.length})`, icon: Flame },
              {
                id: 'approvals' as AdminTab,
                label: `Approvals (${stats.pending})`,
                icon: Users,
              },
              { id: 'payments' as AdminTab, label: 'Payments & QR', icon: CreditCard },
              { id: 'settings' as AdminTab, label: 'Storefront & Pop-Up', icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 text-zinc-950 font-extrabold shadow-[0_0_24px_-4px_rgba(244,114,182,0.55)]'
                      : 'text-zinc-300 font-semibold border border-white/10 bg-[#070911]/80 hover:text-white hover:border-pink-300/45 hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-zinc-950' : 'text-pink-300'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex lg:flex-col gap-2.5 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onBackToStorefront}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:brightness-105 text-xs font-extrabold text-zinc-950 shadow-[0_0_20px_-6px_rgba(52,211,153,0.6)] transition-all cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" /> View Storefront
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                sessionStorage.removeItem('ksl_admin_token');
                sessionStorage.removeItem('ksl_admin_code_ok');
              } catch {
                // ignore
              }
              setAdminToken('');
              setCodeVerified(false);
              void fetch('/api/admin/logout', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-KSL-Client': 'ksl-v1' },
              }).catch(() => {});
              void onSignOut();
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/50 text-xs font-bold text-rose-200 shadow-[0_0_18px_-8px_rgba(244,63,94,0.45)] transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Lock Admin
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative z-10 flex-1 min-w-0 p-4 sm:p-8 space-y-6 overflow-y-auto">
        {/* Top Header Bar */}
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl hd-glass-surface border border-pink-300/40 shadow-[0_0_40px_-12px_rgba(244,114,182,0.35)] overflow-hidden">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
          <div>
            <p className="text-xs font-bold text-pink-300">
              Admin Panel / {activeTab}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent capitalize">
              {activeTab === 'batches'
                ? 'Batches & Thumbnail Studio'
                : activeTab === 'offers'
                  ? 'Limited Offers & Live Telegram'
                  : activeTab === 'approvals'
                    ? 'Payment Approvals Queue'
                    : activeTab === 'payments'
                      ? 'Payment Methods & QR Code'
                      : activeTab === 'settings'
                        ? 'Storefront, Pop-Up & Admin Link'
                        : 'Dashboard Overview'}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTab('batches')}
              className={glowPrimaryBtnClass}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Batch ({batches.length})
            </button>
          </div>
        </div>

        {/* Live Vercel Sync Connection Bar (https://khatushyamlearning.vercel.app/) */}
        <div
          className={`relative p-4 rounded-2xl hd-glass-surface border flex flex-col md:flex-row md:items-center justify-between gap-3 overflow-hidden ${
            user && isDbAdmin
              ? 'border-lime-400/50 shadow-[0_0_28px_-10px_rgba(74,222,128,0.38)]'
              : 'border-amber-300/55 shadow-[0_0_28px_-10px_rgba(251,191,36,0.38)]'
          }`}
        >
          <span
            className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] ${
              user && isDbAdmin
                ? 'bg-gradient-to-r from-emerald-400 via-white to-lime-300'
                : 'bg-gradient-to-r from-amber-300 via-pink-300 to-cyan-300'
            }`}
          />
          <div className="flex items-start gap-3 min-w-0">
            <span
              className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${
                user && isDbAdmin
                  ? 'bg-lime-400 shadow-[0_0_12px_rgba(163,230,53,0.9)] animate-pulse'
                  : 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.8)]'
              }`}
            />
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-extrabold text-white flex flex-wrap items-center gap-2">
                <span>
                  {user && isDbAdmin
                    ? 'Live Connected: khatushyamlearning.vercel.app'
                    : 'Connect Vercel Live Sync (khatushyamlearning.vercel.app)'}
                </span>
                {user && isDbAdmin && (
                  <span className="text-[11px] font-mono text-lime-300">
                    ({user.email})
                  </span>
                )}
              </p>
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                {user && isDbAdmin
                  ? 'Every Batch, Offer, Payment Setting & Order Approval here updates https://khatushyamlearning.vercel.app/ immediately.'
                  : user && !isDbAdmin
                    ? `Signed in as ${user.email}, which is not admin. Switch to ${BOOTSTRAPPED_ADMIN_EMAIL} so updates sync live to khatushyamlearning.vercel.app.`
                    : `Click "Connect Vercel Sync (Google)" to open Google Sign-In in this browser and select ${BOOTSTRAPPED_ADMIN_EMAIL} (no request/OTP is sent to Gmail inbox).`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {user && isDbAdmin ? (
              <>
                <button
                  type="button"
                  disabled={syncingFirestore}
                  onClick={() => void handleSyncOldFirebaseBatches()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-300/45 text-xs font-bold text-cyan-200 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingFirestore ? 'animate-spin' : ''}`} />
                  {syncingFirestore ? 'Pulling...' : 'Pull from Vercel'}
                </button>
                <button
                  type="button"
                  disabled={pushingToVercel}
                  onClick={() => void handlePushAllToVercel()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-400 to-lime-300 hover:brightness-105 text-zinc-950 text-xs font-extrabold shadow-[0_0_20px_-6px_rgba(74,222,128,0.65)] cursor-pointer disabled:opacity-60"
                >
                  <Globe className={`w-3.5 h-3.5 ${pushingToVercel ? 'animate-spin' : ''}`} />
                  {pushingToVercel ? 'Pushing...' : 'Push All to Vercel'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={syncingFirestore}
                  onClick={() => void handleSyncOldFirebaseBatches()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/20 text-xs font-bold text-zinc-200 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingFirestore ? 'animate-spin' : ''}`} />
                  {syncingFirestore ? 'Syncing...' : 'Pull Vercel Batches'}
                </button>
                <button
                  type="button"
                  disabled={connectingSync}
                  onClick={() => void handleConnectVercelSync()}
                  className={glowPrimaryBtnClass}
                >
                  <Globe className="w-3.5 h-3.5" />
                  {connectingSync
                    ? 'Connecting...'
                    : user && !isDbAdmin
                      ? 'Switch to Admin Gmail'
                      : 'Connect Vercel Sync (Google)'}
                </button>
                <a
                  href={typeof window !== 'undefined' ? window.location.href : '/ksl-admin-872'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-cyan-300/45 bg-cyan-500/10 hover:bg-cyan-500/20 text-xs font-bold text-cyan-200"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Admin in Chrome Tab
                </a>
              </>
            )}
            <a
              href="https://khatushyamlearning.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-pink-300/45 bg-pink-500/10 hover:bg-pink-500/20 text-xs font-bold text-pink-200"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Vercel
            </a>
          </div>
        </div>

        {statusMessage && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-lime-400/55 shadow-[0_0_24px_-6px_rgba(74,222,128,0.45)] text-xs font-semibold text-lime-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-lime-300 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
        {(errorMessage || authError) && (
          <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-400/60 shadow-[0_0_24px_-6px_rgba(244,63,94,0.45)] text-xs font-semibold text-rose-200 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-300 shrink-0" />
            <span>{errorMessage || authError}</span>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="relative p-5 rounded-3xl hd-glass-surface border border-lime-400/50 glow-card-emerald space-y-1 overflow-hidden">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-emerald-400 via-white to-lime-300" />
                <p className="text-xs font-semibold text-emerald-200">Approved Revenue</p>
                <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-lime-300">
                  ₹{stats.revenue.toLocaleString('en-IN')}
                </p>
              </div>
              <div className="relative p-5 rounded-3xl hd-glass-surface border border-amber-300/50 glow-card-amber space-y-1 overflow-hidden">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-amber-300 via-white to-pink-300" />
                <p className="text-xs font-semibold text-amber-200">Pending Approvals</p>
                <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-amber-300">
                  {stats.pending}
                </p>
              </div>
              <div className="relative p-5 rounded-3xl hd-glass-surface border border-cyan-400/50 glow-card-sapphire space-y-1 overflow-hidden">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-300 via-white to-sky-400" />
                <p className="text-xs font-semibold text-cyan-200">Approved Students</p>
                <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-cyan-300">
                  {stats.approvedCount}
                </p>
              </div>
              <div className="relative p-5 rounded-3xl hd-glass-surface border border-pink-400/50 glow-card-crimson space-y-1 overflow-hidden">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-rose-400" />
                <p className="text-xs font-semibold text-pink-200">Active Batches</p>
                <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-pink-300">
                  {stats.activeBatches}
                </p>
              </div>
            </div>

            <div className={`${glowCardClass} p-6 space-y-4`}>
              <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-base font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent">
                  Recent Pending Payment Requests
                </h2>
                <button
                  type="button"
                  onClick={() => setActiveTab('approvals')}
                  className="px-4 py-1.5 rounded-xl bg-pink-500/15 border border-pink-300/45 text-xs font-bold text-pink-200 hover:bg-pink-500/25 transition-all cursor-pointer"
                >
                  Manage All
                </button>
              </div>
              {allOrders.filter((o) => o.status === 'pending').length === 0 ? (
                <p className="text-xs text-zinc-400">No pending payments right now.</p>
              ) : (
                <div className="divide-y divide-white/10">
                  {allOrders
                    .filter((o) => o.status === 'pending')
                    .slice(0, 5)
                    .map((ord) => (
                      <div
                        key={ord.id}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="text-xs space-y-0.5">
                          <p className="font-bold text-white">
                            {ord.studentName} ·{' '}
                            <span className="text-lime-300 font-mono">₹{ord.amount}</span>{' '}
                            {ord.planLabel ? `(${ord.batchTitle} · ${ord.planLabel})` : `(${ord.batchTitle})`}
                          </p>
                          <p className="font-mono text-zinc-300">
                            UTR: {ord.utrNumber} · {ord.studentPhone}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleApproveOrder(ord)}
                            className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:brightness-105 text-zinc-950 text-xs font-extrabold cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRejectOrder(ord)}
                            className="px-4 py-1.5 rounded-xl border border-rose-400/55 text-rose-200 hover:bg-rose-500/20 text-xs font-bold cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: BATCHES & THUMBNAIL STUDIO */}
        {activeTab === 'batches' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Batch Form */}
            <form
              onSubmit={handleSaveBatch}
              className={`xl:col-span-7 p-6 space-y-5 ${glowCardClass}`}
            >
              <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent">
                  {editingId ? 'Edit Batch' : 'Add New Batch'}
                </h2>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setBatchForm(EMPTY_BATCH_FORM);
                    }}
                    className="px-3 py-1 rounded-xl border border-white/15 text-xs font-semibold text-zinc-200 hover:text-white cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-pink-200">
                    <span>Batch Name</span>
                    {batchForm.showCheckmark && (
                      <VerifiedMark theme={batchForm.glowAccent} size="sm" />
                    )}
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-lime-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchForm.showCheckmark}
                      onChange={(e) =>
                        setBatchForm({ ...batchForm, showCheckmark: e.target.checked })
                      }
                      className="accent-pink-400"
                    />
                    Checkmark beside Batch Name
                  </label>
                </div>
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={batchForm.title}
                  onChange={(e) => setBatchForm({ ...batchForm, title: e.target.value })}
                  placeholder="Enter Batch Name..."
                  className={glowInputClass}
                />
              </div>

              {/* Price, No-Payment Flow Toggle & Display Order */}
              <div className="space-y-3">
                <label className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-emerald-500/15 border border-lime-400/50 text-xs font-bold text-lime-200 shadow-[0_0_20px_-8px_rgba(74,222,128,0.4)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!batchForm.requirePayment || Number(batchForm.price) === 0}
                    onChange={(e) => {
                      const noPay = e.target.checked;
                      setBatchForm({
                        ...batchForm,
                        requirePayment: !noPay,
                        price: noPay ? '0' : Number(batchForm.price) > 0 ? batchForm.price : '499',
                        openType: noPay ? 'webview' : batchForm.openType,
                      });
                    }}
                    className="accent-emerald-400"
                  />
                  No Payment Flow (Sabse Uper · Free / Direct Open inside app)
                </label>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-lime-300 mb-1">
                      Sale Price (₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      required
                      disabled={!batchForm.requirePayment}
                      value={batchForm.requirePayment ? batchForm.price : '0'}
                      onChange={(e) => {
                        const val = e.target.value;
                        const prevBase = Number(batchForm.price) || 0;
                        const nextBase = Number(val) || 0;
                        const keepAuto2 = Number(batchForm.plan2Price) === prevBase + 10;
                        const keepAuto3 = Number(batchForm.plan3Price) === prevBase + 20;
                        setBatchForm({
                          ...batchForm,
                          price: val,
                          requirePayment: Number(val) > 0,
                          plan2Price: keepAuto2 ? String(nextBase + 10) : batchForm.plan2Price,
                          plan3Price: keepAuto3 ? String(nextBase + 20) : batchForm.plan3Price,
                        });
                      }}
                      className={`${glowInputClass} font-mono disabled:opacity-60`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">Original MRP (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={batchForm.originalPrice}
                      onChange={(e) => setBatchForm({ ...batchForm, originalPrice: e.target.value })}
                      className={`${glowInputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-pink-200 mb-1">Sort Order</label>
                    <input
                      type="number"
                      min={0}
                      value={batchForm.displayOrder}
                      onChange={(e) => setBatchForm({ ...batchForm, displayOrder: e.target.value })}
                      className={`${glowInputClass} font-mono`}
                    />
                  </div>
                </div>

                {batchForm.requirePayment && (
                  <div className="p-3.5 rounded-2xl bg-[#070911] border border-pink-300/30 space-y-3">
                    <p className="text-xs font-extrabold text-pink-200">
                      3-Plan Popup Pricing (Plan 1 Popular uses Sale Price ₹{batchForm.price || 0})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-amber-200">
                          Plan 1 (Most Popular)
                        </label>
                        <input
                          type="text"
                          maxLength={40}
                          value={batchForm.plan1Label}
                          onChange={(e) =>
                            setBatchForm({ ...batchForm, plan1Label: e.target.value })
                          }
                          placeholder="1 Year"
                          className={glowCompactInputClass}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-cyan-200">
                          Plan 2 Label &amp; Price (₹)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={40}
                            value={batchForm.plan2Label}
                            onChange={(e) =>
                              setBatchForm({ ...batchForm, plan2Label: e.target.value })
                            }
                            placeholder="2 Years"
                            className={glowCompactInputClass}
                          />
                          <input
                            type="number"
                            min={0}
                            value={batchForm.plan2Price}
                            onChange={(e) =>
                              setBatchForm({ ...batchForm, plan2Price: e.target.value })
                            }
                            placeholder="59"
                            className={`${glowCompactInputClass} w-20 font-mono`}
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-lime-300">
                          Plan 3 Label &amp; Price (₹)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={40}
                            value={batchForm.plan3Label}
                            onChange={(e) =>
                              setBatchForm({ ...batchForm, plan3Label: e.target.value })
                            }
                            placeholder="Lifetime"
                            className={glowCompactInputClass}
                          />
                          <input
                            type="number"
                            min={0}
                            value={batchForm.plan3Price}
                            onChange={(e) =>
                              setBatchForm({ ...batchForm, plan3Price: e.target.value })
                            }
                            placeholder="69"
                            className={`${glowCompactInputClass} w-20 font-mono`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Thumbnail Size, Aspect & Glow Controls */}
              <div className="p-4 rounded-2xl bg-[#070911] border border-white/15 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-extrabold text-pink-200">
                    Thumbnail Size, Upload &amp; HD Generator
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/20 text-xs font-bold text-white cursor-pointer">
                      <ImagePlus className="w-3.5 h-3.5 text-pink-300" />
                      Upload Thumbnail
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleUploadThumbnail}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={generatingThumb}
                      onClick={() => void handleGenerateThumbnail()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 hover:brightness-105 text-zinc-950 text-xs font-extrabold shadow-[0_0_20px_rgba(244,114,182,0.4)] disabled:opacity-60 cursor-pointer"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      {generatingThumb ? 'Generating...' : 'Generate Thumbnail'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 mb-1">Thumbnail Size</label>
                    <select
                      value={batchForm.thumbnailSize}
                      onChange={(e) =>
                        setBatchForm({
                          ...batchForm,
                          thumbnailSize: e.target.value as ThumbnailSize,
                        })
                      }
                      className={glowCompactInputClass}
                    >
                      <option value="compact">Compact</option>
                      <option value="standard">Standard</option>
                      <option value="large">Large (2-Col)</option>
                      <option value="featured">Featured (Wide)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 mb-1">Aspect Ratio</label>
                    <select
                      value={batchForm.thumbnailAspect}
                      onChange={(e) =>
                        setBatchForm({
                          ...batchForm,
                          thumbnailAspect: e.target.value as ThumbnailAspect,
                        })
                      }
                      className={glowCompactInputClass}
                    >
                      <option value="16:9">16:9 Wide HD</option>
                      <option value="4:3">4:3 Classic</option>
                      <option value="1:1">1:1 Square</option>
                      <option value="3:4">3:4 Poster</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 mb-1">Glow Accent</label>
                    <select
                      value={batchForm.glowAccent}
                      onChange={(e) =>
                        setBatchForm({
                          ...batchForm,
                          glowAccent: e.target.value as GlowTheme,
                        })
                      }
                      className={glowCompactInputClass}
                    >
                      <option value="amber">Neon Gold</option>
                      <option value="crimson">Neon Pink</option>
                      <option value="sapphire">Cyan Glow</option>
                      <option value="emerald">Lime Emerald</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 mb-1">Generator Style</label>
                    <select
                      value={thumbStyle}
                      onChange={(e) =>
                        setThumbStyle(
                          e.target.value as
                            | 'aura_grid'
                            | 'prism_beams'
                            | 'crimson_horizon'
                            | 'obsidian_crest',
                        )
                      }
                      className={glowCompactInputClass}
                    >
                      <option value="aura_grid">Aura Grid</option>
                      <option value="prism_beams">Prism Beams</option>
                      <option value="crimson_horizon">Horizon Glow</option>
                      <option value="obsidian_crest">Obsidian Crest</option>
                    </select>
                  </div>
                </div>

                {batchForm.thumbnailUrl && (
                  <div className="max-w-sm">
                    <BatchThumbnail
                      src={batchForm.thumbnailUrl}
                      alt={batchForm.title || 'Preview'}
                      aspect={batchForm.thumbnailAspect}
                      glow={batchForm.glowAccent}
                      className="rounded-xl border border-white/20 shadow-[0_0_24px_-8px_rgba(244,114,182,0.4)]"
                    />
                  </div>
                )}
              </div>

              {/* Open Type & Protected Target Link */}
              <div className="p-4 rounded-2xl bg-[#070911] border border-lime-400/35 space-y-4">
                <p className="text-xs font-extrabold text-lime-300">
                  {!batchForm.requirePayment || Number(batchForm.price) === 0
                    ? 'Direct Open Link Configuration (No Payment Flow · Top Priority)'
                    : 'Unlocked Link Configuration (Hidden until Admin Approval; WebView links stay hidden)'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-200 mb-1">App Link Open Type</label>
                    <select
                      value={batchForm.openType}
                      onChange={(e) =>
                        setBatchForm({ ...batchForm, openType: e.target.value as OpenType })
                      }
                      className={glowCompactInputClass}
                    >
                      <option value="webview">WebView Link (In-App · URL Hidden)</option>
                      <option value="website">Website Link (External)</option>
                      <option value="telegram">Telegram Channel / Group Link</option>
                      <option value="telegram_bot">Telegram Bot Link</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-200 mb-1">Target URL</label>
                    <input
                      type="text"
                      inputMode="url"
                      required
                      maxLength={1000}
                      value={batchForm.targetUrl}
                      onChange={(e) => setBatchForm({ ...batchForm, targetUrl: e.target.value })}
                      placeholder="https://... or t.me/..."
                      className={`${glowCompactInputClass} font-mono`}
                    />
                  </div>
                </div>
                {batchForm.openType === 'webview' && (
                  <p className="text-[11px] font-medium text-pink-200/85">
                    Students run this WebView inside the app — the URL and external tab button stay completely hidden.
                  </p>
                )}
                <div>
                  <label className="block text-xs font-semibold text-zinc-200 mb-1">
                    Post-Approval Unlock Instructions
                  </label>
                  <input
                    type="text"
                    maxLength={1000}
                    value={batchForm.accessInstructions}
                    onChange={(e) =>
                      setBatchForm({ ...batchForm, accessInstructions: e.target.value })
                    }
                    placeholder="Instructions shown to student after approval..."
                    className={glowCompactInputClass}
                  />
                </div>
              </div>

              {(errorMessage || authError) && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-400/60 text-xs font-semibold text-rose-200 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-rose-300 shrink-0" />
                  <span>{errorMessage || authError}</span>
                </div>
              )}
              {statusMessage && (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-lime-400/55 text-xs font-semibold text-lime-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-lime-300 shrink-0" />
                  <span>{statusMessage}</span>
                </div>
              )}

              {(!user || !isDbAdmin) && (
                <div className="p-3.5 rounded-2xl bg-amber-400/12 border border-amber-300/45 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-[11px] text-amber-100 leading-relaxed">
                    Tap <span className="font-bold">Connect Google Sync</span> to open the Google Sign-In popup in Chrome and choose <span className="font-mono font-bold">{BOOTSTRAPPED_ADMIN_EMAIL}</span> (no email/request comes to Gmail inbox). If popup is blocked, tap <span className="font-bold">Open in Full Tab</span> or <span className="font-bold">⋮ → Open in Chrome</span>.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <a
                      href={typeof window !== 'undefined' ? window.location.href : '/ksl-admin-872'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-cyan-300/45 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 text-xs font-bold"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open in Full Tab
                    </a>
                    <button
                      type="button"
                      disabled={connectingSync}
                      onClick={() => void handleConnectVercelSync()}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-300 to-lime-300 text-zinc-950 text-xs font-extrabold cursor-pointer disabled:opacity-60"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      {connectingSync ? 'Connecting...' : 'Connect Google Sync'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-5 text-xs font-semibold text-zinc-200">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchForm.isActive}
                      onChange={(e) => setBatchForm({ ...batchForm, isActive: e.target.checked })}
                      className="accent-emerald-400"
                    />
                    Visible on Storefront
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchForm.isFeatured}
                      onChange={(e) => setBatchForm({ ...batchForm, isFeatured: e.target.checked })}
                      className="accent-pink-400"
                    />
                    Featured
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={savingBatch}
                  className={glowPrimaryBtnClass}
                >
                  <Plus className="w-4 h-4" />
                  {savingBatch ? 'Saving...' : editingId ? 'Update Batch' : 'Publish Batch'}
                </button>
              </div>
            </form>

            {/* Existing Batches List */}
            <div className="xl:col-span-5 space-y-3">
              {!firestoreSynced && (
                <div className="p-4 rounded-2xl hd-glass-surface border border-amber-300/50 shadow-[0_0_28px_-10px_rgba(251,191,36,0.35)] space-y-2.5">
                  <p className="text-xs font-extrabold text-amber-200">
                    Old Firebase Batches Pending Auto-Sync
                  </p>
                  <p className="text-[11px] text-zinc-300 leading-relaxed">
                    Your older batches saved in Firebase Firestore are waiting because Google&apos;s free daily read quota is temporarily exhausted (resets tomorrow; see Spark plan under Enterprise edition at firebase.google.com/pricing#cloud-firestore). They will merge automatically once quota resets, or tap below:
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={syncingFirestore}
                      onClick={() => void handleSyncOldFirebaseBatches()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-zinc-950 text-xs font-extrabold cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingFirestore ? 'animate-spin' : ''}`} />
                      {syncingFirestore ? 'Checking Firebase...' : 'Sync Old Firebase Batches'}
                    </button>
                    <a
                      href={FIRESTORE_UPGRADE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-amber-300/45 text-[11px] font-bold text-amber-200 hover:bg-amber-400/15"
                    >
                      Firebase Database Upgrade
                    </a>
                  </div>
                </div>
              )}

              <h2 className="text-base font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent">
                Published Batches ({batches.length})
              </h2>
              {batches.length === 0 ? (
                <div className="p-6 rounded-3xl hd-glass-surface border border-white/15 text-xs text-zinc-300">
                  No batches added yet. Fill out the form on the left and tap Publish Batch.
                </div>
              ) : (
                [...batches]
                  .sort((a, b) => {
                    const aDirect = a.requirePayment === false || a.price === 0 ? 0 : 1;
                    const bDirect = b.requirePayment === false || b.price === 0 ? 0 : 1;
                    if (aDirect !== bDirect) return aDirect - bDirect;
                    return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0);
                  })
                  .map((b) => (
                  <div
                    key={b.id}
                    className="p-4 rounded-2xl hd-glass-surface border border-white/15 hover:border-pink-300/60 shadow-[0_0_28px_-12px_rgba(244,114,182,0.28)] flex items-center justify-between gap-4 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {b.thumbnailUrl ? (
                        <img
                          src={b.thumbnailUrl}
                          alt={b.title}
                          className="w-16 h-11 rounded-lg object-cover border border-white/20 shrink-0 bg-black"
                        />
                      ) : (
                        <div className="w-16 h-11 rounded-lg border border-white/15 shrink-0 bg-gradient-to-br from-[#1C1229] to-[#081C15] flex items-center justify-center">
                          <Layers className="w-4 h-4 text-pink-300" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-white truncate">{b.title}</p>
                          {b.showCheckmark !== false && (
                            <VerifiedMark theme={b.glowAccent} size="sm" className="shrink-0" />
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-300 font-mono flex items-center gap-1.5 flex-wrap">
                          <span
                            className={
                              b.requirePayment === false || b.price === 0
                                ? 'px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-lime-400/50 text-lime-300 font-bold'
                                : 'text-lime-300 font-bold'
                            }
                          >
                            {b.requirePayment === false || b.price === 0 ? 'NO PAYMENT · FREE' : `₹${b.price}`}
                          </span>
                          <span className="text-zinc-400">
                            · {b.thumbnailSize} ({b.thumbnailAspect}) · {b.openType}
                          </span>
                          {!secretTargets[b.id]?.targetUrl && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-400/20 border border-amber-400/50 text-amber-200 font-bold">
                              Tap Edit to set URL
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleEditBatch(b)}
                        className="p-2 rounded-xl border border-pink-300/40 bg-pink-500/10 text-pink-200 hover:text-white hover:bg-pink-500/25 cursor-pointer"
                        title="Edit Batch"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteBatch(b.id)}
                        className="p-2 rounded-xl border border-rose-400/45 bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                        title="Delete Batch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 2B: OFFERS & TELEGRAM MANAGER */}
        {activeTab === 'offers' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Add / Edit Offer Form */}
            <div className="xl:col-span-7 space-y-6">
              <form
                onSubmit={handleSaveOffer}
                className={`p-6 space-y-4 ${glowCardClass}`}
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-300" />
                    <span className="bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent">
                      {editingOfferId ? 'Edit Limited Offer' : 'Add New Limited Offer'}
                    </span>
                  </h2>
                  {editingOfferId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingOfferId(null);
                        setOfferForm({
                          title: '',
                          badge: 'LIMITED',
                          description: '',
                          isActive: true,
                          displayOrder: '1',
                        });
                      }}
                      className="text-xs text-zinc-300 hover:text-white cursor-pointer"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-pink-200 mb-1">Offer Title</label>
                    <input
                      type="text"
                      required
                      maxLength={120}
                      value={offerForm.title}
                      onChange={(e) => setOfferForm({ ...offerForm, title: e.target.value })}
                      placeholder="e.g. Flat 60% Off Today Only!"
                      className={glowInputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-amber-200 mb-1">Offer Tag / Badge</label>
                    <input
                      type="text"
                      maxLength={40}
                      value={offerForm.badge}
                      onChange={(e) => setOfferForm({ ...offerForm, badge: e.target.value })}
                      placeholder="60% OFF"
                      className={`${glowInputClass} font-mono`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-200 mb-1">
                    Offer Details (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={300}
                    value={offerForm.description}
                    onChange={(e) => setOfferForm({ ...offerForm, description: e.target.value })}
                    placeholder="Shown right under Limited Offer on the storefront..."
                    className={glowInputClass}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                  <div className="flex items-center gap-5 text-xs font-semibold text-zinc-200">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={offerForm.isActive}
                        onChange={(e) => setOfferForm({ ...offerForm, isActive: e.target.checked })}
                        className="accent-pink-400"
                      />
                      Show on Storefront
                    </label>
                    <div className="flex items-center gap-2">
                      <span>Order:</span>
                      <input
                        type="number"
                        min={0}
                        value={offerForm.displayOrder}
                        onChange={(e) =>
                          setOfferForm({ ...offerForm, displayOrder: e.target.value })
                        }
                        className="w-16 px-2.5 py-1 rounded-lg bg-[#070911] border border-white/15 text-xs font-mono text-white"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={savingOffer}
                    className={glowPrimaryBtnClass}
                  >
                    <Plus className="w-4 h-4" />
                    {savingOffer ? 'Saving...' : editingOfferId ? 'Update Offer' : 'Publish Offer'}
                  </button>
                </div>
              </form>

              {/* Quick Telegram Link & Limited Offer Label Settings */}
              <form
                onSubmit={handleSaveSettings}
                className={`p-6 space-y-4 ${glowCardClass}`}
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-400 via-white to-lime-300" />
                <h3 className="text-sm font-extrabold text-cyan-200">
                  Telegram Channel &amp; Limited Offer Badge Settings
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-200 mb-1">
                      Telegram Channel Link (Real-Time Count)
                    </label>
                    <input
                      type="url"
                      maxLength={300}
                      value={settingsForm.supportTelegramUrl}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, supportTelegramUrl: e.target.value })
                      }
                      placeholder="https://t.me/Cheatestbatchwallah"
                      className={`${glowCompactInputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-200 mb-1">
                      Limited Offer Pill Label
                    </label>
                    <input
                      type="text"
                      maxLength={60}
                      value={settingsForm.popupCtaText}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, popupCtaText: e.target.value })
                      }
                      placeholder="Limited Offer"
                      className={glowCompactInputClass}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settingsForm.popupEnabled}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, popupEnabled: e.target.checked })
                      }
                      className="accent-pink-400"
                    />
                    Show Limited Offer Badge
                  </label>
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className={glowPrimaryBtnClass}
                  >
                    {savingSettings ? 'Saving...' : 'Save Telegram & Label'}
                  </button>
                </div>
              </form>
            </div>

            {/* Active Offers List */}
            <div className="xl:col-span-5 space-y-3">
              <h2 className="text-base font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent">
                Published Offers ({offers.length})
              </h2>
              {offers.length === 0 ? (
                <div className="p-6 rounded-3xl hd-glass-surface border border-white/15 text-xs text-zinc-300">
                  No offers added yet. Add one on the left and it will show right below Limited Offer on the Storefront.
                </div>
              ) : (
                offers.map((offer) => (
                  <div
                    key={offer.id}
                    className="p-4 rounded-2xl hd-glass-surface border border-white/15 shadow-[0_0_24px_-10px_rgba(244,114,182,0.3)] flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-white truncate">{offer.title}</p>
                        {offer.badge && (
                          <span className="px-2 py-0.5 rounded-lg bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 text-zinc-950 text-[10px] font-extrabold shrink-0">
                            {offer.badge}
                          </span>
                        )}
                      </div>
                      {offer.description && (
                        <p className="text-[11px] text-zinc-300 truncate">{offer.description}</p>
                      )}
                      <p className="text-[10px] font-mono text-lime-300">
                        {offer.isActive ? 'Visible on Storefront' : 'Hidden'} · Order #{offer.displayOrder}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingOfferId(offer.id);
                          setOfferForm({
                            title: offer.title,
                            badge: offer.badge,
                            description: offer.description,
                            isActive: offer.isActive,
                            displayOrder: String(offer.displayOrder),
                          });
                        }}
                        className="p-2 rounded-xl border border-pink-300/40 bg-pink-500/10 text-pink-200 hover:text-white cursor-pointer"
                        title="Edit Offer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteOffer(offer.id)}
                        className="p-2 rounded-xl border border-rose-400/45 bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                        title="Delete Offer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: PAYMENT APPROVALS */}
        {activeTab === 'approvals' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 p-1.5 hd-glass-surface border border-white/15 rounded-2xl shadow-[0_0_24px_-8px_rgba(244,114,182,0.25)]">
                {(['pending', 'approved', 'rejected', 'all'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setOrderFilter(tab)}
                    className={`px-4 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
                      orderFilter === tab
                        ? 'bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 text-zinc-950 font-extrabold'
                        : 'text-zinc-300 hover:text-white'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="Search student, phone, UTR..."
                className="px-4 py-2.5 rounded-xl bg-[#070911] border border-pink-300/35 text-xs text-white placeholder:text-zinc-500 w-full sm:w-64 focus:outline-none focus:border-lime-300"
              />
            </div>

            {filteredOrders.length === 0 ? (
              <div className="p-8 rounded-3xl hd-glass-surface border border-white/15 text-center text-xs text-zinc-300">
                No orders matching this filter.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className={`p-5 ${glowCardClass} space-y-4`}
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span
                            className={`font-extrabold ${
                              ord.status === 'approved'
                                ? 'text-lime-300'
                                : ord.status === 'rejected'
                                  ? 'text-rose-400'
                                  : 'text-amber-300'
                            }`}
                          >
                            {ord.status.toUpperCase()}
                          </span>
                          <span className="text-zinc-500">·</span>
                          <span className="font-mono font-bold text-white">
                            ₹{ord.amount.toLocaleString('en-IN')}
                          </span>
                          <span className="text-zinc-500">·</span>
                          <span className="text-cyan-300">{ord.paymentMethod}</span>
                        </div>
                        <h3 className="text-sm font-extrabold text-white">
                          {ord.studentName} — {ord.batchTitle}
                          {ord.planLabel ? ` (${ord.planLabel})` : ''}
                        </h3>
                        <p className="text-xs font-mono text-zinc-300">
                          Phone: {ord.studentPhone} · Email: {ord.userEmail || 'N/A'} · UTR: {ord.utrNumber}
                        </p>
                        {ord.studentNote && (
                          <p className="text-xs text-pink-200">Note: {ord.studentNote}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {ord.screenshotUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewScreenshot(ord.screenshotUrl)}
                            className="px-3.5 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-300/45 text-xs font-bold text-cyan-200 cursor-pointer"
                          >
                            View Receipt
                          </button>
                        )}
                        <input
                          type="text"
                          placeholder="Remark (optional)"
                          value={adminRemarks[ord.id] ?? ''}
                          onChange={(e) =>
                            setAdminRemarks((prev) => ({
                              ...prev,
                              [ord.id]: e.target.value,
                            }))
                          }
                          className="px-3 py-2 rounded-xl bg-[#070911] border border-white/15 text-xs text-white placeholder:text-zinc-500 w-44 focus:outline-none focus:border-pink-300"
                        />
                        <button
                          type="button"
                          onClick={() => void handleApproveOrder(ord)}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:brightness-105 text-zinc-950 text-xs font-extrabold cursor-pointer"
                        >
                          Approve &amp; Open
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRejectOrder(ord)}
                          className="px-4 py-2 rounded-xl border border-rose-400/55 text-rose-200 hover:bg-rose-500/20 text-xs font-bold cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PAYMENTS & QR MANAGER */}
        {activeTab === 'payments' && (
          <form
            onSubmit={handleSaveSettings}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
          >
            <div className={`lg:col-span-7 p-6 space-y-5 ${glowCardClass}`}>
              <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
              <h2 className="text-base font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent">
                Supported Payment Methods &amp; UPI Setup
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-pink-200 mb-1">Merchant UPI ID</label>
                  <input
                    type="text"
                    maxLength={120}
                    value={settingsForm.upiId}
                    onChange={(e) => setSettingsForm({ ...settingsForm, upiId: e.target.value })}
                    placeholder="yourname@okaxis"
                    className={`${glowInputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-lime-300 mb-1">Merchant Display Name</label>
                  <input
                    type="text"
                    maxLength={100}
                    value={settingsForm.merchantName}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, merchantName: e.target.value })
                    }
                    className={glowInputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-pink-200 mb-2">
                  Toggle Supported Payment Options
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {ALL_PAYMENT_METHODS.map((m) => {
                    const enabled = settingsForm.supportedMethods.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => togglePaymentMethod(m.id)}
                        className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          enabled
                            ? 'bg-gradient-to-r from-pink-500/18 to-lime-400/15 border-pink-300/65 text-white'
                            : 'bg-[#070911] border-white/15 text-zinc-300 hover:border-white/35'
                        }`}
                      >
                        <span className="text-xs font-semibold">{m.label}</span>
                        {enabled && <Check className="w-4 h-4 text-lime-300" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1">
                  Bank Transfer / IMPS Details (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={settingsForm.bankDetails}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, bankDetails: e.target.value })
                  }
                  className={glowCompactInputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1">
                  Online Payment Gateway Link (Optional)
                </label>
                <input
                  type="url"
                  maxLength={500}
                  value={settingsForm.gatewayPaymentUrl}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, gatewayPaymentUrl: e.target.value })
                  }
                  placeholder="https://rzp.io/..."
                  className={`${glowCompactInputClass} font-mono`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1">Checkout Instructions</label>
                <textarea
                  rows={2}
                  maxLength={600}
                  value={settingsForm.paymentInstructions}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, paymentInstructions: e.target.value })
                  }
                  className={glowCompactInputClass}
                />
              </div>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-400/60 text-xs font-semibold text-rose-200 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-rose-300 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
              {statusMessage && (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-lime-400/55 text-xs font-semibold text-lime-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-lime-300 shrink-0" />
                  <span>{statusMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={savingSettings}
                className={glowPrimaryBtnClass}
              >
                {savingSettings ? 'Saving...' : 'Save Payment Settings'}
              </button>
            </div>

            {/* QR Preview & Upload */}
            <div className="lg:col-span-5 relative p-6 rounded-3xl hd-glass-surface border border-cyan-300/45 glow-card-sapphire space-y-5 text-center overflow-hidden">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-300 via-white to-lime-300" />
              <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-cyan-200">
                <QrCode className="w-4 h-4 text-cyan-300" />
                Checkout QR Code Preview
              </div>
              <div className="inline-block p-4 rounded-2xl bg-white border-2 border-cyan-300/55 shadow-[0_0_32px_rgba(56,189,248,0.28)]">
                {settingsForm.qrImageUrl ? (
                  <img
                    src={settingsForm.qrImageUrl}
                    alt="Custom QR"
                    className="w-48 h-48 object-contain"
                  />
                ) : (
                  <QRCodeSVG
                    value={`upi://pay?pa=${encodeURIComponent(
                      settingsForm.upiId || 'khatushyamlearning@upi',
                    )}&pn=${encodeURIComponent(settingsForm.merchantName || settingsForm.brandName)}&cu=INR`}
                    size={192}
                  />
                )}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/20 text-xs font-bold text-white cursor-pointer">
                  <ImagePlus className="w-3.5 h-3.5 text-pink-300" />
                  Upload Custom QR Image
                  <input type="file" accept="image/*" onChange={handleQrUpload} className="hidden" />
                </label>
                {settingsForm.qrImageUrl && (
                  <button
                    type="button"
                    onClick={() => setSettingsForm({ ...settingsForm, qrImageUrl: '' })}
                    className="px-4 py-2 rounded-xl border border-white/20 text-xs font-semibold text-zinc-200 hover:text-white cursor-pointer"
                  >
                    Use Auto UPI QR
                  </button>
                )}
              </div>
            </div>
          </form>
        )}

        {/* TAB 5: STOREFRONT, POP-UP & ADMIN LINK */}
        {activeTab === 'settings' && (
          <form
            onSubmit={handleSaveSettings}
            className={`max-w-3xl p-6 space-y-5 ${glowCardClass}`}
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
            <div className="p-4 rounded-2xl bg-gradient-to-r from-pink-500/12 via-[#070911] to-lime-400/12 border border-pink-300/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold text-lime-300">
                  Personal Admin Panel Link
                </p>
                <p className="text-xs font-mono text-white mt-0.5 break-all">{adminUrl}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(adminUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 1800);
                }}
                className={glowPrimaryBtnClass}
              >
                {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedLink ? 'Copied' : 'Copy Admin Link'}
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-500/15 via-[#070911] to-pink-500/12 border border-cyan-300/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-cyan-300">
                  App, Store &amp; WebView Link (Browser + WebView Supported)
                </p>
                <p className="text-xs font-mono text-white mt-0.5 break-all">{storefrontShareUrl}</p>
                <p className="text-[11px] text-zinc-300 mt-1">
                  Anyone can add this link inside their app, store, Android/iOS WebView, or browser — direct external API connections remain strictly blocked.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(storefrontShareUrl);
                  setCopiedStorefrontLink(true);
                  setTimeout(() => setCopiedStorefrontLink(false), 1800);
                }}
                className={glowPrimaryBtnClass}
              >
                {copiedStorefrontLink ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedStorefrontLink ? 'Copied' : 'Copy App Link'}
              </button>
            </div>

            {/* Custom Domain Setup (Anti-Clone Synced) */}
            <div className="p-5 rounded-2xl bg-[#070911] border border-white/15 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-pink-300" />
                  <h3 className="text-xs sm:text-sm font-extrabold text-pink-200">
                    Custom Domain Option (Anti-Clone Authorized)
                  </h3>
                </div>
                {normalizeCustomDomain(settings.customDomain) && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-lime-400/55 text-[10px] font-bold text-lime-300">
                    Active: {normalizeCustomDomain(settings.customDomain)}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  maxLength={180}
                  value={settingsForm.customDomain || ''}
                  onChange={(e) => {
                    setDnsError('');
                    setDnsResult(null);
                    setSettingsForm({ ...settingsForm, customDomain: e.target.value });
                  }}
                  placeholder="e.g. batches.yourdomain.com or yourdomain.in"
                  className={`${glowCompactInputClass} font-mono flex-1`}
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={checkingDns}
                    onClick={() => void handleCheckDomainDns()}
                    className="px-4 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-300/45 text-xs font-bold text-cyan-200 cursor-pointer disabled:opacity-60"
                  >
                    {checkingDns ? 'Checking DNS...' : 'Check DNS'}
                  </button>
                  {settingsForm.customDomain && (
                    <button
                      type="button"
                      onClick={() => {
                        setDnsResult(null);
                        setDnsError('');
                        setSettingsForm({ ...settingsForm, customDomain: '' });
                      }}
                      className="px-3.5 py-2 rounded-xl border border-rose-400/45 text-xs font-semibold text-rose-300 hover:bg-rose-500/15 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {dnsError && (
                <p className="text-xs font-semibold text-rose-300">{dnsError}</p>
              )}

              {dnsResult && (
                <div
                  className={`p-3 rounded-xl border text-xs space-y-1 ${
                    dnsResult.pointsToGoogleHost
                      ? 'bg-emerald-500/10 border-lime-400/45 text-lime-200'
                      : dnsResult.connected
                        ? 'bg-amber-400/10 border-amber-400/45 text-amber-200'
                        : 'bg-rose-500/10 border-rose-400/45 text-rose-200'
                  }`}
                >
                  <p className="font-bold">
                    {dnsResult.pointsToGoogleHost
                      ? `DNS Verified: ${dnsResult.domain} points to Google Cloud hosting.`
                      : dnsResult.connected
                        ? `DNS Found for ${dnsResult.domain} (verify CNAME/proxy points to Cloud Run).`
                        : `No DNS A/CNAME records found yet for ${dnsResult.domain}.`}
                  </p>
                  {dnsResult.cnameRecords.length > 0 && (
                    <p className="font-mono text-[11px] opacity-90">
                      CNAME: {dnsResult.cnameRecords.join(', ')}
                    </p>
                  )}
                  {dnsResult.aRecords.length > 0 && (
                    <p className="font-mono text-[11px] opacity-90">
                      A Records: {dnsResult.aRecords.join(', ')}
                    </p>
                  )}
                </div>
              )}

              {normalizeCustomDomain(settingsForm.customDomain) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div className="p-3 rounded-xl bg-black/45 border border-white/15 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-pink-200">Custom Storefront Link</p>
                      <p className="text-[11px] font-mono text-white truncate">
                        https://{normalizeCustomDomain(settingsForm.customDomain)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const url = `https://${normalizeCustomDomain(settingsForm.customDomain)}`;
                        void navigator.clipboard.writeText(url);
                        setCopiedCustomType('storefront');
                        setTimeout(() => setCopiedCustomType(null), 1600);
                      }}
                      className="p-1.5 rounded-lg border border-white/20 text-zinc-200 hover:text-white shrink-0 cursor-pointer"
                      title="Copy Storefront Link"
                    >
                      {copiedCustomType === 'storefront' ? (
                        <Check className="w-3.5 h-3.5 text-lime-300" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="p-3 rounded-xl bg-black/45 border border-white/15 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-lime-300">Custom Admin Link</p>
                      <p className="text-[11px] font-mono text-white truncate">
                        https://{normalizeCustomDomain(settingsForm.customDomain)}/ksl-admin-872
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const url = `https://${normalizeCustomDomain(settingsForm.customDomain)}/ksl-admin-872`;
                        void navigator.clipboard.writeText(url);
                        setCopiedCustomType('admin');
                        setTimeout(() => setCopiedCustomType(null), 1600);
                      }}
                      className="p-1.5 rounded-lg border border-white/20 text-zinc-200 hover:text-white shrink-0 cursor-pointer"
                      title="Copy Custom Admin Link"
                    >
                      {copiedCustomType === 'admin' ? (
                        <Check className="w-3.5 h-3.5 text-lime-300" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="text-[11px] text-zinc-300 space-y-1 leading-relaxed">
                <p>
                  <span className="font-semibold text-white">DNS Setup:</span> Point your domain/subdomain CNAME record to{' '}
                  <code className="px-1.5 py-0.5 rounded bg-black/60 border border-white/15 text-cyan-300 font-mono">
                    ghs.googlehosted.com
                  </code>{' '}
                  (and map the domain in Google Cloud Run / Cloudflare), then click <span className="text-lime-300 font-semibold">Save Storefront Settings</span> below.
                </p>
                <p className="text-zinc-400">
                  Saving here automatically unlocks ONLY your verified custom domain in Anti-Clone Protection while keeping all other cloned domains blocked.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-pink-200 mb-1">Brand Title</label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={settingsForm.brandName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, brandName: e.target.value })}
                  className={glowInputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-lime-300 mb-1">Neon Glow Theme</label>
                <select
                  value={settingsForm.glowTheme}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      glowTheme: e.target.value as GlowTheme,
                    })
                  }
                  className={glowInputClass}
                >
                  <option value="amber">Neon Gold &amp; Pink</option>
                  <option value="crimson">Neon Pink Glow</option>
                  <option value="sapphire">Cyan Sapphire Glow</option>
                  <option value="emerald">Lime Emerald Glow</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-6 text-xs font-semibold text-zinc-200">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settingsForm.showCheckmark}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, showCheckmark: e.target.checked })
                  }
                  className="accent-emerald-400"
                />
                Show Verified Checkmark beside Brand Name
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settingsForm.popupEnabled}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, popupEnabled: e.target.checked })
                  }
                  className="accent-pink-400"
                />
                Show Limited Offer Badge
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-zinc-200 mb-1">Top Pop-Up Message</label>
                <input
                  type="text"
                  maxLength={240}
                  value={settingsForm.popupText}
                  onChange={(e) => setSettingsForm({ ...settingsForm, popupText: e.target.value })}
                  className={glowCompactInputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1">Limited Offer Button Label</label>
                <input
                  type="text"
                  maxLength={60}
                  value={settingsForm.popupCtaText}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, popupCtaText: e.target.value })
                  }
                  className={glowCompactInputClass}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-200 mb-1">Hero Headline</label>
              <input
                type="text"
                required
                maxLength={160}
                value={settingsForm.heroTitle}
                onChange={(e) => setSettingsForm({ ...settingsForm, heroTitle: e.target.value })}
                className={glowInputClass}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-200 mb-1">Hero Subtitle</label>
              <textarea
                rows={2}
                maxLength={400}
                value={settingsForm.heroSubtitle}
                onChange={(e) => setSettingsForm({ ...settingsForm, heroSubtitle: e.target.value })}
                className={glowCompactInputClass}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-cyan-200 mb-1">Telegram Channel URL</label>
                <input
                  type="text"
                  maxLength={300}
                  value={settingsForm.supportTelegramUrl}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, supportTelegramUrl: e.target.value })
                  }
                  className={`${glowCompactInputClass} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-lime-300 mb-1">WhatsApp Channel / Join Link</label>
                <input
                  type="text"
                  maxLength={300}
                  value={settingsForm.supportWhatsapp}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, supportWhatsapp: e.target.value })
                  }
                  placeholder="https://whatsapp.com/channel/..."
                  className={`${glowCompactInputClass} font-mono`}
                />
              </div>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-400/60 text-xs font-semibold text-rose-200 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-rose-300 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
            {statusMessage && (
              <div className="p-3 rounded-xl bg-emerald-500/15 border border-lime-400/55 text-xs font-semibold text-lime-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-lime-300 shrink-0" />
                <span>{statusMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={savingSettings}
              className={glowPrimaryBtnClass}
            >
              {savingSettings ? 'Saving...' : 'Save Storefront Settings'}
            </button>
          </form>
        )}
      </main>

      {/* Receipt Image Lightbox */}
      {previewScreenshot && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setPreviewScreenshot(null)}
        >
          <img
            src={previewScreenshot}
            alt="Payment Screenshot"
            className="max-w-full max-h-[85vh] rounded-3xl border border-pink-300/60 shadow-[0_0_48px_rgba(244,114,182,0.45)]"
          />
        </div>
      )}
    </div>
  );
}
