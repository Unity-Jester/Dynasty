// Sleeper API Types

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  metadata?: {
    team_name?: string;
    [key: string]: string | undefined;
  };
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  status: string;
  sport: string;
  total_rosters: number;
  roster_positions: string[];
  settings: LeagueSettings;
  scoring_settings: Record<string, number>;
  previous_league_id: string | null;
  draft_id: string;
  avatar: string | null;
}

export interface LeagueSettings {
  wins_bracket: number;
  waiver_type: number;
  waiver_day_of_week: number;
  waiver_clear_days: number;
  waiver_budget: number;
  type: number;
  trade_review_days: number;
  trade_deadline: number;
  taxi_years: number;
  taxi_slots: number;
  taxi_deadline: number;
  taxi_allow_vets: number;
  start_week: number;
  squads: number;
  reserve_slots: number;
  reserve_allow_sus: number;
  reserve_allow_out: number;
  reserve_allow_na: number;
  reserve_allow_doubtful: number;
  reserve_allow_dnr: number;
  reserve_allow_cov: number;
  playoff_week_start: number;
  playoff_teams: number;
  playoff_seed_type: number;
  playoff_round_type: number;
  pick_trading: number;
  offseason_adds: number;
  num_teams: number;
  max_keepers: number;
  leg: number;
  last_scored_leg: number;
  last_report: number;
  divisions: number;
  disable_trades: number;
  daily_waivers_last_ran: number;
  daily_waivers_hour: number;
  daily_waivers_days: number;
  daily_waivers: number;
  commissioner_direct_invite: number;
  capacity_override: number;
  best_ball: number;
  bench_lock: number;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  league_id: string;
  starters: string[];
  players: string[];
  reserve: string[] | null;
  taxi: string[] | null;
  settings: RosterSettings;
  metadata: Record<string, string> | null;
}

export interface RosterSettings {
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fpts_decimal?: number;
  fpts_against?: number;
  fpts_against_decimal?: number;
  ppts?: number;
  ppts_decimal?: number;
  division?: number;
}

export interface SleeperMatchup {
  matchup_id: number;
  roster_id: number;
  players: string[];
  starters: string[];
  points: number;
  starters_points: number[];
  players_points: Record<string, number>;
  custom_points: number | null;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: 'trade' | 'waiver' | 'free_agent' | 'commissioner';
  status: string;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: TradePick[];
  waiver_budget: WaiverBudget[];
  settings: TransactionSettings | null;
  created: number;
  creator: string;
  consenter_ids: number[];
  leg: number;
  metadata: Record<string, string> | null;
}

export interface TradePick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface WaiverBudget {
  sender: number;
  receiver: number;
  amount: number;
}

export interface TransactionSettings {
  waiver_bid?: number;
  seq?: number;
  priority?: number;
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  team: string | null;
  position: string;
  age: number | null;
  years_exp: number;
  college: string | null;
  fantasy_positions: string[];
  status: string;
  injury_status: string | null;
  number: number | null;
  depth_chart_position: string | null;
  depth_chart_order: number | null;
  weight: string | null;
  height: string | null;
  search_rank: number;
  sportradar_id: string | null;
  espn_id: string | null;
  yahoo_id: string | null;
  rotowire_id: string | null;
  fantasy_data_id: string | null;
}

export interface SleeperPlayersMap {
  [playerId: string]: SleeperPlayer;
}

export interface SleeperNFLState {
  week: number;
  season_type: string;
  season_start_date: string;
  season: string;
  previous_season: string;
  leg: number;
  league_season: string;
  league_create_season: string;
  display_week: number;
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  status: string;
  type: string;
  season: string;
  settings: DraftSettings;
  start_time: number;
  sport: string;
  slot_to_roster_id: Record<string, number>;
  draft_order: Record<string, number> | null;
  last_picked: number;
  last_message_id: string;
  last_message_time: number;
  creators: string[];
  created: number;
}

export interface DraftSettings {
  teams: number;
  slots_wr: number;
  slots_te: number;
  slots_rb: number;
  slots_qb: number;
  slots_k: number;
  slots_flex: number;
  slots_def: number;
  slots_bn: number;
  rounds: number;
  reversal_round: number;
  player_type: number;
  pick_timer: number;
  nomination_timer: number;
  enforce_position_limits: number;
  cpu_autopick: number;
  autostart: number;
  autopick_delay: number;
  autopause_start_time: number;
  autopause_end_time: number;
  autopause_enabled: number;
  alpha_sort: number;
}

export interface SleeperDraftPick {
  player_id: string;
  picked_by: string;
  roster_id: number;
  round: number;
  draft_slot: number;
  pick_no: number;
  metadata: {
    first_name: string;
    last_name: string;
    position: string;
    team: string;
  };
  is_keeper: boolean | null;
  draft_id: string;
}

// The bracket endpoint returns abbreviated keys (r/m/w/l/p); the long
// names are kept optional for older payload shapes.
export interface PlayoffMatchup {
  r?: number; // round
  m?: number; // matchup id
  w?: number | null; // winner roster id
  l?: number | null; // loser roster id
  p?: number; // placement this game decides (1 = championship)
  t1?: number | null; // team 1 roster id
  t2?: number | null; // team 2 roster id
  round?: number;
  matchup_id?: number;
  team_1_roster_id?: number | null;
  team_2_roster_id?: number | null;
  winner_roster_id?: number | null;
  loser_roster_id?: number | null;
  team_1_from?: {
    w?: number;
    l?: number;
  };
  team_2_from?: {
    w?: number;
    l?: number;
  };
}

// Extended types for our app
export interface TeamInfo {
  rosterId: number;
  ownerId: string;
  user: SleeperUser | null;
  roster: SleeperRoster;
  teamName: string;
}

export interface MatchupPair {
  matchupId: number;
  team1: {
    roster: SleeperRoster;
    user: SleeperUser | null;
    teamName: string;
    points: number;
    starters: string[];
    startersPoints: number[];
  };
  team2: {
    roster: SleeperRoster;
    user: SleeperUser | null;
    teamName: string;
    points: number;
    starters: string[];
    startersPoints: number[];
  };
}

export interface SeasonRecord {
  season: string;
  leagueId: string;
  champion: TeamInfo | null;
  runnerUp: TeamInfo | null;
  standings: TeamInfo[];
}

export interface HeadToHeadRecord {
  team1Id: number;
  team2Id: number;
  team1Wins: number;
  team2Wins: number;
  ties: number;
  team1Points: number;
  team2Points: number;
}

export interface TradeEvaluation {
  transaction: SleeperTransaction;
  side1: {
    rosterIds: number[];
    playersReceived: string[];
    picksReceived: TradePick[];
    totalPointsAfter: number;
  };
  side2: {
    rosterIds: number[];
    playersReceived: string[];
    picksReceived: TradePick[];
    totalPointsAfter: number;
  };
  winner: 'side1' | 'side2' | 'even' | 'tbd';
}

// Trade Calculator Types
export interface DraftPickSelection {
  season: string;        // "2025", "2026", "2027"
  round: number;         // 1, 2, 3, 4
  key: string;           // "2026 1st" - matches FantasyCalc format
}

export interface TradeSide {
  players: { id: string; name: string; position: string; team: string; value: number }[];
  picks: { pick: DraftPickSelection; value: number }[];
  totalValue: number;
}

export interface TradeCalculation {
  side1: TradeSide;
  side2: TradeSide;
  percentDiff: number;
  verdict: 'fair' | 'side1_wins' | 'side2_wins';
  verdictText: string;
  valueDiff: number;
}

export interface FantasyCalcSettings {
  numQbs: 1 | 2;
  ppr: 0 | 0.5 | 1;
  numTeams: number;
}

// Trade Report Card Types
export type TradeGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';

export interface TradeAssetValue {
  historical: number;  // Estimated value at time of trade
  current: number;     // Current value
  average: number;     // Average of historical and current (used for display/ranking)
}

export interface TradePlayer {
  id: string;
  name: string;
  position: string;
  value: TradeAssetValue;
  ageAtTrade?: number;
}

export interface AnalyzedPick {
  season: string;
  round: number;
  value: TradeAssetValue;
  becamePlayer?: string;
  becamePlayerId?: string;
  wasUsedByTeam: boolean;  // True if team used the pick, false if traded away before draft
}

export interface TradeSideAnalysis {
  players: TradePlayer[];
  picks: AnalyzedPick[];
  totalValue: TradeAssetValue;
}

export interface TradeAnalysis {
  tradeId: string;
  date: number;
  partnerId: number;
  partnerIds: number[];
  received: TradeSideAnalysis;
  given: TradeSideAnalysis;
  netValue: TradeAssetValue;
  result: 'win' | 'loss' | 'push';
}

export interface PositionBreakdown {
  position: string;
  received: number;
  given: number;
  net: number;
}

export interface TradePartner {
  rosterId: number;
  teamName: string;
  tradeCount: number;
  netValue: number;
}

// Per-roster value swing for one trade, in a client-serializable shape.
// Derived from the TradeAnalysis objects already computed for report cards.
export interface TradeValueSwing {
  rosterId: number;
  netAtTrade: number;
  netCurrent: number;
  netAverage: number;
}

// Keyed by transaction_id
export type TradeValueMap = Record<string, TradeValueSwing[]>;

export interface TransactionValueChange {
  rosterId: number;
  addedValue: number;
  droppedValue: number;
  netValue: number;
}

// Keyed by transaction_id
export type TransactionValueChangeMap = Record<string, TransactionValueChange[]>;

export interface TeamReportCard {
  rosterId: number;
  ownerId: string;
  teamName: string;
  avatar: string | null;
  grade: TradeGrade;
  gradeScore: number;
  totalTrades: number;
  wins: number;
  losses: number;
  pushes: number;
  totalValueGained: number;
  bestTrade: TradeAnalysis | null;
  worstTrade: TradeAnalysis | null;
  tradePartners: TradePartner[];
  positionBreakdown: PositionBreakdown[];
  trades: TradeAnalysis[];
}
