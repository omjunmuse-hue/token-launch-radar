// The radar's model: what a pre-token protocol's token would be worth if
// the protocol's record stayed as it is, priced from the snapshot itself.
//
// No name is hardcoded and no multiple is imported from outside. The
// snapshot carries 144 protocols whose tokens already trade; for each
// category their market cap over TVL is the market's own answer to "what
// is a dollar of TVL in this kind of protocol worth as a token". A
// pre-token protocol is priced at its category's median multiple, then
// adjusted by three things the snapshot also carries: its seven-day TVL
// momentum, how long it has run with no token (seasoning), and how many
// chains it reaches. Categories with too few trading peers fall back to
// the all-market median, shrunk toward it by their peer count.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  momentum: number;
  seasoning: number;
  reach: number;
  watchlist: boolean;
}

export interface PeerRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  scanned: number;
  tokenized: number;
  global_multiple: number;
  category_multiples: { category: string; peers: number; multiple: number }[];
  rows: BoardRow[];
  peers: PeerRow[];
}

const MIN_PEERS_FOR_CATEGORY = 5;
const MULTIPLE_FLOOR = 0.03;
const MULTIPLE_CAP = 2.5;
const BOARD_CAP = 260;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot shape not recognised');
  }
  return raw;
}

/** Days between a protocol's listed day and the snapshot's as_of day. */
function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${listedAt}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Category multiples from the snapshot's own trading protocols. */
export function categoryMultiples(snapshot: Snapshot): { global: number; byCategory: Map<string, { peers: number; multiple: number }> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const global = clamp(median(all), MULTIPLE_FLOOR, MULTIPLE_CAP);
  const byCategory = new Map<string, { peers: number; multiple: number }>();
  for (const [category, ratios] of ratiosByCategory) {
    let multiple: number;
    if (ratios.length >= MIN_PEERS_FOR_CATEGORY) {
      multiple = median(ratios);
    } else {
      // Shrink a thin category toward the market median by its peer count.
      const own = median(ratios);
      multiple = (own * ratios.length + global * MIN_PEERS_FOR_CATEGORY) / (ratios.length + MIN_PEERS_FOR_CATEGORY);
    }
    byCategory.set(category, { peers: ratios.length, multiple: clamp(multiple, MULTIPLE_FLOOR, MULTIPLE_CAP) });
  }
  return { global, byCategory };
}

interface Factors {
  multiple: number;
  momentum: number;
  seasoning: number;
  reach: number;
}

/** The four factors that price one pre-token protocol, all from the snapshot. */
export function factorsFor(p: SnapshotProtocol, multiples: { global: number; byCategory: Map<string, { peers: number; multiple: number }> }, asOf: string): Factors & { age: number | null } {
  const entry = multiples.byCategory.get(p.category ?? 'Uncategorised');
  const multiple = entry?.multiple ?? multiples.global;
  const momentum = clamp(1 + ((p.change_7d ?? 0) / 100) * 0.8, 0.75, 1.35);
  const age = ageDays(p.listed_at, asOf);
  const seasoning = age === null ? 0.97 : 0.88 + 0.24 * (Math.min(age, 1095) / 1095);
  const reach = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  return { multiple, momentum, seasoning, reach, age };
}

export function impliedValue(p: SnapshotProtocol, f: Factors): number {
  return Math.max(1, Math.round(p.tvl_usd * f.multiple * f.momentum * f.seasoning * f.reach));
}

// ---------------------------------------------------------------- farm plans

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

type PlanKind = 'lending' | 'dex' | 'yield' | 'staking' | 'bridge' | 'rwa' | 'basis' | 'curator' | 'generic';

function planKind(category: string | null): PlanKind {
  switch (category) {
    case 'Lending':
    case 'CDP':
      return 'lending';
    case 'Dexs':
    case 'Derivatives':
      return 'dex';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
      return 'yield';
    case 'Liquid Staking':
    case 'Liquid Restaking':
      return 'staking';
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return 'bridge';
    case 'RWA':
    case 'RWA Lending':
      return 'rwa';
    case 'Basis Trading':
      return 'basis';
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return 'curator';
    default:
      return 'generic';
  }
}

/** A concrete farm plan for one protocol: actions, amounts, time and cost. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const chain2 = p.chains[1] ?? chain;
  const tvl = usd(p.tvl_usd);
  const kind = planKind(p.category);
  const open = `Open ${p.name} on ${chain} and connect a fresh wallet you use only for farming; a clean wallet history is what most snapshots reward, and ${p.name} already holds ${tvl} of TVL to be counted against.`;
  const track = `Keep a simple log of every position, fee and date from day one: if ${p.name} converts activity to a token, the snapshot date is unknowable in advance, and a log is the only proof of early, consistent use.`;
  const close = `Review monthly and stop adding capital if TVL falls for two straight months or the team ships a token through another vehicle; farming ${p.name} is a position, not a subscription, and dead protocols do not announce themselves.`;
  const byKind: Record<PlanKind, string[]> = {
    lending: [
      `Deposit $1,000-$2,500 of a major stablecoin or ETH on ${chain} as supply collateral; at ${tvl} of TVL the pool is deep enough that this size earns real interest without moving rates, and gas on ${chain} runs about $1-$5 per action.`,
      `Borrow 30-40% against the deposit and re-supply it for two or three loops, keeping the health factor above 1.6; looping takes one evening to set up and is the activity pattern lending points programs count most, at roughly $10-$30 a month in extra gas.`,
      `Hold the loop for at least 10-12 weeks with weekly health checks; short hops in and out are the sybil pattern filters are built to drop, while a season of continuous supply is what early-user allocations have historically rewarded.`,
    ],
    dex: [
      `Provide $1,000-$2,000 of liquidity to the busiest pair on ${chain} in the tightest fee tier you can monitor daily; concentrated ranges earn the fees that count as real usage, and setup plus a weekly rebalance costs about $5-$20 in gas a month.`,
      `Route your ordinary swaps through ${p.name} instead of a rival aggregator for 8-12 weeks: consistent weekly volume from one wallet, even $200-$500 a week, reads as a genuine user rather than a one-day airdrop tourist.`,
      `Vote in any gauge or governance poll the protocol runs and claim every fee epoch on time; unclaimed epochs and silent wallets are the first thing distribution filters trim.`,
    ],
    yield: [
      `Move $1,000-$2,000 into the flagship vault on ${chain} and leave it untouched for a full quarter; vault share balance over time is the simplest metric a points program can snapshot, and entry plus exit gas is usually under $10.`,
      `Split a second $500-$1,000 across the ${chain2} deployment if one exists, so your history spans more than one chain before any snapshot; cross-chain users are a small minority and are weighted like it.`,
      `Restake or lock the vault's receipt token wherever ${p.name} itself points to partner protocols; composed positions are how small wallets build a history that looks like conviction rather than parking.`,
    ],
    staking: [
      `Stake $1,000-$2,500 of the base asset through ${p.name} on ${chain} and hold the liquid receipt token in the same wallet; duration-weighted stake is the metric staking protocols can actually verify at a snapshot.`,
      `Put 30-50% of the receipt token to work in one integrated lending market or pool the protocol lists as a partner, so the same capital shows both staking and DeFi activity over 10+ weeks.`,
      `Delegate any validator choice the product offers toward smaller operators rather than the default; decentralisation-weighted rewards are common in this category and cost nothing extra to qualify for.`,
    ],
    bridge: [
      `Bridge $500-$1,500 to ${chain2} and back on a weekly rhythm for 8-10 weeks, varying amounts and days; steady two-way volume from one wallet is the usage pattern bridge points programs are built on, at about $2-$10 of fees per hop.`,
      `Leave at least $500 of working capital parked on the far side between hops instead of round-tripping everything home; balances held on destination chains are what separates users from pure volume bots.`,
      `Use every route type ${p.name} offers at least twice (fast and slow paths, different source chains) so your history covers the product surface a snapshot is likely to score.`,
    ],
    rwa: [
      `Onboard early: complete KYC and make a first $500-$1,000 deposit on ${chain} even before yields tempt you, because verified-account age is a filter later users cannot buy back; onboarding takes under an hour.`,
      `Roll each maturity out instead of withdrawing for at least two full cycles (typically 60-180 days); continuous exposure across cycles is the behaviour real-world-asset protocols reward when they tokenise.`,
      `Hold a second position in a different asset class on the platform (treasuries plus one other) so your account reads as a customer of the platform, not a single-product yield tourist.`,
    ],
    basis: [
      `Deposit $1,000-$2,000 of stablecoins on ${chain} and hold through at least one full funding cycle (about 30 days); basis products score time-weighted balance, and entering or exiting mid-cycle forfeits most of it.`,
      `Add a smaller second tranche on ${chain2} if the product is deployed there, and rebalance only monthly; low-touch, long-duration capital is exactly what this category's points are priced to attract.`,
      `Track the published funding rate weekly and keep a note of negative weeks you stayed through; staying during negative funding is the strongest loyalty signal a basis protocol can measure.`,
    ],
    curator: [
      `Deposit $1,000-$2,500 into the flagship curated vault on ${chain} (the one holding the largest share of the ${tvl} under curation) and keep it there for a full quarter; curator points and snapshots are time-weighted, and vault entry plus exit usually costs under $10 in gas.`,
      `Follow the curator, not just the vault: read its allocation reports, join its governance or community calls, and mirror one reallocation manually so your wallet shows engagement with the curation itself, not only passive yield.`,
      `Add a second, smaller $500-$1,000 position in a different vault family the curator runs on ${chain2}, so a snapshot of either product line finds a seasoned position rather than a last-week deposit.`,
    ],
    generic: [
      `Use the core product on ${chain} with $500-$1,500 of real capital at least once a week for 10-12 weeks; in a category this size, consistent weekly activity from one wallet already puts you ahead of most addresses a snapshot would count.`,
      `Take part in every public program the team runs while you farm: points seasons, testnet or beta access, governance votes and feedback forms each take minutes and are the cheapest history to build.`,
      `Keep position sizes boring and steady rather than spiking once; distribution filters are tuned to drop one-week wonders, and a flat three-month curve of activity is what survives them.`,
    ],
  };
  return [open, ...byKind[kind], track, close];
}

// ---------------------------------------------------------------- the board

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const multiples = categoryMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter((p) => p.mcap_usd === null);
  // The board's additions beyond the watchlist must still be genuinely
  // pre-token: the watchlist's own exclusion rule (the snapshot section
  // of the rules) names the shapes that are really a tokenized protocol
  // wearing another entry — versioned products, wrapped or staked
  // products, exchange house brands, bridge and staking categories —
  // plus one shape the rule cannot name because the snapshot carries no
  // parent field: a protocol whose first name-word is a tokenized
  // protocol's first name-word (Aave V3 under Aave, USDe under Ethena).
  const tokenizedFirstWords = new Set(
    snapshot.protocols.filter((p) => p.mcap_usd !== null).map((p) => p.name.split(' ')[0]!.toLowerCase()),
  );
  const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];
  function looksTokenized(p: SnapshotProtocol): boolean {
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
    if (/\s(v\d+|\d+\.\d+)$/i.test(p.name)) return true;
    if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
    const first = p.name.split(' ')[0]!.toLowerCase();
    if (EXCHANGE_PREFIXES.includes(first)) return true;
    if (tokenizedFirstWords.has(first)) return true;
    return false;
  }
  // Selection follows the watchlist's own logic. Above the floor, only
  // the watchlist is ranked: the house built it with a parent-protocol
  // record this snapshot does not carry, so a big protocol the list
  // leaves out is left out here too, whatever its TVL. Below the floor
  // is the radar's own hunting ground: every pre-token protocol there
  // that is not visibly a tokenized protocol's product joins the board.
  const chosen = preToken.filter(
    (p) => watchlist.has(p.slug) || (p.tvl_usd < snapshot.floor_usd && !looksTokenized(p)),
  );
  const scored = chosen.map((p) => {
    const raw = factorsFor(p, multiples, snapshot.as_of);
    // Round the factors first and price from the rounded numbers, so the
    // dashboard's own recomputation from the row lands on the same dollar.
    const f = {
      multiple: Math.round(raw.multiple * 1000) / 1000,
      momentum: Math.round(raw.momentum * 1000) / 1000,
      seasoning: Math.round(raw.seasoning * 1000) / 1000,
      reach: Math.round(raw.reach * 1000) / 1000,
      age: raw.age,
    };
    return { p, f, implied: impliedValue(p, f) };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));
  // The cap trims the tail, but a watchlist protocol is never trimmed:
  // coverage of the watchlist is the gate's hard rule, so the board keeps
  // every watchlist row and fills its remaining places with the best rest.
  const kept = scored.filter((s) => watchlist.has(s.p.slug));
  for (const s of scored) {
    if (kept.length >= BOARD_CAP) break;
    if (!watchlist.has(s.p.slug)) kept.push(s);
  }
  kept.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));
  const rows: BoardRow[] = kept.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.f.age,
    multiple: Math.round(s.f.multiple * 1000) / 1000,
    momentum: Math.round(s.f.momentum * 1000) / 1000,
    seasoning: Math.round(s.f.seasoning * 1000) / 1000,
    reach: Math.round(s.f.reach * 1000) / 1000,
    watchlist: watchlist.has(s.p.slug),
  }));
  const peers: PeerRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000, symbol: p.symbol }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 60);
  const categoryList = [...multiples.byCategory.entries()]
    .map(([category, v]) => ({ category, peers: v.peers, multiple: Math.round(v.multiple * 1000) / 1000 }))
    .sort((a, b) => b.peers - a.peers);
  return {
    board: rows,
    radar: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      scanned: snapshot.protocols.length,
      tokenized: snapshot.protocols.length - preToken.length,
      global_multiple: Math.round(multiples.global * 1000) / 1000,
      category_multiples: categoryList,
      rows,
      peers,
    },
  };
}

/** A board the gate refuses, named in one line; null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const [i, row] of board.entries()) {
    if (row.rank !== i + 1) return `row ${i} carries rank ${row.rank}`;
    if (!slugs.has(row.slug)) return `row ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${row.slug} appears twice`;
    seen.add(row.slug);
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) return `implied value rises at rank ${row.rank}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `a farm step of ${row.slug} is ${len} characters`;
    }
  }
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist protocol ${slug} is missing`;
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
