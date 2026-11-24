import { useEffect, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Maximize2,
  MessageCircle,
  Minimize2,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { Batch, Order, SiteSettings } from '../types';
import { JoinCommunityModal } from './JoinCommunityModal';

export function BatchLauncherModal({
  order,
  batch,
  settings,
  onClose,
}: {
  order: Order;
  batch: Batch;
  settings: SiteSettings;
  onClose: () => void;
}) {
  const openType = order.openType || batch.openType || 'webview';
  const targetUrl = order.unlockedUrl || '';
  const isWebView = openType === 'webview';
  const isFree = batch.requirePayment === false || batch.price === 0;

  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [sealedFramePath, setSealedFramePath] = useState<string | null>(
    () => (isWebView && order.sealedFramePath ? order.sealedFramePath : null),
  );
  const [loadingFrame, setLoadingFrame] = useState(
    () => Boolean(isWebView && targetUrl && !order.sealedFramePath),
  );
  const [frameError, setFrameError] = useState('');

  const [communityPopup, setCommunityPopup] = useState<'telegram' | 'whatsapp' | 'both' | null>(
    () => (isWebView ? 'both' : null),
  );

  useEffect(() => {
    if (!isWebView || !targetUrl) {
      setSealedFramePath(null);
      setFrameError('');
      setLoadingFrame(false);
      return;
    }

    if (reloadKey === 0 && order.sealedFramePath) {
      setSealedFramePath(order.sealedFramePath);
      setFrameError('');
      setLoadingFrame(false);
      return;
    }

    let cancelled = false;
    setLoadingFrame(true);
    setFrameError('');

    fetch('/api/webview/seal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-KSL-Client': 'ksl-v1',
      },
      body: JSON.stringify({ targetUrl }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.framePath) {
          throw new Error(data.error || 'Could not start in-app WebView.');
        }
        if (!cancelled) {
          setSealedFramePath(String(data.framePath));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSealedFramePath(null);
          setFrameError(
            err instanceof Error ? err.message : 'Could not open WebView inside app.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFrame(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isWebView, targetUrl, reloadKey, order.sealedFramePath]);

  const handleCopy = async () => {
    if (!targetUrl || isWebView) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/82 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Open ${batch.title}`}
    >
      <div
        className={`relative flex flex-col bg-[#070911] border border-pink-300/40 rounded-3xl overflow-hidden shadow-[0_24px_70px_-10px_rgba(0,0,0,0.96),0_0_46px_-8px_rgba(244,114,182,0.42)] ${
          fullscreen || isWebView
            ? 'w-full max-w-5xl h-[88vh]'
            : 'w-full max-w-xl'
        }`}
      >
        <div className="pointer-events-none h-[2px] w-full bg-gradient-to-r from-pink-400 via-white to-lime-300 shrink-0" />

        {/* Header Bar */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-[#0B0D18] border-b border-white/10">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-lime-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-pink-300" />
              {isFree ? 'Free In-App Batch Access' : 'Verified Unlocked Access'}
            </p>
            <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
              {batch.title}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCommunityPopup('telegram')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-400/15 hover:bg-cyan-400/25 border border-cyan-300/50 text-[11px] font-bold text-cyan-200 cursor-pointer transition-colors"
              title="Join Official Telegram"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Telegram</span>
            </button>
            <button
              type="button"
              onClick={() => setCommunityPopup('whatsapp')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-lime-400/15 hover:bg-lime-400/25 border border-lime-300/50 text-[11px] font-bold text-lime-200 cursor-pointer transition-colors"
              title="Join Official WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">WhatsApp</span>
            </button>
            {isWebView && (
              <>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="p-2 rounded-xl border border-white/15 text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
                  title="Reload WebView"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreen((f) => !f)}
                  className="p-2 rounded-xl border border-white/15 text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
                  title="Toggle size"
                >
                  {fullscreen ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
              </>
            )}
            {!isWebView && targetUrl && (
              <a
                href={targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-pink-300/45 text-xs font-bold text-pink-200 hover:bg-pink-400/15"
              >
                Open Tab <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border border-white/15 text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        {isWebView ? (
          <div className="relative flex-1 flex flex-col bg-[#05060B] min-h-0">
            {order.unlockedInstructions && (
              <div className="px-5 py-2.5 bg-emerald-500/15 border-b border-lime-400/25 text-xs text-lime-100">
                {order.unlockedInstructions}
              </div>
            )}
            {!targetUrl ? (
              <div className="flex-1 flex items-center justify-center p-8 text-sm text-zinc-400">
                No WebView URL configured for this batch yet.
              </div>
            ) : loadingFrame ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-xs text-lime-200">
                <Loader2 className="w-6 h-6 animate-spin text-pink-300" />
                <span>Opening batch inside app...</span>
              </div>
            ) : frameError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-sm font-semibold text-rose-300">{frameError}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="px-4 py-2 rounded-xl bg-pink-500/15 border border-pink-300/50 text-xs font-bold text-pink-200 hover:bg-pink-500/25 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : sealedFramePath ? (
              <>
                <iframe
                  key={reloadKey}
                  src={sealedFramePath}
                  title={batch.title}
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-presentation allow-modals"
                  className="w-full flex-1 border-0 bg-white"
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-read; clipboard-write"
                />

                {/* Branded Floating Corner Shield: covers third-party bottom-right WhatsApp/Telegram widgets & opens YOUR popup */}
                <div className="absolute bottom-3.5 right-3.5 z-30 flex items-center gap-2 p-1.5 rounded-2xl bg-[#070911]/95 border border-pink-300/50 shadow-[0_14px_34px_-6px_rgba(0,0,0,0.95),0_0_24px_-4px_rgba(244,114,182,0.45)] backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => setCommunityPopup('telegram')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-400 text-zinc-950 text-xs font-extrabold shadow-[0_0_16px_rgba(56,189,248,0.65)] cursor-pointer"
                    title="Join Official Telegram"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Join TG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommunityPopup('whatsapp')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-400 text-zinc-950 text-xs font-extrabold shadow-[0_0_16px_rgba(74,222,128,0.65)] cursor-pointer"
                    title="Join Official WhatsApp"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>Join WA</span>
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="p-7 sm:p-9 space-y-6 text-center bg-[#070911]">
            <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center bg-gradient-to-br from-pink-400 via-amber-300 to-lime-300 text-zinc-950 shadow-[0_0_28px_rgba(244,114,182,0.55)]">
              {openType === 'telegram_bot' ? (
                <Bot className="w-8 h-8" />
              ) : openType === 'telegram' ? (
                <Send className="w-8 h-8" />
              ) : (
                <Globe className="w-8 h-8" />
              )}
            </div>

            <div className="space-y-2">
              <h4 className="font-display text-2xl font-extrabold text-white">
                {openType === 'telegram_bot'
                  ? 'Launch Telegram Bot'
                  : openType === 'telegram'
                    ? 'Join Private Telegram Channel'
                    : 'Open Batch Website Portal'}
              </h4>
              <p className="text-sm text-zinc-300 max-w-md mx-auto leading-relaxed">
                {order.unlockedInstructions ||
                  'Your payment has been approved by Admin. Use the verified link below to enter your batch.'}
              </p>
            </div>

            {targetUrl && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-[#0C0F1C] border border-white/15 text-left">
                <span className="text-xs font-mono text-zinc-200 truncate">
                  {targetUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 text-xs font-bold text-cyan-300 hover:text-white shrink-0 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-lime-300" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              {targetUrl && (
                <a
                  href={targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-400 hover:from-lime-200 hover:to-emerald-300 text-zinc-950 font-extrabold text-sm transition-all shadow-[0_0_26px_rgba(74,222,128,0.55)]"
                >
                  {openType === 'telegram_bot'
                    ? 'Open Telegram Bot'
                    : openType === 'telegram'
                      ? 'Open Telegram Channel'
                      : 'Open Website'}
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {communityPopup && (
        <JoinCommunityModal
          brandName={settings.brandName}
          showCheckmark={settings.showCheckmark}
          glowTheme={settings.glowTheme}
          telegramUrl={settings.supportTelegramUrl}
          whatsappUrl={settings.supportWhatsapp}
          focusChannel={communityPopup}
          batchTitle={batch.title}
          onClose={() => setCommunityPopup(null)}
        />
      )}
    </div>
  );
}
