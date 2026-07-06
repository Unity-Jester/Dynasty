'use client';

import { useEffect, useState } from 'react';
import { sendMagicLink, verifyLoginCode } from '@/server/actions/auth';

// Supabase enforces a 60s per-address minimum between OTP emails; surface it
// honestly instead of letting a too-early resend silently fail.
const RESEND_COOLDOWN_SECONDS = 60;

// Shown after a magic-link email goes out: the same email also carries a
// 6-digit code, which works even when the link is eaten by a mail scanner
// or opened in a different browser.
export default function CodeEntryForm({ email, next }: { email: string; next: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  // Bounded countdown: starts at 60 after each send and only ever decrements.
  useEffect(() => {
    if (cooldown === 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown(s => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleVerify = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    // A valid code redirects server-side and never returns here.
    const result = await verifyLoginCode(formData);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setError(null);
    const formData = new FormData();
    formData.set('email', email);
    formData.set('next', next ?? '');
    const result = await sendMagicLink(formData);
    setBusy(false);
    if (result.ok) {
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="panel p-6 mt-4 space-y-3">
      <p className="text-sm text-gray-400 text-center">
        Or enter the 6-digit code from the same email:
      </p>
      <form action={handleVerify} className="space-y-3">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next ?? ''} />
        <input
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          placeholder="123456"
          className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-xl text-white text-center tracking-[0.5em] placeholder-gray-500 focus:outline-none focus:border-gold-500/60 focus:bg-white/[0.06] transition-colors"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
        >
          {busy ? 'Checking…' : 'Sign in with code'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          void handleResend();
        }}
        disabled={busy || cooldown > 0}
        className="w-full text-sm text-gray-500 hover:text-gray-300 transition-colors disabled:cursor-not-allowed disabled:hover:text-gray-500"
      >
        {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend email'}
      </button>
      {error && <p className="text-sleeper-red text-sm text-center">{error}</p>}
    </div>
  );
}
