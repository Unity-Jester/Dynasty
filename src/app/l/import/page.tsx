import type { Metadata } from 'next';
import ImportWizard from './ImportWizard';

export const metadata: Metadata = { title: 'Import from Sleeper' };

// Server component shell; middleware guards `/l/*`, so visitors here are
// signed in. The interactive wizard is a client child.
export default function ImportPage() {
  return (
    <div className="max-w-2xl mx-auto py-16 px-4">
      <div className="text-center mb-10">
        <h1 className="font-display text-4xl text-white mb-4">
          Import from <span className="text-gold-gradient">Sleeper</span>
        </h1>
        <p className="text-gray-400">
          Preview a Sleeper league before hosting it — rosters, picks, and
          settings all come along.
        </p>
      </div>
      <ImportWizard />
    </div>
  );
}
