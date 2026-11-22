import React, { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  ImagePlus,
  Lock,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  AlertCircle,
} from 'lucide-react';
import { ALL_PAYMENT_METHODS, Batch, Order, SiteSettings } from '../types';
import { db, handleFirestoreError, isQuotaExceededError, OperationType } from '../firebase';
import { compressImageFile } from '../utils/imageTools';
import { BatchThumbnail } from './BatchThumbnail';
import { VerifiedMark } from './VerifiedMark';

type ModalStep = 'preview' | 'payment' | 'form' | 'status';

interface CheckoutPlan {
  id: 'plan1' | 'plan2' | 'plan3';
  label: string;
  price: number;
  popular?: boolean;
}

function buildBatchPlans(batch: Batch): CheckoutPlan[] {
  const basePrice = Math.max(0, Number(batch.price) || 0);
  const plan2Price =
    typeof batch.plan2Price === 'number' && !Number.isNaN(batch.plan2Price)
      ? Math.max(0, batch.plan2Price)
      : basePrice + 10;
  const plan3Price =
    typeof batch.plan3Price === 'number' && !Number.isNaN(batch.plan3Price)
      ? Math.max(0, batch.plan3Price)
      : basePrice + 20;

  return [
    {
      id: 'plan1',
      label: (batch.plan1Label || '').trim() || '1 Year',
      price: basePrice,
      popular: true,
    },
    {
      id: 'plan2',
      label: (batch.plan2Label || '').trim() || '2 Years',
      price: plan2Price,
    },
    {
      id: 'plan3',
      label: (batch.plan3Label || '').trim() || 'Lifetime',
      price: plan3Price,
    },
  ];
}

function getStudentClientId(): string {
  try {
    const existing = localStorage.getItem('ksl_student_client_id');
    if (existing && /^[a-zA-Z0-9_-]{12,64}$/.test(existing)) return existing;
    const fresh = `stu_${crypto.randomUUID().replace(/-/g, '')}`;
    localStorage.setItem('ksl_student_client_id', fresh);
    return fresh;
  } catch {
    return `stu_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

function createOrderDocId(): string {
  try {
    return `ord_${crypto.randomUUID().replace(/-/g, '')}`;
  } catch {
    const seg1 = Math.random().toString(36).slice(2, 14).padEnd(10, 'x');
    const seg2 = Math.random().toString(36).slice(2, 14).padEnd(10, 'y');
    return `ord_${Date.now().toString(36)}_${seg1}_${seg2}`;
  }
}

export function BatchCheckoutModal({
  batch,
  settings,
  existingOrder,
  onOrderCreated,
  onOpenBatch,
  onClose,
}: {
  batch: Batch;
  settings: SiteSettings;
  existingOrder: Order | null;
  onOrderCreated: (orderId: string) => void;
  onOpenBatch: (order: Order, batch: Batch) => void;
  onClose: () => void;
}) {
  const plans = buildBatchPlans(batch);
  const initialStep: ModalStep = existingOrder ? 'status' : 'preview';
  const [step, setStep] = useState<ModalStep>(initialStep);
  const [selectedPlan, setSelectedPlan] = useState<CheckoutPlan>(plans[0]);
  const [copiedUpi, setCopiedUpi] = useState(false);

  const enabledMethodObjects = ALL_PAYMENT_METHODS.filter((m) =>
    settings.supportedMethods.includes(m.id),
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(
    enabledMethodObjects[0]?.label || 'UPI QR Scan',
  );
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [studentNote, setStudentNote] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [createdOrderId, setCreatedOrderId] = useState('');

  const activeAmount = selectedPlan.price;

  const upiUri = `upi://pay?pa=${encodeURIComponent(
    settings.upiId || 'khatushyamlearning@upi',
  )}&pn=${encodeURIComponent(
    settings.merchantName || settings.brandName,
  )}&am=${encodeURIComponent(String(activeAmount))}&cu=INR&tn=${encodeURIComponent(
    `${batch.title.slice(0, 26)} (${selectedPlan.label})`.slice(0, 40),
  )}`;

  const handleCopyUpi = async () => {
    try {
      await navigator.clipboard.writeText(settings.upiId);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 1800);
    } catch {
      // clipboard fallback ignored
    }
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 900, 0.78);
      setScreenshotUrl(compressed);
      setFormError('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to process screenshot.');
    }
  };

  const handleSelectPlan = (plan: CheckoutPlan) => {
    setSelectedPlan(plan);
    setFormError('');
    setStep('payment');
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!studentName.trim() || !studentPhone.trim() || !utrNumber.trim()) {
      setFormError('Please enter your Full Name, Phone/WhatsApp number, and UTR / Transaction ID.');
      return;
    }

    setSubmitting(true);
    const orderId = createOrderDocId();
    const clientId = getStudentClientId();
    const path = `orders/${orderId}`;

    try {
      await setDoc(doc(db, 'orders', orderId), {
        userId: clientId,
        userEmail: studentEmail.trim().slice(0, 160),
        studentName: studentName.trim().slice(0, 100),
        studentPhone: studentPhone.trim().slice(0, 30),
        batchId: batch.id,
        batchTitle: batch.title.slice(0, 140),
        planLabel: selectedPlan.label.slice(0, 60),
        amount: Number(activeAmount),
        paymentMethod: paymentMethod.slice(0, 60),
        utrNumber: utrNumber.trim().slice(0, 100),
        screenshotUrl: screenshotUrl.slice(0, 500000),
        studentNote: studentNote.trim().slice(0, 500),
        status: 'pending',
        adminNote: '',
        openType: batch.openType,
        unlockedUrl: '',
        unlockedInstructions: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setCreatedOrderId(orderId);
      onOrderCreated(orderId);
      setStep('status');
    } catch (error) {
      if (isQuotaExceededError(error)) {
        setFormError('Database daily free quota is currently exceeded. Please try again after reset or contact Admin.');
        setSubmitting(false);
        return;
      }
      try {
        handleFirestoreError(error, OperationType.CREATE, path);
      } catch (wrapped) {
        setFormError(
          wrapped instanceof Error
            ? 'Could not submit verification. Please ensure the batch has been published in Admin Panel.'
            : 'Submission failed.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label={batch.title}
    >
      <div className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl hd-glass-surface border border-pink-400/50 shadow-[0_0_80px_-8px_rgba(244,114,182,0.55),0_0_64px_-12px_rgba(74,222,128,0.45)]">
        {/* Top Multi-Color Ultra-Glow Specular Beam */}
        <div className="pointer-events-none sticky top-0 z-20 h-[2.5px] w-full bg-gradient-to-r from-pink-400 via-white to-lime-300" />

        {/* Stylish Prompt Header */}
        <div className="sticky top-[2.5px] z-10 flex items-center justify-between gap-4 px-6 py-4 bg-[#070911]/95 backdrop-blur-xl border-b border-white/15">
          <div className="flex items-center gap-3 min-w-0">
            {step !== 'preview' && !existingOrder && (
              <button
                type="button"
                onClick={() =>
                  setStep(step === 'form' ? 'payment' : 'preview')
                }
                className="p-2 rounded-xl border border-pink-400/35 text-pink-200 hover:text-white hover:bg-pink-500/15 transition-colors cursor-pointer"
                aria-label="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-bold bg-gradient-to-r from-pink-300 to-lime-300 bg-clip-text text-transparent truncate">
                  {settings.brandName}
                </p>
                {settings.showCheckmark && (
                  <VerifiedMark theme={settings.glowTheme} size="sm" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <h3 className="text-base sm:text-lg font-extrabold text-white truncate">
                  {batch.title}
                </h3>
                {batch.showCheckmark !== false && (
                  <VerifiedMark theme={batch.glowAccent} size="sm" />
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl border border-white/15 text-zinc-300 hover:text-white hover:border-pink-400/50 hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1: Compact Header Preview + Ultra-Glow HD 3-Plan Selector */}
        {step === 'preview' && (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-3.5 rounded-2xl bg-[#070912]/90 border border-white/15 shadow-[0_0_32px_-12px_rgba(244,114,182,0.35)]">
              <div className="w-full sm:w-36 shrink-0">
                <BatchThumbnail
                  src={batch.thumbnailUrl}
                  alt={batch.title}
                  aspect="16:9"
                  glow={batch.glowAccent}
                  className="rounded-xl border border-white/20"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-display text-lg sm:text-xl font-extrabold bg-gradient-to-r from-white via-pink-100 to-lime-200 bg-clip-text text-transparent truncate">
                    {batch.title}
                  </h4>
                  {batch.showCheckmark !== false && (
                    <VerifiedMark theme={batch.glowAccent} size="sm" />
                  )}
                </div>
                <p className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-pink-300 shrink-0" />
                  Choose your validity plan below to unlock instant access
                </p>
              </div>
            </div>

            {/* 3-Plan Ultra-Glow HD Stacked Card */}
            <div className="relative rounded-2xl overflow-hidden border border-pink-400/55 bg-[#060811] shadow-[0_0_54px_-10px_rgba(244,114,182,0.55),0_0_40px_-12px_rgba(74,222,128,0.45)]">
              <div className="pointer-events-none h-[2px] w-full bg-gradient-to-r from-pink-400 via-amber-200 to-lime-300" />

              {plans.map((plan, idx) => {
                const isPopular = Boolean(plan.popular);
                return (
                  <div
                    key={plan.id}
                    className={`relative flex items-center justify-between gap-3 sm:gap-5 px-4 sm:px-6 transition-all ${
                      isPopular
                        ? 'py-5 bg-gradient-to-r from-[#1E1032] via-[#13182E] to-[#0B221A] border-b border-pink-400/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                        : `py-4 sm:py-5 bg-[#070A13]/95 hover:bg-[#0D1323] ${
                            idx < plans.length - 1 ? 'border-b border-white/12' : ''
                          }`
                    }`}
                  >
                    {isPopular && (
                      <span className="pointer-events-none absolute -top-10 left-10 w-56 h-24 rounded-full blur-2xl bg-pink-500/25" />
                    )}

                    {/* Left Column: Popular Kicker + Plan Duration */}
                    <div className="relative z-10 min-w-0 flex-1 space-y-1">
                      {isPopular && (
                        <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.14em] uppercase bg-gradient-to-r from-pink-300 via-amber-200 to-lime-300 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(244,114,182,0.75)]">
                          <Flame className="w-3.5 h-3.5 text-amber-300 shrink-0 drop-shadow-[0_0_8px_rgba(251,191,36,0.95)]" />
                          <span>Most Popular</span>
                        </div>
                      )}
                      <p
                        className={`font-display truncate ${
                          isPopular
                            ? 'text-lg sm:text-xl font-extrabold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.3)]'
                            : 'text-base sm:text-lg font-bold text-zinc-100'
                        }`}
                      >
                        {plan.label}
                      </p>
                    </div>

                    {/* Middle Column: Price */}
                    <div className="relative z-10 text-right shrink-0">
                      <span
                        className={`font-mono tabular-nums font-extrabold ${
                          isPopular
                            ? 'text-xl sm:text-2xl text-white drop-shadow-[0_0_16px_rgba(244,114,182,0.8)]'
                            : idx === 1
                              ? 'text-xl sm:text-2xl text-cyan-200 drop-shadow-[0_0_12px_rgba(56,189,248,0.6)]'
                              : 'text-xl sm:text-2xl text-lime-300 drop-shadow-[0_0_12px_rgba(74,222,128,0.65)]'
                        }`}
                      >
                        ₹{plan.price.toLocaleString('en-IN')}
                      </span>
                    </div>

                    {/* Right Column: Get Access -> CTA */}
                    <button
                      type="button"
                      onClick={() => handleSelectPlan(plan)}
                      className={`relative z-10 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 sm:px-5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                        isPopular
                          ? 'bg-gradient-to-r from-pink-400 via-amber-300 to-lime-300 hover:from-pink-300 hover:to-lime-200 text-zinc-950 shadow-[0_0_32px_rgba(244,114,182,0.65),0_0_20px_rgba(74,222,128,0.45)] ring-1 ring-white/50'
                          : idx === 1
                            ? 'bg-[#10172A] hover:bg-gradient-to-r hover:from-cyan-300 hover:to-sky-300 text-white hover:text-zinc-950 border border-cyan-300/50 shadow-[0_0_24px_-6px_rgba(56,189,248,0.55)]'
                            : 'bg-[#0D1815] hover:bg-gradient-to-r hover:from-lime-300 hover:to-emerald-400 text-white hover:text-zinc-950 border border-lime-300/50 shadow-[0_0_24px_-6px_rgba(74,222,128,0.55)]'
                      }`}
                    >
                      <span>Get Access</span>
                      <ArrowRight className="w-4 h-4 shrink-0" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Stylish QR Code & Supported Payment Methods Prompt */}
        {step === 'payment' && (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Glowing QR Code Card */}
              <div className="relative flex flex-col items-center justify-center p-5 rounded-2xl bg-[#0B0E18] border border-lime-300/45 shadow-[0_0_40px_-10px_rgba(74,222,128,0.45)] space-y-4 text-center overflow-hidden">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-lime-300 to-transparent" />
                <div className="space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pink-300">
                    Plan: {selectedPlan.label}
                  </p>
                  <p className="text-xs font-bold text-lime-300">
                    Scan QR Code to Pay ₹{activeAmount.toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white shadow-[0_0_36px_rgba(255,255,255,0.28)]">
                  {settings.qrImageUrl ? (
                    <img
                      src={settings.qrImageUrl}
                      alt="Payment QR Code"
                      className="w-44 h-44 object-contain"
                    />
                  ) : (
                    <QRCodeSVG value={upiUri} size={176} level="M" />
                  )}
                </div>
                <div className="w-full space-y-2">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-black/55 border border-white/15">
                    <span className="text-xs font-mono text-zinc-100 truncate">
                      {settings.upiId || 'khatushyamlearning@upi'}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyUpi}
                      className="inline-flex items-center gap-1 text-xs font-bold text-pink-300 hover:text-pink-200 shrink-0"
                    >
                      {copiedUpi ? (
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
                  <p className="text-[11px] text-zinc-300">
                    Merchant: {settings.merchantName || settings.brandName}
                  </p>
                </div>
              </div>

              {/* Supported Payment Options */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-white">
                    Supported Payment Methods
                  </h4>
                  <p className="text-xs text-zinc-300 mt-1">
                    Select any enabled method, complete payment, then submit the verification form below.
                  </p>
                </div>

                <div className="space-y-2">
                  {enabledMethodObjects.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.label)}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-left transition-all ${
                        paymentMethod === m.label
                          ? 'bg-pink-500/20 border-pink-400/75 text-white shadow-[0_0_24px_-8px_rgba(244,114,182,0.5)]'
                          : 'bg-[#0B0E18] border-white/15 text-zinc-200 hover:border-white/35'
                      }`}
                    >
                      <div>
                        <p className="text-xs font-semibold">{m.label}</p>
                        <p className="text-[11px] text-zinc-300">{m.detail}</p>
                      </div>
                      {paymentMethod === m.label && (
                        <Check className="w-4 h-4 text-lime-300 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>

                {settings.supportedMethods.includes('bank_transfer') && settings.bankDetails && (
                  <div className="p-3 rounded-xl bg-[#0B0E18] border border-white/15 text-xs text-zinc-200 whitespace-pre-wrap">
                    <p className="font-semibold text-white mb-1">Bank Transfer Details</p>
                    {settings.bankDetails}
                  </div>
                )}

                {settings.supportedMethods.includes('gateway_link') && settings.gatewayPaymentUrl && (
                  <a
                    href={settings.gatewayPaymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-pink-400/55 text-pink-200 hover:bg-pink-500/15 text-xs font-semibold transition-colors"
                  >
                    Open Online Payment Link <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                <a
                  href={upiUri}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-xs font-semibold text-white transition-colors"
                >
                  Open UPI App Directly <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {settings.paymentInstructions && (
              <div className="p-3.5 rounded-xl bg-lime-400/10 border border-lime-400/35 text-xs text-lime-100 leading-relaxed">
                {settings.paymentInstructions}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-white/15">
              <p className="text-xs text-zinc-300">
                After paying, fill the verification form so Admin can approve and unlock your batch.
              </p>
              <button
                type="button"
                onClick={() => setStep('form')}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-pink-400 via-amber-300 to-lime-300 hover:from-pink-300 hover:to-lime-200 text-zinc-950 font-extrabold text-sm transition-all shadow-[0_0_28px_rgba(74,222,128,0.5)] whitespace-nowrap shrink-0"
              >
                I Have Paid — Fill Form
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Payment Verification Form */}
        {step === 'form' && (
          <form onSubmit={handleSubmitOrder} className="p-6 space-y-5">
            {formError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/45 text-xs text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                  Student Full Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0E18] border border-white/20 text-sm text-white focus:outline-none focus:border-pink-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                  Mobile / WhatsApp Number
                </label>
                <input
                  type="tel"
                  required
                  minLength={5}
                  maxLength={30}
                  value={studentPhone}
                  onChange={(e) => setStudentPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0E18] border border-white/20 text-sm text-white focus:outline-none focus:border-pink-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                  Payment Method Used
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0E18] border border-white/20 text-sm text-white focus:outline-none focus:border-pink-400"
                >
                  {enabledMethodObjects.map((m) => (
                    <option key={m.id} value={m.label}>
                      {m.label}
                    </option>
                  ))}
                  {enabledMethodObjects.length === 0 && (
                    <option value="UPI QR Scan">UPI QR Scan</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                  UTR / Transaction Reference ID
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={utrNumber}
                  onChange={(e) => setUtrNumber(e.target.value)}
                  placeholder="12-digit UTR or Txn ID"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0E18] border border-white/20 text-sm font-mono text-white focus:outline-none focus:border-lime-300"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                Email Address (Optional)
              </label>
              <input
                type="email"
                maxLength={160}
                value={studentEmail}
                onChange={(e) => setStudentEmail(e.target.value)}
                placeholder="Optional email for receipt record"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0E18] border border-white/20 text-sm text-white focus:outline-none focus:border-pink-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                Payment Screenshot (Optional)
              </label>
              <label className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0B0E18] border border-dashed border-white/25 hover:border-lime-300/70 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 text-xs text-zinc-200">
                  <ImagePlus className="w-4 h-4 text-lime-300" />
                  <span>
                    {screenshotUrl ? 'Screenshot attached (Click to replace)' : 'Upload payment receipt screenshot'}
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleScreenshotUpload}
                  className="hidden"
                />
                {screenshotUrl && (
                  <img
                    src={screenshotUrl}
                    alt="Receipt preview"
                    className="w-10 h-10 rounded object-cover border border-white/20"
                  />
                )}
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                Note for Admin (Optional)
              </label>
              <textarea
                rows={2}
                maxLength={500}
                value={studentNote}
                onChange={(e) => setStudentNote(e.target.value)}
                placeholder="Any extra payment detail or Telegram username..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0E18] border border-white/20 text-sm text-white focus:outline-none focus:border-pink-400"
              />
            </div>

            <div className="flex items-center justify-between gap-4 pt-3 border-t border-white/15">
              <div className="text-xs text-zinc-300">
                <span>{selectedPlan.label} · </span>
                Amount: <span className="font-mono text-white font-bold">₹{activeAmount.toLocaleString('en-IN')}</span>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-pink-400 via-amber-300 to-lime-300 hover:from-pink-300 hover:to-lime-200 disabled:opacity-50 text-zinc-950 font-extrabold text-sm transition-all shadow-[0_0_28px_rgba(244,114,182,0.5)]"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Submitting...' : 'Submit for Admin Approval'}
              </button>
            </div>
          </form>
        )}

        {/* Step 4: Stylish Live Approval & Unlock Prompt */}
        {step === 'status' && (
          <div className="p-6 space-y-6">
            {existingOrder?.status === 'approved' ? (
              <div className="relative p-7 rounded-2xl bg-gradient-to-br from-lime-400/15 via-[#0A1118] to-cyan-400/10 border border-lime-300/60 shadow-[0_0_52px_-10px_rgba(74,222,128,0.6)] text-center space-y-5 overflow-hidden">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-lime-300 to-transparent" />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-lime-300 to-emerald-400 text-zinc-950 flex items-center justify-center mx-auto shadow-[0_0_28px_rgba(74,222,128,0.8)]">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-display text-xl font-extrabold text-white">
                    Payment Approved — Batch Unlocked
                  </h4>
                  <p className="text-xs text-zinc-200 max-w-md mx-auto">
                    Your enrollment has been verified by Admin. Tap below to open your batch right now.
                  </p>
                </div>
                {existingOrder.unlockedInstructions && (
                  <p className="text-xs text-lime-200 bg-black/45 p-3.5 rounded-xl border border-lime-300/30">
                    {existingOrder.unlockedInstructions}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onOpenBatch(existingOrder, batch)}
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-gradient-to-r from-lime-300 via-emerald-400 to-cyan-300 hover:from-lime-200 hover:to-cyan-200 text-zinc-950 font-extrabold text-sm transition-all shadow-[0_0_36px_rgba(74,222,128,0.75)]"
                >
                  <Sparkles className="w-4 h-4" />
                  Open Batch Now
                </button>
              </div>
            ) : existingOrder?.status === 'rejected' ? (
              <div className="relative p-7 rounded-2xl bg-gradient-to-br from-rose-500/15 via-[#120A10] to-pink-500/10 border border-rose-400/55 shadow-[0_0_48px_-12px_rgba(244,63,94,0.5)] text-center space-y-4 overflow-hidden">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-300 border border-rose-400/40 flex items-center justify-center mx-auto">
                  <Lock className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-display text-lg font-extrabold text-white">
                    Payment Verification Declined
                  </h4>
                  <p className="text-xs text-rose-200">
                    {existingOrder.adminNote || 'UTR details could not be matched. Please submit a new verification.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('payment')}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-pink-400 to-amber-300 text-zinc-950 font-extrabold text-sm shadow-[0_0_24px_rgba(244,114,182,0.5)]"
                >
                  Retry Payment Verification
                </button>
              </div>
            ) : (
              <div className="relative p-7 rounded-2xl bg-gradient-to-br from-pink-500/15 via-[#0B0D18] to-cyan-500/10 border border-pink-400/55 shadow-[0_0_52px_-10px_rgba(244,114,182,0.5)] text-center space-y-4 overflow-hidden">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-pink-400 via-white to-cyan-300" />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-400 to-fuchsia-500 text-white flex items-center justify-center mx-auto shadow-[0_0_28px_rgba(244,114,182,0.75)]">
                  <Clock className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-display text-xl font-extrabold text-white">
                    Submitted — Waiting for Admin Approval
                  </h4>
                  <p className="text-xs text-zinc-200 max-w-md mx-auto leading-relaxed">
                    Your payment verification is in the Admin Panel queue. This prompt updates automatically the instant Admin approves your request.
                  </p>
                </div>
                {(existingOrder?.utrNumber || createdOrderId) && (
                  <div className="text-xs font-mono text-pink-200 bg-black/50 px-4 py-2.5 rounded-xl border border-pink-400/30 inline-block">
                    {existingOrder
                      ? `UTR: ${existingOrder.utrNumber} · ${existingOrder.paymentMethod}`
                      : `Order Ref: ${createdOrderId}`}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
