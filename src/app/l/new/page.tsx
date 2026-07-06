import type { Metadata } from 'next';
import NewLeagueForm from './NewLeagueForm';

export const metadata: Metadata = { title: 'Create a league' };

// Server component shell; the interactive form is a client child. The `/l`
// prefix is auth-guarded by middleware, so visitors here are signed in.
export default function NewLeaguePage() {
  return (
    <div className="max-w-md mx-auto py-16">
      <div className="text-center mb-10">
        <h1 className="font-display text-4xl text-white mb-4">
          Start a <span className="text-gold-gradient">Dynasty</span>
        </h1>
        <p className="text-gray-400">
          Name your league and pick a size. We&apos;ll create the teams and
          generate a claim link for each one.
        </p>
      </div>
      <NewLeagueForm />
    </div>
  );
}
