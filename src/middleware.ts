import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { invariant } from '@/lib/invariant';

const GUARDED_PREFIX = '/l';

function isGuardedPath(pathname: string): boolean {
  return pathname === GUARDED_PREFIX || pathname.startsWith(`${GUARDED_PREFIX}/`);
}

// Refreshes the Supabase session on every matched request and redirects
// unauthenticated visitors away from the league-hosting app (`/l/*`). The
// public analytics pages are outside the matcher and stay untouched.
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  invariant(typeof url === 'string' && url.length > 0, 'NEXT_PUBLIC_SUPABASE_URL is not set');
  invariant(
    typeof anonKey === 'string' && anonKey.length > 0,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set'
  );

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isGuardedPath(request.nextUrl.pathname) && !user) {
    // Carry the intended destination through login; safeNextPath re-validates
    // it at both embed and callback boundaries before any redirect happens.
    const next = encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(new URL(`/login?next=${next}`, request.url));
  }

  return response;
}

export const config = {
  matcher: ['/l/:path*', '/l'],
};
