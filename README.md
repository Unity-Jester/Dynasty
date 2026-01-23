# Sleeper Fantasy Football League Hub

A Next.js wrapper website for Sleeper fantasy football leagues with enhanced features.

## Features

- **Dashboard**: Current standings, this week's matchups, and recent activity
- **Matchup Center**: Week-by-week matchup browser with detailed lineup comparisons
- **Trade Center**: Trade analyzer and past trades browser
- **League History**: Championship tracker, all-time records, and season archives

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure your league ID in `.env.local`:
```
NEXT_PUBLIC_LEAGUE_ID=your_league_id_here
```

Find your League ID in the Sleeper app under League Settings.

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment to Vercel

1. Push your code to a GitHub repository

2. Import the project in [Vercel](https://vercel.com)

3. Add the environment variable `NEXT_PUBLIC_LEAGUE_ID` in Vercel's project settings

4. Deploy

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **API**: Sleeper API (no authentication required)

## API Caching

The app includes a built-in API proxy at `/api/sleeper/[...path]` that caches Sleeper API responses:
- Regular endpoints: 1 minute cache
- Player data: 24 hour cache

## Project Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout with navigation
│   ├── page.tsx            # Dashboard
│   ├── matchups/           # Matchup center
│   ├── trades/             # Trade analyzer
│   ├── history/            # League history
│   └── api/sleeper/        # API proxy
├── components/
│   ├── Navigation.tsx      # Site navigation
│   ├── Standings.tsx       # Standings table
│   ├── Matchup.tsx         # Matchup card
│   ├── Roster.tsx          # Roster display
│   ├── TransactionCard.tsx # Transaction display
│   └── TradeAnalyzer.tsx   # Trade evaluation form
└── lib/
    ├── sleeper.ts          # Sleeper API client
    ├── types.ts            # TypeScript types
    └── utils.ts            # Helper functions
```
