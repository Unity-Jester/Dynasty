import { getLeague, getLeagueUsers } from '@/lib/sleeper';
import { getLeagueId } from '@/lib/utils';

export const revalidate = 3600; // Revalidate every hour

export default async function SettingsPage() {
  const leagueId = getLeagueId();

  if (!leagueId || leagueId === 'your_league_id_here') {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Please configure your League ID first.</p>
      </div>
    );
  }

  try {
    const [league, users] = await Promise.all([
      getLeague(leagueId),
      getLeagueUsers(leagueId),
    ]);

    // Find commissioner
    const commissioner = users.find(u => u.user_id === league.settings?.commissioner_direct_invite?.toString());

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">League Settings</h1>
          <p className="text-gray-400 mt-1">{league.name}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* General Settings */}
          <div className="bg-sleeper-darker rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">General</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-400">League Name</dt>
                <dd className="text-white">{league.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Season</dt>
                <dd className="text-white">{league.season}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Status</dt>
                <dd className="text-white capitalize">{league.status.replace('_', ' ')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Teams</dt>
                <dd className="text-white">{league.total_rosters}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">League Type</dt>
                <dd className="text-white">
                  {league.settings.type === 0 ? 'Redraft' : league.settings.type === 1 ? 'Keeper' : 'Dynasty'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Schedule Settings */}
          <div className="bg-sleeper-darker rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Schedule</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-400">Playoff Teams</dt>
                <dd className="text-white">{league.settings.playoff_teams}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Playoff Start</dt>
                <dd className="text-white">Week {league.settings.playoff_week_start}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Trade Deadline</dt>
                <dd className="text-white">
                  {league.settings.trade_deadline === 0 ? 'None' : `Week ${league.settings.trade_deadline}`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Divisions</dt>
                <dd className="text-white">{league.settings.divisions || 'None'}</dd>
              </div>
            </dl>
          </div>

          {/* Waiver Settings */}
          <div className="bg-sleeper-darker rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Waivers</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-400">Waiver Type</dt>
                <dd className="text-white">
                  {league.settings.waiver_type === 0 ? 'Rolling' :
                   league.settings.waiver_type === 1 ? 'Reverse Standings' :
                   league.settings.waiver_type === 2 ? 'FAAB' : 'Unknown'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Waiver Budget</dt>
                <dd className="text-white">${league.settings.waiver_budget}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Waiver Clear Days</dt>
                <dd className="text-white">{league.settings.waiver_clear_days} days</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Daily Waivers</dt>
                <dd className="text-white">{league.settings.daily_waivers ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </div>

          {/* Trade Settings */}
          <div className="bg-sleeper-darker rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Trades</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-400">Trade Review Period</dt>
                <dd className="text-white">{league.settings.trade_review_days} days</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Trades Enabled</dt>
                <dd className="text-white">{league.settings.disable_trades ? 'No' : 'Yes'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Pick Trading</dt>
                <dd className="text-white">{league.settings.pick_trading ? 'Enabled' : 'Disabled'}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Roster Positions */}
        <div className="bg-sleeper-darker rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Roster Positions</h2>
          <div className="flex flex-wrap gap-2">
            {league.roster_positions.map((pos, idx) => (
              <span
                key={idx}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  pos === 'BN' ? 'bg-gray-700 text-gray-300' :
                  pos === 'IR' ? 'bg-red-900/50 text-red-400' :
                  pos === 'TAXI' ? 'bg-yellow-900/50 text-yellow-400' :
                  'bg-sleeper-accent/20 text-sleeper-accent'
                }`}
              >
                {pos}
              </span>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Starters:</span>
              <span className="text-white ml-2">
                {league.roster_positions.filter(p => p !== 'BN' && p !== 'IR' && p !== 'TAXI').length}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Bench:</span>
              <span className="text-white ml-2">
                {league.roster_positions.filter(p => p === 'BN').length}
              </span>
            </div>
            <div>
              <span className="text-gray-400">IR:</span>
              <span className="text-white ml-2">
                {league.roster_positions.filter(p => p === 'IR').length || league.settings.reserve_slots || 0}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Taxi:</span>
              <span className="text-white ml-2">
                {league.settings.taxi_slots || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Scoring Settings */}
        <div className="bg-sleeper-darker rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Scoring</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
            {Object.entries(league.scoring_settings)
              .filter(([, value]) => value !== 0)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2">
                  <span className="text-gray-400 truncate">{formatScoringKey(key)}</span>
                  <span className="text-white font-medium">{value}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error loading settings:', error);
    return (
      <div className="text-center py-12">
        <p className="text-sleeper-red">Error loading league settings</p>
      </div>
    );
  }
}

function formatScoringKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Rec', 'Reception')
    .replace('Yds', 'Yards')
    .replace('Td', 'TD')
    .replace('Qb', 'QB')
    .replace('Rb', 'RB')
    .replace('Wr', 'WR')
    .replace('Te', 'TE');
}
