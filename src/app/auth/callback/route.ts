import { NextRequest, NextResponse } from 'next/server';
import { ensureProfileForUser } from '@/server/auth/profile';
import { createSupabaseServerClient } from '@/server/supabase';
import { safeNextPath } from '@/lib/auth/nextPath';

// Completes the magic-link / OAuth flow: exchanges the auth code for a
// session, then upserts a profile row so every signed-in user has one.
export async function GET(request: NextRequest) {
  // Sanitized once up front; error redirects must carry it too, or a retry
  // from the login error page silently loses the user's destination (an
  // expired invite-link login would strand the invitee on /l).
  const nextPath = safeNextPath(request.nextUrl.searchParams.get('next'));
  const loginError = (kind: string) =>
    NextResponse.redirect(
      new URL(`/login?error=${kind}&next=${encodeURIComponent(nextPath)}`, request.url),
    );

  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return loginError('missing_code');
  }

  const supabase = createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return loginError('auth');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fail loud: a successful exchange without a user means the sign-in did
  // not really complete. Letting it through would surface later as a
  // profiles FK violation far from the cause.
  if (!user) {
    return loginError('auth');
  }

  await ensureProfileForUser(user);

  return NextResponse.redirect(new URL(nextPath, request.url));
}
