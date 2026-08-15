// dsh-token-anxiety client half — hand-written bundle (no bundler, no
// minification). Served as a classic script at /plugins/dsh-token-anxiety/client.js
// and registered through the client module table:
//
//   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
//
// The only externals are react and react-dom (platform seed words); everything
// else is inline. The plugin registers one entry in the conversation.input.dock strip
// and renders the Token Anxiety widget from the 'tokenAnxiety' session
// projection (host fold). Peak/valley status, local time and the hour strip
// are computed in the browser from the projection's pricing config.
//
// Explain: the widget's button fetch()es the bundle's own host route
// (/token-anxiety/explain, registered by the host half on the webserver), so
// click-to-analyze works without the Typert Remote channel and without
// queueing an agent turn. The analysis is held in component state; the waste
// tab keeps its hover details and suggestions.
window.__ModuleLoader__.load({ id: 'dsh-token-anxiety', factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  var React = require('react');
  var ReactDOM = require('react-dom');

  // ---- styles ------------------------------------------------------------
  function insertStyles(css) {
    if (typeof document === 'undefined') return;
    if (document.querySelector('style[data-plugin="dsh-token-anxiety"]') !== null) return;
    var tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-token-anxiety';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  var CSS = [
    '.txg-widget { display:inline-flex; align-items:center; gap:6px; font-size:12px; line-height:1; padding:3px 9px; border-radius:999px; background:rgba(160,160,160,.14); color:inherit; white-space:nowrap; }',
    '.txg-valley { color:#2ea867; }',
    '.txg-peak { color:#e08b2d; }',
    '.txg-muted { opacity:.72; }',
    '.txg-pop { position:absolute; bottom:calc(100% + 8px); left:0; z-index:60; width:720px; max-width:96vw; height:64vh; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; background:#1b1b1f; color:#eceaf0; border:1px solid rgba(255,255,255,.15); border-radius:10px; padding:14px 16px; font-size:13px; line-height:1.55; box-shadow:0 10px 30px rgba(0,0,0,.5); text-align:left; }',
    '.txg-tabbody { flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; }',
    '.txg-tasks { display:flex; flex-direction:column; height:100%; }',
    '.txg-tbl { display:flex; flex-direction:column; flex:1; min-height:0; margin-top:6px; }',
    '.txg-tbl-head { display:flex; gap:8px; align-items:center; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.12); font-size:12px; text-transform:uppercase; letter-spacing:.08em; opacity:.7; }',
    '.txg-th { width:44px; flex:none; cursor:pointer; user-select:none; }',
    '.txg-th:hover { opacity:1; color:#e08b2d; }',
    '.txg-th-task { flex:1; min-width:0; }',
    '.txg-tbl-rows { flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; }',
    '.txg-tbl-row { display:flex; gap:8px; align-items:center; }',
    '.txg-cell-num { width:44px; flex:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.txg-cell-pct { width:44px; flex:none; text-align:right; font-variant-numeric:tabular-nums; opacity:.8; }',
    '.txg-th-cost { width:190px; flex:none; }',
    '.txg-cell-cost { width:190px; flex:none; text-align:right; font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.4; }',
    '.txg-cell-graph { flex:1; min-width:0; }',
    '.txg-tip-fixed { position:fixed; top:auto; left:auto; z-index:2147483000; }',
    '.txg-explwrap { margin:4px 0; }',
    '.txg-top { position:sticky; top:-12px; z-index:8; background:#1b1b1f; margin:-12px -14px 0; padding:10px 14px 6px; border-bottom:1px solid rgba(255,255,255,.1); border-radius:10px 10px 0 0; }',
    '.txg-tabs { display:flex; gap:2px; margin-top:6px; }',
    '.txg-tab { flex:1; padding:6px 4px; text-align:center; font-size:12px; font-weight:600; border-radius:6px 6px 0 0; background:transparent; border:none; color:inherit; opacity:.55; cursor:pointer; }',
    '.txg-tab:hover { opacity:.85; background:rgba(255,255,255,.05); }',
    '.txg-tab-on { opacity:1; background:rgba(255,255,255,.09); box-shadow:inset 0 -2px 0 #e08b2d; }',
    '.txg-tab-n { display:inline-block; margin-left:4px; padding:0 5px; border-radius:999px; background:rgba(229,72,77,.35); color:#ffd7d7; font-size:12px; }',
    '.txg-tl { display:flex; gap:2px; margin:5px 0 2px; }',
    '.txg-cell { flex:1 1 0; height:12px; border-radius:2px; background:rgba(255,255,255,.11); cursor:pointer; }',
    '.txg-cell-peak { background:#e08b2d; }',
    '.txg-cell-now { outline:2px solid #eceaf0; }',
    '.txg-cell-sel { box-shadow:inset 0 0 0 2px rgba(236,234,240,.85); }',
    '.txg-cell-sel.txg-cell-peak { box-shadow:inset 0 0 0 2px #fff; background:#e08b2d; }',
    '.txg-lbl { display:flex; justify-content:space-between; font-size:12px; opacity:.55; margin-top:4px; }',
    '.txg-selrow { display:flex; gap:4px; margin-top:4px; flex-wrap:wrap; }',
    '.txg-selbtn { font-size:12px; padding:2px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.22); background:transparent; color:inherit; opacity:.7; cursor:pointer; }',
    '.txg-selbtn-on { opacity:1; background:rgba(224,139,45,.25); border-color:#e08b2d; }',
    '.txg-selbtn-peak { color:#e08b2d; opacity:.85; }',
    '.txg-selbtn-peak.txg-selbtn-on { opacity:1; background:rgba(224,139,45,.25); border-color:#e08b2d; }',
    '.txg-selbtn-valley { color:#2ea867; opacity:.85; }',
    '.txg-selbtn-valley.txg-selbtn-on { opacity:1; background:rgba(46,168,103,.22); border-color:#2ea867; }',
    '.txg-cc { position:relative; display:inline-block; }',
    '.txg-cc-panel { position:absolute; top:calc(100% + 4px); left:0; z-index:75; min-width:290px; max-height:280px; overflow-y:auto; background:#26262c; border:1px solid rgba(255,255,255,.18); border-radius:8px; padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.5); }',
    '.txg-cc-pick { display:flex; align-items:center; gap:6px; flex:1; cursor:pointer; min-width:0; }',
    '.txg-cc-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.txg-cc-pick > span:first-child { flex:none; }',
    '.txg-cc-check { color:#e08b2d; flex:none; }',
    '.txg-cc-addlist .txg-cc-item > span:first-child { flex:none; }',
    '.txg-cc-rate { font-size:12px; opacity:.55; flex:none; max-width:136px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-left:4px; }',
    '.txg-cc-x { border:none; background:transparent; color:inherit; opacity:.5; cursor:pointer; font-size:12px; padding:2px 4px; border-radius:4px; flex:none; }',
    '.txg-cc-x:hover { opacity:1; background:rgba(255,255,255,.15); }',
    '.txg-cc-add { margin-top:4px; padding:5px 8px; border-top:1px solid rgba(255,255,255,.12); font-size:12px; color:#e08b2d; cursor:pointer; }',
    '.txg-cc-addlist { margin-top:4px; border-top:1px solid rgba(255,255,255,.12); padding-top:4px; max-height:170px; overflow-y:auto; }',
    '.txg-cc-search { width:100%; box-sizing:border-box; font-size:12px; padding:4px 6px; border-radius:6px; border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.06); color:inherit; margin-bottom:4px; }',
    '.txg-cc-item { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:5px 10px; border-radius:6px; cursor:pointer; font-size:12px; }',
    '.txg-cc-item:hover { background:rgba(255,255,255,.08); }',
    '.txg-currow { display:flex; align-items:center; gap:6px; margin-top:2px; }',
    '.txg-projchk { display:inline-flex; align-items:center; gap:4px; font-size:12px; opacity:.75; cursor:pointer; margin-left:auto; }',
    '.txg-cur-lbl { opacity:.6; margin-right:2px; }',
    '.txg-sec { margin-top:12px; }',
    '.txg-sec-t { font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; opacity:.55; margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,.08); }',
    '.txg-hero { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; margin-bottom:4px; }',
    '.txg-hero-v { font-size:24px; font-weight:650; letter-spacing:-.01em; font-variant-numeric:tabular-nums; }',
    '.txg-hero-s { font-size:16px; opacity:.85; }',
    '.txg-post { color:#e04848; font-weight:600; }',
    '.txg-stat { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:3px 0; }',
    '.txg-stat-l { font-size:12px; letter-spacing:.05em; text-transform:uppercase; opacity:.5; flex:none; }',
    '.txg-stat-v { font-size:14px; font-variant-numeric:tabular-nums; text-align:right; }',
    '.txg-stat-sub { font-size:12px; opacity:.6; margin-top:1px; text-align:right; }',
    '.txg-note { opacity:.6; font-size:12px; margin:3px 0; }',
    '.txg-note-warn { color:#ffd7d7; }',
    '.txg-bar-row { position:relative; display:flex; gap:8px; align-items:center; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.06); }',
    '.txg-bar-row-waste { background:rgba(229,72,77,.06); }',
    '.txg-barlbl { width:110px; flex:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.txg-bars { flex:1; min-width:0; }',
    '.txg-track { position:relative; height:20px; background:rgba(255,255,255,.07); border-radius:3px; overflow:hidden; }',
    '.txg-fill { position:absolute; top:0; bottom:0; left:0; background:linear-gradient(90deg,#2ea867,#e08b2d); opacity:.85; }',
    '.txg-num { position:absolute; right:4px; top:50%; transform:translateY(-50%); font-size:12px; }',
    '.txg-stack { display:flex; height:6px; margin-top:2px; border-radius:2px; overflow:hidden; }',
    '.txg-sg-miss { background:#e08b2d; }',
    '.txg-sg-hit { background:#2ea867; }',
    '.txg-sg-out { background:#8b7bd8; }',
    '.txg-legend { display:flex; gap:10px; margin-top:5px; font-size:12px; opacity:.7; }',
    '.txg-lg { display:inline-flex; align-items:center; gap:4px; }',
    '.txg-sw { display:inline-block; width:8px; height:8px; border-radius:2px; }',
    '.txg-tip { position:absolute; bottom:calc(100% + 4px); left:0; z-index:70; width:max-content; max-width:440px; background:#26262c; border:1px solid rgba(255,255,255,.18); border-radius:8px; padding:22px 12px 10px; font-size:14px; line-height:1.5; box-shadow:0 8px 24px rgba(0,0,0,.5); }',
    '.txg-tip-x { position:absolute; top:3px; left:3px; z-index:3; width:18px; height:18px; line-height:1; border:none; background:transparent; color:inherit; opacity:.55; cursor:pointer; border-radius:4px; font-size:14px; padding:0; }',
    '.txg-tip-x:hover { opacity:1; background:rgba(255,255,255,.15); }',
    '.txg-tip-t { font-weight:600; margin-bottom:3px; }',
    '.txg-tip-p { margin:3px 0; }',
    '.txg-tip-w { color:#ffb3b3; margin:3px 0; }',
    '.txg-tip-m { opacity:.8; }',
    '.txg-tip-s { margin-top:5px; border-top:1px solid rgba(255,255,255,.12); padding-top:4px; }',
    '.txg-range { border:1px solid rgba(255,255,255,.14); border-radius:8px; padding:6px 10px; margin:4px 0; }',
    '.txg-range-t { font-weight:600; margin-bottom:3px; }',
    '.txg-ft { opacity:.55; font-size:12px; margin-top:8px; border-top:1px solid rgba(255,255,255,.1); padding-top:6px; }',
    '.txg-explbar { display:flex; align-items:center; gap:8px; margin:4px 0; padding:4px 8px; border:1px solid rgba(224,139,45,.45); border-radius:6px; background:rgba(224,139,45,.08); }',
    '.txg-wbtn { font-size:12px; padding:3px 10px; border-radius:6px; border:1px solid rgba(224,139,45,.6); background:transparent; color:inherit; cursor:pointer; }',
    '.txg-wbtn:hover { background:rgba(224,139,45,.2); }',
    '.txg-wbtn:disabled { opacity:.5; cursor:default; }',

    '.txg-explx { background:transparent; border:none; color:inherit; opacity:.6; cursor:pointer; font-size:12px; }',
    '.txg-explhead { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:6px; font-weight:600; }',
    '.txg-expl { max-height:240px; overflow:auto; white-space:pre-wrap; margin-top:2px; padding:6px 8px; border:1px solid rgba(255,255,255,.12); border-radius:6px; background:rgba(255,255,255,.05); font-size:12px; line-height:1.5; }',
    '.txg-expl-label { color:#e08b2d; font-weight:700; }',
    '.txg-expl-line { margin:2px 0; }',
    '.txg-expl-gap { height:4px; }',
    '.txg-expl-err { color:#ffb3b3; border-color:rgba(229,72,77,.4); }',
    '.txg-bar-row-sel { outline:1px solid rgba(224,139,45,.55); border-radius:4px; }',
    '.txg-px { width:100%; border-collapse:collapse; table-layout:fixed; font-size:12.5px; }',
    '.txg-px th, .txg-px td { border:1px solid rgba(255,255,255,.1); padding:5px 7px; text-align:left; vertical-align:top; font-variant-numeric:tabular-nums; }',
    '.txg-px th { background:rgba(255,255,255,.06); font-weight:600; }',
    '.txg-px td { background:rgba(255,255,255,.02); }',
    '.txg-px th:first-child, .txg-px td:first-child { width:16%; }',
    '.txg-px-cur { color:#2ea867; }',
    '.txg-px-proj { color:#e08b2d; }',
    '.txg-px-less { color:#2ea867; }',
    '.txg-px-more { color:#e04848; }',
    // Light mode: the harness resolves the theme onto body[data-ds-dark-theme]
    // (present = dark). When that attribute is absent the page is light, so
    // these overrides swap the dark palette for light equivalents (higher
    // specificity wins; the dark base above stays the default).
    'body:not([data-ds-dark-theme]) .txg-pop { background:#ffffff; color:#1f1f23; border-color:rgba(0,0,0,.14); box-shadow:0 10px 30px rgba(0,0,0,.18); }',
    'body:not([data-ds-dark-theme]) .txg-top { background:#ffffff; border-bottom-color:rgba(0,0,0,.1); }',
    'body:not([data-ds-dark-theme]) .txg-tab:hover { background:rgba(0,0,0,.06); }',
    'body:not([data-ds-dark-theme]) .txg-tab-on { background:rgba(0,0,0,.08); }',
    'body:not([data-ds-dark-theme]) .txg-tab-n { background:rgba(229,72,77,.16); color:#a11c26; }',
    'body:not([data-ds-dark-theme]) .txg-cell { background:rgba(0,0,0,.1); }',
    'body:not([data-ds-dark-theme]) .txg-cell-peak { background:#e08b2d; }',
    'body:not([data-ds-dark-theme]) .txg-cell-now { outline-color:#1f1f23; }',
    'body:not([data-ds-dark-theme]) .txg-cell-sel { box-shadow:inset 0 0 0 2px rgba(0,0,0,.35); }',
    'body:not([data-ds-dark-theme]) .txg-cell-sel.txg-cell-peak { box-shadow:inset 0 0 0 2px #1f1f23; }',
    'body:not([data-ds-dark-theme]) .txg-selbtn { border-color:rgba(0,0,0,.25); }',
    'body:not([data-ds-dark-theme]) .txg-selbtn-on { background:rgba(224,139,45,.18); border-color:#d97c14; }',
    'body:not([data-ds-dark-theme]) .txg-cc-panel { background:#ffffff; border-color:rgba(0,0,0,.16); box-shadow:0 8px 24px rgba(0,0,0,.16); }',
    'body:not([data-ds-dark-theme]) .txg-cc-item:hover { background:rgba(0,0,0,.06); }',
    'body:not([data-ds-dark-theme]) .txg-cc-add { border-top-color:rgba(0,0,0,.12); }',
    'body:not([data-ds-dark-theme]) .txg-cc-addlist { border-top-color:rgba(0,0,0,.12); }',
    'body:not([data-ds-dark-theme]) .txg-cc-search { border-color:rgba(0,0,0,.22); background:rgba(0,0,0,.05); }',
    'body:not([data-ds-dark-theme]) .txg-sec-t { border-bottom-color:rgba(0,0,0,.1); }',
    'body:not([data-ds-dark-theme]) .txg-tbl-head { border-bottom-color:rgba(0,0,0,.12); }',
    'body:not([data-ds-dark-theme]) .txg-bar-row { border-bottom-color:rgba(0,0,0,.08); }',
    'body:not([data-ds-dark-theme]) .txg-bar-row-waste { background:rgba(229,72,77,.08); }',
    'body:not([data-ds-dark-theme]) .txg-track { background:rgba(0,0,0,.08); }',
    'body:not([data-ds-dark-theme]) .txg-tip { background:#ffffff; border-color:rgba(0,0,0,.16); box-shadow:0 8px 24px rgba(0,0,0,.18); }',
    'body:not([data-ds-dark-theme]) .txg-tip-x:hover { background:rgba(0,0,0,.1); }',
    'body:not([data-ds-dark-theme]) .txg-tip-s { border-top-color:rgba(0,0,0,.12); }',
    'body:not([data-ds-dark-theme]) .txg-range { border-color:rgba(0,0,0,.14); }',
    'body:not([data-ds-dark-theme]) .txg-expl { border-color:rgba(0,0,0,.12); background:rgba(0,0,0,.04); }',
    'body:not([data-ds-dark-theme]) .txg-px th { background:rgba(0,0,0,.05); }',
    'body:not([data-ds-dark-theme]) .txg-px td { background:rgba(0,0,0,.02); }',
    'body:not([data-ds-dark-theme]) .txg-px th, body:not([data-ds-dark-theme]) .txg-px td { border-color:rgba(0,0,0,.1); }',
    'body:not([data-ds-dark-theme]) .txg-ft { border-top-color:rgba(0,0,0,.1); }',
  ].join('\n');

  // ---- currencies ------------------------------------------------------------
  // Enabled by default: USD, COP, CNY, EUR, BRL. The chooser can add any
  // catalog currency (flags) and remove enabled ones; the enabled list is
  // persisted host-side via /token-anxiety/currencies. Rates come from the
  // projection's fxRates (fetched daily by the pricing sync, USD base).
  var DEFAULT_CURRENCIES = ['COP', 'USD', 'CNY'];
  // Client-side fallback rates (USD base), used only until the host projection
  // exposes the synced fxRates (after a dsh web restart). Mirrors the host's
  // embedded defaults.
  var DEFAULT_FX_RATES = { USD: 1, COP: 3137.586264, CNY: 7.1, EUR: 0.85, BRL: 5.4 };
  function fmtRate(r) {
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return null;
    if (r >= 100) return String(Math.round(r * 10) / 10);
    if (r >= 1) return String(Math.round(r * 100) / 100);
    return String(Math.round(r * 10000) / 10000);
  }
  var CURRENCY_CATALOG = [
    { code: 'USD', flag: '\ud83c\uddfa\ud83c\uddf8', name: 'US Dollar' },
    { code: 'COP', flag: '\ud83c\udde8\ud83c\uddf4', name: 'Colombian Peso' },
    { code: 'CNY', flag: '\ud83c\udde8\ud83c\uddf3', name: 'Chinese Yuan' },
    { code: 'EUR', flag: '\ud83c\uddea\ud83c\uddfa', name: 'Euro' },
    { code: 'BRL', flag: '\ud83c\udde7\ud83c\uddf7', name: 'Brazilian Real' },
    { code: 'GBP', flag: '\ud83c\uddec\ud83c\udde7', name: 'British Pound' },
    { code: 'JPY', flag: '\ud83c\uddef\ud83c\uddf5', name: 'Japanese Yen' },
    { code: 'KRW', flag: '\ud83c\uddf0\ud83c\uddf7', name: 'South Korean Won' },
    { code: 'MXN', flag: '\ud83c\uddf2\ud83c\uddfd', name: 'Mexican Peso' },
    { code: 'ARS', flag: '\ud83c\udde6\ud83c\uddf7', name: 'Argentine Peso' },
    { code: 'CLP', flag: '\ud83c\udde8\ud83c\uddf1', name: 'Chilean Peso' },
    { code: 'PEN', flag: '\ud83c\uddf5\ud83c\uddea', name: 'Peruvian Sol' },
    { code: 'VES', flag: '\ud83c\uddfb\ud83c\uddea', name: 'Venezuelan Bol\u00edvar' },
    { code: 'CAD', flag: '\ud83c\udde8\ud83c\udde6', name: 'Canadian Dollar' },
    { code: 'AUD', flag: '\ud83c\udde6\ud83c\uddfa', name: 'Australian Dollar' },
    { code: 'CHF', flag: '\ud83c\udde8\ud83c\udded', name: 'Swiss Franc' },
    { code: 'SEK', flag: '\ud83c\uddf8\ud83c\uddea', name: 'Swedish Krona' },
    { code: 'NOK', flag: '\ud83c\uddf3\ud83c\uddf4', name: 'Norwegian Krone' },
    { code: 'DKK', flag: '\ud83c\udde9\ud83c\uddf0', name: 'Danish Krone' },
    { code: 'PLN', flag: '\ud83c\uddf5\ud83c\uddf1', name: 'Polish Zloty' },
    { code: 'CZK', flag: '\ud83c\udde8\ud83c\uddff', name: 'Czech Koruna' },
    { code: 'HUF', flag: '\ud83c\udded\ud83c\uddfa', name: 'Hungarian Forint' },
    { code: 'INR', flag: '\ud83c\uddee\ud83c\uddf3', name: 'Indian Rupee' },
    { code: 'IDR', flag: '\ud83c\uddee\ud83c\udde9', name: 'Indonesian Rupiah' },
    { code: 'THB', flag: '\ud83c\uddf9\ud83c\udded', name: 'Thai Baht' },
    { code: 'SGD', flag: '\ud83c\uddf8\ud83c\uddec', name: 'Singapore Dollar' },
    { code: 'HKD', flag: '\ud83c\udded\ud83c\uddf0', name: 'Hong Kong Dollar' },
    { code: 'TWD', flag: '\ud83c\uddf9\ud83c\uddfc', name: 'New Taiwan Dollar' },
    { code: 'NZD', flag: '\ud83c\uddf3\ud83c\uddff', name: 'New Zealand Dollar' },
    { code: 'ZAR', flag: '\ud83c\uddff\ud83c\udde6', name: 'South African Rand' },
    { code: 'TRY', flag: '\ud83c\uddf9\ud83c\uddf7', name: 'Turkish Lira' },
    { code: 'RUB', flag: '\ud83c\uddf7\ud83c\uddfa', name: 'Russian Ruble' },
    { code: 'ILS', flag: '\ud83c\uddee\ud83c\uddf1', name: 'Israeli Shekel' },
    { code: 'SAR', flag: '\ud83c\uddf8\ud83c\udde6', name: 'Saudi Riyal' },
    { code: 'AED', flag: '\ud83c\udde6\ud83c\uddea', name: 'UAE Dirham' },
    { code: 'EGP', flag: '\ud83c\uddea\ud83c\uddec', name: 'Egyptian Pound' },
    { code: 'NGN', flag: '\ud83c\uddf3\ud83c\uddec', name: 'Nigerian Naira' },
    { code: 'UAH', flag: '\ud83c\uddfa\ud83c\udde6', name: 'Ukrainian Hryvnia' },
    { code: 'VND', flag: '\ud83c\uddfb\ud83c\uddf3', name: 'Vietnamese Dong' },
    { code: 'PHP', flag: '\ud83c\uddf5\ud83c\udded', name: 'Philippine Peso' },
    { code: 'MYR', flag: '\ud83c\uddf2\ud83c\uddfe', name: 'Malaysian Ringgit' },
  ];
  function currencyEntry(code) {
    for (var ci = 0; ci < CURRENCY_CATALOG.length; ci++) {
      if (CURRENCY_CATALOG[ci].code === code) return CURRENCY_CATALOG[ci];
    }
    return null;
  }

  // ---- regional display metadata -------------------------------------------
  // Symbol + decimal convention per currency. `$` symbols are ambiguous, so the
  // code stays appended for them; everything else renders symbol-only.
  var CURRENCY_META = {
    USD: { sym: '$', dec: 4 },
    CNY: { sym: '\u00a5', dec: 2 },
    EUR: { sym: '\u20ac', dec: 2 },
    GBP: { sym: '\u00a3', dec: 2 },
    JPY: { sym: '\u00a5', dec: 0 },
    KRW: { sym: '\u20a9', dec: 0 },
    VND: { sym: '\u20ab', dec: 0 },
    BRL: { sym: 'R$', dec: 2 },
    CHF: { sym: 'Fr', dec: 2 },
    SEK: { sym: 'kr', dec: 2 },
    NOK: { sym: 'kr', dec: 2 },
    DKK: { sym: 'kr', dec: 2 },
    PLN: { sym: 'z\u0142', dec: 2 },
    CZK: { sym: 'K\u010d', dec: 2 },
    HUF: { sym: 'Ft', dec: 0 },
    INR: { sym: '\u20b9', dec: 2 },
    IDR: { sym: 'Rp', dec: 0 },
    THB: { sym: '\u0e3f', dec: 2 },
    SGD: { sym: 'S$', dec: 2 },
    HKD: { sym: 'HK$', dec: 2 },
    TWD: { sym: 'NT$', dec: 2 },
    ZAR: { sym: 'R', dec: 2 },
    TRY: { sym: '\u20ba', dec: 2 },
    RUB: { sym: '\u20bd', dec: 2 },
    ILS: { sym: '\u20aa', dec: 2 },
    NGN: { sym: '\u20a6', dec: 2 },
    UAH: { sym: '\u20b4', dec: 2 },
    PHP: { sym: '\u20b1', dec: 2 },
    MYR: { sym: 'RM', dec: 2 },
    ARS: { sym: '$', dec: 2 },
    CLP: { sym: '$', dec: 0 },
    MXN: { sym: '$', dec: 2 },
    CAD: { sym: '$', dec: 2 },
    AUD: { sym: '$', dec: 2 },
    NZD: { sym: '$', dec: 2 },
    PEN: { sym: 'S/', dec: 2 },
    VES: { sym: 'Bs', dec: 2 },
    SAR: { sym: '\ufdfc', dec: 2 },
    AED: { sym: '\u062f.\u0625', dec: 2 },
    EGP: { sym: 'E\u00a3', dec: 2 },
  };
  function currencyMeta(code) {
    return CURRENCY_META[code] || { sym: '$', dec: 2 };
  }

  // ---- i18n ----------------------------------------------------------------
  // Registered with the harness LocaleRuntime (ctx.locale) as the
  // 'token-anxiety' namespace; `t(key)` reads the active locale at call time.
  // When the harness is configured to Chinese the component renders zh and
  // defaults the currency to CNY.
  var I18N = {
    en: {
      overview: 'Overview', tasks: 'Tasks',
      currency: 'Currency', projected: 'Projected', chooseCurrency: 'Choose display currency',
      showProjected: 'Show projected post-hike values',
      explainTitle: 'Analyze why this task costs what it costs and find hidden waste (one small LLM call, only on click)',
      addCurrency: '\uff0b Add currency\u2026', closeAdd: '\u25b2 Close add', searchCurrency: 'Search code or name\u2026',
      removeCurrency: 'Remove {code}', select: 'Select {code}',
      all: 'All', peak: 'Peak', valley: 'Valley', wasteFilter: '\u26a0 Waste',
      showAll: 'Show all tasks', selectPeak: 'Select peak hours {hours}', selectValley: 'Select valley hours {hours}',
      wasteOnly: 'Only show tasks flagged as possible waste',
      peakHoursLocal: 'peak hours local {windows}',
      selectionSuffix: ' \u00b7 selection: {hours}',
      costPerTask: 'Cost per task ({cur})',
      costHead: 'Cost', projHead: 'Proj',
      graphNote: 'Click a bar to select it, then \u201cExplain\u201d \u00b7 100% = the most expensive task (or most tokens) among those shown \u00b7 hover a bar for details',
      hourFilterNote: 'Hour filter: {hours} \u00b7 {n} of {total} tasks',
      noTasksMatch: ' (no tasks match those hours)',
      wasteShown: '\u26a0 {n} of {total} shown tasks flagged as possible waste',
      selectedLabel: 'Selected: #{n}', explain: 'Explain', asking: 'Asking\u2026', clearSelection: 'Clear selection',
      inputMiss: 'input miss', cacheHit: 'cache hit', output: 'output',
      pricePerTask: 'PRICE PER TASK ({cur})', requests: 'Requests', tokens: 'Tokens',
      postPeakValley: 'Post peak / valley', postHikeByHour: 'Post-hike by hour', byRegimeActual: 'By regime (actual)',
      pricing: 'Pricing', selectedRange: 'Selected range ({hours})', today: 'Today',
      costShape: 'Cost shape', avgPerTask: 'Avg per task', avgPerRequest: 'Avg per request', mostExpensive: 'Most expensive',
      wasteSnapshot: 'Waste snapshot', flagged: 'Flagged', cost: 'Cost', topFlags: 'Top flags', models: 'Models',
      projectedFrom: 'projected from {date} \u00b7 USD per 1M tokens', usdPer1m: 'USD per 1M tokens',
      model: 'Model', current: 'Current', projectedPostHike: 'Projected post-hike',
      fxRate: '1 USD = {rate} {code}',
      peakCol: 'Peak', valleyCol: 'Valley',
      noRecordedContent: '(no recorded content)', possibleWaste: 'Possible waste: {flags}',
      nowShare: '{cost} now \u00b7 {pct}% of conversation', postLabel: ' \u00b7 post {cost}',
      reqLine: '{req} req \u00b7 miss {miss} / hit {hit} / out {out}',
      hourSuffix: ' \u00b7 hour {hour}:00 {regime}', regimePeak: '(peak)', regimeValley: '(valley)',
      toolCalls: 'Tool calls: {list}', errors: 'Errors: {list}', retries: 'Model retries: {n}',
      tokensLine: 'Tokens: miss {miss} / hit {hit} / out {out}',
      dismiss: 'Dismiss', dismissAnalysis: 'Dismiss this analysis', analysisLabel: 'Analysis \u2014 {label}',
      postArrow: '\u2192 post', valleyWord: 'valley', peakWord: 'peak',
      heroPostValley: 'valley {cost}', heroPostPeak: ' \u00b7 peak {cost}',
      tasksCount: '{n} task{s}', delta: ' (\u0394+{pct}%)', wasteCount: ' \u00b7 \u26a0{n}',
      footer: ' \u00b7 root session only \u00b7 {cur} \u00b7 hour filter + waste flags',
      askAnalyzing: 'Asking the agent to analyze this task\u2026', turnPrefix: 'turn #',
      explainFailed: 'Analysis failed: {msg}', explainTimeout: 'took too long (timed out) \u2014 try again',
      peakStatus: 'Peak', valleyStatus: 'Valley', rootOnly: 'root session only',
      removeCurrencyTitle: 'Remove {code}', flagCurrency: '{code} \u00b7 {name}',
    },
    zh: {
      overview: '概览', tasks: '任务',
      currency: '货币', projected: '预测', chooseCurrency: '选择显示货币',
      showProjected: '显示预测（涨价后）值',
      explainTitle: '分析该任务为何花费如此之高，并找出隐藏浪费（每次仅一次小型 LLM 调用）',
      addCurrency: '＋ 添加货币…', closeAdd: '▲ 收起添加', searchCurrency: '按代码或名称搜索…',
      removeCurrency: '移除 {code}', select: '选择 {code}',
      all: '全部', peak: '高峰', valley: '低谷', wasteFilter: '⚠ 浪费',
      showAll: '显示全部任务', selectPeak: '选择高峰时段 {hours}', selectValley: '选择低谷时段 {hours}',
      wasteOnly: '仅显示疑似浪费的任务',
      peakHoursLocal: '本地高峰时段 {windows}',
      selectionSuffix: ' · 已选：{hours}',
      costPerTask: '每任务成本（{cur}）',
      costHead: '费用', projHead: '预测',
      graphNote: '点击条形选择，再点击“解释” · 100% = 所示中最贵任务（或最多 token）· 悬停查看详情',
      hourFilterNote: '时段筛选：{hours} · {n}/{total} 个任务',
      noTasksMatch: '（无任务匹配这些时段）',
      wasteShown: '⚠ 所示 {total} 个任务中 {n} 个疑似浪费',
      selectedLabel: '已选：#{n}', explain: '解释', asking: '正在分析…', clearSelection: '清除选择',
      inputMiss: '输入未命中', cacheHit: '缓存命中', output: '输出',
      pricePerTask: '每任务价格（{cur}）', requests: '请求', tokens: 'Token',
      postPeakValley: '预测高峰/低谷', postHikeByHour: '按时段预测涨价后', byRegimeActual: '按实际计费档位',
      pricing: '定价', selectedRange: '已选范围（{hours}）', today: '今日',
      costShape: '成本结构', avgPerTask: '每任务平均', avgPerRequest: '每请求平均', mostExpensive: '最贵',
      wasteSnapshot: '浪费概览', flagged: '标记', cost: '成本', topFlags: '主要标记', models: '模型',
      projectedFrom: '自 {date} 起预测 · 每百万 token 美元价', usdPer1m: '每百万 token 美元价',
      model: '模型', current: '当前', projectedPostHike: '预测涨价后',
      fxRate: '1 美元 = {rate} {code}',
      peakCol: '高峰', valleyCol: '低谷',
      noRecordedContent: '（无记录内容）', possibleWaste: '疑似浪费：{flags}',
      nowShare: '当前 {cost} · 占对话 {pct}%', postLabel: ' · 预测 {cost}',
      reqLine: '{req} 请求 · 未命中 {miss} / 命中 {hit} / 输出 {out}',
      hourSuffix: ' · 时段 {hour}:00 {regime}', regimePeak: '（高峰）', regimeValley: '（低谷）',
      toolCalls: '工具调用：{list}', errors: '错误：{list}', retries: '模型重试：{n}',
      tokensLine: 'Token：未命中 {miss} / 命中 {hit} / 输出 {out}',
      dismiss: '关闭', dismissAnalysis: '关闭此分析', analysisLabel: '分析 — {label}',
      postArrow: '→ 预测', valleyWord: '低谷', peakWord: '高峰',
      heroPostValley: '低谷 {cost}', heroPostPeak: ' · 高峰 {cost}',
      tasksCount: '{n} 个任务{s}', delta: '（Δ+{pct}%）', wasteCount: ' · ⚠{n}',
      footer: ' · 仅根会话 · {cur} · 时段筛选 + 浪费标记',
      askAnalyzing: '正在请求智能体分析此任务…', turnPrefix: '轮次 ',
      explainFailed: '分析失败：{msg}', explainTimeout: '用时过长（已超时）— 请重试',
      peakStatus: '高峰', valleyStatus: '低谷', rootOnly: '仅根会话',
      removeCurrencyTitle: '移除 {code}', flagCurrency: '{code} · {name}',
    },
  };

  // ---- labels and advice ---------------------------------------------------
  var wasteLabel = {
    'tool-errors': 'repeated tool errors',
    'retries': 'model retries',
    'repeat': 'near-duplicate prompt',
    'tiny-output': 'huge input, tiny output',
    'corrected': 'you corrected the result',
  };

  // ---- formatting helpers ---------------------------------------------------
  function fmtCop(n) {
    var neg = n < 0;
    var abs = Math.abs(n);
    var int = Math.floor(abs);
    var dec = Math.round((abs - int) * 100);
    var s = int.toLocaleString('en-US');
    var d = dec < 10 ? '0' + dec : String(dec);
    return (neg ? '-' : '') + '$' + s + '.' + d;
  }

  function fmtTok(n) {
    if (!Number.isFinite(n)) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(Math.round(n));
  }

  function fmtDate(t, tz) {
    if (!t || !t.last) return null;
    var d = new Date(t.last + tz * 3600000);
    var wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    var dd = String(d.getUTCDate()).padStart(2, '0');
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    var hh = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    return wd + ' ' + dd + '/' + mm + ' ' + hh;
  }

  function fmtHours(hs) {
    if (!hs.length) return '';
    var s = hs.slice().sort(function (a, b) { return a - b; });
    var out = [];
    var start = s[0];
    var prev = s[0];
    for (var i = 1; i <= s.length; i++) {
      var h = s[i];
      if (i < s.length && h === prev + 1) { prev = h; continue; }
      var a = String(start).padStart(2, '0') + ':00';
      var b = String(prev + 1).padStart(2, '0') + ':00';
      out.push(start === prev ? a : a + '\u2013' + b);
      if (i < s.length) { start = h; prev = h; }
    }
    return out.join(', ');
  }

  function fmtWindows(ws) {
    return ws.map(function (w) {
      return String(w.start).padStart(2, '0') + ':00\u2013' + String(w.end).padStart(2, '0') + ':00';
    }).join(', ');
  }

  // ---- the widget component ----------------------------------------------------
  function TokenAnxietyWidget(props) {
    var useProjection = props.useProjection;
    var onExplain = props.onExplain;
    var projection = useProjection('tokenAnxiety');
    var localeVerState = React.useState(0);
    var setLocaleVer = localeVerState[1];
    React.useEffect(function () {
      var sub = props.subscribeLocale;
      if (!sub) return;
      return sub(function () { setLocaleVer(function (v) { return v + 1; }); });
    }, []);
    var t = props.t || null;
    var L = {};
    if (t) { for (var lk in I18N.en) L[lk] = t(lk); } else { L = I18N.en; }
    var nowState = React.useState(function () { return Date.now(); });
    var now = nowState[0];
    var setNow = nowState[1];
    var hovState = React.useState(false);
    var hov = hovState[0];
    var setHov = hovState[1];
    var hovIState = React.useState(-1);
    var hovI = hovIState[0];
    var setHovI = hovIState[1];
    var pinState = React.useState(false);
    var pin = pinState[0];
    var setPin = pinState[1];
    var selState = React.useState([]);
    var sel = selState[0];
    var setSel = selState[1];
    var wasteOnlyState = React.useState(false);
    var wasteOnly = wasteOnlyState[0];
    var setWasteOnly = wasteOnlyState[1];
    var curState = React.useState(function () { return props.activeLocale === 'zh' ? 'CNY' : 'USD'; });
    var cur = curState[0];
    var setCur = curState[1];
    var tabState = React.useState('overview');
    var tab = tabState[0];
    var setTab = tabState[1];
    var selTaskState = React.useState(null);
    var selTask = selTaskState[0];
    var setSelTask = selTaskState[1];
    var explPendingState = React.useState({});
    var explPending = explPendingState[0];
    var setExplPending = explPendingState[1];
    var explDismissState = React.useState({});
    var explDismiss = explDismissState[0];
    var setExplDismiss = explDismissState[1];
    var explTextState = React.useState({});
    var explText = explTextState[0];
    var setExplText = explTextState[1];
    var explErrState = React.useState({});
    var explErr = explErrState[0];
    var setExplErr = explErrState[1];
    var curOpenState = React.useState(false);
    var curOpen = curOpenState[0];
    var setCurOpen = curOpenState[1];
    var hoverTimer = React.useRef(null);
    var tipTimer = React.useRef(null);
    var tipPending = React.useRef(null);
    var sortKeyState = React.useState('turn');
    var sortKey = sortKeyState[0];
    var setSortKey = sortKeyState[1];
    var sortDirState = React.useState('asc');
    var sortDir = sortDirState[0];
    var setSortDir = sortDirState[1];
    var hovTipState = React.useState(null);
    var hovTip = hovTipState[0];
    var setHovTip = hovTipState[1];
    var tipDismissState = React.useState({});
    var tipDismiss = tipDismissState[0];
    var setTipDismiss = tipDismissState[1];
    var showProjState = React.useState(true);
    var showProj = showProjState[0];
    var setShowProj = showProjState[1];
    var enabledCurrenciesState = React.useState(function () {
      var p = projection && projection.pricing;
      return (p && Array.isArray(p.currencies) && p.currencies.length ? p.currencies : DEFAULT_CURRENCIES).slice();
    });
    var enabledCurrencies = enabledCurrenciesState[0];
    var setEnabledCurrencies = enabledCurrenciesState[1];
    var addOpenState = React.useState(false);
    var addOpen = addOpenState[0];
    var setAddOpen = addOpenState[1];
    var addQueryState = React.useState('');
    var addQuery = addQueryState[0];
    var setAddQuery = addQueryState[1];

    React.useEffect(function () {
      var id = window.setInterval(function () { setNow(Date.now()); }, 30000);
      return function () { window.clearInterval(id); };
    }, []);

    React.useEffect(function () {
      return function () {
        if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
        if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
      };
    }, []);

    // Currency chooser dismissal: outside click or Escape closes the panel
    // (listener lives only while open, so idle re-renders cost nothing).
    React.useEffect(function () {
      if (!curOpen) return;
      function onDoc() { setCurOpen(false); }
      function onKey(e) { if (e.key === 'Escape') setCurOpen(false); }
      document.addEventListener('click', onDoc);
      document.addEventListener('keydown', onKey);
      return function () {
        document.removeEventListener('click', onDoc);
        document.removeEventListener('keydown', onKey);
      };
    }, [curOpen]);

    if (!projection || typeof projection !== 'object' || !projection.pricing) return null;

    // ---- status from pricing config + browser clock/tz ----
    var pricing = projection.pricing;
    var tz = -new Date().getTimezoneOffset() / 60;
    var peakWindowsUtc = pricing.peakWindowsUtc || [];
    function shift(h, off) { return ((h + off) % 24 + 24) % 24; }
    var localWindows = peakWindowsUtc.map(function (w) { return { start: shift(w.start, tz), end: shift(w.end, tz) }; });
    function inPeak(h) {
      return localWindows.some(function (w) { return w.start <= w.end ? h >= w.start && h < w.end : h >= w.start || h < w.end; });
    }
    var nowD = new Date(now + tz * 3600000);
    var nowH = nowD.getUTCHours();
    var localTime = String(nowD.getUTCHours()).padStart(2, '0') + ':' + String(nowD.getUTCMinutes()).padStart(2, '0');
    var peak = inPeak(nowH);
    var minNow = nowH * 60 + nowD.getUTCMinutes() + nowD.getUTCSeconds() / 60;
    var winMin = localWindows.map(function (x) { return { start: x.start * 60, end: x.end * 60 }; });
    var nextPeriod = null;
    var nextChange = null;
    if (peak) {
      var curW = null;
      for (var wi = 0; wi < winMin.length; wi++) {
        if (minNow >= winMin[wi].start && minNow < winMin[wi].end) { curW = winMin[wi]; break; }
      }
      if (curW !== null) {
        var a1 = new Date(nowD);
        a1.setUTCHours(0, curW.end, 0, 0);
        if (a1 <= nowD) a1.setUTCDate(a1.getUTCDate() + 1);
        nextPeriod = 'valley';
        nextChange = a1;
      }
    } else {
      var a2 = null;
      for (var wi2 = 0; wi2 < winMin.length; wi2++) {
        var c = new Date(nowD);
        c.setUTCHours(0, winMin[wi2].start, 0, 0);
        if (c > nowD) { a2 = c; break; }
      }
      if (a2 === null) {
        a2 = new Date(nowD);
        a2.setUTCHours(0, winMin.length ? winMin[0].start : 0, 0, 0);
        a2.setUTCDate(a2.getUTCDate() + 1);
      }
      nextPeriod = 'peak';
      nextChange = a2;
    }
    var nextChangeLocal = nextChange === null
      ? null
      : String(nextChange.getUTCHours()).padStart(2, '0') + ':' + String(nextChange.getUTCMinutes()).padStart(2, '0');
    var peakWindowsLocalText = fmtWindows(localWindows);

    // ---- data + filters ----
    var conv = projection;
    var allTasks = projection.tasks || [];
    var pricingNow = projection.pricing || {};
    var fxRates = pricingNow.fxRates && Object.keys(pricingNow.fxRates).length ? pricingNow.fxRates : DEFAULT_FX_RATES;
    var copRate = fxRates.COP || pricingNow.fxUsdCop || 3137.586264;
    function fmtNum(v, dec) {
      var factor = Math.pow(10, dec);
      return (Math.round(v * factor) / factor).toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
    }
    function money(cop) {
      if (cur !== 'COP') {
        var rate = fxRates[cur];
        if (typeof rate !== 'number' || rate <= 0) return fmtCop(cop) + ' COP';
      }
      var meta = currencyMeta(cur);
      var v = cur === 'COP' ? cop : (cop / copRate) * rate;
      var s = fmtNum(v, meta.dec);
      // `$` is ambiguous across currencies, so the code stays appended for it.
      return meta.sym + s + (meta.sym === '$' ? ' ' + cur : '');
    }
    function hourOf(t) { return t && t.last ? new Date(t.last + tz * 3600000).getUTCHours() : -1; }
    function taskKey(t) { return 't:' + String(t.turn); }
    function sameArr(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }
    function isWaste(t) { return Array.isArray(t.waste) && t.waste.length > 0; }
    function postPeakStr(t) { return 'peak ' + money(t.postPeakCop || 0) + ' / valley ' + money(t.postValleyCop || 0); }
    // Shared cost-graph column: the Tasks and Waste tabs render the same bars
    // (cost track + miss/hit/out stack + request/token/post line).
    function barGraph(t, maxCop, maxTok) {
      var pct = Math.max(2, Math.round((t.cop || 0) / maxCop * 100));
      var mPct = (t.missTokens || 0) / maxTok * 100;
      var hPct = (t.hitTokens || 0) / maxTok * 100;
      var oPct = (t.outputTokens || 0) / maxTok * 100;
      return React.createElement('div', { className: 'txg-bars' },
        React.createElement('div', { className: 'txg-track' },
          React.createElement('div', { className: 'txg-fill', style: { width: pct + '%' } }, null),
          React.createElement('div', { className: 'txg-num' }, money(t.cop))),
        React.createElement('div', { className: 'txg-stack' },
          React.createElement('div', { className: 'txg-sg-miss', style: { width: mPct + '%' } }, null),
          React.createElement('div', { className: 'txg-sg-hit', style: { width: hPct + '%' } }, null),
          React.createElement('div', { className: 'txg-sg-out', style: { width: oPct + '%' } }, null)));
    }

    var peakSel = [];
    var valleySel = [];
    for (var h = 0; h < 24; h++) { if (inPeak(h)) peakSel.push(h); else valleySel.push(h); }

    var hourFiltered = sel.length ? allTasks.filter(function (t) { return sel.indexOf(hourOf(t)) >= 0; }) : allTasks;
    var filtered = wasteOnly ? hourFiltered.filter(isWaste) : hourFiltered;
    var tasks = filtered.slice(-40);
    var wasteCount = filtered.filter(isWaste).length;
    var wasteTasks = allTasks.filter(isWaste);
    var wasteTotal = wasteTasks.length;
    var wasteCop = wasteTasks.reduce(function (s, t) { return s + (t.cop || 0); }, 0);

    function toggleHour(h) {
      setSel(sel.indexOf(h) >= 0 ? sel.filter(function (x) { return x !== h; }) : sel.concat([h]).sort(function (a, b) { return a - b; }));
    }
    function toggleSort(key) {
      if (sortKey === key) {
        setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        setSortKey(key);
        setSortDir(key === 'sharePct' ? 'desc' : 'asc');
      }
    }
    function enter() {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(function () { setHov(true); }, 250);
    }
    function leave() {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      setHov(false);
      setHovI(-1);
    }

    // ---- explain flow: click fetch()es the host route /token-anxiety/explain;
    // the returned analysis is kept in component state and rendered in a
    // scrollable box (lost on reload, like the old dynamic plugin).
    function explainTextOf(turn) { return explText[turn] || null; }
    function setPending(turn, value) {
      setExplPending(function (m) { var n = {}; for (var k in m) n[k] = m[k]; if (value) n[turn] = true; else delete n[turn]; return n; });
    }
    function doExplain(turn) {
      if (explPending[turn]) return;
      // A dismissed analysis counts as "not there": clicking Explain again
      // clears the dismissal and the stale text, then reruns, so the button
      // always gives visible feedback.
      if (explDismiss[turn]) {
        setExplDismiss(function (m) { var n = {}; for (var k in m) n[k] = m[k]; delete n[turn]; return n; });
        setExplText(function (m) { var n = {}; for (var k in m) n[k] = m[k]; delete n[turn]; return n; });
      }
      if (explErr[turn]) {
        setExplErr(function (m) { var n = {}; for (var k in m) n[k] = m[k]; delete n[turn]; return n; });
      }
      if (explainTextOf(turn)) return; // an analysis is already visible
      setPending(turn, true);
      var p = null;
      try {
        p = onExplain ? onExplain(turn, function (acc) {
          setExplText(function (m) { var n = {}; for (var k in m) n[k] = m[k]; n[turn] = acc; return n; });
        }) : null;
      } catch (e) {
        setPending(turn, false);
        return;
      }
      if (p && typeof p.then === 'function') {
        p.then(function (v) {
          setExplErr(function (m) { var n = {}; for (var k in m) n[k] = m[k]; delete n[turn]; return n; });
          setExplText(function (m) { var n = {}; for (var k in m) n[k] = m[k]; if (v && v.text) n[turn] = v.text; else delete n[turn]; return n; });
          setPending(turn, false);
        }, function (err) {
          var msg = String((err && err.message) || err);
          if (err && err.name === 'AbortError') msg = L.explainTimeout;
          setExplErr(function (m) { var n = {}; for (var k in m) n[k] = m[k]; n[turn] = msg; return n; });
          setExplText(function (m) { var n = {}; for (var k in m) n[k] = m[k]; delete n[turn]; return n; });
          setPending(turn, false);
        });
      } else {
        setPending(turn, false);
      }
    }
    function dismissExplain(turn) {
      setExplDismiss(function (m) { var n = {}; for (var k in m) n[k] = m[k]; n[turn] = true; return n; });
    }
    // Render the streamed analysis as rich text: lines that start with a short
    // label followed by a colon (English or Chinese, e.g. "Wanted:", "Happened:",
    // "避免：") get the label bolded in the accent color; continuation lines
    // render plain. Gaps between the four sections get a little breathing room.
    function explainBody(text) {
      var lines = String(text || '').split('\n');
      var els = [];
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (!ln.trim()) {
          els.push(React.createElement('div', { key: i, className: 'txg-expl-gap' }, null));
          continue;
        }
        var m = ln.match(/^([^:：]{1,18})([：:])\s*(.*)$/);
        if (m && m[1].trim()) {
          els.push(React.createElement('div', { key: i, className: 'txg-expl-line' },
            React.createElement('b', { className: 'txg-expl-label' }, m[1] + m[2]),
            m[3] ? ' ' + m[3] : ''));
        } else {
          els.push(React.createElement('div', { key: i, className: 'txg-expl-line' }, ln));
        }
      }
      return React.createElement('div', null, els);
    }
    function explainBlock(turn, label) {
      var text = explainTextOf(turn);
      if (text && !explDismiss[turn] && !explPending[turn]) {
        return React.createElement('div', null,
          React.createElement('div', { className: 'txg-explhead' },
            React.createElement('b', null, L.analysisLabel.replace('{label}', label)),
            React.createElement('button', { className: 'txg-explx', onClick: function () { dismissExplain(turn); }, title: L.dismissAnalysis }, '\u2715')),
          React.createElement('div', { className: 'txg-expl' }, explainBody(text)));
      }
      if (explErr[turn] && !explDismiss[turn]) {
        return React.createElement('div', null,
          React.createElement('div', { className: 'txg-explhead' },
            React.createElement('b', null, L.analysisLabel.replace('{label}', label)),
            React.createElement('button', { className: 'txg-explx', onClick: function () { dismissExplain(turn); }, title: L.dismissAnalysis }, '\u2715')),
          React.createElement('div', { className: 'txg-expl txg-expl-err' }, L.explainFailed.replace('{msg}', explErr[turn])));
      }
      if (explPending[turn]) {
        return React.createElement('div', null,
          React.createElement('div', { className: 'txg-explhead' },
            React.createElement('b', null, L.analysisLabel.replace('{label}', label)),
            React.createElement('button', { className: 'txg-explx', onClick: function () { dismissExplain(turn); }, title: L.dismissAnalysis }, '\u2715')),
          text
            ? React.createElement('div', { className: 'txg-expl' }, explainBody(text))
            : React.createElement('div', { className: 'txg-muted', style: { marginTop: 3 } }, L.askAnalyzing));
      }
      return null;
    }

    var show = pin || hov;

    // ---- selected range stats ----
    var range = null;
    if (sel.length) {
      var req = 0, today = 0, post = 0, postPeak = 0, postValley = 0, miss = 0, hit = 0, out = 0;
      for (var ri = 0; ri < filtered.length; ri++) {
        var rt = filtered[ri];
        req += rt.requests || 0;
        today += rt.cop || 0;
        post += rt.postCop || 0;
        postPeak += rt.postPeakCop || 0;
        postValley += rt.postValleyCop || 0;
        miss += rt.missTokens || 0;
        hit += rt.hitTokens || 0;
        out += rt.outputTokens || 0;
      }
      var share = conv.totalCop > 0 ? Math.round(today / conv.totalCop * 1000) / 10 : 0;
      var hike = today > 0 ? Math.round((post / today - 1) * 1000) / 10 : 0;
      range = { count: filtered.length, req: req, today: today, post: post, postPeak: postPeak, postValley: postValley, miss: miss, hit: hit, out: out, share: share, hike: hike };
    }

    // ---- hour strip + cells ----
    var cells = [];
    for (var ch = 0; ch < 24; ch++) {
      (function (hour) {
        cells.push(React.createElement('span', {
          key: String(hour),
          className: 'txg-cell' + (inPeak(hour) ? ' txg-cell-peak' : '') + (hour === nowH ? ' txg-cell-now' : '') + (sel.indexOf(hour) >= 0 ? ' txg-cell-sel' : ''),
          onClick: function () { toggleHour(hour); },
          title: String(hour).padStart(2, '0') + ':00 ' + (inPeak(hour) ? 'peak' : 'valley') + (sel.indexOf(hour) >= 0 ? ' \u00b7 selected' : '') + ' \u2014 click to toggle',
        }, null));
      })(ch);
    }

    var strip = React.createElement('div', null,
      React.createElement('div', { className: 'txg-lbl' },
        React.createElement('span', null, '0'),
        React.createElement('span', null, '6'),
        React.createElement('span', null, '12'),
        React.createElement('span', null, '18'),
        React.createElement('span', null, '24')),
      React.createElement('div', { className: 'txg-tl' }, cells),
      React.createElement('div', { className: 'txg-selrow' },
        React.createElement('button', {
          className: 'txg-selbtn' + (sel.length === 0 && !wasteOnly ? ' txg-selbtn-on' : ''),
          onClick: function () { setSel([]); setWasteOnly(false); },
          title: L.showAll,
        }, L.all),
        React.createElement('button', {
          className: 'txg-selbtn txg-selbtn-peak' + (sameArr(sel, peakSel) ? ' txg-selbtn-on' : ''),
          onClick: function () { setSel(peakSel); },
          title: L.selectPeak.replace('{hours}', fmtHours(peakSel)),
        }, L.peak),
        React.createElement('button', {
          className: 'txg-selbtn txg-selbtn-valley' + (sameArr(sel, valleySel) ? ' txg-selbtn-on' : ''),
          onClick: function () { setSel(valleySel); },
          title: L.selectValley.replace('{hours}', fmtHours(valleySel)),
        }, L.valley),
        React.createElement('button', {
          className: 'txg-selbtn' + (wasteOnly ? ' txg-selbtn-on' : ''),
          onClick: function () { setWasteOnly(!wasteOnly); },
          title: L.wasteOnly,
        }, L.wasteFilter)),
      React.createElement('div', { className: 'txg-muted', style: { marginTop: 2 } },
        L.peakHoursLocal.replace('{windows}', peakWindowsLocalText) + (sel.length ? L.selectionSuffix.replace('{hours}', fmtHours(sel)) : '')));

    // ---- tasks tab: sortable table, fixed header/selection, scroll on rows ----
    var tasksTab = null;
    if (tasks.length) {
      var sortedTasks = tasks.slice().sort(function (a, b) {
        var av = sortKey === 'turn' ? a.turn : (a.sharePct || 0);
        var bv = sortKey === 'turn' ? b.turn : (b.sharePct || 0);
        var r = av - bv;
        return sortDir === 'asc' ? r : -r;
      });
      var maxCop = Math.max.apply(null, sortedTasks.map(function (t) { return t.cop || 0; })) || 1;
      var maxTok = Math.max.apply(null, sortedTasks.map(function (t) { return t.totalTokens || 0; })) || 1;
      var rows = sortedTasks.map(function (t, i) {
        var label = (isWaste(t) ? '\u26a0 ' : '') + '#' + String(t.turn);
        var ds = fmtDate(t, tz);
        return React.createElement('div', {
          className: 'txg-bar-row txg-tbl-row' + (isWaste(t) ? ' txg-bar-row-waste' : '') + (selTask === t.turn ? ' txg-bar-row-sel' : ''),
          key: String(t.turn),
          onClick: function () { setSelTask(selTask === t.turn ? null : t.turn); },
          onMouseEnter: function (e) {
            if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
            tipPending.current = { el: e.currentTarget, task: t };
            tipTimer.current = window.setTimeout(function () {
              var p = tipPending.current;
              if (p && p.el) {
                var r = p.el.getBoundingClientRect();
                setHovTip({ top: r.top, left: r.left, task: p.task });
              }
            }, 1000);
          },
          onMouseLeave: function () {
            if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
            tipTimer.current = null;
            tipPending.current = null;
            setHovTip(null);
            setTipDismiss(function (m) { var n = {}; for (var k in m) n[k] = m[k]; delete n['t:' + t.turn]; return n; });
          },
        },
          React.createElement('div', { className: 'txg-cell-num', title: String(t.turn) }, label),
          React.createElement('div', { className: 'txg-cell-pct', title: L.tokens }, (typeof t.sharePct === 'number' ? t.sharePct : 0) + '%'),
          React.createElement('div', { className: 'txg-cell-cost', title: money(t.cop) + (showProj ? ' \u2192 ' + money(t.postCop) : '') },
            React.createElement('div', null, money(t.cop)),
            showProj ? React.createElement('div', { className: 'txg-post' },
              React.createElement('div', null, '\u2192 (peak ' + money(t.postPeakCop || 0)),
              React.createElement('div', null, '/ valley ' + money(t.postValleyCop || 0) + ')')) : null),
          React.createElement('div', { className: 'txg-cell-graph' }, barGraph(t, maxCop, maxTok)));
      });
      var selTaskObj = null;
      for (var si = 0; si < tasks.length; si++) {
        if (tasks[si].turn === selTask) { selTaskObj = tasks[si]; break; }
      }
      tasksTab = React.createElement('div', { className: 'txg-tasks' },
        React.createElement('div', { className: 'txg-sec' },
          React.createElement('div', { className: 'txg-sec-t' }, L.costPerTask.replace('{cur}', cur)),
          React.createElement('div', { className: 'txg-hero' },
            React.createElement('span', { className: 'txg-hero-v' }, money(conv.taskCount > 0 ? conv.totalCop / conv.taskCount : 0)),
            showProj ? React.createElement('span', { className: 'txg-hero-s' },
              ' \u2192 ',
              React.createElement('span', { className: 'txg-post' },
                money(conv.taskCount > 0 ? conv.postCop / conv.taskCount : 0))) : null),
          React.createElement('div', { className: 'txg-note' }, L.graphNote),
          sel.length ? React.createElement('div', { className: 'txg-note' }, L.hourFilterNote.replace('{hours}', fmtHours(sel)).replace('{n}', String(filtered.length)).replace('{total}', String(allTasks.length)) + (filtered.length === 0 ? L.noTasksMatch : '')) : null,
          wasteCount > 0 ? React.createElement('div', { className: 'txg-note txg-note-warn' }, L.wasteShown.replace('{n}', String(wasteCount)).replace('{total}', String(filtered.length))) : null),
        selTaskObj ? React.createElement('div', { className: 'txg-explwrap' },
          React.createElement('div', { className: 'txg-explbar' },
            React.createElement('b', null, L.selectedLabel.replace('{n}', String(selTaskObj.turn))),
            React.createElement('button', {
              className: 'txg-wbtn',
              onClick: function () { doExplain(selTaskObj.turn); },
              disabled: !!explPending[selTaskObj.turn],
              title: L.explainTitle,
            }, explPending[selTaskObj.turn] ? '\u23f3 ' + L.asking : '\ud83e\udde0 ' + L.explain),
            React.createElement('button', { className: 'txg-explx', onClick: function () { setSelTask(null); }, title: L.clearSelection }, '\u2715')),
          explainBlock(selTaskObj.turn, '#' + String(selTaskObj.turn))) : null,
        React.createElement('div', { className: 'txg-tbl' },
          React.createElement('div', { className: 'txg-tbl-head' },
            React.createElement('div', { className: 'txg-th', onClick: function () { toggleSort('turn'); }, title: L.tasks },
              '#' + (sortKey === 'turn' ? (sortDir === 'asc' ? ' \u25b2' : ' \u25bc') : '')),
            React.createElement('div', { className: 'txg-th', onClick: function () { toggleSort('sharePct'); }, title: '%' },
              '%' + (sortKey === 'sharePct' ? (sortDir === 'asc' ? ' \u25b2' : ' \u25bc') : '')),
            React.createElement('div', { className: 'txg-th-cost', title: (showProj ? L.costHead + ' \u2192 ' + L.projHead : L.costHead) },
              L.costHead + (showProj ? ' \u2192 ' + L.projHead : '')),
            React.createElement('div', { className: 'txg-th-task' }, L.tasks)),
          React.createElement('div', { className: 'txg-tbl-rows' }, rows)),
        React.createElement('div', { className: 'txg-legend' },
          React.createElement('span', { className: 'txg-lg' }, React.createElement('span', { className: 'txg-sw txg-sg-miss' }, null), L.inputMiss),
          React.createElement('span', { className: 'txg-lg' }, React.createElement('span', { className: 'txg-sw txg-sg-hit' }, null), L.cacheHit),
          React.createElement('span', { className: 'txg-lg' }, React.createElement('span', { className: 'txg-sw txg-sg-out' }, null), L.output)));
    }

    // ---- overview: cheap folds over the projection's recent tasks ----
    var totalReq = 0, totalMiss = 0, totalHit = 0, totalOut = 0;
    var mostExp = null;
    for (var oi = 0; oi < allTasks.length; oi++) {
      var ot = allTasks[oi];
      totalReq += ot.requests || 0;
      totalMiss += ot.missTokens || 0;
      totalHit += ot.hitTokens || 0;
      totalOut += ot.outputTokens || 0;
      if (mostExp === null || (ot.cop || 0) > mostExp.cop) mostExp = ot;
    }
    var flagCounts = {};
    for (var fi = 0; fi < wasteTasks.length; fi++) {
      var wf = wasteTasks[fi].waste || [];
      for (var fj = 0; fj < wf.length; fj++) flagCounts[wf[fj]] = (flagCounts[wf[fj]] || 0) + 1;
    }
    var topFlags = Object.keys(flagCounts).sort(function (a, b) { return flagCounts[b] - flagCounts[a]; }).slice(0, 3);
    var round2 = function (n) { return Math.round(n * 100) / 100; };
    var avgTask = conv.taskCount > 0 ? conv.totalCop / conv.taskCount : 0;
    var avgReq = totalReq > 0 ? conv.totalCop / totalReq : 0;
    // Per-request cost split from the fold: `regime` is what actually billed
    // (current before the effective date, peak/valley by request hour after);
    // `postRegime` is the projected post-hike split by request hour.
    var regime = conv.regime || {};
    var postRegime = conv.postRegime || {};
    var postHikeNow = pricingNow.effectiveFromUtc ? Date.now() >= Date.parse(pricingNow.effectiveFromUtc) : false;

    function statRow(label, value) {
      return React.createElement('div', { className: 'txg-stat' },
        React.createElement('div', { className: 'txg-stat-l' }, label),
        React.createElement('div', { className: 'txg-stat-v' }, value));
    }

    var overview = React.createElement('div', null,
      React.createElement('div', { className: 'txg-sec' },
        React.createElement('div', { className: 'txg-sec-t' }, L.pricePerTask.replace('{cur}', cur)),
        React.createElement('div', { className: 'txg-hero' },
          React.createElement('span', { className: 'txg-hero-v' }, money(conv.totalCop)),
          showProj ? React.createElement('span', { className: 'txg-hero-s' },
            L.postArrow + ' ', React.createElement('span', { className: 'txg-post' },
              L.heroPostValley.replace('{cost}', money(conv.postValleyCop)),
              L.heroPostPeak.replace('{cost}', money(conv.postPeakCop))),
            ' (' + conv.hikePct + '%)') : null),
        statRow(L.tasks, String(conv.taskCount)),
        statRow(L.requests, String(totalReq)),
        statRow(L.tokens, 'miss ' + fmtTok(totalMiss) + ' / hit ' + fmtTok(totalHit) + ' / out ' + fmtTok(totalOut)),
        showProj ? statRow(L.postPeakValley, React.createElement('span', { className: 'txg-post' }, money(conv.postPeakCop) + ' / ' + money(conv.postValleyCop))) : null,
        showProj ? statRow(postHikeNow ? L.byRegimeActual : L.postHikeByHour,
          postHikeNow
            ? (L.peakWord + ' ' + money(round2(regime.peak || 0)) + ' \u00b7 ' + L.valleyWord + ' ' + money(round2(regime.valley || 0)))
            : (L.peakWord + ' ' + money(round2(postRegime.peak || 0)) + ' \u00b7 ' + L.valleyWord + ' ' + money(round2(postRegime.valley || 0)))) : null),
      React.createElement('div', { className: 'txg-sec' },
        React.createElement('div', { className: 'txg-sec-t' }, L.pricing),
        pricingTableBlock(pricingNow)),
      range ? React.createElement('div', { className: 'txg-sec' },
        React.createElement('div', { className: 'txg-sec-t' }, L.selectedRange.replace('{hours}', fmtHours(sel))),
        statRow(L.tasks, String(range.count) + ' / ' + allTasks.length),
        statRow(L.requests, String(range.req)),
        statRow(L.today, money(range.today) + (showProj ? (' ' + L.postArrow + ' ' + money(range.post) + ' (' + (range.hike >= 0 ? '+' : '') + range.hike + '%)') : '')),
        showProj ? statRow(L.postPeakValley, money(range.postPeak) + ' / ' + money(range.postValley) + ' \u00b7 ' + range.share + '%') : null,
        statRow(L.tokens, 'miss ' + fmtTok(range.miss) + ' / hit ' + fmtTok(range.hit) + ' / out ' + fmtTok(range.out))) : null);

    // ---- prices tab ----
    function priceCell(r) {
      return 'miss $' + r.miss + ' / hit $' + r.hit + ' / out $' + r.output;
    }
    // Projected peak/valley value after the current price (e.g. current 17 ->
    // peak 34 / valley 8.5): green when cheaper than the current rate, red
    // when more expensive (compared on the headline miss price).
    function projLine(label, price, cur) {
      var extra = '';
      if (price && cur && typeof price.miss === 'number' && typeof cur.miss === 'number') {
        if (price.miss < cur.miss) extra = ' txg-px-less';
        else if (price.miss > cur.miss) extra = ' txg-px-more';
      }
      return React.createElement('span', { className: 'txg-px-proj' + extra }, label + ' $' + price.miss);
    }
    function pricingTableBlock(p) {
      var rates = p.rates || {};
      var models = p.models || [];
      var eff = p.effectiveFromUtc ? Date.parse(p.effectiveFromUtc) : Infinity;
      // Before the effective date the view shows current vs projected
      // post-hike prices; once the new pricing is live it realigns and shows
      // only the peak/valley rates now in effect.
      var postHike = Number.isFinite(eff) && Date.now() >= eff;
      // "Projected" checkbox off -> current-only single column; on + pre-hike ->
      // current vs projected post-hike; on + post-hike -> the peak/valley rates
      // now in effect.
      var head = [];
      var rows = models.map(function (mn) {
        var r = rates[mn];
        if (!r) return null;
        var name = mn === 'deepseek-v4-flash' ? 'flash' : (mn === 'deepseek-v4-pro' ? 'pro' : mn);
        if (!showProj) {
          head = [React.createElement('th', { key: 'm' }, L.model), React.createElement('th', { key: 'c' }, L.current)];
          return React.createElement('tr', { key: mn },
            React.createElement('td', null, name),
            React.createElement('td', { className: 'txg-px-cur' }, priceCell(r.current)));
        }
        if (postHike) {
          head = [React.createElement('th', { key: 'm' }, L.model), React.createElement('th', { key: 'p' }, L.peakCol), React.createElement('th', { key: 'v' }, L.valleyCol)];
          return React.createElement('tr', { key: mn },
            React.createElement('td', null, name),
            React.createElement('td', { className: 'txg-px-cur' }, priceCell(r.peak)),
            React.createElement('td', { className: 'txg-px-cur' }, priceCell(r.valley)));
        }
        head = [React.createElement('th', { key: 'm' }, L.model), React.createElement('th', { key: 'c' }, L.current), React.createElement('th', { key: 'p' }, L.projectedPostHike)];
        return React.createElement('tr', { key: mn },
          React.createElement('td', null, name),
          React.createElement('td', { className: 'txg-px-cur' }, priceCell(r.current)),
          React.createElement('td', null,
            projLine(L.peakWord, r.peak, r.current),
            ' \u00b7 ',
            projLine(L.valleyWord, r.valley, r.current)));
      });
      return React.createElement('div', null,
        React.createElement('table', { className: 'txg-px' },
          React.createElement('thead', null, React.createElement('tr', null, head)),
          React.createElement('tbody', null, rows)));
    }
    // ---- widget + popup ----
    var icon = peak ? '\u2600' : '\ud83c\udf19';
    var widget = React.createElement('span', {
      className: 'txg-widget' + (peak ? ' txg-peak' : ' txg-valley'),
      onClick: function () { setPin(!pin); },
      onMouseEnter: enter,
      onMouseLeave: leave,
      style: { cursor: 'pointer' },
    },
      icon + ' ' + (peak ? L.peakStatus : L.valleyStatus),
      React.createElement('b', null, localTime),
      React.createElement('b', null, money(conv.totalCop)),
      showProj ? React.createElement('b', { className: 'txg-post' }, ' \u2192 ' + money(conv.postCop)) : null,
      React.createElement('span', { className: 'txg-muted' },
        L.tasksCount.replace('{n}', String(conv.taskCount)).replace('{s}', conv.taskCount === 1 ? '' : 's') + (showProj ? L.delta.replace('{pct}', String(conv.hikePct)) : '') + (wasteTotal > 0 ? L.wasteCount.replace('{n}', String(wasteTotal)) : '')));

    // ---- currency list management ----
    function persistCurrencies(list) {
      fetch('/token-anxiety/currencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currencies: list }),
      }).catch(function () {});
    }
    function addCurrency(code) {
      if (enabledCurrencies.indexOf(code) >= 0) return;
      var next = enabledCurrencies.concat([code]);
      setEnabledCurrencies(next);
      setAddOpen(false);
      setAddQuery('');
      persistCurrencies(next);
    }
    function removeCurrency(code) {
      if (enabledCurrencies.length <= 1) return;
      var next = enabledCurrencies.filter(function (c) { return c !== code; });
      setEnabledCurrencies(next);
      if (cur === code) setCur(next[0]);
      persistCurrencies(next);
    }

    // Task-row tooltip, portaled to <body>: the popup's overflow:hidden and the
    // composer band's transform/filter contexts would otherwise clip or
    // miscontain a fixed/absolute child. React removes it on unmount.
    var hoverTip = null;
    if (hovTip && hovTip.task && !tipDismiss['t:' + hovTip.task.turn]) {
      var ht = hovTip.task;
      var hLabel = (isWaste(ht) ? '\u26a0 ' : '') + '#' + String(ht.turn);
      var hDs = fmtDate(ht, tz);
      hoverTip = ReactDOM.createPortal(React.createElement('div', { className: 'txg-tip txg-tip-fixed', style: { bottom: (window.innerHeight - hovTip.top + 4), left: hovTip.left } },
        React.createElement('button', { className: 'txg-tip-x', onClick: function (e) { e.stopPropagation(); setTipDismiss(function (m) { var n = {}; for (var k in m) n[k] = m[k]; n['t:' + ht.turn] = true; return n; }); }, title: L.dismiss }, '\u2715'),
        React.createElement('div', { className: 'txg-tip-t' }, hLabel + ' \u00b7 ' + L.turnPrefix + String(ht.turn) + (hDs ? (' \u00b7 ' + hDs) : '')),
        ht.preview
          ? React.createElement('div', { className: 'txg-tip-p' }, '\u201c' + ht.preview + '\u201d')
          : React.createElement('div', { className: 'txg-tip-p txg-muted' }, L.noRecordedContent),
        isWaste(ht) ? React.createElement('div', { className: 'txg-tip-w' }, '\u26a0 ' + L.possibleWaste.replace('{flags}', ht.waste.map(function (w) { return wasteLabel[w] || w; }).join(' \u00b7 '))) : null,
        React.createElement('div', { className: 'txg-tip-m' }, L.nowShare.replace('{cost}', money(ht.cop)).replace('{pct}', String(typeof ht.sharePct === 'number' ? ht.sharePct : 0)) + (showProj ? L.postLabel.replace('{cost}', money(ht.postCop)) : '')),
        showProj ? React.createElement('div', { className: 'txg-tip-m' }, L.postLabel.replace('{cost}', postPeakStr(ht))) : null,
        React.createElement('div', { className: 'txg-tip-m' }, L.reqLine.replace('{req}', String(ht.requests)).replace('{miss}', fmtTok(ht.missTokens || 0)).replace('{hit}', fmtTok(ht.hitTokens || 0)).replace('{out}', fmtTok(ht.outputTokens || 0)) + L.hourSuffix.replace('{hour}', String(hourOf(ht)).padStart(2, '0')).replace('{regime}', inPeak(hourOf(ht)) ? L.regimePeak : L.regimeValley))), document.body);
    }

    var pop = show ? React.createElement('div', { className: 'txg-pop' },
      React.createElement('div', { className: 'txg-top' },
        React.createElement('div', { style: { fontWeight: 600 } }, icon + ' ' + (peak ? L.peakStatus : L.valleyStatus) + ' \u00b7 ' + localTime + (nextPeriod && nextChangeLocal ? (' \u00b7 \u2192 ' + (nextPeriod === 'peak' ? L.peakStatus : L.valleyStatus) + ' ' + nextChangeLocal) : '')),
        React.createElement('div', { className: 'txg-currow' },
          React.createElement('span', { className: 'txg-cur-lbl' }, L.currency),
          React.createElement('span', { className: 'txg-cc' },
            React.createElement('button', {
              className: 'txg-selbtn' + (curOpen ? ' txg-selbtn-on' : ''),
              onClick: function (e) { e.stopPropagation(); setCurOpen(!curOpen); },
              title: L.chooseCurrency,
            }, cur + (curOpen ? ' \u25b2' : ' \u25bc')),
            curOpen ? React.createElement('div', { className: 'txg-cc-panel' },
              enabledCurrencies.map(function (code) {
                var entry = currencyEntry(code);
                var rate = fxRates[code];
                return React.createElement('div', { key: code, className: 'txg-cc-item' },
                  React.createElement('span', {
                    className: 'txg-cc-pick',
                    onClick: function (e) { e.stopPropagation(); setCur(code); setCurOpen(false); },
                  },
                    React.createElement('span', null, entry ? entry.flag : '\u00a0'),
                    React.createElement('span', { className: 'txg-cc-name' }, L.flagCurrency.replace('{code}', code).replace('{name}', entry ? entry.name : code)),
                    cur === code ? React.createElement('span', { className: 'txg-cc-check' }, '\u2713') : null),
                  rate ? React.createElement('span', { className: 'txg-cc-rate' }, L.fxRate.replace('{rate}', fmtRate(rate)).replace('{code}', code)) : null,
                  enabledCurrencies.length > 1 ? React.createElement('button', {
                    className: 'txg-cc-x',
                    onClick: function (e) { e.stopPropagation(); removeCurrency(code); },
                    title: L.removeCurrencyTitle.replace('{code}', code),
                  }, '\u2715') : null);
              }),
              React.createElement('div', {
                className: 'txg-cc-add',
                onClick: function (e) { e.stopPropagation(); setAddOpen(!addOpen); },
              }, addOpen ? L.closeAdd : L.addCurrency),
              addOpen ? React.createElement('div', { className: 'txg-cc-addlist' },
                React.createElement('input', {
                  className: 'txg-cc-search',
                  type: 'text',
                  value: addQuery,
                  onChange: function (e) { setAddQuery(e.target.value); },
                  onClick: function (e) { e.stopPropagation(); },
                  placeholder: L.searchCurrency,
                }),
                CURRENCY_CATALOG.filter(function (c) {
                  if (enabledCurrencies.indexOf(c.code) >= 0) return false;
                  var q = addQuery.trim().toLowerCase();
                  if (!q) return true;
                  return c.code.toLowerCase().indexOf(q) >= 0 || c.name.toLowerCase().indexOf(q) >= 0;
                }).slice(0, 50).map(function (c) {
                  var rate = fxRates[c.code];
                  return React.createElement('div', {
                    key: c.code,
                    className: 'txg-cc-item',
                    onClick: function (e) { e.stopPropagation(); addCurrency(c.code); },
                  },
                    React.createElement('span', null, c.flag),
                    React.createElement('span', { className: 'txg-cc-name' }, c.code + ' \u00b7 ' + c.name),
                    rate ? React.createElement('span', { className: 'txg-cc-rate' }, L.fxRate.replace('{rate}', fmtRate(rate)).replace('{code}', c.code)) : null);
                })) : null) : null),
          React.createElement('label', { className: 'txg-projchk', title: L.showProjected },
            React.createElement('input', { type: 'checkbox', checked: showProj, onChange: function (e) { setShowProj(e.target.checked); } }),
            L.projected)),
        React.createElement('div', { className: 'txg-tabs' },
          React.createElement('button', { className: 'txg-tab' + (tab === 'overview' ? ' txg-tab-on' : ''), onClick: function () { setTab('overview'); } }, L.overview),
          React.createElement('button', { className: 'txg-tab' + (tab === 'tasks' ? ' txg-tab-on' : ''), onClick: function () { setTab('tasks'); } }, L.tasks))),
      strip,
      React.createElement('div', { className: 'txg-tabbody' },
        tab === 'overview' ? overview : null,
        tab === 'tasks' ? tasksTab : null),
      hoverTip,
      React.createElement('div', { className: 'txg-ft' },
        projection.model + ' \u00b7 ' + (peak ? L.peakWord : L.valleyWord) + L.footer.replace('{cur}', cur))) : null;

    return React.createElement('span', { style: { position: 'relative', display: 'inline-flex' } }, widget, pop);
  }

  // ---- plugin ----
  function apply(ctx) {
    var slots = ctx.get('slots');
    if (slots === undefined) return;
    insertStyles(CSS);
    var localeSvc = ctx.get('locale');
    var t = null;
    var subscribeLocale = null;
    var activeLocale = 'en';
    if (localeSvc !== undefined) {
      t = localeSvc.bind('token-anxiety');
      subscribeLocale = function (fn) { return localeSvc.subscribe(fn); };
      try { activeLocale = localeSvc.getLocale().active; } catch (e) {}
      ctx.effect(function () { return localeSvc.register('token-anxiety', I18N); });
    }
    ctx.slots.inject('conversation.composer.dock', function () {
      return ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'token-anxiety',
        order: 1,
        inject: function (sessionId) {
          return {
            t: t,
            subscribeLocale: subscribeLocale,
            activeLocale: activeLocale,
            onExplain: function (task, onDelta) {
              // Direct host call: the host half registers /token-anxiety/explain
              // on the webserver and streams the analysis back as NDJSON lines
              // ({"delta": …} per chunk, then {"error": …} or {"done": …}).
              // Same-origin fetch; no agent turn, no session event.
              var acc = '';
              var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
              var fetTimer = ctrl ? setTimeout(function () { ctrl.abort(); }, 70000) : null;
              function clearFet() { if (fetTimer !== null) { clearTimeout(fetTimer); fetTimer = null; } }
              return fetch('/token-anxiety/explain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sessionId, task: task }),
                signal: ctrl ? ctrl.signal : undefined,
              }).then(function (r) {
                if (!r.ok) return r.json().then(function (j) { throw new Error((j && j.error) || ('HTTP ' + r.status)); });
                if (!r.body || typeof r.body.getReader !== 'function') return r.json();
                var reader = r.body.getReader();
                var decoder = new TextDecoder('utf-8');
                var buf = '';
                var truncated = false;
                function pump() {
                  return reader.read().then(function (res) {
                    if (res.done) return { text: acc, truncated: truncated };
                    buf += decoder.decode(res.value, { stream: true });
                    var lines = buf.split('\n');
                    buf = lines.pop();
                    for (var i = 0; i < lines.length; i++) {
                      var line = lines[i].trim();
                      if (!line) continue;
                      var msg;
                      try { msg = JSON.parse(line); } catch (e) { continue; }
                      if (msg.delta) { acc += msg.delta; if (onDelta) onDelta(acc); }
                      else if (msg.error) return Promise.reject(new Error(msg.error));
                      else if (msg.done) truncated = !!msg.truncated;
                    }
                    return pump();
                  });
                }
                return pump();
              }).then(function (v) { clearFet(); return v; }, function (e) { clearFet(); throw e; });
            },
          };
        },
      }, TokenAnxietyWidget);
    });
  }

  module.exports = { name: 'dsh-token-anxiety', inject: ['slots', 'locale'], apply: apply };
  return module.exports;
} });
