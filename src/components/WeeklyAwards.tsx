import Image from 'next/image';
import { SleeperRoster, SleeperUser } from '@/lib/types';
import { getUserByOwnerId, getUserAvatarUrl } from '@/lib/sleeper';
import { getTeamName } from '@/lib/utils';
import { WeeklyAwards as WeeklyAwardsData } from '@/lib/seasonStats';

interface WeeklyAwardsProps {
  awards: WeeklyAwardsData;
  rosters: SleeperRoster[];
  users: SleeperUser[];
}

export default function WeeklyAwards({ awards, rosters, users }: WeeklyAwardsProps) {
  const teamFor = (rosterId: number) => {
    const roster = rosters.find(r => r.roster_id === rosterId);
    const user = roster ? getUserByOwnerId(users, roster.owner_id) : null;
    return { name: getTeamName(user, rosterId), avatar: user?.avatar || null };
  };

  const cards: { emoji: string; title: string; body: React.ReactNode }[] = [];

  if (awards.topScore) {
    const team = teamFor(awards.topScore.rosterId);
    cards.push({
      emoji: '🔥',
      title: 'Top Score',
      body: (
        <div className="flex items-center gap-2">
          <Image src={getUserAvatarUrl(team.avatar)} alt={team.name} width={28} height={28} className="rounded-full" />
          <div className="min-w-0">
            <p className="text-white font-medium truncate">{team.name}</p>
            <p className="text-sm text-sleeper-green tabular-nums">{awards.topScore.points.toFixed(2)} pts</p>
          </div>
        </div>
      ),
    });
  }

  if (awards.biggestBlowout) {
    const winner = teamFor(awards.biggestBlowout.winnerId);
    const loser = teamFor(awards.biggestBlowout.loserId);
    cards.push({
      emoji: '💥',
      title: 'Biggest Blowout',
      body: (
        <div className="min-w-0">
          <p className="text-white font-medium truncate">
            {winner.name} <span className="text-gray-500">over</span> {loser.name}
          </p>
          <p className="text-sm text-gray-400 tabular-nums">
            {awards.biggestBlowout.winnerPoints.toFixed(2)}–{awards.biggestBlowout.loserPoints.toFixed(2)}
            <span className="text-sleeper-red ml-2">+{awards.biggestBlowout.margin.toFixed(2)}</span>
          </p>
        </div>
      ),
    });
  }

  if (awards.closestGame && awards.closestGame !== awards.biggestBlowout) {
    const winner = teamFor(awards.closestGame.winnerId);
    const loser = teamFor(awards.closestGame.loserId);
    cards.push({
      emoji: '😅',
      title: 'Closest Call',
      body: (
        <div className="min-w-0">
          <p className="text-white font-medium truncate">
            {winner.name} <span className="text-gray-500">edges</span> {loser.name}
          </p>
          <p className="text-sm text-gray-400 tabular-nums">
            {awards.closestGame.winnerPoints.toFixed(2)}–{awards.closestGame.loserPoints.toFixed(2)}
            <span className="text-yellow-400 ml-2">by {awards.closestGame.margin.toFixed(2)}</span>
          </p>
        </div>
      ),
    });
  }

  if (cards.length === 0) return null;

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-4">Week {awards.week} Awards</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(card => (
          <div key={card.title} className="panel panel-hover p-4">
            <p className="text-xs text-gray-500 mb-2">
              <span className="mr-1">{card.emoji}</span>
              {card.title}
            </p>
            {card.body}
          </div>
        ))}
      </div>
    </div>
  );
}
