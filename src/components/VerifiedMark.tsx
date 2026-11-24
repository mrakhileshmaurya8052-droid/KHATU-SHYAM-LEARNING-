import { Check } from 'lucide-react';
import { GlowTheme } from '../types';

const THEME_RING: Record<GlowTheme, string> = {
  amber:
    'bg-gradient-to-br from-emerald-400 to-lime-300 text-zinc-950 ring-2 ring-amber-200/80 shadow-[0_0_16px_rgba(74,222,128,0.75)]',
  crimson:
    'bg-gradient-to-br from-pink-400 to-rose-400 text-zinc-950 ring-2 ring-pink-200/80 shadow-[0_0_16px_rgba(244,114,182,0.75)]',
  sapphire:
    'bg-gradient-to-br from-cyan-300 to-sky-400 text-zinc-950 ring-2 ring-cyan-200/80 shadow-[0_0_16px_rgba(56,189,248,0.75)]',
  emerald:
    'bg-gradient-to-br from-lime-300 to-emerald-400 text-zinc-950 ring-2 ring-lime-200/80 shadow-[0_0_16px_rgba(74,222,128,0.8)]',
};

export function VerifiedMark({
  theme = 'amber',
  size = 'md',
  className = '',
}: {
  theme?: GlowTheme;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims =
    size === 'sm'
      ? 'w-4 h-4'
      : size === 'lg'
        ? 'w-6 h-6'
        : 'w-5 h-5';
  const iconDims =
    size === 'sm'
      ? 'w-2.5 h-2.5'
      : size === 'lg'
        ? 'w-3.5 h-3.5'
        : 'w-3 h-3';

  return (
    <span
      title="Verified"
      aria-label="Verified"
      className={`inline-flex items-center justify-center rounded-full shrink-0 ${dims} ${THEME_RING[theme]} ${className}`}
    >
      <Check className={`${iconDims} stroke-[3.5]`} />
    </span>
  );
}
