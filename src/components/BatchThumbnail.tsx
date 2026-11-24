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
  amber: 'shadow-none',
  crimson: 'shadow-none',
  sapphire: 'shadow-none',
  emerald: 'shadow-none',
};

const SPECULAR_TOP: Record<GlowTheme, string> = {
  amber: 'from-pink-400/90 via-amber-300/95 to-lime-300/90',
  crimson: 'from-transparent via-pink-400/95 to-transparent',
  sapphire: 'from-transparent via-cyan-300/95 to-transparent',
  emerald: 'from-transparent via-lime-300/95 to-transparent',
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
      className={`relative w-full overflow-hidden bg-[#070911] ${ASPECT_CLASSES[aspect]} ${GLOW_HALO[glow]} ${className}`}
    >
      {/* Crisp 1.5px neon specular top hairline */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-[1.5px] z-10 bg-gradient-to-r ${SPECULAR_TOP[glow]}`}
      />
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover contrast-[1.04] saturate-[1.08] transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#1C1229] via-[#090B14] to-[#081C15] px-4 text-center">
          <BookOpen className="w-8 h-8 text-pink-300" />
          <span className="text-xs font-semibold text-zinc-100 line-clamp-2">{alt}</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#070911]/75 via-transparent to-transparent" />
    </div>
  );
}
