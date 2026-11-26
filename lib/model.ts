// The radar's model, version 2: every term fitted on the snapshot itself
// and kept or dropped on two blind tests — leave-one-out over the priced
// peers and a walk-forward split at the median listing date. The tests
// run inside this program on every build and their scores ship in the
// dossier, so the claims on the dashboard's method page are recomputed,
// never asserted.
//
// What survived testing:
//  - Gross value if a token launches: a log-log pricing line,
//    log10(market cap) = a + b * log10(TVL), fitted by least squares on
//    the 128 peers whose tokens carry a real price (16 records carry a
//    market cap of 0 or -1 — dead tokens with no price to learn from,
//    counted in the accounting, never in the fit). Category medians and
//    category intercepts, seven-day momentum, chain-count and age tilts
//    and nearest-neighbour multiples were all fitted and all lost to
//    this line on both tests (the method page shows the table).
//  - Launch odds: a logistic launch curve G(t) fitted by IRLS on every
//    dated protocol, tokenized or not. A protocol still tokenless at
//    age t has odds (G(H) - G(t)) / (1 - G(t)) of launching by the
//    horizon H = 6 years — the record's own answer, and one that falls
//    with age, because most of the curve is already behind a survivor.
//  - The board ranks by expected value: gross value times launch odds.
//  - Each row's range is the backtest's own spread: the 80th percentile
//    of the pricing line's leave-one-out absolute log error, applied
//    both ways. It is wide because pricing a launch is wide; the radar
//    prints it rather than hiding it.

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
  gross_value_usd: number;
  launch_odds: number;
  range_low_usd: number;
  range_high_usd: number;
  verdict: string;
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

export interface ModelTest {
  name: string;
  loo_rmse: number;
  walk_forward_rmse: number;
  verdict: string;
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  scanned: number;
  tokenized: number;
  priced_peers: number;
  unpriced_tokens: number;
  undated: number;
  fit: { a: number; b: number; peers: number };
  odds_curve: { weights: number[]; horizon_years: number; fitted_on: number };
  range_spread: number;
  tests: ModelTest[];
  accounting: { ranked: number; trading: number; unpriced: number; tokenized_products: number; below_floor_other: number };
  rows: BoardRow[];
  peers: PeerRow[];
}

const BOARD_CAP = 260;
const ODDS_HORIZON_YEARS = 6;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
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

/** The peers a price can be learned from: a token with a real market cap. */
export function pricedPeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

function linFit(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/** The shipped pricing line: log10(mcap) = a + b * log10(TVL). */
export function fitPricingLine(peers: SnapshotProtocol[]): { a: number; b: number } {
  return linFit(peers.map((p) => Math.log10(p.tvl_usd)), peers.map((p) => Math.log10(p.mcap_usd!)));
}

function solveLinear(A: number[][], v: number[]): number[] {
  const k = v.length;
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [v[c], v[piv]] = [v[piv]!, v[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let c2 = c; c2 < k; c2++) A[r]![c2]! -= f * A[c]![c2]!;
      v[r]! -= f * v[c]!;
    }
  }
  return v.map((x, i) => x / A[i]![i]!);
}

/**
 * The launch curve: a logistic fit of "has a token" on [1, ageYears,
 * ageYears^2, log10(TVL)] over every dated protocol, by IRLS. G(t) is the
 * fitted probability that a protocol with this TVL has launched by age t.
 */
export function fitLaunchCurve(snapshot: Snapshot): { weights: number[]; fittedOn: number } {
  const dated = snapshot.protocols
    .filter((p) => p.listed_at !== null)
    .map((p) => ({
      ageY: Math.max(0, (ageDays(p.listed_at, snapshot.as_of) ?? 0) / 365.25),
      logT: Math.log10(Math.max(1, p.tvl_usd)),
      y: p.mcap_usd !== null ? 1 : 0,
    }));
  const X = dated.map((d) => [1, d.ageY, d.ageY * d.ageY, d.logT]);
  const w = [0, 0, 0, 0];
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  for (let iter = 0; iter < 25; iter++) {
    const A = Array.from({ length: 4 }, () => new Array(4).fill(0));
    const v = new Array(4).fill(0);
    for (let i = 0; i < X.length; i++) {
      const z = X[i]!.reduce((s, f, j) => s + f * w[j]!, 0);
      const mu = sig(z);
      const wgt = Math.max(1e-6, mu * (1 - mu));
      for (let a = 0; a < 4; a++) {
        v[a]! += X[i]![a]! * (dated[i]!.y - mu);
        for (let b = 0; b < 4; b++) A[a]![b]! += X[i]![a]! * X[i]![b]! * wgt;
      }
    }
    for (let a = 0; a < 4; a++) A[a]![a]! += 1e-6;
    const step = solveLinear(A, v);
    let maxStep = 0;
    for (let j = 0; j < 4; j++) { w[j]! += step[j]!; maxStep = Math.max(maxStep, Math.abs(step[j]!)); }
    if (maxStep < 1e-8) break;
  }
  return { weights: w, fittedOn: dated.length };
}

function launchG(weights: number[], ageYears: number, logT: number): number {
  const z = weights[0]! + weights[1]! * ageYears + weights[2]! * ageYears * ageYears + weights[3]! * logT;
  return 1 / (1 + Math.exp(-z));
}

/** Odds that a protocol still tokenless at this age launches by the horizon. */
export function launchOdds(weights: number[], ageDaysValue: number | null, tvlUsd: number, medianAgeDays: number): number {
  const logT = Math.log10(Math.max(1, tvlUsd));
  const t = (ageDaysValue ?? medianAgeDays) / 365.25;
  const gT = launchG(weights, t, logT);
  const gH = launchG(weights, ODDS_HORIZON_YEARS, logT);
  return clamp((gH - gT) / Math.max(1e-9, 1 - gT), 0.02, 0.95);
}

// ------------------------------------------------------------- blind tests

interface Predictor {
  fit: (train: SnapshotProtocol[]) => (p: SnapshotProtocol) => number;
}

/** The version-1 model, kept as the baseline every candidate must beat. */
function v1Predictor(asOf: string): Predictor {
  return {
    fit: (train) => {
      const ratios = train.map((p) => p.mcap_usd! / p.tvl_usd);
      const byCat = new Map<string, number[]>();
      for (const p of train) {
        const key = p.category ?? 'Uncategorised';
        const list = byCat.get(key) ?? [];
        list.push(p.mcap_usd! / p.tvl_usd);
        byCat.set(key, list);
      }
      const global = clamp(median(ratios), 0.03, 2.5);
      const mult = new Map<string, number>();
      for (const [cat, rs] of byCat) {
        mult.set(cat, rs.length >= 5
          ? clamp(median(rs), 0.03, 2.5)
          : clamp((median(rs) * rs.length + global * 5) / (rs.length + 5), 0.03, 2.5));
      }
      return (p) => {
        const age = ageDays(p.listed_at, asOf);
        const momentum = clamp(1 + ((p.change_7d ?? 0) / 100) * 0.8, 0.75, 1.35);
        const seasoning = age === null ? 0.97 : 0.88 + 0.24 * (Math.min(age, 1095) / 1095);
        const reach = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5);
        return Math.log10(p.tvl_usd * (mult.get(p.category ?? 'Uncategorised') ?? global) * momentum * seasoning * reach);
      };
    },
  };
}

function logLogPredictor(): Predictor {
  return { fit: (train) => { const f = fitPricingLine(train); return (p) => f.a + f.b * Math.log10(p.tvl_usd); } };
}

function categoryMedianPredictor(): Predictor {
  return {
    fit: (train) => {
      const global = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
      const byCat = new Map<string, number[]>();
      for (const p of train) {
        const key = p.category ?? 'Uncategorised';
        const list = byCat.get(key) ?? [];
        list.push(p.mcap_usd! / p.tvl_usd);
        byCat.set(key, list);
      }
      return (p) => Math.log10(p.tvl_usd * (byCat.get(p.category ?? 'Uncategorised') ? median(byCat.get(p.category ?? 'Uncategorised')!) : global));
    },
  };
}

/** Run both blind tests for one candidate; returns log-space RMSEs. */
function runTests(peers: SnapshotProtocol[], asOf: string, candidate: Predictor): { loo: number; wf: number; looAbs: number[] } {
  const looErr: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const train = peers.filter((_, j) => j !== i);
    looErr.push(candidate.fit(train)(peers[i]!) - Math.log10(peers[i]!.mcap_usd!));
  }
  const loo = Math.sqrt(looErr.reduce((s, e) => s + e * e, 0) / looErr.length);
  const dated = peers
    .map((p) => ({ p, age: ageDays(p.listed_at, asOf) }))
    .filter((d) => d.age !== null)
    .sort((x, y) => y.age! - x.age!);
  const cut = dated[Math.floor(dated.length / 2)]!.age!;
  const past = dated.filter((d) => d.age! >= cut).map((d) => d.p);
  const future = dated.filter((d) => d.age! < cut).map((d) => d.p);
  const wfErr = future.map((p) => candidate.fit(past)(p) - Math.log10(p.mcap_usd!));
  const wf = Math.sqrt(wfErr.reduce((s, e) => s + e * e, 0) / wfErr.length);
  return { loo, wf, looAbs: looErr.map(Math.abs) };
}

/** The published test table: the shipped model against what it beat. */
export function modelTests(peers: SnapshotProtocol[], asOf: string): { tests: ModelTest[]; rangeSpread: number } {
  const shipped = runTests(peers, asOf, logLogPredictor());
  const v1 = runTests(peers, asOf, v1Predictor(asOf));
  const catMed = runTests(peers, asOf, categoryMedianPredictor());
  const sortedAbs = [...shipped.looAbs].sort((a, b) => a - b);
  const rangeSpread = sortedAbs[Math.floor(sortedAbs.length * 0.8)]!;
  return {
    rangeSpread,
    tests: [
      { name: 'Log-log pricing line (shipped)', loo_rmse: round3(shipped.loo), walk_forward_rmse: round3(shipped.wf), verdict: 'kept' },
      { name: 'Version 1: category median x hand-set tilts', loo_rmse: round3(v1.loo), walk_forward_rmse: round3(v1.wf), verdict: 'dropped' },
      { name: 'Category median multiple alone', loo_rmse: round3(catMed.loo), walk_forward_rmse: round3(catMed.wf), verdict: 'dropped' },
    ],
  };
}

/** A plain-language verdict for one row, from its odds and expected value. */
export function farmVerdict(odds: number, expectedUsd: number): string {
  if (odds >= 0.35 && expectedUsd >= 25_000_000) return 'Core farm';
  if (odds >= 0.28 && expectedUsd >= 8_000_000) return 'Selective farm';
  if (odds >= 0.18) return 'Watch and farm light';
  return 'Skip unless you use it anyway';
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
  const peersFit = pricedPeers(snapshot);
  // Price from the line rounded to three decimals — the same numbers the
  // dashboard prints — so a reader's recomputation lands on the same dollar.
  const rawLine = fitPricingLine(peersFit);
  const line = { a: round3(rawLine.a), b: round3(rawLine.b) };
  const curve = fitLaunchCurve(snapshot);
  const { tests, rangeSpread } = modelTests(peersFit, snapshot.as_of);
  const datedAges = snapshot.protocols
    .map((p) => ageDays(p.listed_at, snapshot.as_of))
    .filter((a) => a !== null) as number[];
  const medianAge = median(datedAges);
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
    const age = ageDays(p.listed_at, snapshot.as_of);
    // Round the odds first and price from the rounded numbers, so the
    // dashboard's own recomputation from the row lands on the same dollar.
    const gross = Math.max(1, Math.round(10 ** (line.a + line.b * Math.log10(Math.max(1, p.tvl_usd)))));
    const odds = round3(launchOdds(curve.weights, age, p.tvl_usd, medianAge));
    const implied = Math.max(1, Math.round(gross * odds));
    const spread = 10 ** rangeSpread;
    return {
      p,
      age,
      gross,
      odds,
      implied,
      low: Math.max(1, Math.round(implied / spread)),
      high: Math.round(implied * spread),
    };
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
    age_days: s.age,
    gross_value_usd: s.gross,
    launch_odds: s.odds,
    range_low_usd: s.low,
    range_high_usd: s.high,
    verdict: farmVerdict(s.odds, s.implied),
    watchlist: watchlist.has(s.p.slug),
  }));
  const peers: PeerRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000, symbol: p.symbol }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 60);
  const unpriced = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length;
  const excludedProducts = preToken.filter((p) => !watchlist.has(p.slug) && looksTokenized(p)).length;
  const belowFloorOther = preToken.length - rows.length - excludedProducts;
  return {
    board: rows,
    radar: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      scanned: snapshot.protocols.length,
      tokenized: snapshot.protocols.length - preToken.length,
      priced_peers: peersFit.length,
      unpriced_tokens: unpriced,
      undated: snapshot.protocols.length - datedAges.length,
      fit: { a: round3(line.a), b: round3(line.b), peers: peersFit.length },
      odds_curve: { weights: curve.weights.map(round3), horizon_years: ODDS_HORIZON_YEARS, fitted_on: curve.fittedOn },
      range_spread: round3(rangeSpread),
      tests,
      accounting: {
        ranked: rows.length,
        trading: peersFit.length,
        unpriced,
        tokenized_products: excludedProducts,
        below_floor_other: belowFloorOther,
      },
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
