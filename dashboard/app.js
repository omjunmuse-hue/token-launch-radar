// Token Launch Radar: renders window.RADAR (written by main.ts beside this
// folder) as a sortable, filterable board with a per-protocol detail view,
// the tokenized peer set the multiples came from, and the method. No
// network, no framework: every number on the page is in data.js, and the
// detail view recomputes the implied value from the row's own factors.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('app');
  var state = { tab: 'board', q: '', category: 'all', chain: 'all', watch: false, sort: 'rank', dir: 1, slug: null };

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
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

  var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;
  var categories = [], chains = [], seenC = {}, seenH = {};
  D.rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    if (!seenC[c]) { seenC[c] = 1; categories.push(c); }
    r.chains.forEach(function (h) { if (!seenH[h]) { seenH[h] = 1; chains.push(h); } });
  });
  categories.sort(); chains.sort();

  function header() {
    return '<header class="top"><div><p class="eyebrow">Token Launch Radar · snapshot ' + esc(D.as_of) + '</p>' +
      '<h1>Pre-token protocols, <span class="thin">priced.</span></h1>' +
      '<p class="sub">Every protocol in the snapshot that records no token, ranked by the value its token would carry if priced like its own category\'s trading peers: TVL times the category\'s median market-cap/TVL multiple, adjusted for seven-day momentum, years live without a token, and chains reached. Click any row for the full breakdown and its farm plan.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + D.scanned + '</b><span>protocols scanned</span></div>' +
      '<div class="stat"><b>' + D.rows.length + '</b><span>pre-token ranked</span></div>' +
      '<div class="stat"><b>' + D.rows.filter(function (r) { return r.watchlist; }).length + ' / 40</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + D.global_multiple.toFixed(2) + 'x</b><span>market median mcap/TVL</span></div>' +
      '</div></header>';
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
      '<label class="check"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + D.rows.length + ' shown</span></div>';
    if (!rows.length) return html + '<div class="empty">No protocol matches that filter. Loosen it: the radar only ranks protocols that record no token.</div>';
    function th(key, label, cls) { var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : ''; return '<th data-sort="' + key + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + label + arrow + '</th>'; }
    html += '<table><thead><tr>' + th('rank', '#') + th('name', 'Protocol') + th('category', 'Category') + '<th>Chains</th>' + th('tvl_usd', 'TVL', 'n') + th('change_7d', '7d', 'n') + th('multiple', 'Peer multiple', 'n') + th('implied_value_usd', 'Implied value', 'n') + '<th>Share of #1</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="cat">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="n">' + usd(r.tvl_usd) + '</td>' +
        '<td class="n ' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="n">' + r.multiple.toFixed(2) + 'x</td>' +
        '<td class="n"><b>' + usd(r.implied_value_usd) + '</b></td>' +
        '<td><div class="bar"><i style="width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied)) + '%"></i></div></td></tr>';
    });
    return html + '</tbody></table>';
  }

  function detailView(r) {
    var check = Math.round(r.tvl_usd * r.multiple * r.momentum * r.seasoning * r.reach);
    var html = '<button class="back" id="back">← Back to the board</button><section class="detail">' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<p class="meta">Rank #' + r.rank + ' of ' + D.rows.length + ' · ' + esc(r.category || 'Uncategorised') + ' · live on ' + esc(r.chains.join(', ')) + ' · tracked since ' + esc(r.listed_at || 'unknown') + ' (' + age(r.age_days) + ' with no token recorded)</p>' +
      '<div class="factors">' +
      '<div class="factor"><span>TVL</span><b>' + usd(r.tvl_usd) + '</b><p>The protocol\'s own size in the snapshot.</p></div>' +
      '<div class="factor"><span>Category multiple</span><b>' + r.multiple.toFixed(2) + 'x</b><p>Median mcap/TVL of its trading peers.</p></div>' +
      '<div class="factor"><span>Momentum</span><b>' + r.momentum.toFixed(2) + 'x</b><p>From ' + pct(r.change_7d) + ' TVL over seven days.</p></div>' +
      '<div class="factor"><span>Seasoning</span><b>' + r.seasoning.toFixed(2) + 'x</b><p>' + age(r.age_days) + ' live with no token.</p></div>' +
      '<div class="factor"><span>Reach</span><b>' + r.reach.toFixed(2) + 'x</b><p>' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' deployed.</p></div>' +
      '<div class="factor"><span>Implied value</span><b>' + usd(r.implied_value_usd) + '</b><p>Recomputed here: ' + usd(check) + '.</p></div>' +
      '</div>' +
      '<p class="eq">Implied value = <b>' + usd(r.tvl_usd) + '</b> TVL × <b>' + r.multiple.toFixed(2) + '</b> peer multiple × <b>' + r.momentum.toFixed(2) + '</b> momentum × <b>' + r.seasoning.toFixed(2) + '</b> seasoning × <b>' + r.reach.toFixed(2) + '</b> reach. It is a claim about price if a token existed today, not a prediction that one will.</p>' +
      '<h3>Farm plan: what to do before a token exists</h3><ol class="plan">';
    r.farm_steps.forEach(function (s) { html += '<li>' + esc(s) + '</li>'; });
    return html + '</ol></section>';
  }

  function peersView() {
    var html = '<p class="sub" style="margin-bottom:12px">These protocols already have a token. The radar never ranks them; it learns from them. Each category\'s multiple is the median of its peers\' market cap over TVL, computed from this same snapshot.</p>';
    html += '<table><thead><tr><th>Protocol</th><th>Category</th><th>Token</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Mcap / TVL</th></tr></thead><tbody>';
    D.peers.forEach(function (p) {
      html += '<tr><td><span class="pname">' + esc(p.name) + '</span></td><td class="cat">' + esc(p.category || 'Uncategorised') + '</td><td class="cat">' + esc(p.symbol || '-') + '</td><td class="n">' + usd(p.tvl_usd) + '</td><td class="n">' + usd(p.mcap_usd) + '</td><td class="n">' + p.ratio.toFixed(2) + 'x</td></tr>';
    });
    return html + '</tbody></table>';
  }

  function methodView() {
    var html = '<section class="method"><h3>The model, in the open</h3>' +
      '<p>The snapshot (DefiLlama, ' + esc(D.as_of) + ') carries ' + D.scanned + ' protocols at $5M TVL or more. ' + D.tokenized + ' record a token; the other ' + (D.scanned - D.tokenized) + ' are the radar\'s subject. Nothing outside the snapshot is consulted: no prices, no news, no list of names.</p>' +
      '<p><code>implied = TVL × category multiple × momentum × seasoning × reach</code></p>' +
      '<ul><li><b>Category multiple</b>: for each category, the median market-cap/TVL of its protocols whose token already trades (thin categories shrink toward the market median of ' + D.global_multiple.toFixed(2) + 'x). A lending dollar and a DEX dollar are not worth the same as tokens, and the snapshot itself says by how much.</li>' +
      '<li><b>Momentum</b>: 1 + 0.8 × the seven-day TVL change, clamped between 0.75x and 1.35x. Growing protocols price richer; shrinking ones are marked down, never to zero.</li>' +
      '<li><b>Seasoning</b>: 0.88x rising to 1.12x over three years tracked with no token. A protocol that has run for years without issuing has both proved demand and saved its launch.</li>' +
      '<li><b>Reach</b>: +4% per extra chain, up to five. Distribution is part of what a token would price.</li></ul>' +
      '<p>The board holds every watchlist protocol (TVL at or above ' + usd(D.floor_usd) + ', no token recorded, not a wrapped or staked product of a tokenized parent) plus the early radar: pre-token protocols below that floor that are not visibly a tokenized protocol\'s product (no versioned names, no wrapped or staked products, no exchange house brands, no sibling entry carrying a token). Above the floor the watchlist is the whole board, because the house built it with a parent record this snapshot does not carry; below it is where a radar earns its keep.</p>' +
      '<h3>Category multiples from the snapshot\'s peers</h3><table><thead><tr><th>Category</th><th class="n">Trading peers</th><th class="n">Median mcap/TVL</th></tr></thead><tbody>';
    D.category_multiples.forEach(function (c) { html += '<tr><td>' + esc(c.category) + '</td><td class="n">' + c.peers + '</td><td class="n">' + c.multiple.toFixed(2) + 'x</td></tr>'; });
    return html + '</tbody></table></section>';
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
