import { NextRequest, NextResponse } from 'next/server';

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

// Simple in-memory cache
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_DURATION = 60 * 1000; // 1 minute
const PLAYERS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for player data

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const endpoint = '/' + path.join('/');
  const cacheKey = endpoint;

  // Check cache
  const cached = cache.get(cacheKey);
  const isPlayersEndpoint = endpoint.includes('/players/');
  const cacheDuration = isPlayersEndpoint ? PLAYERS_CACHE_DURATION : CACHE_DURATION;

  if (cached && Date.now() - cached.timestamp < cacheDuration) {
    return NextResponse.json(cached.data, {
      headers: {
        'X-Cache': 'HIT',
        'Cache-Control': `public, max-age=${Math.floor(cacheDuration / 1000)}`,
      },
    });
  }

  try {
    const response = await fetch(`${SLEEPER_API_BASE}${endpoint}`, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Sleeper API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Store in cache
    cache.set(cacheKey, { data, timestamp: Date.now() });

    // Clean old cache entries periodically
    if (cache.size > 100) {
      const now = Date.now();
      const entries = Array.from(cache.entries());
      for (let i = 0; i < entries.length; i++) {
        const [key, value] = entries[i];
        const maxAge = key.includes('/players/') ? PLAYERS_CACHE_DURATION : CACHE_DURATION;
        if (now - value.timestamp > maxAge) {
          cache.delete(key);
        }
      }
    }

    return NextResponse.json(data, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': `public, max-age=${Math.floor(cacheDuration / 1000)}`,
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Sleeper API' },
      { status: 500 }
    );
  }
}
