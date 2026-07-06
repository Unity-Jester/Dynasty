'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { sendMagicLink, signInWithGoogle } from '@/server/actions/auth';
import CodeEntryForm from './CodeEntryForm';

type Status = { kind: 'idle' } | { kind: 'sent' } | { kind: 'error'; message: string };

const QUERY_ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'That sign-in link was missing its code. Request a new one below.',
  auth: 'That sign-in link is invalid or expired. Request a new one below.',
};

function statusFromQueryError(errorParam: string | null): Status {
  if (!errorParam) {
    return { kind: 'idle' };
  }
  return {
    kind: 'error',
    message: QUERY_ERROR_MESSAGES[errorParam] ?? 'Something went wrong signing you in.',
  };
}

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const [status, setStatus] = useState<Status>(() =>
    statusFromQueryError(searchParams.get('error'))
  );
  const [loading, setLoading] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  // Documented env flag (Rule 8): flip on after enabling the Google provider
  // in the Supabase dashboard. Inlined at build time for client components.
  const googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === 'true';

  const handleSubmit = async (formData: FormData) => {
    setLoading(true);
    const result = await sendMagicLink(formData);
    setLoading(false);
    if (result.ok) {
      const email = formData.get('email');
      setSentEmail(typeof email === 'string' ? email : null);
      setStatus({ kind: 'sent' });
    } else {
      setStatus({ kind: 'error', message: result.error });
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    const result = await signInWithGoogle(next);
    setLoading(false);
    // A successful call redirects server-side and never returns here.
    if (!result.ok) {
      setStatus({ kind: 'error', message: result.error });
    }
  };

  return (
    <div className="max-w-md mx-auto py-16">
      <div className="text-center mb-10">
        <h1 className="font-display text-4xl text-white mb-4">
          Sign in to <span className="text-gold-gradient">Dynasty</span>
        </h1>
        <p className="text-gray-400">Use a magic link — no password required.</p>
      </div>

      <div className="panel p-6 space-y-4">
        <form action={handleSubmit} className="space-y-3">
          <input type="hidden" name="next" value={next ?? ''} />
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            placeholder="you@example.com"
            className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/60 focus:bg-white/[0.06] transition-colors"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            {loading ? 'Sending…' : 'Send magic link'}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <div className="h-px flex-1 bg-white/10" />
              or
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              onClick={() => {
                void handleGoogle();
              }}
              disabled={loading}
              className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-xl text-white font-medium hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue with Google
            </button>
          </>
        )}
      </div>

      {status.kind === 'sent' && (
        <>
          <p className="text-sleeper-green text-sm mt-4 text-center">
            Check your email for a magic link.
          </p>
          {sentEmail && <CodeEntryForm email={sentEmail} next={next} />}
        </>
      )}
      {status.kind === 'error' && (
        <p className="text-sleeper-red text-sm mt-4 text-center">{status.message}</p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
