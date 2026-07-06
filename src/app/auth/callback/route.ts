import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { profiles } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { displayNameFromEmail } from '@/lib/auth/displayName';

// Completes the magic-link / OAuth flow: exchanges the auth code for a
// session, then upserts a profile row so every signed-in user has one.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url));
  }

  const supabase = createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(new URL('/login?error=auth', request.url));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await getDb()
      .insert(profiles)
      .values({ id: user.id, displayName: displayNameFromEmail(user.email ?? '') })
      .onConflictDoNothing({ target: profiles.id });
  }

  return NextResponse.redirect(new URL('/l', request.url));
}
