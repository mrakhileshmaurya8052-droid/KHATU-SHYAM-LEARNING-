import { SiteSettings } from '../types';

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  brandName: 'KHATU SHYAM LEARNING',
  showCheckmark: true,
  popupEnabled: true,
  popupText: '2026 Batches Open — Instant QR Checkout & Fast Admin Approval',
  popupCtaText: 'Limited Offer',
  heroTitle: 'Master Every Exam With Precision & Clarity',
  heroSubtitle:
    'Structured video batches, live Telegram mentorship, and curated test series engineered for top-tier competitive results.',
  glowTheme: 'amber',
  upiId: 'khatushyamlearning@upi',
  merchantName: 'KHATU SHYAM LEARNING',
  qrImageUrl: '',
  bankDetails: 'Bank transfer details available upon request from support.',
  paymentInstructions:
    'Scan the QR code or use any supported UPI app below. After paying, submit your 12-digit UTR number in the verification form for Admin approval.',
  gatewayPaymentUrl: '',
  supportTelegramUrl: 'https://t.me/Cheatestbatchwallah',
  supportWhatsapp: 'https://whatsapp.com/channel/0029Vb7xXWZ7dmedUxP4PY44',
  supportedMethods: ['upi_qr', 'phonepe', 'gpay', 'paytm', 'bhim', 'bank_transfer'],
  customDomain: 'khatushyamlearning.vercel.app',
};
