// Token Launch Radar: a make.fun token-radar-01 entry (Node 22, stdlib only).
//
// Reads the sealed snapshot (--input <file|dir>, default /input/snapshot.json),
// prices every pre-token protocol with the model in lib/model.ts, writes the
// ranked board to /output/board.json and the dashboard's data to
// /output/data.js, copies dashboard/ and screenshots/ into /output, and
// writes /output/dossier.json with the vendored make.fun library, byte for
// byte as the scorer rebuilds it. Deterministic: same snapshot, same bytes.
//
// Local run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
// Determinism is a claim the dashboard prints, so the program proves it
// on every run: build the radar a second time from the same bytes and
// refuse to hand in anything if the two boards differ by a single byte.
const second = buildRadar(snapshot);
if (JSON.stringify(second.board) !== JSON.stringify(board)) {
  process.stderr.write('token radar: the model is not deterministic: two builds of the same snapshot disagree\n');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3 (board, detail, filtered)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: bad image name\n`);
    process.exit(1);
  }
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const shipped = radar.tests[0]!;
const shippedOdds = radar.odds_tests[0]!;
const droppedOdds = radar.odds_tests[1]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} watchlist, ${board.length} pre-token rows ranked; top: ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')} implied\n` +
  `token radar: pricing line log10(mcap) = ${radar.fit.a} + ${radar.fit.b} * log10(TVL) on ${radar.fit.peers} priced peers; blind tests: leave-one-out RMSE ${shipped.loo_rmse}, walk-forward ${shipped.walk_forward_rmse} (log10)\n` +
  `token radar: launch curve re-selected on time splits both ways: shipped log-loss ${shippedOdds.logloss_forward} forward / ${shippedOdds.logloss_reverse} reverse, against the v2 quadratic curve's ${droppedOdds.logloss_forward} / ${droppedOdds.logloss_reverse}\n`,
);
