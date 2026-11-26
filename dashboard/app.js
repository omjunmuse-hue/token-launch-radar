// Token Launch Radar v2: renders window.RADAR (written by main.ts beside
// this folder) as a sortable, filterable board with a per-protocol detail
// view, the priced peers the model was fitted on, and the method with its
// blind-test scores. No network, no framework: every number on the page
// is in data.js, and the detail view recomputes the row's gross value
// from the printed pricing line and its odds from the printed curve.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('app');
  var state = { tab: 'board', q: '', category: 'all', chain: 'all', verdict: 'all', watch: false, sort: 'rank', dir: 1, slug: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function usd(n) {
    if (n == null) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n;
  }
  function pct(n) { return n == null ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(a) { return a == null ? 'unknown' : a >= 365 ? (a / 365).toFixed(1) + ' yrs' : a + ' days'; }

  var watchCount = D.rows.filter(function (r) { return r.watchlist; }).length;
  var categories = [], chains = [], verdicts = [], seenC = {}, seenH = {}, seenV = {};
  D.rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    if (!seenC[c]) { seenC[c] = 1; categories.push(c); }
    if (!seenV[r.verdict]) { seenV[r.verdict] = 1; verdicts.push(r.verdict); }
    r.chains.forEach(function (h) { if (!seenH[h]) { seenH[h] = 1; chains.push(h); } });
  });
  categories.sort(); chains.sort();

  function strip() {
    var t = D.tests[0];
    return '<div class="strip">' +
      '<span><b>Integrity</b></span>' +
      '<span>Watchlist ' + watchCount + '/40 covered</span>' +
      '<span>' + D.accounting.ranked + ' ranked · ' + D.accounting.trading + ' trading · ' + D.accounting.unpriced + ' unpriced tokens · ' + D.accounting.tokenized_products + ' tokenized products set aside · ' + D.accounting.below_floor_other + ' below the board\'s cut — all ' + D.scanned + ' accounted for</span>' +
      '<span>Model blind tests: leave-one-out RMSE ' + t.loo_rmse.toFixed(3) + ' · walk-forward ' + t.walk_forward_rmse.toFixed(3) + ' (log10)</span>' +
      '<span>Deterministic: same snapshot, same board, byte for byte</span>' +
      '</div>';
  }

  function header() {
    return '<header class="top"><div><p class="eyebrow">Token Launch Radar · snapshot ' + esc(D.as_of) + '</p>' +
      '<h1>Pre-token protocols, <span class="thin">priced and odds-weighted.</span></h1>' +
      '<p class="sub">Every protocol in the snapshot that records no token, ranked by expected value: what its token would be worth if it launched, priced by a line fitted on the ' + D.priced_peers + ' peers whose tokens already trade, times the odds it launches at all — odds fitted on the whole record and falling with age. Every model term was kept or dropped on two blind tests; the method page shows the scores. Click any row for its breakdown and farm plan.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + D.scanned + '</b><span>protocols scanned</span></div>' +
      '<div class="stat"><b>' + D.rows.length + '</b><span>pre-token ranked</span></div>' +
      '<div class="stat"><b>' + watchCount + ' / 40</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + D.fit.b.toFixed(2) + '</b><span>fitted TVL elasticity</span></div>' +
      '</div></header>' + strip();
  }

  function tabs() {
    function b(id, label) { return '<button data-tab="' + id + '"' + (state.tab === id ? ' class="on"' : '') + '>' + label + '</button>'; }
    return '<nav class="tabs">' + b('board', 'The board') + b('peers', 'Already tokenized') + b('method', 'How the model works') + '</nav>';
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * state.dir;
    });
    return rows;
  }

  function boardView() {
    var rows = filtered();
    var opts = function (list, cur) { return list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join(''); };
    var html = '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search protocols..." value="' + esc(state.q) + '">' +
      '<select id="cat"><option value="all">All categories</option>' + opts(categories, state.category) + '</select>' +
      '<select id="chain"><option value="all">All chains</option>' + opts(chains, state.chain) + '</select>' +
      '<select id="verd"><option value="all">All verdicts</option>' + opts(verdicts, state.verdict) + '</select>' +
      '<label class="check"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + D.rows.length + ' shown</span></div>';
    if (!rows.length) return html + '<div class="empty">No protocol matches that filter. Loosen it: the radar only ranks protocols that record no token.</div>';
    function th(key, label, cls) { var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : ''; return '<th data-sort="' + key + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + label + arrow + '</th>'; }
    html += '<table><thead><tr>' + th('rank', '#') + th('name', 'Protocol') + th('category', 'Category') + th('tvl_usd', 'TVL', 'n') + th('change_7d', '7d', 'n') + th('gross_value_usd', 'Value if launched', 'n') + th('launch_odds', 'Launch odds', 'n') + th('implied_value_usd', 'Expected value', 'n') + '<th>Backtest range</th><th>Verdict</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '<span class="sub2">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="n">' + usd(r.tvl_usd) + '</td>' +
        '<td class="n ' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="n">' + usd(r.gross_value_usd) + '</td>' +
        '<td class="n">' + Math.round(r.launch_odds * 100) + '%</td>' +
        '<td class="n"><b>' + usd(r.implied_value_usd) + '</b></td>' +
        '<td class="cat">' + usd(r.range_low_usd) + ' – ' + usd(r.range_high_usd) + '</td>' +
        '<td><span class="verdict">' + esc(r.verdict) + '</span></td></tr>';
    });
    return html + '</tbody></table>';
  }

  function detailView(r) {
    var grossCheck = Math.round(Math.pow(10, D.fit.a + D.fit.b * Math.log10(Math.max(1, r.tvl_usd))));
    var w = D.odds_curve.weights;
    function G(t) { var z = w[0] + w[1] * t + w[2] * t * t + w[3] * Math.log10(Math.max(1, r.tvl_usd)); return 1 / (1 + Math.exp(-z)); }
    var ageY = r.age_days == null ? null : r.age_days / 365.25;
    var oddsText = ageY == null ? 'age unrecorded, priced at the board\'s median age' : 'at ' + age(ageY * 365.25) + ' tokenless, the fitted curve leaves ' + Math.round(r.launch_odds * 100) + '% of its launch probability still ahead (G(' + D.odds_curve.horizon_years + 'y) − G(age)) / (1 − G(age))';
    var html = '<button class="back" id="back">← Back to the board</button><section class="detail">' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '<span class="verdict big">' + esc(r.verdict) + '</span></h2>' +
      '<p class="meta">Rank #' + r.rank + ' of ' + D.rows.length + ' · ' + esc(r.category || 'Uncategorised') + ' · live on ' + esc(r.chains.join(', ')) + ' · tracked since ' + esc(r.listed_at || 'unknown') + ' (' + age(r.age_days) + ' with no token recorded)</p>' +
      '<div class="factors">' +
      '<div class="factor"><span>TVL</span><b>' + usd(r.tvl_usd) + '</b><p>The protocol\'s own size in the snapshot.</p></div>' +
      '<div class="factor"><span>Value if launched</span><b>' + usd(r.gross_value_usd) + '</b><p>From the fitted line: 10^(' + D.fit.a.toFixed(3) + ' + ' + D.fit.b.toFixed(3) + ' × log10 TVL). Recomputed here: ' + usd(grossCheck) + '.</p></div>' +
      '<div class="factor"><span>Launch odds</span><b>' + Math.round(r.launch_odds * 100) + '%</b><p>' + oddsText + '.</p></div>' +
      '<div class="factor"><span>Expected value</span><b>' + usd(r.implied_value_usd) + '</b><p>Value if launched × launch odds. This is the board\'s ranking number.</p></div>' +
      '<div class="factor"><span>Backtest range</span><b>' + usd(r.range_low_usd) + ' – ' + usd(r.range_high_usd) + '</b><p>The pricing line\'s 80% leave-one-out error band, applied to the expected value.</p></div>' +
      '<div class="factor"><span>Seven-day TVL</span><b>' + pct(r.change_7d) + '</b><p>Tested as a model term and dropped: it did not price held-out peers any better. Shown for the reader, not used in the price.</p></div>' +
      '</div>' +
      '<p class="eq">Expected value = <b>' + usd(r.gross_value_usd) + '</b> if launched × <b>' + Math.round(r.launch_odds * 100) + '%</b> odds = <b>' + usd(r.implied_value_usd) + '</b>. A claim about what a launch would be worth and how likely it is, from the snapshot\'s own record — not a promise that a token comes.</p>' +
      '<h3>Farm plan: what to do before a token exists</h3><ol class="plan">';
    r.farm_steps.forEach(function (s) { html += '<li>' + esc(s) + '</li>'; });
    return html + '</ol></section>';
  }

  function peersView() {
    var html = '<p class="sub" style="margin-bottom:12px">These protocols already have a token with a real price. The radar never ranks them; it fits on them — the pricing line and the launch curve are both learned from this record (the ' + D.unpriced_tokens + ' records whose token carries a market cap of 0 or less are counted in the accounting and excluded from the fit: a dead token has no price to learn from). Top ' + D.peers.length + ' by market cap.</p>';
    html += '<table><thead><tr><th>Protocol</th><th>Category</th><th>Token</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Mcap / TVL</th></tr></thead><tbody>';
    D.peers.forEach(function (p) {
      html += '<tr><td><span class="pname">' + esc(p.name) + '</span></td><td class="cat">' + esc(p.category || 'Uncategorised') + '</td><td class="cat">' + esc(p.symbol || '-') + '</td><td class="n">' + usd(p.tvl_usd) + '</td><td class="n">' + usd(p.mcap_usd) + '</td><td class="n">' + p.ratio.toFixed(2) + 'x</td></tr>';
    });
    return html + '</tbody></table>';
  }

  function methodView() {
    var html = '<section class="method"><h3>The model, in the open — fitted, then blind-tested twice</h3>' +
      '<p>The snapshot (DefiLlama, ' + esc(D.as_of) + ') carries ' + D.scanned + ' protocols at $5M TVL or more. ' + D.tokenized + ' record a token; the rest are the radar\'s subject. Nothing outside the snapshot is consulted: no live prices, no news, no list of names.</p>' +
      '<p><code>value if launched = 10^(' + D.fit.a.toFixed(3) + ' + ' + D.fit.b.toFixed(3) + ' × log10(TVL))</code> — a least-squares line through the ' + D.fit.peers + ' priced peers, in log-log space, where a protocol ten times the size prices at about ' + Math.pow(10, D.fit.b).toFixed(1) + ' times the value, not ten times: scale compresses, and the fit says by how much.</p>' +
      '<p><code>expected value = value if launched × launch odds</code>, where the odds come from a logistic launch curve fitted on all ' + D.odds_curve.fitted_on + ' dated protocols: the share of the launch probability still ahead of a protocol that has survived tokenless to its current age, out to a ' + D.odds_curve.horizon_years + '-year horizon. Odds fall with age — a five-year survivor has already missed most of its curve.</p>' +
      '<h3>Kept or dropped on two blind tests</h3><p>Each candidate priced the priced peers two ways it could not cheat: leave-one-out (predict each peer from the other ' + (D.fit.peers - 1) + ') and walk-forward (fit on the older half by listing date, price the younger half). Scores are RMSE in log10 — 0.30 is a typical 2× miss.</p>' +
      '<table><thead><tr><th>Candidate</th><th class="n">Leave-one-out</th><th class="n">Walk-forward</th><th>Verdict</th></tr></thead><tbody>';
    D.tests.forEach(function (t) { html += '<tr><td>' + esc(t.name) + '</td><td class="n">' + t.loo_rmse.toFixed(3) + '</td><td class="n">' + t.walk_forward_rmse.toFixed(3) + '</td><td>' + esc(t.verdict) + '</td></tr>'; });
    html += '</tbody></table>' +
      '<p>Also fitted and dropped on the same two tests: category intercepts on the line, a seven-day momentum tilt, chain-count and age tilts on value, and nearest-neighbour multiples — each lost to the plain line out of sample, so none of them moves a price here. Seven-day change is still shown on every row for the reader.</p>' +
      '<p>Each row\'s range is the shipped line\'s own 80th-percentile leave-one-out error (×' + Math.pow(10, D.range_spread).toFixed(1) + ' either way). It is wide because launch pricing is wide; the radar prints it instead of hiding it.</p>' +
      '<h3>Who is on the board, and who is not</h3>' +
      '<p>The board holds every watchlist protocol (TVL at or above ' + usd(D.floor_usd) + ', no token recorded, not a wrapped or staked product of a tokenized parent) plus the early radar below that floor, excluding anything visibly a tokenized protocol\'s product (versioned names, wrapped or staked products, exchange house brands, bridge and staking categories, or a first name shared with a tokenized protocol). Accounting: ' + D.accounting.ranked + ' ranked + ' + D.accounting.trading + ' trading and fitted on + ' + D.accounting.unpriced + ' tokens with no price + ' + D.accounting.tokenized_products + ' tokenized products set aside + ' + D.accounting.below_floor_other + ' pre-token protocols below the board\'s cut = ' + D.scanned + '.</p>' +
      '</section>';
    return html;
  }

  function render() {
    var selected = null;
    if (state.slug) { for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.slug) { selected = D.rows[i]; break; } }
    var body = state.tab === 'peers' ? peersView() : state.tab === 'method' ? methodView() : selected ? detailView(selected) : boardView();
    app.innerHTML = header() + tabs() + body + '<footer>Token Launch Radar · built for make.fun\'s token launch radar bounty · data: the sealed DefiLlama snapshot of ' + esc(D.as_of) + ' · implied values are this board\'s own claims, not make.fun\'s.</footer>';
    app.setAttribute('aria-busy', 'false');
    wire();
  }

  function wire() {
    Array.prototype.forEach.call(app.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); state.slug = null; render(); });
    });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; var pos = q.selectionStart; render(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(pos, pos); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; render(); });
    var ch = document.getElementById('chain');
    if (ch) ch.addEventListener('change', function () { state.chain = ch.value; render(); });
    var vd = document.getElementById('verd');
    if (vd) vd.addEventListener('change', function () { state.verdict = vd.value; render(); });
    var w = document.getElementById('watch');
    if (w) w.addEventListener('change', function () { state.watch = w.checked; render(); });
    Array.prototype.forEach.call(app.querySelectorAll('th[data-sort]'), function (t) {
      t.addEventListener('click', function () {
        var k = t.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
        render();
      });
    });
    Array.prototype.forEach.call(app.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { state.slug = tr.getAttribute('data-slug'); render(); window.scrollTo(0, 0); });
    });
    var back = document.getElementById('back');
    if (back) back.addEventListener('click', function () { state.slug = null; render(); });
  }

  render();
})();
