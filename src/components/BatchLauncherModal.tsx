import { useEffect, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { Batch, Order } from '../types';

export function BatchLauncherModal({
  order,
  batch,
  onClose,
}: {
  order: Order;
  batch: Batch;
  onClose: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [sealedFramePath, setSealedFramePath] = useState<string | null>(null);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [frameError, setFrameError] = useState('');

  const openType = order.openType || batch.openType;
  const targetUrl = order.unlockedUrl;
  const isWebView = openType === 'webview';
  const isFree = batch.price === 0 || order.amount === 0;

  useEffect(() => {
    if (!isWebView || !targetUrl) {
      setSealedFramePath(null);
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
  }, [isWebView, targetUrl, reloadKey]);

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
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/88 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label={`Open ${batch.title}`}
    >
      <div
        className={`relative flex flex-col hd-glass-surface border border-lime-400/55 rounded-3xl overflow-hidden shadow-[0_0_80px_-8px_rgba(74,222,128,0.6),0_0_56px_-12px_rgba(244,114,182,0.4)] ${
          fullscreen || isWebView
            ? 'w-full max-w-5xl h-[88vh]'
            : 'w-full max-w-xl'
        }`}
      >
        <div className="pointer-events-none h-[2.5px] w-full bg-gradient-to-r from-lime-300 via-white to-pink-400 shrink-0" />

        {/* Stylish Prompt Header Bar */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 bg-[#070A12] border-b border-white/15">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-lime-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              {isFree ? 'Free In-App Batch Access' : 'Verified Unlocked Access'}
            </p>
            <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
              {batch.title}
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isWebView && (
              <>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="p-2 rounded-xl border border-white/15 text-zinc-200 hover:text-white hover:bg-white/10"
                  title="Reload WebView"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreen((f) => !f)}
                  className="p-2 rounded-xl border border-white/15 text-zinc-200 hover:text-white hover:bg-white/10"
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
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-lime-300/40 text-xs font-semibold text-lime-200 hover:bg-lime-400/10"
              >
                Open Tab <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border border-white/15 text-zinc-300 hover:text-white hover:bg-white/10"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        {isWebView ? (
          <div className="flex-1 flex flex-col bg-[#030307] min-h-0">
            {order.unlockedInstructions && (
              <div className="px-5 py-2.5 bg-lime-400/10 border-b border-lime-400/25 text-xs text-lime-100">
                {order.unlockedInstructions}
              </div>
            )}
            {!targetUrl ? (
              <div className="flex-1 flex items-center justify-center p-8 text-sm text-zinc-300">
                No WebView URL configured for this batch yet.
              </div>
            ) : loadingFrame ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-xs text-lime-200">
                <Loader2 className="w-6 h-6 animate-spin text-lime-300" />
                <span>Opening batch inside app...</span>
              </div>
            ) : frameError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-sm font-semibold text-rose-300">{frameError}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="px-4 py-2 rounded-xl bg-lime-400/15 border border-lime-300/45 text-xs font-bold text-lime-200 hover:bg-lime-400/25 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : sealedFramePath ? (
              <iframe
                key={reloadKey}
                src={sealedFramePath}
                title={batch.title}
                referrerPolicy="no-referrer"
                className="w-full flex-1 border-0 bg-white"
                allow="autoplay; fullscreen; clipboard-read; clipboard-write"
              />
            ) : null}
          </div>
        ) : (
          <div className="p-7 sm:p-9 space-y-6 text-center">
            <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center bg-gradient-to-br from-lime-300 via-emerald-400 to-cyan-300 text-zinc-950 shadow-[0_0_36px_rgba(74,222,128,0.75)]">
              {openType === 'telegram_bot' ? (
                <Bot className="w-8 h-8" />
              ) : openType === 'telegram' ? (
                <Send className="w-8 h-8" />
              ) : (
                <Globe className="w-8 h-8" />
              )}
            </div>

            <div className="space-y-2">
              <h4 className="font-display text-2xl font-extrabold bg-gradient-to-r from-lime-200 via-white to-pink-200 bg-clip-text text-transparent">
                {openType === 'telegram_bot'
                  ? 'Launch Telegram Bot'
                  : openType === 'telegram'
                    ? 'Join Private Telegram Channel'
                    : 'Open Batch Website Portal'}
              </h4>
              <p className="text-sm text-zinc-200 max-w-md mx-auto leading-relaxed">
                {order.unlockedInstructions ||
                  'Your payment has been approved by Admin. Use the verified link below to enter your batch.'}
              </p>
            </div>

            {targetUrl && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-black/55 border border-white/15 text-left">
                <span className="text-xs font-mono text-zinc-200 truncate">
                  {targetUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 text-xs font-bold text-pink-300 hover:text-pink-200 shrink-0"
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
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-gradient-to-r from-lime-300 via-emerald-400 to-cyan-300 hover:from-lime-200 hover:to-cyan-200 text-zinc-950 font-extrabold text-sm transition-all shadow-[0_0_36px_rgba(74,222,128,0.75)]"
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
    </div>
  );
}
