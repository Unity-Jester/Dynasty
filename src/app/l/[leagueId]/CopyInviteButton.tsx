'use client';

import { useState } from 'react';

// Clipboard affordance for invite URLs. Manual text selection is unreliable
// here: the URL renders in a visually truncated code block, and a partial
// drag-copy produces a clipped token that dead-ends the invitee.
export default function CopyInviteButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleCopy();
      }}
      className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium bg-white/[0.06] border border-white/10 text-gray-200 hover:bg-white/[0.1] transition-colors"
    >
      {copied ? 'Copied ✓' : 'Copy link'}
    </button>
  );
}
