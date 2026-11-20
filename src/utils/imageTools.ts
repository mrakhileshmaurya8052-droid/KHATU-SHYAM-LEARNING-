import { GlowTheme, ThumbnailAspect } from '../types';

export async function compressImageFile(
  file: File,
  maxDimension = 1280,
  quality = 0.82,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const webpUrl = canvas.toDataURL('image/webp', quality);
        if (webpUrl.startsWith('data:image/webp') && webpUrl.length < 360000) {
          resolve(webpUrl);
          return;
        }
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export interface ThumbnailGeneratorOptions {
  headline: string;
  kicker: string;
  tagline: string;
  instructor: string;
  price: number;
  aspectRatio: ThumbnailAspect;
  glowAccent: GlowTheme;
  styleVariant: 'aura_grid' | 'prism_beams' | 'crimson_horizon' | 'obsidian_crest';
  brandName?: string;
}

const ACCENT_PALETTES: Record<GlowTheme, { primary: string; secondary: string; soft: string; border: string }> = {
  amber: {
    primary: '#F59E0B',
    secondary: '#FDE68A',
    soft: 'rgba(245, 158, 11, 0.34)',
    border: 'rgba(251, 191, 36, 0.55)',
  },
  crimson: {
    primary: '#F43F5E',
    secondary: '#FDA4AF',
    soft: 'rgba(244, 63, 94, 0.36)',
    border: 'rgba(251, 113, 133, 0.55)',
  },
  sapphire: {
    primary: '#3B82F6',
    secondary: '#93C5FD',
    soft: 'rgba(59, 130, 246, 0.36)',
    border: 'rgba(96, 165, 250, 0.55)',
  },
  emerald: {
    primary: '#10B981',
    secondary: '#6EE7B7',
    soft: 'rgba(16, 185, 129, 0.34)',
    border: 'rgba(52, 211, 153, 0.55)',
  },
};

function getCanvasDimensions(aspect: ThumbnailAspect): { w: number; h: number } {
  switch (aspect) {
    case '4:3':
      return { w: 1200, h: 900 };
    case '1:1':
      return { w: 1080, h: 1080 };
    case '3:4':
      return { w: 900, h: 1200 };
    case '16:9':
    default:
      return { w: 1280, h: 720 };
  }
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const testLine = current ? `${current} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth) {
      current = testLine;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

export function generateHdThumbnailDataUrl(opts: ThumbnailGeneratorOptions): string {
  const { w, h } = getCanvasDimensions(opts.aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const palette = ACCENT_PALETTES[opts.glowAccent] || ACCENT_PALETTES.amber;

  // Base ultra-dark obsidian gradient
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#040508');
  bgGrad.addColorStop(0.55, '#090B12');
  bgGrad.addColorStop(1, '#040406');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Radial ultra-glow core
  const cx = opts.styleVariant === 'prism_beams' ? w * 0.78 : w * 0.72;
  const cy = opts.styleVariant === 'crimson_horizon' ? h * 0.85 : h * 0.28;
  const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, w * 0.65);
  glow.addColorStop(0, palette.soft);
  glow.addColorStop(0.45, 'rgba(15, 23, 42, 0.16)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Secondary ambient edge glow
  const glow2 = ctx.createRadialGradient(w * 0.12, h * 0.9, 10, w * 0.12, h * 0.9, w * 0.5);
  glow2.addColorStop(0, palette.soft);
  glow2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, w, h);

  // Precision architectural grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  ctx.lineWidth = 1;
  const step = 64;
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Geometric luminous motif based on preset
  ctx.save();
  if (opts.styleVariant === 'prism_beams') {
    ctx.translate(w * 0.78, h * 0.5);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(0.28);
      ctx.strokeStyle = i === 0 ? palette.border : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = i === 0 ? 3 : 1.5;
      ctx.strokeRect(-140 - i * 35, -140 - i * 35, 280 + i * 70, 280 + i * 70);
    }
  } else if (opts.styleVariant === 'obsidian_crest') {
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(w * 0.8, h * 0.45, Math.min(w, h) * 0.24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w * 0.8, h * 0.45, Math.min(w, h) * 0.31, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Aura diagonal light streaks
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.62, 0);
    ctx.lineTo(w, h * 0.42);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(w * 0.74, 0);
    ctx.lineTo(w, h * 0.28);
    ctx.stroke();
  }
  ctx.restore();

  // Outer luminous border frame
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, w - 36, h - 36);

  const padX = Math.round(w * 0.065);
  const topY = Math.round(h * 0.13);

  // Brand bar + verified dot/check
  const brandLabel = (opts.brandName || 'KHATU SHYAM LEARNING').toUpperCase();
  ctx.font = '700 22px "Outfit", sans-serif';
  ctx.fillStyle = palette.secondary;
  ctx.fillText(brandLabel, padX, topY);

  const brandWidth = ctx.measureText(brandLabel).width;
  const checkX = padX + brandWidth + 18;
  const checkY = topY - 7;
  ctx.beginPath();
  ctx.arc(checkX, checkY, 12, 0, Math.PI * 2);
  ctx.fillStyle = palette.primary;
  ctx.fill();
  ctx.strokeStyle = '#050508';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(checkX - 5, checkY);
  ctx.lineTo(checkX - 1, checkY + 4);
  ctx.lineTo(checkX + 6, checkY - 4);
  ctx.stroke();

  // Kicker
  ctx.font = '600 20px "JetBrains Mono", monospace';
  ctx.fillStyle = palette.primary;
  ctx.fillText(opts.kicker.toUpperCase(), padX, topY + 56);

  // Main Headline
  const headlineFontSize = opts.aspectRatio === '3:4' ? 58 : 64;
  ctx.font = `800 ${headlineFontSize}px "Outfit", sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  const maxTextWidth = w - padX * 2 - (opts.aspectRatio === '16:9' ? 140 : 20);
  const lines = wrapTextLines(ctx, opts.headline || 'Premium Mastery Batch', maxTextWidth, 3);
  let yCursor = topY + 132;
  for (const line of lines) {
    ctx.fillText(line, padX, yCursor);
    yCursor += headlineFontSize * 1.15;
  }

  // Tagline
  ctx.font = '500 26px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = '#D4D4D8';
  const tagLines = wrapTextLines(ctx, opts.tagline || 'Live & Recorded Complete Syllabus', maxTextWidth, 2);
  let tagY = yCursor + 18;
  for (const tl of tagLines) {
    ctx.fillText(tl, padX, tagY);
    tagY += 34;
  }

  // Bottom bar: Verified Badge + Price
  const bottomY = h - Math.round(h * 0.11);
  ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = palette.secondary;
  ctx.fillText('VERIFIED BATCH ACCESS', padX, bottomY);

  if (opts.price >= 0) {
    const priceLabel = opts.price === 0 ? 'FREE ACCESS' : `₹${opts.price.toLocaleString('en-IN')}`;
    ctx.font = '700 34px "JetBrains Mono", monospace';
    const pw = ctx.measureText(priceLabel).width;
    const boxW = pw + 44;
    const boxH = 56;
    const bx = w - padX - boxW;
    const by = bottomY - 40;
    ctx.fillStyle = palette.primary;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = '#050508';
    ctx.fillText(priceLabel, bx + 22, bottomY - 2);
  }

  const webp = canvas.toDataURL('image/webp', 0.88);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', 0.9);
}
