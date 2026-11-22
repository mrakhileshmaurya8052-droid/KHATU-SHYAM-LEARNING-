export type GlowTheme = 'amber' | 'crimson' | 'sapphire' | 'emerald';
export type ThumbnailSize = 'compact' | 'standard' | 'large' | 'featured';
export type ThumbnailAspect = '16:9' | '4:3' | '1:1' | '3:4';
export type OpenType = 'webview' | 'website' | 'telegram' | 'telegram_bot';
export type OrderStatus = 'pending' | 'approved' | 'rejected';

export interface SiteSettings {
  brandName: string;
  showCheckmark: boolean;
  popupEnabled: boolean;
  popupText: string;
  popupCtaText: string;
  heroTitle: string;
  heroSubtitle: string;
  glowTheme: GlowTheme;
  upiId: string;
  merchantName: string;
  qrImageUrl: string;
  bankDetails: string;
  paymentInstructions: string;
  gatewayPaymentUrl: string;
  supportTelegramUrl: string;
  supportWhatsapp: string;
  supportedMethods: string[];
  customDomain?: string;
  updatedAt?: unknown;
}

export interface Batch {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  instructor: string;
  price: number;
  originalPrice: number;
  thumbnailUrl: string;
  thumbnailSize: ThumbnailSize;
  thumbnailAspect: ThumbnailAspect;
  glowAccent: GlowTheme;
  openType: OpenType;
  isActive: boolean;
  isFeatured: boolean;
  showCheckmark?: boolean;
  requirePayment?: boolean;
  plan1Label?: string;
  plan2Label?: string;
  plan2Price?: number;
  plan3Label?: string;
  plan3Price?: number;
  displayOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BatchSecret {
  targetUrl: string;
  accessInstructions: string;
  updatedAt?: unknown;
}

export interface Order {
  id: string;
  userId: string;
  userEmail: string;
  studentName: string;
  studentPhone: string;
  batchId: string;
  batchTitle: string;
  planLabel?: string;
  amount: number;
  paymentMethod: string;
  utrNumber: string;
  screenshotUrl: string;
  studentNote: string;
  status: OrderStatus;
  adminNote: string;
  openType: OpenType;
  unlockedUrl: string;
  unlockedInstructions: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Offer {
  id: string;
  title: string;
  badge: string;
  description: string;
  isActive: boolean;
  displayOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PaymentMethodMeta {
  id: string;
  label: string;
  detail: string;
}

export const ALL_PAYMENT_METHODS: PaymentMethodMeta[] = [
  { id: 'upi_qr', label: 'UPI QR Scan', detail: 'Scan QR with any UPI app' },
  { id: 'phonepe', label: 'PhonePe', detail: 'Instant UPI transfer' },
  { id: 'gpay', label: 'Google Pay', detail: 'Fast UPI payment' },
  { id: 'paytm', label: 'Paytm UPI', detail: 'UPI / Wallet transfer' },
  { id: 'bhim', label: 'BHIM UPI', detail: 'Direct bank UPI' },
  { id: 'bank_transfer', label: 'Bank Transfer (IMPS/NEFT)', detail: 'Direct account transfer' },
  { id: 'gateway_link', label: 'Online Payment Link', detail: 'Cards / NetBanking gateway' },
];
