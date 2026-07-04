# Dynasty League Hub

A premium Next.js hub for Sleeper fantasy football leagues with enhanced features. Works with **any** Sleeper league — enter a league ID or Sleeper username on the landing page, or configure a default league for your own deployment.

## Features

- **Dashboard**: Current standings, this week's matchups, power rankings, weekly awards (top score, biggest blowout, closest call), luck index (all-play expected wins vs actual record), and recent activity
- **Matchup Center**: Week-by-week matchup browser with detailed lineup comparisons and all-time head-to-head records
- **Draft Center**: Draft board visualization, draft value analysis comparing pick value at draft time vs current value, manager rankings by draft performance, best/worst picks tracking across all seasons
- **Trade Center**: Trade analyzer with real-time valuations (2 and 3-team trades), trade report cards with curve grades (A+ to F) and win/loss records, historical trade browser across all seasons with value analysis at time of trade
- **League History**: Championship tracker, all-time records, head-to-head rivalry grid, and season-by-season archive
- **Settings**: League configuration display including roster positions, scoring settings, waiver rules, and trade settings
- **Multi-league**: All pages live under `/league/<leagueId>`; visitors can look up their own leagues by Sleeper username at `/start`

## Setup

1. Install dependencies:
```bash
npm install
```

2. (Optional) Configure a default league in `.env.local` — see `.env.example`:
```
NEXT_PUBLIC_LEAGUE_ID=your_league_id_here
```

Without a default league, the landing page asks for a league ID or Sleeper username. Find your League ID in the Sleeper app under League Settings.

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_LEAGUE_ID` | No | Default league for this deployment; `/` redirects to it |
| `HISTORICAL_VALUES_CSV_URL` | No | Override the CSV export URL for historical player/pick values (defaults to the shared community Google Sheet) |

## Testing

```bash
npm test
```

Unit tests (vitest) cover the trade analysis engine, historical value lookups, season stats (luck index, weekly awards), and shared utilities.

## Deployment to Vercel

1. Push your code to a GitHub repository
2. Import the project in [Vercel](https://vercel.com)
3. (Optional) Add `NEXT_PUBLIC_LEAGUE_ID` in Vercel's project settings
4. Deploy

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **API**: Sleeper API (no authentication required), FantasyCalc + DynastyProcess for player values
- **Testing**: Vitest

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout with navigation
│   ├── page.tsx                # Landing: redirects to default/last league or shows picker
│   ├── start/                  # League picker (league ID or username lookup)
│   └── league/[leagueId]/
│       ├── page.tsx            # Dashboard
│       ├── matchups/           # Matchup center
│       ├── draft/              # Draft center with value analysis
│       ├── trades/             # Trade center with report cards
│       ├── history/            # League history + H2H rivalry grid
│       └── settings/           # League settings display
├── components/                 # UI components (server + client)
└── lib/
    ├── sleeper.ts              # Sleeper API client (parallelized fetch helpers)
    ├── types.ts                # TypeScript types
    ├── utils.ts                # Shared helpers (team names, name normalization, CSV)
    ├── rankings.ts             # FantasyCalc / DynastyProcess player values
    ├── tradeAnalysis.ts        # Trade analysis and curve grading
    ├── seasonStats.ts          # Luck index and weekly awards
    └── historicalValues.ts     # Historical player/pick value data
```
