import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { invariant } from '@/lib/invariant';

// Reads Supabase env vars lazily (at request time, not import time) so the
// app can build and run analytics pages without a Supabase project configured.
function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  invariant(typeof url === 'string' && url.length > 0, 'NEXT_PUBLIC_SUPABASE_URL is not set');
  invariant(
    typeof anonKey === 'string' && anonKey.length > 0,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set'
  );
  return { url, anonKey };
}

// For Server Components, Route Handlers, and Server Actions. A new client
// must be created per request - never module-level (Supabase SSR guidance).
export function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component - middleware refreshes the
          // session instead, so writes here can be safely ignored.
        }
      },
    },
  });
}
