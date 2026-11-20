import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  Lock,
  Search,
  Send,
  ShieldCheck,
  Tag,
  Unlock,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import { STARTER_BATCHES } from '../constants/defaults';
import { Batch, GlowTheme, Offer, Order, SiteSettings } from '../types';
import { VerifiedMark } from '../components/VerifiedMark';
import { BatchThumbnail } from '../components/BatchThumbnail';
import { BatchCheckoutModal } from '../components/BatchCheckoutModal';
import { BatchLauncherModal } from '../components/BatchLauncherModal';

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
    btn: 'bg-gradient-to-r from-pink-400 via-amber-300 to-lime-300 hover:from-pink-300 hover:via-amber-200 hover:to-lime-200 text-zinc-950 shadow-[0_0_38px_rgba(244,114,182,0.55),0_0_24px_rgba(74,222,128,0.45)] ring-1 ring-white/50',
    glowCard: 'glow-card-amber border-amber-300/45',
  },
  crimson: {
    text: 'text-pink-300',
    btn: 'bg-gradient-to-r from-pink-400 via-fuchsia-400 to-rose-400 hover:from-pink-300 hover:to-rose-300 text-zinc-950 shadow-[0_0_38px_rgba(244,114,182,0.75)] ring-1 ring-pink-200/70',
    glowCard: 'glow-card-crimson border-pink-400/55',
  },
  sapphire: {
    text: 'text-cyan-300',
    btn: 'bg-gradient-to-r from-cyan-300 via-sky-400 to-pink-400 hover:from-cyan-200 hover:to-pink-300 text-zinc-950 shadow-[0_0_38px_rgba(56,189,248,0.7)] ring-1 ring-cyan-200/70',
    glowCard: 'glow-card-sapphire border-sky-400/50',
  },
  emerald: {
    text: 'text-lime-300',
    btn: 'bg-gradient-to-r from-lime-300 via-emerald-400 to-cyan-300 hover:from-lime-200 hover:to-cyan-200 text-zinc-950 shadow-[0_0_38px_rgba(74,222,128,0.75)] ring-1 ring-lime-200/70',
    glowCard: 'glow-card-emerald border-lime-400/55',
  },
};

export function Storefront({
  settings,
  batches,
  offers,
  orders,
  loadingData,
  onOrderCreated,
}: {
  settings: SiteSettings;
  batches: Batch[];
  offers: Offer[];
  orders: Order[];
  loadingData: boolean;
  onOrderCreated: (orderId: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeBatchModal, setActiveBatchModal] = useState<Batch | null>(null);
  const [showMyAccessModal, setShowMyAccessModal] = useState(false);
  const [showOfferDetails, setShowOfferDetails] = useState(true);
  const [telegramCount, setTelegramCount] = useState<number>(703);
  const [openingFreeBatchId, setOpeningFreeBatchId] = useState<string | null>(null);
  const [freeOpenError, setFreeOpenError] = useState('');
  const [launcherState, setLauncherState] = useState<{
    order: Order;
    batch: Batch;
  } | null>(null);

  const telegramJoinUrl =
    settings.supportTelegramUrl && settings.supportTelegramUrl !== 'https://t.me/'
      ? settings.supportTelegramUrl
      : 'https://t.me/Cheatestbatchwallah';

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
        .filter((b) => b.isActive)
        .sort((a, b) => {
          const aDirect = hasPaymentFlow(a) ? 1 : 0;
          const bDirect = hasPaymentFlow(b) ? 1 : 0;
          if (aDirect !== bDirect) return aDirect - bDirect;
          return a.displayOrder - b.displayOrder;
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
      const snap = await getDoc(doc(db, 'batches', batch.id, 'private', 'access'));
      if (snap.exists()) {
        const d = snap.data();
        targetUrl = String(d.targetUrl || '');
        accessInstructions = String(d.accessInstructions || '');
      } else {
        const starter = STARTER_BATCHES.find((s) => s.id === batch.id);
        if (starter) {
          targetUrl = starter.targetUrl;
          accessInstructions = starter.accessInstructions;
        }
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
        openType: batch.openType,
        unlockedUrl: targetUrl,
        unlockedInstructions: accessInstructions,
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
    <div className="min-h-screen bg-[#030307] text-zinc-100 flex flex-col relative overflow-x-hidden">
      {/* Multi-Spectrum Ultra-Glow Pink, Light Green & Cyan Ambient Lights */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-36 left-1/4 w-[620px] h-[360px] rounded-full blur-[150px] bg-pink-500/25" />
        <div className="absolute -top-28 right-1/4 w-[620px] h-[360px] rounded-full blur-[150px] bg-lime-400/20" />
        <div className="absolute top-[42%] -left-32 w-[480px] h-[480px] rounded-full blur-[160px] bg-cyan-400/15" />
        <div className="absolute bottom-0 right-[-10%] w-[540px] h-[440px] rounded-full blur-[160px] bg-fuchsia-500/15" />
      </div>

      {/* Top Pop-Up Brand Bar: ONLY KHATU SHYAM LEARNING + Checkmark */}
      <header className="sticky top-3 z-40 px-4 sm:px-6 pointer-events-none">
        <div className="max-w-fit mx-auto pointer-events-auto">
          <a
            href="#top"
            className="relative flex items-center justify-center gap-3 px-7 sm:px-9 py-3 rounded-2xl ultra-glow-topbar backdrop-blur-2xl border border-pink-300/45 overflow-hidden transition-transform duration-200 hover:scale-[1.02]"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
            <span className="font-display text-base sm:text-xl font-extrabold tracking-wide bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent whitespace-nowrap drop-shadow-[0_0_16px_rgba(255,255,255,0.45)]">
              {settings.brandName}
            </span>
            {settings.showCheckmark && (
              <VerifiedMark theme={settings.glowTheme} size="md" />
            )}
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main id="top" className="flex-1 relative z-10">
        {/* Hero Action Buttons + Limited Offer + Real-Time Telegram Card */}
        <section className="relative border-b border-white/15">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-10 space-y-7">
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href="#batches"
                className={`inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-extrabold transition-all whitespace-nowrap shrink-0 ${theme.btn}`}
              >
                Explore Live Batches
                <ArrowRight className="w-4 h-4" />
              </a>
              <button
                type="button"
                onClick={() => setShowMyAccessModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl hd-glass-surface border border-lime-300/45 hover:border-lime-300/85 shadow-[0_0_28px_-6px_rgba(74,222,128,0.5)] text-sm font-bold text-lime-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                My Batch Access
              </button>
            </div>

            {/* Limited Offer Pill + Admin Live Offers + Join Our Telegram (Real-Time Count) */}
            <div className="max-w-xl mx-auto space-y-4">
              {settings.popupEnabled && (
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowOfferDetails((prev) => !prev)}
                    className="inline-flex items-center gap-2.5 px-6 py-2.5 rounded-full bg-[#130D06]/95 border border-amber-400/75 shadow-[0_0_32px_rgba(251,191,36,0.5),0_0_24px_rgba(244,114,182,0.3)] hover:scale-[1.03] transition-transform cursor-pointer"
                  >
                    <Flame className="w-4 h-4 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.95)]" />
                    <span className="text-sm font-extrabold tracking-wide bg-gradient-to-r from-amber-200 via-yellow-300 to-pink-200 bg-clip-text text-transparent">
                      {settings.popupCtaText || 'Limited Offer'}
                    </span>
                  </button>

                  {showOfferDetails && activeOffers.length > 0 && (
                    <div className="w-full space-y-2.5">
                      {activeOffers.map((offer) => (
                        <div
                          key={offer.id}
                          className="relative px-4 py-3 rounded-2xl hd-glass-surface border border-amber-400/45 shadow-[0_0_30px_-8px_rgba(251,191,36,0.45),0_0_24px_-10px_rgba(244,114,182,0.35)] overflow-hidden"
                        >
                          <span className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-amber-300 via-pink-400 to-lime-300" />
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Tag className="w-4 h-4 text-amber-300 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs sm:text-sm font-bold text-white truncate">
                                  {offer.title}
                                </p>
                                {offer.description && (
                                  <p className="text-[11px] text-zinc-200 mt-0.5 leading-snug">
                                    {offer.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            {offer.badge && (
                              <span className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-300 to-pink-400 text-zinc-950 text-[11px] font-extrabold shrink-0 shadow-[0_0_18px_rgba(251,191,36,0.5)]">
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

              {/* Join Our Telegram Card with Real-Time Count */}
              <a
                href={telegramJoinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center justify-between gap-4 px-5 py-4 rounded-2xl hd-glass-surface border border-pink-300/40 hover:border-lime-300/80 shadow-[0_0_48px_-12px_rgba(244,114,182,0.45),0_0_38px_-12px_rgba(74,222,128,0.4)] transition-all duration-200 hover:-translate-y-0.5 overflow-hidden"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-full bg-[#090D16] border border-cyan-300/45 shadow-[0_0_24px_rgba(56,189,248,0.45)] flex items-center justify-center shrink-0">
                    <Send className="w-5 h-5 text-cyan-300 -translate-x-0.5 translate-y-0.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-base sm:text-lg font-extrabold text-white group-hover:text-lime-200 transition-colors truncate">
                      Join Our Telegram
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-lime-400 shadow-[0_0_12px_rgba(74,222,128,1)] animate-pulse shrink-0" />
                      <span className="text-xs font-mono font-semibold tracking-wider text-zinc-200 tabular-nums">
                        {telegramCount.toLocaleString('en-IN')} JOINED
                      </span>
                    </div>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full bg-white/10 group-hover:bg-gradient-to-r group-hover:from-pink-400 group-hover:to-lime-300 border border-white/15 flex items-center justify-center shrink-0 transition-all">
                  <ArrowRight className="w-4 h-4 text-white group-hover:text-zinc-950 transition-colors" />
                </div>
              </a>
            </div>
          </div>
        </section>

        {/* Batches Catalog Section */}
        <section id="batches" className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-8">
          <div className="flex items-center justify-between gap-4">
            {/* Ultra-Matching Glow Search Bar */}
            <div className="relative flex-1 max-w-lg group">
              <div className="pointer-events-none absolute -inset-0.5 rounded-xl bg-gradient-to-r from-pink-500/50 via-amber-300/40 to-lime-400/55 blur-md opacity-75 group-focus-within:opacity-100 transition-opacity" />
              <div className="relative flex items-center rounded-xl bg-[#070911]/95 border border-pink-300/55 group-focus-within:border-lime-300 shadow-[0_0_32px_-6px_rgba(244,114,182,0.55),0_0_24px_-8px_rgba(74,222,128,0.45)] overflow-hidden">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
                <Search className="w-4 h-4 text-lime-300 ml-4 shrink-0 drop-shadow-[0_0_8px_rgba(74,222,128,0.85)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search batch name..."
                  className="w-full px-3.5 py-3 bg-transparent text-sm font-medium text-white placeholder:text-zinc-300 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {freeOpenError && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-400/50 text-xs font-semibold text-rose-200 flex items-center justify-between gap-3">
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
                  className="h-80 rounded-2xl hd-glass-surface border border-white/15 animate-pulse"
                />
              ))}
            </div>
          ) : filteredBatches.length === 0 ? (
            <div className="p-12 rounded-2xl hd-glass-surface border border-white/15 text-center space-y-2">
              <p className="text-base font-semibold text-white">No batches match your search</p>
              <p className="text-xs text-zinc-300">
                Try clearing your search to view all batches.
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
                    className={`group relative cursor-pointer rounded-2xl hd-glass-surface border overflow-hidden transition-transform duration-200 hover:-translate-y-1 ${cardAccent.glowCard} ${sizeColClass}`}
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
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#050A08]/85 backdrop-blur-md border border-lime-400/75 text-lime-300 text-[11px] font-bold shadow-[0_0_20px_rgba(74,222,128,0.55)]">
                            <Unlock className="w-3.5 h-3.5" />
                            Free
                          </span>
                        ) : isApproved ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#050A08]/85 backdrop-blur-md border border-lime-400/70 text-lime-300 text-[11px] font-bold shadow-[0_0_20px_rgba(74,222,128,0.5)]">
                            <Unlock className="w-3.5 h-3.5" />
                            Unlocked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#09060D]/85 backdrop-blur-md border border-pink-400/65 text-pink-200 text-[11px] font-bold shadow-[0_0_20px_rgba(244,114,182,0.45)]">
                            <Lock className="w-3.5 h-3.5 text-pink-300" />
                            Locked
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-5 sm:p-6 space-y-4">
                      <div className="flex items-center gap-2.5">
                        <h3 className="font-display text-lg sm:text-xl font-bold text-white leading-snug group-hover:text-pink-200 transition-colors">
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

                      <div className="flex items-center justify-between gap-4 pt-3.5 border-t border-white/15">
                        <div className="flex items-baseline gap-2.5">
                          <span
                            className={`text-2xl font-extrabold font-mono tabular-nums ${
                              isFree
                                ? 'text-lime-300 drop-shadow-[0_0_16px_rgba(74,222,128,0.65)]'
                                : 'text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.4)]'
                            }`}
                          >
                            {isFree
                              ? 'Free'
                              : `₹${batch.price.toLocaleString('en-IN')}`}
                          </span>
                          {batch.originalPrice > batch.price && (
                            <span className="text-xs font-mono tabular-nums text-zinc-400 line-through">
                              ₹{batch.originalPrice.toLocaleString('en-IN')}
                            </span>
                          )}
                          {discountPct > 0 && !isFree && (
                            <span className="text-xs font-extrabold text-lime-300 drop-shadow-[0_0_10px_rgba(74,222,128,0.75)]">
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
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-lime-300 via-emerald-400 to-cyan-300 hover:from-lime-200 hover:to-cyan-200 text-zinc-950 text-xs font-extrabold shadow-[0_0_28px_rgba(74,222,128,0.75)] transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-70"
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
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-lime-300 via-emerald-400 to-teal-300 hover:from-lime-200 hover:to-teal-200 text-zinc-950 text-xs font-extrabold shadow-[0_0_28px_rgba(74,222,128,0.75)] transition-all whitespace-nowrap shrink-0"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Open Batch
                          </button>
                        ) : isPending ? (
                          <span className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-pink-500/20 border border-pink-400/60 text-pink-200 text-xs font-semibold shadow-[0_0_20px_rgba(244,114,182,0.35)] whitespace-nowrap shrink-0">
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
                            className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all whitespace-nowrap shrink-0 ${cardAccent.btn}`}
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
                <div className="space-y-7">
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

      {/* Footer */}
      <footer id="support" className="relative z-10 border-t border-white/15 bg-[#030307] py-8 px-4 sm:px-6">
        <div
          className={`max-w-7xl mx-auto flex flex-col sm:flex-row items-center gap-4 text-xs text-zinc-200 ${
            settings.supportWhatsapp ? 'justify-between' : 'justify-center'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-white">
              {settings.brandName}
            </span>
            {settings.showCheckmark && (
              <VerifiedMark theme={settings.glowTheme} size="sm" />
            )}
          </div>

          {settings.supportWhatsapp && (
            <div className="flex flex-wrap items-center gap-5">
              <span>WhatsApp: {settings.supportWhatsapp}</span>
            </div>
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setShowMyAccessModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-xl rounded-2xl hd-glass-surface border border-lime-300/45 shadow-[0_0_64px_-12px_rgba(74,222,128,0.55),0_0_48px_-14px_rgba(244,114,182,0.45)] overflow-hidden"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-lime-300" />
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/15">
              <h2 className="font-display text-lg font-bold bg-gradient-to-r from-lime-200 via-white to-pink-200 bg-clip-text text-transparent">
                My Batch Access
              </h2>
              <button
                type="button"
                onClick={() => setShowMyAccessModal(false)}
                aria-label="Close My Batch Access"
                className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto space-y-3">
              {orders.length === 0 ? (
                <div className="p-6 rounded-xl bg-white/[0.04] border border-white/15 text-center space-y-2">
                  <p className="text-sm font-semibold text-white">No active batch purchases yet</p>
                  <p className="text-xs text-zinc-300">
                    Tap any batch thumbnail and submit payment to unlock access here.
                  </p>
                </div>
              ) : (
                orders.map((ord) => {
                  const matchedBatch = batches.find((b) => b.id === ord.batchId);
                  return (
                    <div
                      key={ord.id}
                      className="p-4 rounded-xl bg-white/[0.04] border border-pink-400/35 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            className={`font-bold ${
                              ord.status === 'approved'
                                ? 'text-lime-300'
                                : ord.status === 'rejected'
                                  ? 'text-pink-400'
                                  : 'text-amber-300'
                            }`}
                          >
                            {ord.status === 'approved'
                              ? 'Approved'
                              : ord.status === 'rejected'
                                ? 'Declined'
                                : 'Pending Approval'}
                          </span>
                          <span className="text-zinc-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-zinc-300 truncate">
                            UTR: {ord.utrNumber}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-white truncate">
                          {ord.batchTitle}
                        </h3>
                        <p className="text-xs text-zinc-300">
                          ₹{ord.amount.toLocaleString('en-IN')} · {ord.paymentMethod}
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
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-400 hover:from-lime-200 hover:to-emerald-300 text-zinc-950 text-xs font-extrabold shadow-[0_0_24px_rgba(74,222,128,0.65)] whitespace-nowrap shrink-0"
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
                          className={`px-4 py-2.5 rounded-xl text-xs font-extrabold whitespace-nowrap shrink-0 ${theme.btn}`}
                        >
                          Resubmit
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-pink-200 font-medium shrink-0">
                          <Lock className="w-3.5 h-3.5 text-pink-300" /> Locked until Approved
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
          onClose={() => setLauncherState(null)}
        />
      )}
    </div>
  );
}
