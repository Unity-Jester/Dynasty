'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/auth/nextPath';
import { getSiteOrigin } from '@/lib/siteOrigin';
import { createSupabaseServerClient } from '@/server/supabase';

export type AuthActionResult = { ok: true } | { ok: false; error: string };

const emailSchema = z.string().email().max(254);
const nextSchema = z.string().max(2048).nullish();

// Builds the post-auth callback URL, carrying the sanitized return path.
// safeNextPath runs here AND in the callback route - both boundaries.
function callbackUrl(rawNext: unknown): string {
  const parsed = nextSchema.safeParse(rawNext);
  const nextPath = safeNextPath(parsed.success ? parsed.data : null);
  return `${getSiteOrigin()}/auth/callback?next=${encodeURIComponent(nextPath)}`;
}

// Server action backing the login page's "Send magic link" button.
export async function sendMagicLink(formData: FormData): Promise<AuthActionResult> {
  const rawEmail = formData.get('email');
  const parsed = emailSchema.safeParse(typeof rawEmail === 'string' ? rawEmail : '');
  if (!parsed.success) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: callbackUrl(formData.get('next')) },
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// Server action backing the login page's "Continue with Google" button.
// On success it redirects straight to the provider's consent screen; it
// only returns a result object on failure (Google isn't enabled in
// Supabase yet, so this currently always errors until that's configured).
export async function signInWithGoogle(next?: string | null): Promise<AuthActionResult> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callbackUrl(next) },
  });

  if (error || !data.url) {
    return { ok: false, error: error?.message ?? 'Google sign-in is not available yet.' };
  }
  redirect(data.url);
}
