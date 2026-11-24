import { ArrowRight, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { GlowTheme } from '../types';
import { VerifiedMark } from './VerifiedMark';

export function resolveTelegramChannelUrl(raw?: string): string {
  const cleaned = typeof raw === 'string' ? raw.trim() : '';
  if (!cleaned || cleaned === 'https://t.me/') {
    return 'https://t.me/Cheatestbatchwallah';
  }
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return `https://t.me/${cleaned.replace(/^@/, '')}`;
}

export function resolveWhatsappChannelUrl(raw?: string): string {
  const cleaned = typeof raw === 'string' ? raw.trim() : '';
  if (!cleaned) {
    return 'https://whatsapp.com/channel/0029Vb7xXWZ7dmedUxP4PY44';
  }
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  const digits = cleaned.replace(/[^\d]/g, '');
  if (digits.length >= 10) {
    return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
  }
  return 'https://whatsapp.com/channel/0029Vb7xXWZ7dmedUxP4PY44';
}

export function JoinCommunityModal({
  brandName,
  showCheckmark,
  glowTheme,
  telegramUrl,
  whatsappUrl,
  focusChannel = 'both',
  batchTitle,
  onClose,
}: {
  brandName: string;
  showCheckmark: boolean;
  glowTheme: GlowTheme;
  telegramUrl?: string;
  whatsappUrl?: string;
  focusChannel?: 'telegram' | 'whatsapp' | 'both';
  batchTitle?: string;
  onClose: () => void;
}) {
  const tgLink = resolveTelegramChannelUrl(telegramUrl);
  const waLink = resolveWhatsappChannelUrl(whatsappUrl);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Join Official Telegram & WhatsApp"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl bg-[#070911] border border-pink-300/40 shadow-[0_24px_70px_-10px_rgba(0,0,0,0.96),0_0_48px_-10px_rgba(244,114,182,0.45)] overflow-hidden"
      >
        <div className="pointer-events-none h-[2px] w-full bg-gradient-to-r from-pink-400 via-white to-lime-300" />

        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-[#0B0D18] border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-display text-sm sm:text-base font-extrabold bg-gradient-to-r from-pink-200 via-white to-lime-200 bg-clip-text text-transparent truncate">
              {brandName}
            </span>
            {showCheckmark && <VerifiedMark theme={glowTheme} size="sm" />}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close popup"
            className="p-2 rounded-full border border-white/15 text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 bg-[#070911]">
          <div className="space-y-1.5 text-center">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-lime-300">
              <Sparkles className="w-3.5 h-3.5 text-pink-300" />
              Official Channel Access
            </div>
            <h3 className="font-display text-xl font-extrabold text-white">
              Join Official Telegram &amp; WhatsApp
            </h3>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {batchTitle
                ? `Stay connected with ${brandName} while accessing ${batchTitle} — join our official channels for instant updates & new batch links.`
                : `Join ${brandName} official Telegram & WhatsApp channels for instant batch updates and support.`}
            </p>
          </div>

          <div className="space-y-3">
            {(focusChannel === 'both' || focusChannel === 'telegram') && (
              <a
                href={tgLink}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500/20 via-cyan-500/15 to-blue-600/20 border border-cyan-300/55 shadow-[0_0_26px_-8px_rgba(56,189,248,0.55)] hover:border-cyan-200 transition-all hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-cyan-300 text-zinc-950 flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(56,189,248,0.65)]">
                    <Send className="w-4 h-4 -translate-x-0.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-white">
                      Join Official Telegram
                    </p>
                    <p className="text-[11px] font-mono text-cyan-200/90 truncate">
                      {tgLink.replace(/^https?:\/\//i, '')}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 text-zinc-950 text-xs font-extrabold shrink-0">
                  Join
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </a>
            )}

            {(focusChannel === 'both' || focusChannel === 'whatsapp') && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500/20 via-lime-400/15 to-green-600/20 border border-lime-300/55 shadow-[0_0_26px_-8px_rgba(74,222,128,0.55)] hover:border-lime-200 transition-all hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-lime-300 to-emerald-400 text-zinc-950 flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(74,222,128,0.65)]">
                    <MessageCircle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-white">
                      Join Official WhatsApp
                    </p>
                    <p className="text-[11px] font-mono text-lime-200/90 truncate">
                      {waLink.replace(/^https?:\/\//i, '')}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-400 text-zinc-950 text-xs font-extrabold shrink-0">
                  Join
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-bold text-zinc-200 hover:text-white transition-colors cursor-pointer"
          >
            {batchTitle ? 'Continue to Batch' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
