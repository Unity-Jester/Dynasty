// Utility functions

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
    }
  }

  return 'Just now';
}

export function getPositionColor(position: string): string {
  const colors: Record<string, string> = {
    QB: 'bg-red-500',
    RB: 'bg-green-500',
    WR: 'bg-blue-500',
    TE: 'bg-yellow-500',
    K: 'bg-purple-500',
    DEF: 'bg-orange-500',
    FLEX: 'bg-pink-500',
    SUPER_FLEX: 'bg-indigo-500',
    BN: 'bg-gray-500',
  };
  return colors[position] || 'bg-gray-500';
}

export function getPositionTextColor(position: string): string {
  const colors: Record<string, string> = {
    QB: 'text-red-400',
    RB: 'text-green-400',
    WR: 'text-blue-400',
    TE: 'text-yellow-400',
    K: 'text-purple-400',
    DEF: 'text-orange-400',
    FLEX: 'text-pink-400',
    SUPER_FLEX: 'text-indigo-400',
    BN: 'text-gray-400',
  };
  return colors[position] || 'text-gray-400';
}

export function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function getLeagueId(): string {
  return process.env.NEXT_PUBLIC_LEAGUE_ID || '';
}

export function abbreviateNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}
