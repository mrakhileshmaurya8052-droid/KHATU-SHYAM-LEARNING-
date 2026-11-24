import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, getDocFromCache } from 'firebase/firestore';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Flame,
  KeyRound,
  Loader2,
  Lock,
  MessageCircle,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Tag,
  Unlock,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import { Batch, GlowTheme, Offer, Order, SiteSettings } from '../types';
import { VerifiedMark } from '../components/VerifiedMark';
import { BatchThumbnail } from '../components/BatchThumbnail';
import { BatchCheckoutModal } from '../components/BatchCheckoutModal';
import { BatchLauncherModal } from '../components/BatchLauncherModal';
import {
  JoinCommunityModal,
  resolveTelegramChannelUrl,
  resolveWhatsappChannelUrl,
} from '../components/JoinCommunityModal';

const THEME_ACCENT: Record<
  GlowTheme,
  {
    text: string;
    btn: string;
    glowCard: string;
  }
> = {
  amber: {
    text: 'text-amber-300',
    btn: 'bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 hover:brightness-105 text-zinc-950 font-extrabold shadow-[0_0_22px_-4px_rgba(244,114,182,0.55)]',
    glowCard: 'glow-card-amber border-amber-300/45',
  },
  crimson: {
    text: 'text-pink-300',
    btn: 'bg-gradient-to-r from-pink-400 via-rose-300 to-amber-200 hover:brightness-105 text-zinc-950 font-extrabold shadow-[0_0_22px_-4px_rgba(244,114,182,0.6)]',
    glowCard: 'glow-card-crimson border-pink-400/45',
  },
  sapphire: {
    text: 'text-cyan-300',
    btn: 'bg-gradient-to-r from-cyan-300 via-sky-300 to-lime-200 hover:brightness-105 text-zinc-950 font-extrabold shadow-[0_0_22px_-4px_rgba(56,189,248,0.6)]',
    glowCard: 'glow-card-sapphire border-cyan-400/45',
  },
  emerald: {
    text: 'text-lime-300',
    btn: 'bg-gradient-to-r from-emerald-400 to-cyan-400 hover:brightness-105 text-zinc-950 font-extrabold shadow-[0_0_22px_-4px_rgba(74,222,128,0.6)]',
    glowCard: 'glow-card-emerald border-lime-400/45',
  },
};

export function Storefront({
  settings,
  batches,
  offers,
  orders,
  loadingData,
  quotaExceeded = false,
  onOrderCreated,
}: {
  settings: SiteSettings;
  batches: Batch[];
  offers: Offer[];
  orders: Order[];
  loadingData: boolean;
  quotaExceeded?: boolean;
  onOrderCreated: (orderId: string, initialOrder?: Order) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeBatchModal, setActiveBatchModal] = useState<Batch | null>(null);
  const [showMyAccessModal, setShowMyAccessModal] = useState(false);
  const [showOfferDetails, setShowOfferDetails] = useState(false);
  const [telegramCount, setTelegramCount] = useState<number>(703);
  const [openingFreeBatchId, setOpeningFreeBatchId] = useState<string | null>(null);
  const [freeOpenError, setFreeOpenError] = useState('');
  const [launcherState, setLauncherState] = useState<{
    order: Order;
    batch: Batch;
  } | null>(null);
  const [communityModalChannel, setCommunityModalChannel] = useState<
    'telegram' | 'whatsapp' | 'both' | null
  >(null);

  const telegramJoinUrl = resolveTelegramChannelUrl(settings.supportTelegramUrl);
  const whatsappJoinUrl = resolveWhatsappChannelUrl(settings.supportWhatsapp);

  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      try {
        const res = await fetch(
          `/api/telegram-stats?url=${encodeURIComponent(telegramJoinUrl)}`,
          {
            credentials: 'same-origin',
            headers: {
              'X-KSL-Client': 'ksl-v1',
            },
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (active && typeof data.count === 'number' && data.count > 0) {
          setTelegramCount(data.count);
        }
      } catch {
        // Keep last valid count
      }
    };
    void fetchStats();
    const timer = setInterval(() => {
      void fetchStats();
    }, 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [telegramJoinUrl]);

  const activeOffers = useMemo(
    () =>
      offers
        .filter((o) => o.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [offers],
  );

  const hasPaymentFlow = (batch: Batch) =>
    batch.requirePayment !== false && Number(batch.price) > 0;

  const theme = THEME_ACCENT[settings.glowTheme] || THEME_ACCENT.amber;
  const activeBatches = useMemo(
    () =>
      batches
        .filter((b) => b.isActive !== false)
        .sort((a, b) => {
          const aDirect = hasPaymentFlow(a) ? 1 : 0;
          const bDirect = hasPaymentFlow(b) ? 1 : 0;
          if (aDirect !== bDirect) return aDirect - bDirect;
          return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0);
        }),
    [batches],
  );

  const filteredBatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeBatches;
    return activeBatches.filter((b) => b.title.toLowerCase().includes(q));
  }, [activeBatches, searchQuery]);

  const orderByBatchId = useMemo(() => {
    const map = new Map<string, Order>();
    orders.forEach((ord) => {
      const existing = map.get(ord.batchId);
      if (!existing || ord.status === 'approved') {
        map.set(ord.batchId, ord);
      }
    });
    return map;
  }, [orders]);

  const handleOpenFreeBatch = async (batch: Batch) => {
    if (openingFreeBatchId) return;
    setFreeOpenError('');
    setOpeningFreeBatchId(batch.id);
    try {
      let targetUrl = '';
      let accessInstructions = '';
      let openType = batch.openType;
      let sealedFramePath = '';

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(
          `/api/batches/${encodeURIComponent(batch.id)}/free-access`,
          {
            method: 'POST',
            credentials: 'same-origin',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'X-KSL-Client': 'ksl-v1',
            },
          },
        );
        clearTimeout(timer);
        if (res.ok) {
          const data = (await res.json()) as {
            ok?: boolean;
            openType?: Batch['openType'];
            unlockedUrl?: string;
            unlockedInstructions?: string;
            sealedFramePath?: string;
          };
          if (data.ok) {
            targetUrl = String(data.unlockedUrl || '');
            accessInstructions = String(data.unlockedInstructions || '');
            if (data.openType) openType = data.openType;
            if (data.sealedFramePath) sealedFramePath = String(data.sealedFramePath);
          }
        }
      } catch {
        // Fall through to cached Firestore lookup cleanly
      }

      if (!targetUrl) {
        const ref = doc(db, 'batches', batch.id, 'private', 'access');
        const cachedSnap = await getDocFromCache(ref).catch(() => null);
        if (cachedSnap && cachedSnap.exists()) {
          const d = cachedSnap.data();
          targetUrl = String(d.targetUrl || '');
          accessInstructions = String(d.accessInstructions || '');
        } else {
          const serverSnap = await Promise.race([
            getDoc(ref).catch(() => null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
          ]);
          if (serverSnap && serverSnap.exists()) {
            const d = serverSnap.data();
            targetUrl = String(d.targetUrl || '');
            accessInstructions = String(d.accessInstructions || '');
          }
        }
      }

      if (!targetUrl) {
        setFreeOpenError(
          'Batch link needs to be saved in Admin Panel (/ksl-admin-872) once to open live.',
        );
        return;
      }

      const virtualFreeOrder: Order = {
        id: `free_${batch.id}`,
        userId: 'free',
        userEmail: '',
        studentName: 'Free Access',
        studentPhone: '',
        batchId: batch.id,
        batchTitle: batch.title,
        amount: 0,
        paymentMethod: 'FREE',
        utrNumber: 'FREE',
        screenshotUrl: '',
        studentNote: '',
        status: 'approved',
        adminNote: '',
        openType,
        unlockedUrl: targetUrl,
        unlockedInstructions: accessInstructions,
        ...(sealedFramePath ? { sealedFramePath } : {}),
      };
      setLauncherState({ order: virtualFreeOrder, batch });
    } catch {
      setFreeOpenError('Could not open free batch right now. Please try again.');
    } finally {
      setOpeningFreeBatchId(null);
    }
  };

  const handleBatchCardClick = (batch: Batch) => {
    if (!hasPaymentFlow(batch)) {
      void handleOpenFreeBatch(batch);
      return;
    }
    const order = orderByBatchId.get(batch.id);
    if (order && order.status === 'approved') {
      setLauncherState({ order, batch });
      return;
    }
    setActiveBatchModal(batch);
  };

  return (
    <div className="min-h-screen bg-[#030307] dark-hd-studio text-zinc-100 flex flex-col relative overflow-x-hidden">
      {/* Ambient Neon Studio Lights */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/5 w-[560px] h-[340px] rounded-full blur-[150px] bg-pink-500/14" />
        <div className="absolute -top-32 right-1/5 w-[520px] h-[320px] rounded-full blur-[150px] bg-lime-400/10" />
        <div className="absolute top-[42%] -left-24 w-[420px] h-[420px] rounded-full blur-[160px] bg-cyan-400/10" />
      </div>

      {/* Main Content */}
      <main id="top" className="flex-1 relative z-10">
        {/* Ultra-Dark Neon Hero & Quick Action Stack */}
        <section className="relative border-b border-white/10">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 pb-9 space-y-6">
            {/* Brand Header */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full ultra-glow-topbar">
                <span className="font-display text-xs sm:text-sm font-extrabold tracking-wide bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent">
                  {settings.brandName}
                </span>
                {settings.showCheckmark && (
                  <VerifiedMark theme={settings.glowTheme} size="sm" />
                )}
              </div>

              <h1 className="font-display text-2xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                {settings.heroTitle}
              </h1>
              {settings.heroSubtitle && (
                <p className="text-xs sm:text-sm text-zinc-300 max-w-xl mx-auto leading-relaxed">
                  {settings.heroSubtitle}
                </p>
              )}
            </div>

            {/* Clean Neon Action Buttons & Search Stack */}
            <div className="max-w-md mx-auto space-y-3">
              {/* 1. Explore Live Batches */}
              <a
                href="#batches"
                className="group w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-pink-400 via-amber-300 to-lime-300 hover:brightness-105 text-zinc-950 font-extrabold shadow-[0_0_30px_-4px_rgba(244,114,182,0.55)] transition-all active:scale-[0.99]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-zinc-950/15 flex items-center justify-center shrink-0">
                    <Rocket className="w-5 h-5 text-zinc-950" />
                  </div>
                  <span className="font-display text-sm sm:text-base font-extrabold truncate">
                    Explore Live Batches
                  </span>
                </div>
                <ArrowRight className="w-5 h-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </a>

              {/* 2. My Batch Access */}
              <button
                type="button"
                onClick={() => setShowMyAccessModal(true)}
                className="group w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl hd-glass-surface border border-pink-300/40 hover:border-pink-300/75 text-white shadow-[0_0_24px_-8px_rgba(244,114,182,0.38)] transition-all active:scale-[0.99] cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-pink-500/15 border border-pink-300/40 flex items-center justify-center shrink-0">
                    <KeyRound className="w-4 h-4 text-pink-300" />
                  </div>
                  <span className="font-display text-sm sm:text-base font-bold truncate">
                    My Batch Access
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-pink-200 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>

              {/* 3. Limited Offer Toggle + Drawer */}
              {settings.popupEnabled && (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setShowOfferDetails((prev) => !prev)}
                    className="group w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl hd-glass-surface border border-amber-300/45 hover:border-amber-300/80 text-white shadow-[0_0_24px_-8px_rgba(251,191,36,0.35)] transition-all active:scale-[0.99] cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-amber-400/15 border border-amber-300/40 flex items-center justify-center shrink-0">
                        <Flame className="w-4 h-4 text-amber-300" />
                      </div>
                      <span className="font-display text-sm sm:text-base font-bold text-amber-200 truncate">
                        {settings.popupCtaText || 'Limited Offer'}
                      </span>
                    </div>
                    <ArrowRight
                      className={`w-4 h-4 text-amber-200 shrink-0 transition-transform ${
                        showOfferDetails ? 'rotate-90' : 'group-hover:translate-x-0.5'
                      }`}
                    />
                  </button>

                  {showOfferDetails && activeOffers.length > 0 && (
                    <div className="space-y-2 pt-0.5">
                      {activeOffers.map((offer) => (
                        <div
                          key={offer.id}
                          className="relative px-4 py-3 rounded-2xl bg-[#0B0D18] border border-amber-300/40 shadow-[0_0_24px_-8px_rgba(251,191,36,0.3)] overflow-hidden"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Tag className="w-4 h-4 text-pink-300 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs sm:text-sm font-bold text-white truncate">
                                  {offer.title}
                                </p>
                                {offer.description && (
                                  <p className="text-[11px] text-zinc-300 mt-0.5 leading-snug">
                                    {offer.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            {offer.badge && (
                              <span className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 text-zinc-950 text-[11px] font-extrabold shrink-0">
                                {offer.badge}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 4. Join Our Telegram */}
              <button
                type="button"
                onClick={() => setCommunityModalChannel('telegram')}
                className="group w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-sky-500/20 via-cyan-500/15 to-blue-600/20 border border-cyan-300/55 hover:border-cyan-200 shadow-[0_0_26px_-8px_rgba(56,189,248,0.5)] transition-all active:scale-[0.99] cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-cyan-300 text-zinc-950 flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(56,189,248,0.65)]">
                    <Send className="w-4 h-4 -translate-x-0.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-sm sm:text-base font-extrabold text-white truncate">
                      Join Our Telegram
                    </p>
                    <div className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-lime-400 shadow-[0_0_8px_#4ADE80] shrink-0" />
                      <span className="text-[11px] font-mono font-bold tracking-wider text-cyan-200 tabular-nums">
                        {telegramCount.toLocaleString('en-IN')} JOINED
                      </span>
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-cyan-200 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>

              {/* 5. Join Our WhatsApp */}
              <button
                type="button"
                onClick={() => setCommunityModalChannel('whatsapp')}
                className="group w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-emerald-500/20 via-lime-400/15 to-green-600/20 border border-lime-300/55 hover:border-lime-200 shadow-[0_0_26px_-8px_rgba(74,222,128,0.5)] transition-all active:scale-[0.99] cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-lime-300 to-emerald-400 text-zinc-950 flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(74,222,128,0.65)]">
                    <MessageCircle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-sm sm:text-base font-extrabold text-white truncate">
                      Join Our WhatsApp
                    </p>
                    <p className="text-[11px] font-mono font-bold tracking-wider text-lime-300">
                      OFFICIAL CHANNEL
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-lime-200 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>

              {/* 6. Search Batch Name */}
              <div className="flex items-center rounded-2xl bg-[#070911] border border-pink-300/40 focus-within:border-lime-300 shadow-[0_0_22px_-8px_rgba(244,114,182,0.3)] transition-all px-3.5 py-2.5">
                <Search className="w-4 h-4 text-pink-300 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search batch name..."
                  className="w-full px-2.5 bg-transparent text-xs sm:text-sm font-medium text-white placeholder:text-zinc-400 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="p-1 text-zinc-400 hover:text-white cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Batches Catalog Section */}
        <section id="batches" className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
          {freeOpenError && (
            <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-400/50 text-xs font-semibold text-rose-200 flex items-center justify-between gap-3">
              <span>{freeOpenError}</span>
              <button
                type="button"
                onClick={() => setFreeOpenError('')}
                className="text-rose-200 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {loadingData ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-80 rounded-2xl hd-glass-surface border border-white/10 animate-pulse"
                />
              ))}
            </div>
          ) : filteredBatches.length === 0 ? (
            <div className="p-12 rounded-3xl hd-glass-surface border border-pink-300/35 text-center space-y-3">
              <p className="text-base font-bold text-white">
                {searchQuery.trim()
                  ? 'No batches match your search'
                  : 'No batches published yet'}
              </p>
              <p className="text-xs text-zinc-400 max-w-lg mx-auto leading-relaxed">
                {searchQuery.trim()
                  ? 'Try clearing your search to view all batches.'
                  : quotaExceeded
                    ? 'Older Firebase batches are temporarily paused due to daily free read limits. Any new batch published in Admin Panel will appear here live right away.'
                    : 'Batches published from the Admin Panel will appear here automatically.'}
              </p>
            </div>
          ) : (
            (() => {
              const directOpenBatches = filteredBatches.filter((b) => !hasPaymentFlow(b));
              const paidBatches = filteredBatches.filter((b) => hasPaymentFlow(b));

              const renderBatchCard = (batch: Batch) => {
                const order = orderByBatchId.get(batch.id);
                const isFree = !hasPaymentFlow(batch);
                const isApproved = order?.status === 'approved';
                const isPending = order?.status === 'pending';
                const isOpeningFree = openingFreeBatchId === batch.id;
                const cardAccent = THEME_ACCENT[batch.glowAccent] || theme;

                const sizeColClass =
                  batch.thumbnailSize === 'featured'
                    ? 'md:col-span-2'
                    : batch.thumbnailSize === 'large'
                      ? 'lg:col-span-2'
                      : '';
                const thumbScaleClass =
                  batch.thumbnailSize === 'compact' ? 'max-h-48' : '';

                const discountPct =
                  batch.originalPrice > batch.price && batch.originalPrice > 0
                    ? Math.round(
                        ((batch.originalPrice - batch.price) / batch.originalPrice) * 100,
                      )
                    : 0;

                return (
                  <article
                    key={batch.id}
                    onClick={() => handleBatchCardClick(batch)}
                    className={`group relative cursor-pointer rounded-2xl hd-glass-surface border overflow-hidden transition-all duration-200 hover:-translate-y-1 ${sizeColClass} ${cardAccent.glowCard}`}
                  >
                    <div className="relative">
                      <BatchThumbnail
                        src={batch.thumbnailUrl}
                        alt={batch.title}
                        aspect={batch.thumbnailAspect}
                        glow={batch.glowAccent}
                        className={thumbScaleClass}
                      />
                      <div className="absolute top-3 right-3 z-10">
                        {isFree ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#051810]/90 backdrop-blur-md border border-lime-400/55 text-lime-300 text-[11px] font-bold shadow-[0_4px_16px_rgba(74,222,128,0.35)]">
                            <Unlock className="w-3 h-3" />
                            Free
                          </span>
                        ) : isApproved ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#051810]/90 backdrop-blur-md border border-lime-400/55 text-lime-300 text-[11px] font-bold shadow-[0_4px_16px_rgba(74,222,128,0.35)]">
                            <Unlock className="w-3 h-3" />
                            Unlocked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#070911]/90 backdrop-blur-md border border-white/20 text-zinc-100 text-[11px] font-semibold shadow-lg">
                            <Lock className="w-3 h-3 text-zinc-300" />
                            Locked
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-5 space-y-4 bg-[#070911]">
                      <div className="flex items-center gap-2.5">
                        <h3 className="font-display text-lg sm:text-xl font-extrabold text-white leading-snug group-hover:text-pink-100 transition-colors">
                          {batch.title}
                        </h3>
                        {batch.showCheckmark !== false && (
                          <VerifiedMark
                            theme={batch.glowAccent}
                            size="sm"
                            className="shrink-0"
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-4 pt-3.5 border-t border-white/10">
                        <div className="flex items-baseline gap-2.5">
                          <span
                            className={`text-2xl font-extrabold font-mono tabular-nums ${
                              isFree ? 'text-lime-300' : 'text-white'
                            }`}
                          >
                            {isFree
                              ? 'Free'
                              : `₹${batch.price.toLocaleString('en-IN')}`}
                          </span>
                          {batch.originalPrice > batch.price && (
                            <span className="text-xs font-mono tabular-nums text-zinc-500 line-through">
                              ₹{batch.originalPrice.toLocaleString('en-IN')}
                            </span>
                          )}
                          {discountPct > 0 && !isFree && (
                            <span className="text-xs font-bold text-lime-300">
                              {discountPct}% Off
                            </span>
                          )}
                        </div>

                        {isFree ? (
                          <button
                            type="button"
                            disabled={isOpeningFree}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleOpenFreeBatch(batch);
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:brightness-105 text-zinc-950 text-xs font-extrabold shadow-[0_0_24px_-4px_rgba(52,211,153,0.6)] transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-70"
                          >
                            {isOpeningFree ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Unlock className="w-4 h-4" />
                            )}
                            {isOpeningFree ? 'Opening...' : 'Open Batch'}
                          </button>
                        ) : isApproved ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (order) setLauncherState({ order, batch });
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:brightness-105 text-zinc-950 text-xs font-extrabold shadow-[0_0_24px_-4px_rgba(52,211,153,0.6)] transition-all whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Open Batch
                          </button>
                        ) : isPending ? (
                          <span className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-400/15 border border-amber-300/45 text-amber-200 text-xs font-bold whitespace-nowrap shrink-0">
                            <Clock className="w-3.5 h-3.5" />
                            Pending Approval
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveBatchModal(batch);
                            }}
                            className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs transition-all whitespace-nowrap shrink-0 cursor-pointer ${cardAccent.btn}`}
                          >
                            <Lock className="w-3.5 h-3.5" />
                            Buy Now
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              };

              return (
                <div className="space-y-8">
                  {directOpenBatches.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7 items-start">
                      {directOpenBatches.map(renderBatchCard)}
                    </div>
                  )}
                  {paidBatches.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7 items-start">
                      {paidBatches.map(renderBatchCard)}
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </section>
      </main>

      {/* Clean Minimal Dark Footer */}
      <footer id="support" className="relative z-10 bg-[#030307] border-t border-white/10 py-8 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2.5 text-xs text-white">
          <span className="font-display font-extrabold tracking-wide text-white">
            {settings.brandName}
          </span>
          {settings.showCheckmark && (
            <VerifiedMark theme={settings.glowTheme} size="sm" />
          )}
        </div>
      </footer>

      {/* Checkout Modal */}
      {activeBatchModal && (
        <BatchCheckoutModal
          batch={activeBatchModal}
          settings={settings}
          existingOrder={orderByBatchId.get(activeBatchModal.id) || null}
          onOrderCreated={onOrderCreated}
          onOpenBatch={(ord, b) => {
            setActiveBatchModal(null);
            setLauncherState({ order: ord, batch: b });
          }}
          onClose={() => setActiveBatchModal(null)}
        />
      )}

      {/* My Batch Access Modal */}
      {showMyAccessModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/82 backdrop-blur-md"
          onClick={() => setShowMyAccessModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-xl rounded-3xl bg-[#070911] border border-pink-300/40 shadow-[0_24px_70px_-10px_rgba(0,0,0,0.96),0_0_46px_-8px_rgba(244,114,182,0.42)] overflow-hidden"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
            <div className="flex items-center justify-between px-6 py-4 bg-[#0B0D18] border-b border-white/10">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-pink-300" />
                <h2 className="font-display text-lg font-extrabold text-white">
                  My Batch Access
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowMyAccessModal(false)}
                aria-label="Close My Batch Access"
                className="p-1.5 rounded-xl border border-white/15 text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto space-y-3 bg-[#070911]">
              {orders.length === 0 ? (
                <div className="p-6 rounded-2xl bg-[#0C0F1C] border border-white/10 text-center space-y-2">
                  <p className="text-sm font-semibold text-white">No active batch purchases yet</p>
                  <p className="text-xs text-zinc-400">
                    Tap any batch thumbnail and submit payment to unlock access here.
                  </p>
                </div>
              ) : (
                orders.map((ord) => {
                  const matchedBatch = batches.find((b) => b.id === ord.batchId);
                  return (
                    <div
                      key={ord.id}
                      className="p-4 rounded-2xl bg-[#0C0F1C] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            className={`font-bold ${
                              ord.status === 'approved'
                                ? 'text-lime-300'
                                : ord.status === 'rejected'
                                  ? 'text-rose-400'
                                  : 'text-amber-300'
                            }`}
                          >
                            {ord.status === 'approved'
                              ? 'Approved'
                              : ord.status === 'rejected'
                                ? 'Declined'
                                : 'Pending Approval'}
                          </span>
                          <span className="text-zinc-500" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-zinc-300 truncate">
                            UTR: {ord.utrNumber}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-white truncate">
                          {ord.batchTitle}
                        </h3>
                        <p className="text-xs text-zinc-400">
                          ₹{ord.amount.toLocaleString('en-IN')}
                          {ord.planLabel ? ` · ${ord.planLabel}` : ''} · {ord.paymentMethod}
                        </p>
                        {ord.adminNote && (
                          <p className="text-xs text-zinc-200 pt-1">
                            Admin Note: {ord.adminNote}
                          </p>
                        )}
                      </div>

                      {ord.status === 'approved' && matchedBatch ? (
                        <button
                          type="button"
                          onClick={() => {
                            setShowMyAccessModal(false);
                            setLauncherState({ order: ord, batch: matchedBatch });
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-zinc-950 text-xs font-extrabold shadow-[0_0_22px_-4px_rgba(52,211,153,0.55)] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          Open Batch
                        </button>
                      ) : ord.status === 'rejected' && matchedBatch ? (
                        <button
                          type="button"
                          onClick={() => {
                            setShowMyAccessModal(false);
                            setActiveBatchModal(matchedBatch);
                          }}
                          className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer ${theme.btn}`}
                        >
                          Resubmit
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300 font-medium shrink-0">
                          <Lock className="w-3.5 h-3.5 text-amber-300" /> Locked until Approved
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Batch Launcher Modal */}
      {launcherState && (
        <BatchLauncherModal
          order={launcherState.order}
          batch={launcherState.batch}
          settings={settings}
          onClose={() => setLauncherState(null)}
        />
      )}

      {/* Official Telegram & WhatsApp Join Popup */}
      {communityModalChannel && (
        <JoinCommunityModal
          brandName={settings.brandName}
          showCheckmark={settings.showCheckmark}
          glowTheme={settings.glowTheme}
          telegramUrl={telegramJoinUrl}
          whatsappUrl={whatsappJoinUrl}
          focusChannel={communityModalChannel}
          onClose={() => setCommunityModalChannel(null)}
        />
      )}
    </div>
  );
}
