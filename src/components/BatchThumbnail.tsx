import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { GlowTheme, ThumbnailAspect } from '../types';

const ASPECT_CLASSES: Record<ThumbnailAspect, string> = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
  '3:4': 'aspect-[3/4]',
};

const GLOW_HALO: Record<GlowTheme, string> = {
  amber: 'group-hover:shadow-[0_0_54px_-2px_rgba(251,191,36,0.75)]',
  crimson: 'group-hover:shadow-[0_0_54px_-2px_rgba(244,114,182,0.8)]',
  sapphire: 'group-hover:shadow-[0_0_54px_-2px_rgba(56,189,248,0.8)]',
  emerald: 'group-hover:shadow-[0_0_54px_-2px_rgba(74,222,128,0.8)]',
};

const SPECULAR_TOP: Record<GlowTheme, string> = {
  amber: 'from-pink-400/70 via-amber-300 to-lime-300/80',
  crimson: 'from-amber-300/70 via-pink-400 to-cyan-300/80',
  sapphire: 'from-pink-400/70 via-sky-300 to-emerald-300/80',
  emerald: 'from-cyan-300/70 via-lime-300 to-pink-400/80',
};

export function BatchThumbnail({
  src,
  alt,
  aspect = '16:9',
  glow = 'amber',
  className = '',
}: {
  src: string;
  alt: string;
  aspect?: ThumbnailAspect;
  glow?: GlowTheme;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={`relative w-full overflow-hidden bg-[#05060B] ${ASPECT_CLASSES[aspect]} ${GLOW_HALO[glow]} transition-shadow duration-200 ${className}`}
    >
      {/* Multi-color ultra-glow top specular light bar */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] z-10 bg-gradient-to-r ${SPECULAR_TOP[glow]}`}
      />
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover contrast-[1.09] saturate-[1.18] brightness-[1.03] transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#1C1229] via-[#0A101B] to-[#081C15] px-4 text-center">
          <BookOpen className="w-8 h-8 text-pink-300" />
          <span className="text-xs font-medium text-zinc-100 line-clamp-2">{alt}</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#05060B]/85 via-black/10 to-white/[0.06]" />
    </div>
  );
}
