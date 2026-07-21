/* ============================================================================
   Tevus prototype — data-driven UI over the dummy JSON model (window.DB).

   No backend. Every number on screen is DERIVED from data/*.json (bundled into
   db.js by build.py). Sign-in is real against data/users.json: the account you
   pick decides the portal, the navigation, the permissions and the data scope —
   which is how this prototype demonstrates multi-tenant isolation (Req 2.1–2.3).

   The corner "Demo accounts" popup on the login screen lists every seeded login;
   picking one auto-fills the form and signs straight in.
   ========================================================================= */
(function () {
  var app = document.getElementById('app');
  var DB = window.DB;
  var NOW = '2026-07-21T14:08:00Z';   // frozen "now" so the dummy data reads consistently

  /* ---- View state ------------------------------------------------------ */
  var state = {
    user: null,                 // signed-in user object from DB.users (null = logged out)
    inviteUser: null,           // user being onboarded on the set-password screen
    loginEmail: '',
    loginError: '',
    acctMenu: false,            // top-bar account switcher open
    mobileNav: false,           // off-canvas sidebar open (narrow viewports)
    ovPeriod: 14,                // overview period filter, in days
    periodMenu: false,          // overview period dropdown open
    exportMenu: false,          // overview export dropdown open
    demoPop: true,              // corner demo-accounts popup open
    overlay: null,              // 'new-client' | 'assign'
    drawer: null,               // { type:'transcript', id } | { type:'sync' }
    toast: '',
    clientTab: 'personas',
    assignFor: null,
    assignSel: {},
    personaFilter: 'all',
    personaTab: 'analytics',
    replicaTab: 'overview',
    convSort: { key: 'started_at', dir: 'desc' },       // shared by every conversation table
    convFilter: '',
    report: null,                                       // report being previewed
    lastRoute: null,
    tree: { open: {}, sel: null, seeded: false },       // explorer tree
    db: { z: 1, x: 0, y: 0, sel: null, ready: false }   // schema-canvas view (survives re-renders)
  };

  /* ---- Derived data layer (recomputed after any mutation) -------------- */
  var IX = {};
  function rebuild() {
    IX.clientsById = index(DB.clients);
    IX.conversationsById = index(DB.conversations);
    IX.personasById = index(DB.personas);
    IX.replicasById = index(DB.replicas);
    IX.usersById = index(DB.users);

    // per-persona period totals from usage_daily
    IX.personaTotals = {};
    IX.personaSeries = {};
    DB.usage_daily.forEach(function (r) {
      var t = IX.personaTotals[r.persona_id] || (IX.personaTotals[r.persona_id] = { minutes: 0, convos: 0 });
      t.minutes += r.minutes; t.convos += r.conversations;
      (IX.personaSeries[r.persona_id] || (IX.personaSeries[r.persona_id] = [])).push(r);
    });

    // per-client rollups (a client's usage = usage of the personas it owns)
    IX.clientTotals = {};
    DB.clients.forEach(function (c) { IX.clientTotals[c.id] = { minutes: 0, convos: 0, personas: 0 }; });
    DB.personas.forEach(function (p) {
      if (!p.client_id) return;
      var ct = IX.clientTotals[p.client_id]; if (!ct) return;
      ct.personas += 1;
      var t = IX.personaTotals[p.id] || { minutes: 0, convos: 0 };
      ct.minutes += t.minutes; ct.convos += t.convos;
    });

    // ledger-derived budget / remaining per client
    IX.clientLedger = {};
    IX.clientBudget = {};
    DB.clients.forEach(function (c) { IX.clientLedger[c.id] = []; IX.clientBudget[c.id] = { allocated: 0, used: 0 }; });
    DB.minute_ledger.forEach(function (e) {
      (IX.clientLedger[e.client_id] || (IX.clientLedger[e.client_id] = [])).push(e);
      var b = IX.clientBudget[e.client_id] || (IX.clientBudget[e.client_id] = { allocated: 0, used: 0 });
      if (e.amount >= 0) b.allocated += e.amount; else b.used += -e.amount;
    });
  }
  function index(arr) { var m = {}; (arr || []).forEach(function (x) { m[x.id] = x; }); return m; }

  function clientRemaining(cid) { var b = IX.clientBudget[cid] || { allocated: 0, used: 0 }; return b.allocated - b.used; }
  function clientPctUsed(cid) { var b = IX.clientBudget[cid] || { allocated: 0, used: 0 }; return b.allocated ? Math.round(b.used / b.allocated * 100) : 0; }

  function seriesForClient(cid) { return seriesFrom(DB.usage_daily.filter(function (r) { return r.client_id === cid; })); }
  function seriesAll() { return seriesFrom(DB.usage_daily); }
  function seriesForPersona(pid) { return seriesFrom((IX.personaSeries[pid] || [])); }
  function seriesFrom(rows) {
    var byDate = {};
    rows.forEach(function (r) { byDate[r.date] = (byDate[r.date] || 0) + r.minutes; });
    var dates = Object.keys(byDate).sort();
    return { dates: dates, values: dates.map(function (d) { return byDate[d]; }) };
  }

  /* ---- Formatters ------------------------------------------------------ */
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function nf(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  function fmtDate(iso) { var d = new Date(iso + (iso.length <= 10 ? 'T00:00:00Z' : '')); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function fmtDateTime(iso) { var d = new Date(iso); var h = d.getUTCHours(), m = d.getUTCMinutes(); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
  function fmtDur(sec) { var m = Math.floor(sec / 60), s = sec % 60; return m + 'm ' + (s < 10 ? '0' : '') + s + 's'; }
  function ago(iso) { var mins = Math.round((Date.parse(NOW) - Date.parse(iso)) / 60000); if (mins < 1) return 'just now'; if (mins < 60) return mins + 'm ago'; var h = Math.round(mins / 60); if (h < 48) return h + 'h ago'; return Math.round(h / 24) + 'd ago'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var AV_TONES = ['av-orange', 'av-pink', 'av-violet', 'av-emerald', 'av-blue', 'av-amber'];
  function initials(name) { return (name || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  function tone(name) { var s = name || '', h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return AV_TONES[(h >>> 0) % AV_TONES.length]; }
  function avatar(name, size) { return '<span class="av ' + (size ? size + ' ' : '') + tone(name) + '">' + initials(name) + '</span>'; }

  /* ---- Icons (16px stroke set) ----------------------------------------- */
  var PATHS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    building: '<path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 21V9h2a2 2 0 0 1 2 2v10M9 7h2M9 11h2M9 15h2"/>',
    persona: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    replica: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="12" cy="10.5" r="2.5"/><path d="M7.5 17a4.7 4.7 0 0 1 9 0"/>',
    chat: '<path d="M20 12a8 8 0 1 1-3.4-6.5"/><path d="M20 4v5h-5"/><path d="M8.5 11h7M8.5 14.5h4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.4M17.5 19a6 6 0 0 0-2.2-4.6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 19.4 9H21a2 2 0 1 1 0 4h-.1"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h9"/>',
    db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
    tree: '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="9.5" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M6 8v9a1 1 0 0 0 1 1h8M6 12h9"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>'
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PATHS[name] || '') + '</svg>';
  }

  /* ---- Charts (real values from usage_daily) --------------------------- */
  function areaChart(values, dates, h) {
    var W = 720, H = h || 200, padY = 14, padB = 10, padX = 3, n = values.length;
    if (!n) return emptyChart(H);
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    var x = function (i) { return padX + i * ((W - 2 * padX) / (n - 1 || 1)); };
    var y = function (v) { var t = (v - min) / (max - min || 1); return padY + (1 - t) * (H - padY - padB); };
    var pts = values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); });
    var line = 'M' + pts.join(' L');
    var area = line + ' L' + x(n - 1).toFixed(1) + ',' + (H - padB) + ' L' + x(0).toFixed(1) + ',' + (H - padB) + ' Z';
    var grid = '';
    for (var g = 0; g <= 3; g++) { var gy = (padY + g * (H - padY - padB) / 3).toFixed(1); grid += '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" stroke="#f3f4f6" stroke-width="1" vector-effect="non-scaling-stroke"/>'; }
    var lx = x(n - 1).toFixed(1), ly = y(values[n - 1]).toFixed(1);
    // axis labels render as HTML so they stay undistorted under preserveAspectRatio="none"
    var axis = '';
    if (dates) {
      var ticks = [0, Math.floor((n - 1) / 2), n - 1];
      axis = '<div class="axis">' + ticks.map(function (i) { return '<span>' + fmtDate(dates[i]) + '</span>'; }).join('') + '</div>';
    }
    return '<div class="chart-wrap">' +
      '<div class="chart" style="height:' + H + 'px">' +
      '<span class="chart-y">' + nf(max) + '</span>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="minutes over time">' +
      '<defs><linearGradient id="af" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#111111" stop-opacity="0.11"/><stop offset="1" stop-color="#111111" stop-opacity="0"/></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#af)"/>' +
      '<path d="' + line + '" fill="none" stroke="#111111" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + lx + '" cy="' + ly + '" r="3.5" fill="#111111"/></svg></div>' + axis + '</div>';
  }
  function emptyChart(H) { return '<div class="chart-wrap"><div class="chart" style="height:' + H + 'px;background:var(--surface-soft)"></div></div>'; }
  function sparkline(values, h) {
    var H = h || 52, W = 220, pad = 5, n = values.length;
    if (!n) return emptyChart(H);
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    var x = function (i) { return pad + i * ((W - 2 * pad) / (n - 1 || 1)); };
    var y = function (v) { var t = (v - min) / (max - min || 1); return pad + (1 - t) * (H - 2 * pad); };
    var pts = values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); });
    var line = 'M' + pts.join(' L');
    var area = line + ' L' + x(n - 1).toFixed(1) + ',' + (H - pad) + ' L' + x(0).toFixed(1) + ',' + (H - pad) + ' Z';
    return '<div class="chart" style="height:' + H + 'px"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="usage sparkline">' +
      '<path d="' + area + '" fill="#111111" fill-opacity="0.06"/><path d="' + line + '" fill="none" stroke="#111111" stroke-width="1.75" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>';
  }
  function barRows(items) {
    if (!items.length) return '<div class="empty"><b>Nothing to chart yet</b>usage appears once conversations are synced</div>';
    var max = Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    return items.map(function (i) {
      return '<div class="hrow"><span>' + esc(i.label) + '</span><span class="track"><i style="width:' + Math.max(2, Math.round(i.value / max * 100)) + '%"></i></span><span class="num">' + nf(i.value) + '</span></div>';
    }).join('');
  }
  function statusPill(s) {
    var k = { active: '', assigned: '', ready: '', healthy: '', success: '', paused: 'off', unassigned: 'off', training: 'pend', invited: 'pend', reconciled: 'info', disabled: 'err' };
    var cls = k[s] == null ? '' : k[s];
    return '<span class="pill ' + cls + '"><span class="gd"></span>' + s.charAt(0).toUpperCase() + s.slice(1) + '</span>';
  }
  function roleLabel(g) {
    return { 'internal-admin': 'Internal · Admin', 'internal-staff': 'Internal · Staff', 'client-admin': 'Client · Admin', 'client-user': 'Client · User' }[g] || g;
  }

  /* ============================================================================
     Conversation tables — one sortable / filterable component, reused by the
     Conversations screen, Persona detail and Replica detail. Sort and filter
     live in state so the table keeps its arrangement across a re-render.
     ========================================================================= */
  var CONV_SORT = {
    started_at: function (c) { return Date.parse(c.started_at); },
    duration_seconds: function (c) { return c.duration_seconds; },
    turns: function (c) { return DB.transcripts[c.id] ? DB.transcripts[c.id].turns.length : 0; },
    persona: function (c) { var p = IX.personasById[c.persona_id]; return p ? p.name.toLowerCase() : ''; },
    client: function (c) { return clientOf(c) ? clientOf(c).name.toLowerCase() : ''; },
    end_user_ref: function (c) { return c.end_user_ref || ''; }
  };
  function clientOf(c) { var p = IX.personasById[c.persona_id]; return p && p.client_id ? IX.clientsById[p.client_id] : null; }

  function convApply(list) {
    var q = state.convFilter.trim().toLowerCase();
    if (q) list = list.filter(function (c) {
      var p = IX.personasById[c.persona_id], cl = clientOf(c), r = c.replica_id ? IX.replicasById[c.replica_id] : null;
      return [c.tavus_conversation_id, c.end_user_ref, p && p.name, cl && cl.name, r && r.name, fmtDateTime(c.started_at)]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var s = state.convSort, get = CONV_SORT[s.key] || CONV_SORT.started_at;
    return list.slice().sort(function (a, b) {
      var x = get(a), y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (s.dir === 'asc' ? 1 : -1);
    });
  }
  function sortTh(key, label, cls) {
    var on = state.convSort.key === key;
    return '<th class="' + (cls ? cls + ' ' : '') + 'sortable' + (on ? ' on' : '') + '" data-sort="' + key + '">' +
      label + '<i class="sc">' + (on ? (state.convSort.dir === 'asc' ? '▲' : '▼') : '↕') + '</i></th>';
  }
  function convFilterBar(shown, total) {
    return '<div class="filterbar">' +
      '<input class="inp fsearch" id="convq" placeholder="Filter by persona, client, face, end user or date…" value="' + esc(state.convFilter) + '">' +
      (state.convFilter ? '<span class="btn sm" data-convclear>Clear</span>' : '') +
      '<span class="fcount">' + nf(shown) + ' of ' + nf(total) + '</span></div>';
  }

  /* ---- CSV (reports actually produce a file) ---------------------------- */
  function toCsv(headers, rows) {
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [headers.map(q).join(',')].concat(rows.map(function (r) { return r.map(q).join(','); })).join('\r\n');
  }
  function downloadFile(name, text, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: mime + ';charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 0);
  }
  function downloadCsv(name, text) { downloadFile(name, text, 'text/csv');
  }

  /* ---- Report definitions — each one builds its rows from live data ------ */
  var REPORTS = [
    { id: 'usage_by_client', name: 'Usage by client', scope: 'All clients', period: 'Current term',
      headers: ['Client', 'Status', 'Personas', 'Conversations', 'Minutes used', 'Allocated', 'Remaining'],
      build: function () {
        return DB.clients.map(function (c) {
          var t = IX.clientTotals[c.id], b = IX.clientBudget[c.id];
          return [c.name, c.status, t.personas, t.convos, t.minutes, b.allocated, b.allocated - b.used];
        });
      } },
    { id: 'persona_breakdown', name: 'Persona breakdown', scope: 'All personas', period: 'Last 14 days',
      headers: ['Persona', 'Tavus persona ID', 'Client', 'Replica', 'Conversations', 'Minutes'],
      build: function () {
        return DB.personas.map(function (p) {
          var t = IX.personaTotals[p.id] || { minutes: 0, convos: 0 };
          var r = p.replica_id ? IX.replicasById[p.replica_id] : null;
          return [p.name, p.tavus_persona_id, p.client_id ? IX.clientsById[p.client_id].name : 'Unassigned',
            r ? r.name : '—', t.convos, t.minutes];
        });
      } },
    { id: 'daily_usage', name: 'Daily usage rollup', scope: 'All clients', period: 'Day by day',
      headers: ['Date', 'Client', 'Persona', 'Conversations', 'Minutes'],
      build: function () {
        return DB.usage_daily.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (r) {
          var p = IX.personasById[r.persona_id], c = IX.clientsById[r.client_id];
          return [r.date, c ? c.name : r.client_id, p ? p.name : r.persona_id, r.conversations, r.minutes];
        });
      } },
    { id: 'conversation_log', name: 'Conversation log', scope: 'All clients', period: 'Stored sessions',
      headers: ['Started at', 'Client', 'Persona', 'Replica', 'Duration (s)', 'Turns', 'End user'],
      build: function () {
        return DB.conversations.slice().sort(function (a, b) { return Date.parse(b.started_at) - Date.parse(a.started_at); }).map(function (c) {
          var p = IX.personasById[c.persona_id], cl = clientOf(c), r = c.replica_id ? IX.replicasById[c.replica_id] : null;
          return [c.started_at, cl ? cl.name : 'Unassigned', p ? p.name : c.persona_id, r ? r.name : '—',
            c.duration_seconds, DB.transcripts[c.id] ? DB.transcripts[c.id].turns.length : 0, c.end_user_ref];
        });
      } },
    { id: 'minute_ledger', name: 'Minute ledger', scope: 'All clients', period: 'Full history',
      headers: ['Date', 'Client', 'Type', 'Amount', 'Balance after', 'Admin', 'Note'],
      build: function () {
        return DB.minute_ledger.map(function (l) {
          var c = IX.clientsById[l.client_id];
          return [l.date, c ? c.name : l.client_id, l.type, l.amount, l.balance_after, l.admin || '', l.note || ''];
        });
      } }
  ];
  function reportById(id) { return REPORTS.filter(function (r) { return r.id === id; })[0]; }

  /* ---- Session helpers -------------------------------------------------- */
  function isClientView() { return !!state.user && state.user.group.indexOf('client-') === 0; }
  function currentClientId() { return isClientView() ? state.user.client_id : null; }
  function canProvision() { return !!state.user && state.user.group === 'internal-admin'; }   // staff = read-mostly (Req 2.2)
  function canManageOrgUsers() { return !!state.user && state.user.group === 'client-admin'; }
  function homeRoute(u) { return u.group.indexOf('client-') === 0 ? '#/c/dashboard' : '#/overview'; }

  /* ---- Portal chrome --------------------------------------------------- */
  var INTERNAL_NAV = [
    ['Overview', '#/overview', 'grid'], ['Clients', '#/clients', 'building'], ['Personas', '#/personas', 'persona'],
    ['Replicas', '#/replicas', 'replica'], ['Conversations', '#/conversations', 'chat'], ['Reports', '#/reports', 'doc'],
    ['Users', '#/users', 'users'], ['Explorer', '#/explorer', 'tree'], ['Database', '#/database', 'db'],
    ['__spacer__'], ['Settings', '#/overview', 'gear']
  ];
  var CLIENT_NAV = [
    ['Dashboard', '#/c/dashboard', 'chart'], ['Minutes', '#/c/minutes', 'clock'], ['Personas', '#/c/personas', 'persona'],
    ['Conversations', '#/c/conversations', 'chat'], ['__spacer__'], ['Profile & Settings', '#/c/profile', 'user']
  ];

  function navTail(route) {
    var cid = currentClientId();
    switch (route) {
      case '#/clients': return DB.clients.length;
      case '#/personas': return DB.personas.length;
      case '#/replicas': return DB.replicas.length;
      case '#/conversations': return DB.conversations.length;
      case '#/users': return DB.users.length;
      case '#/database': return ER_TABLES.length;
      case '#/c/personas': return DB.personas.filter(function (p) { return p.client_id === cid; }).length;
      case '#/c/conversations': return DB.conversations.filter(function (c) { var p = IX.personasById[c.persona_id]; return p && p.client_id === cid; }).length;
      default: return '';
    }
  }

  function sidebar(active) {
    var u = state.user;
    var items = (isClientView() ? CLIENT_NAV : INTERNAL_NAV).map(function (n) {
      if (n[0] === '__spacer__') return '<span class="spx"></span>';
      var tail = navTail(n[1]);
      return '<a class="' + (n[1] === active ? 'on' : '') + '" data-nav="' + n[1] + '">' + icon(n[2]) + n[0] +
        (tail !== '' ? '<span class="tail">' + tail + '</span>' : '') + '</a>';
    }).join('');
    var me = '<div class="me">' + avatar(u.name, 'sm') +
      '<div class="t"><b>' + esc(u.name) + '</b><span>' + esc(roleLabel(u.group)) + '</span></div>' +
      '<span class="out" data-signout title="Sign out">' + icon('out') + '</span></div>';
    return '<div class="side' + (state.mobileNav ? ' open' : '') + '"><span class="menu-x" data-nav-close aria-label="Close menu">✕</span>' +
      '<div class="logo">Tevus</div>' +
      '<div class="kicker">' + (isClientView() ? 'your workspace' : 'platform') + '</div>' +
      '<div class="nav" style="flex:1">' + items + '</div>' + me + '</div>';
  }

  function accountMenu() {
    var u = state.user;
    var row = function (x) {
      return '<button class="acct' + (x.id === u.id ? ' on' : '') + '" data-switch="' + x.id + '">' + avatar(x.name, 'sm') +
        '<span class="t"><b>' + esc(x.name) + '</b><span>' + esc(x.email) + '</span></span>' +
        '<span class="role">' + esc(x.client_id ? IX.clientsById[x.client_id].name : roleLabel(x.group).split(' · ')[1]) + '</span></button>';
    };
    var live = DB.users.filter(function (x) { return x.status === 'active'; });
    var internal = live.filter(function (x) { return x.group.indexOf('internal-') === 0; }).map(row).join('');
    var clients = live.filter(function (x) { return x.group.indexOf('client-') === 0; }).map(row).join('');
    var menu = state.acctMenu ? (
      '<div class="menu">' +
      '<div class="grp">Internal team</div>' + internal +
      '<div class="grp">Client logins (scoped)</div>' + clients +
      '<div class="mfoot"><button class="acct" data-signout><span class="av sm av-ink">' + '↩' + '</span>' +
      '<span class="t"><b>Sign out</b><span>back to the login screen</span></span></button></div></div>'
    ) : '';
    return '<div class="rolesw">' +
      '<div class="cur" data-acct-toggle>' + avatar(u.name, 'sm') +
      '<span class="who"><b>' + esc(u.name) + '</b><span>' + esc(u.client_id ? IX.clientsById[u.client_id].name : roleLabel(u.group)) + '</span></span>' +
      '<span class="caret">▾</span></div>' + menu + '</div>';
  }

  function topbar() {
    var left;
    if (isClientView()) {
      left = '<div class="search">Search your personas &amp; conversations…<span class="kbd">⌘K</span></div>';
    } else {
      var s = DB.sync_status, warn = s.status !== 'healthy';
      left = '<div class="search">Search clients, personas, conversations…<span class="kbd">⌘K</span></div>' +
        '<div class="sync" data-sync><span class="dot' + (warn ? ' warn' : '') + '"></span>Synced ' + ago(s.last_sync_at) + '</div>';
    }
    var menuBtn = '<span class="menu-btn" data-menu-toggle role="button" aria-label="Open menu">' + icon('menu') + '</span>';
    return '<div class="top">' + menuBtn + left + accountMenu() + '</div>';
  }

  function shell(active, content, cls) {
    return '<div class="scr">' + sidebar(active) +
      (state.mobileNav ? '<div class="nav-scrim" data-nav-close></div>' : '') +
      '<div class="main">' + topbar() +
      '<div class="content' + (cls ? ' ' + cls : '') + '">' + content + '</div></div></div>' + overlays();
  }
  function ph(title, sub, right) {
    return '<div class="ph"><h1>' + esc(title) + '</h1>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + (right ? '<div class="r">' + right + '</div>' : '') + '</div>';
  }
  function emptyRow(cols, title, msg) {
    return '<tr><td colspan="' + cols + '"><div class="empty"><b>' + esc(title) + '</b>' + esc(msg) + '</div></td></tr>';
  }

  /* ---- Overlays & drawers ---------------------------------------------- */
  function overlays() {
    var html = '';
    if (state.overlay === 'new-client') {
      html += '<div class="ov" data-close-ov><div class="modal">' +
        '<h3>New client</h3>' +
        '<div class="note">creates the client org + first login (Cognito user) + initial minute ledger entry</div>' +
        '<div class="fld">Client name<input class="inp" id="nc_name" placeholder="e.g. Wayne Enterprises"></div>' +
        '<div class="fld">Initial minute allocation<input class="inp" id="nc_alloc" value="3000"></div>' +
        '<div class="fld">First login (email → invite)<input class="inp" id="nc_email" placeholder="admin@client.com"></div>' +
        '<div class="mend"><span class="btn" data-close>Cancel</span><span class="btnp" data-create-client>Create &amp; send invite</span></div></div></div>';
    }
    if (state.overlay === 'assign') {
      var pool = DB.personas.filter(function (p) { return !p.client_id; });
      var rows = pool.length ? pool.map(function (p) {
        var on = state.assignSel[p.id] ? ' on' : '';
        return '<div class="ckrow" data-assign-toggle="' + p.id + '"><span class="ck' + on + '"></span><b>' + esc(p.name) + '</b>' +
          '<span class="pill off"><span class="gd"></span>Unassigned</span>' +
          (p.replica_id ? '<span class="note" style="margin-left:auto">face: ' + esc(IX.replicasById[p.replica_id].name) + '</span>' : '') + '</div>';
      }).join('') : '<div class="empty"><b>Pool is empty</b>every synced persona is already assigned to a client</div>';
      var count = Object.keys(state.assignSel).filter(function (k) { return state.assignSel[k]; }).length;
      html += '<div class="ov" data-close-ov><div class="modal">' +
        '<h3>Assign to ' + esc(IX.clientsById[state.assignFor].name) + '</h3>' +
        '<div class="note">unassigned personas only — one persona = one client</div>' + rows +
        '<div class="mend"><span class="btn" data-close>Cancel</span><span class="btnp" data-assign-commit>Assign ' + count + ' selected</span></div></div></div>';
    }
    if (state.drawer && state.drawer.type === 'transcript') html += transcriptDrawer(state.drawer.id);
    if (state.drawer && state.drawer.type === 'sync') html += syncDrawer();
    if (state.toast) html += '<div class="toast"><span class="gd"></span>' + esc(state.toast) + '</div>';
    return html;
  }

  function transcriptDrawer(cid) {
    var conv = DB.conversations.filter(function (c) { return c.id === cid; })[0];
    if (!conv) return '';
    var persona = IX.personasById[conv.persona_id], replica = persona && persona.replica_id ? IX.replicasById[persona.replica_id] : null;
    var client = persona && persona.client_id ? IX.clientsById[persona.client_id] : null;
    var tr = DB.transcripts[cid];
    var lines = tr ? tr.turns.map(function (t) { return '<div class="bub ' + t.speaker + '">' + esc(t.text) + '</div>'; }).join('')
      : '<div class="empty"><b>No transcript stored</b>this session predates transcript capture</div>';
    return '<div class="drawer">' +
      '<div class="drawer-head">' + avatar(persona ? persona.name : '?') +
      '<div><b>' + esc(persona ? persona.name : '—') + '</b> · ' + esc(replica ? replica.name : '—') +
      '<div class="note">' + esc(client ? client.name : 'Unassigned') + ' · ' + fmtDateTime(conv.started_at) + ' · ' + fmtDur(conv.duration_seconds) + '</div></div>' +
      '<span class="x" data-close>✕</span></div><div class="hr"></div>' +
      '<div class="thread">' + lines + '</div>' +
      '<div class="note">turn-by-turn transcript · read-only</div></div>';
  }

  function syncDrawer() {
    var s = DB.sync_status;
    var runs = s.recent_runs.map(function (r) {
      return '<tr><td class="mono">' + fmtDateTime(r.at) + '</td><td>' + statusPill(r.status) + '</td><td class="num">' + nf(r.records) + '</td></tr>';
    }).join('');
    return '<div class="drawer">' +
      '<div class="drawer-head"><b style="font-family:var(--font-display);font-size:16px;letter-spacing:-.3px">Data pipeline</b>' +
      statusPill(s.status) + '<span class="x" data-close>✕</span></div><div class="hr"></div>' +
      '<div class="kv"><span class="k">Last sync</span><span class="v">' + fmtDateTime(s.last_sync_at) + ' (' + ago(s.last_sync_at) + ')</span>' +
      '<span class="k">Interval</span><span class="v">every ' + s.interval_minutes + ' min</span>' +
      '<span class="k">Source</span><span class="v">' + esc(s.source) + '</span>' +
      '<span class="k">Last run</span><span class="v">' + nf(s.records_pulled_last_run) + ' records</span></div><div class="hr"></div>' +
      '<div class="note">recent runs — the scheduled sync reconciles anything a webhook missed</div>' +
      '<div class="card"><table class="tbl"><tr><th>Run</th><th>Status</th><th class="num">Records</th></tr>' + runs + '</table></div></div>';
  }

  /* ============================ AUTH ==================================== */
  /* The demo-accounts popup is the prototype's own affordance (not a product
     feature): it lists every seeded login so a reviewer can jump between
     portals in one click and see the isolation model for themselves. */
  function demoPopup() {
    if (!state.demoPop) return '<button class="demo-tab" data-demo-toggle>' + icon('users') + 'Demo accounts</button>';
    var row = function (u) {
      var scope = u.client_id ? IX.clientsById[u.client_id].name : roleLabel(u.group).split(' · ')[1];
      var flag = u.status === 'invited' ? ' pend' : (u.status === 'disabled' ? ' pend' : '');
      var badge = u.status === 'active' ? esc(scope) : (u.status === 'invited' ? 'invited' : 'disabled');
      return '<button class="acct' + flag + '" data-signin="' + esc(u.email) + '">' + avatar(u.name, 'sm') +
        '<span class="t"><b>' + esc(u.name) + '</b><span>' + esc(u.email) + '</span></span>' +
        '<span class="role">' + badge + '</span></button>';
    };
    var internal = DB.users.filter(function (u) { return u.group.indexOf('internal-') === 0; }).map(row).join('');
    var clients = DB.users.filter(function (u) { return u.group.indexOf('client-') === 0; }).map(row).join('');
    return '<div class="demo-pop">' +
      '<div class="dh"><span class="dot"></span><b>Demo accounts</b><span class="x" data-demo-toggle>✕</span></div>' +
      '<div class="dlist"><div class="dgrp">Internal team</div>' + internal +
      '<div class="dgrp">Client logins</div>' + clients + '</div>' +
      '<div class="dfoot">any password works · prototype only</div></div>';
  }

  function scrLogin() {
    var acme = IX.clientsById['cli_acme'];
    var frag = '<div class="frag">' +
      '<div class="frow"><b>' + esc(acme.name) + '</b><span style="margin-left:auto">minutes remaining</span></div>' +
      '<div class="fnum">' + nf(clientRemaining('cli_acme')) + ' <span style="font-size:13px;color:var(--on-dark-soft);font-weight:500">/ ' + nf(IX.clientBudget['cli_acme'].allocated) + '</span></div>' +
      '<div class="frow"><span class="fbar"><i style="width:' + clientPctUsed('cli_acme') + '%"></i></span>' + clientPctUsed('cli_acme') + '%</div>' +
      '<div class="fmini">' +
      '<div>Personas<span>' + IX.clientTotals['cli_acme'].personas + '</span></div>' +
      '<div>Conversations<span>' + nf(IX.clientTotals['cli_acme'].convos) + '</span></div>' +
      '<div>Minutes<span>' + nf(IX.clientTotals['cli_acme'].minutes) + '</span></div></div></div>';

    var aside = '<div class="auth-aside"><div class="brand">Tevus</div>' +
      '<div class="pitch"><h1>Usage, ownership and budgets — for every client on one Tavus account.</h1>' +
      '<p>Tevus adds the tenancy layer Tavus lacks: each client sees only the personas assigned to them, and every minute is tracked against a ledger.</p></div>' +
      frag +
      '<div class="foot"><div><b>' + DB.clients.length + '</b>client orgs</div><div><b>' + DB.personas.length + '</b>personas synced</div><div><b>' + nf(DB.usage_daily.reduce(function (a, r) { return a + r.minutes; }, 0)) + '</b>minutes tracked</div></div></div>';

    var err = state.loginError ? '<div class="auth-err">⚠ ' + esc(state.loginError) + '</div>' : '';
    var main = '<div class="auth-main"><div class="auth-form">' +
      '<div class="head"><h2>Sign in</h2><p>One sign-in for internal and client users — your role decides where you land.</p></div>' + err +
      '<form id="loginForm">' +
      '<div class="fld">Email<input class="inp" id="loginEmail" type="email" autocomplete="username" placeholder="you@company.com" value="' + esc(state.loginEmail) + '"></div>' +
      '<div class="fld">Password<input class="inp" id="loginPw" type="password" autocomplete="current-password" value="demo1234"></div>' +
      '<button type="submit" class="btnp block">Sign in</button></form>' +
      '</div></div>';

    return '<div class="auth">' + aside + main + '</div>' + demoPopup() + (state.toast ? '<div class="toast"><span class="gd"></span>' + esc(state.toast) + '</div>' : '');
  }

  function scrSetPassword() {
    var u = state.inviteUser;
    var email = u ? u.email : 'invited@client.com';
    var org = u && u.client_id ? IX.clientsById[u.client_id].name : 'your organisation';
    return '<div class="auth"><div class="auth-aside"><div class="brand">Tevus</div>' +
      '<div class="pitch"><h1>You\'ve been invited.</h1><p>Your admin created this login for ' + esc(org) + '. Set a password and you\'ll go straight to your dashboard — you\'ll only ever see your own organisation\'s data.</p></div>' +
      '<div class="foot"><div><b>Invite-only</b>no open self-signup</div><div><b>Scoped</b>your org\'s data only</div></div></div>' +
      '<div class="auth-main"><div class="auth-form">' +
      '<div class="head"><h2>Set your password</h2><p>Welcome' + (u ? ', ' + esc(u.name.split(' ').slice(-1)[0]) : '') + ' — finish setting up your account.</p></div>' +
      '<form id="setPwForm">' +
      '<div class="fld">Email<div class="inp lock">' + esc(email) + ' &nbsp;·&nbsp; locked</div></div>' +
      '<div class="fld">New password<input class="inp" type="password" placeholder="••••••••" autocomplete="new-password"></div>' +
      '<div class="fld">Confirm password<input class="inp" type="password" placeholder="••••••••" autocomplete="new-password"></div>' +
      '<button type="submit" class="btnp block">Create account &amp; sign in</button></form>' +
      '<div class="auth-foot">Reached only via an invite link — admins provision logins, there is no open self-signup.<br>' +
      '<a data-nav="#/login" style="cursor:pointer;font-weight:600">← Back to sign in</a></div>' +
      '</div></div></div>' + (state.toast ? '<div class="toast"><span class="gd"></span>' + esc(state.toast) + '</div>' : '');
  }

  /* ======================= INTERNAL SCREENS ============================= */
  /* ---- Overview period + export ----------------------------------------- */
  var OV_PERIODS = [7, 14];
  function overviewStats(days) {
    var dates = Object.keys(DB.usage_daily.reduce(function (m, r) { m[r.date] = 1; return m; }, {})).sort();
    var win = dates.slice(-days);
    var winSet = win.reduce(function (m, d) { m[d] = 1; return m; }, {});
    var rows = DB.usage_daily.filter(function (r) { return winSet[r.date]; });

    var totalMin = 0, totalConv = 0, byClient = {}, byPersona = {};
    rows.forEach(function (r) {
      totalMin += r.minutes; totalConv += r.conversations;
      var c = byClient[r.client_id] || (byClient[r.client_id] = { minutes: 0, convos: 0 });
      c.minutes += r.minutes; c.convos += r.conversations;
      var p = byPersona[r.persona_id] || (byPersona[r.persona_id] = { minutes: 0, convos: 0 });
      p.minutes += r.minutes; p.convos += r.conversations;
    });

    var assigned = DB.personas.filter(function (p) { return p.client_id; }).length;
    var unassigned = DB.personas.length - assigned;
    var alloc = 0, used = 0;
    DB.clients.forEach(function (c) { alloc += IX.clientBudget[c.id].allocated; used += IX.clientBudget[c.id].used; });
    var pct = alloc ? Math.round(used / alloc * 100) : 0;

    var usage = DB.clients.map(function (c) { return { label: c.name, value: (byClient[c.id] || { minutes: 0 }).minutes }; }).sort(function (a, b) { return b.value - a.value; });
    var tops = DB.personas.filter(function (p) { return p.client_id; })
      .map(function (p) { var t = byPersona[p.id] || { minutes: 0, convos: 0 }; return { p: p, m: t.minutes, c: t.convos }; })
      .sort(function (a, b) { return b.m - a.m; }).slice(0, 5);

    return { days: days, totalMin: totalMin, totalConv: totalConv, assigned: assigned, unassigned: unassigned,
      pct: pct, remaining: alloc - used, usage: usage, tops: tops, series: seriesFrom(rows) };
  }

  function periodDropdown() {
    var menu = state.periodMenu ? ('<div class="menu">' + OV_PERIODS.map(function (n) {
      return '<button class="' + (state.ovPeriod === n ? 'on' : '') + '" data-period="' + n + '">Last ' + n + ' days</button>';
    }).join('') + '</div>') : '';
    return '<div class="ddown"><span class="sel" data-period-toggle>Last ' + (state.ovPeriod || 14) + ' days</span>' + menu + '</div>';
  }
  function exportDropdown() {
    var menu = state.exportMenu ? (
      '<div class="menu">' +
      '<button data-ovexport="csv">Export as CSV</button>' +
      '<button data-ovexport="word">Export as Word (.doc)</button>' +
      '<button data-ovexport="md">Export as Markdown</button>' +
      '</div>'
    ) : '';
    return '<div class="ddown"><span class="btn" data-export-toggle>Export</span>' + menu + '</div>';
  }

  function overviewMarkdown(d) {
    var rows = function (headers, data) {
      return '| ' + headers.join(' | ') + ' |\n|' + headers.map(function () { return '---'; }).join('|') + '|\n' +
        data.map(function (r) { return '| ' + r.join(' | ') + ' |'; }).join('\n');
    };
    return '# Overview\n\n_Last ' + d.days + ' days · usage across all clients_\n\n' +
      rows(['Metric', 'Value'], [
        ['Total minutes', nf(d.totalMin)],
        ['Conversations', nf(d.totalConv)],
        ['Personas (PALs)', DB.personas.length + ' (' + d.assigned + ' assigned, ' + d.unassigned + ' unassigned)'],
        ['Minutes vs budget', d.pct + '% (' + nf(d.remaining) + ' minutes left)']
      ]) + '\n\n## Usage by client\n\n' +
      rows(['Client', 'Minutes'], d.usage.map(function (u) { return [u.label, nf(u.value)]; })) +
      '\n\n## Top personas\n\n' +
      rows(['Persona', 'Client', 'Conversations', 'Minutes'], d.tops.map(function (r) {
        return [r.p.name, IX.clientsById[r.p.client_id].name, nf(r.c), nf(r.m)];
      })) + '\n';
  }
  function overviewWordHtml(d) {
    var table = function (headers, data) {
      return '<table border="1" cellspacing="0" cellpadding="4"><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' +
        data.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(String(c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
    };
    return '<html><head><meta charset="utf-8"><title>Overview</title></head><body>' +
      '<h1>Overview</h1><p>Last ' + d.days + ' days &middot; usage across all clients</p>' +
      table(['Metric', 'Value'], [
        ['Total minutes', nf(d.totalMin)],
        ['Conversations', nf(d.totalConv)],
        ['Personas (PALs)', DB.personas.length + ' (' + d.assigned + ' assigned, ' + d.unassigned + ' unassigned)'],
        ['Minutes vs budget', d.pct + '% (' + nf(d.remaining) + ' minutes left)']
      ]) +
      '<h2>Usage by client</h2>' + table(['Client', 'Minutes'], d.usage.map(function (u) { return [u.label, nf(u.value)]; })) +
      '<h2>Top personas</h2>' + table(['Persona', 'Client', 'Conversations', 'Minutes'], d.tops.map(function (r) {
        return [r.p.name, IX.clientsById[r.p.client_id].name, nf(r.c), nf(r.m)];
      })) +
      '</body></html>';
  }
  function exportOverview(fmt, d) {
    if (fmt === 'csv') {
      var text = toCsv(['Metric', 'Value'], [
        ['Period', 'Last ' + d.days + ' days'],
        ['Total minutes', d.totalMin],
        ['Conversations', d.totalConv],
        ['Personas (PALs)', DB.personas.length],
        ['Assigned personas', d.assigned],
        ['Unassigned personas', d.unassigned],
        ['Minutes vs budget', d.pct + '%'],
        ['Minutes remaining', d.remaining]
      ]) + '\r\n\r\n' + toCsv(['Client', 'Minutes'], d.usage.map(function (u) { return [u.label, u.value]; })) +
        '\r\n\r\n' + toCsv(['Persona', 'Client', 'Conversations', 'Minutes'], d.tops.map(function (r) {
          return [r.p.name, IX.clientsById[r.p.client_id].name, r.c, r.m];
        }));
      downloadFile('overview.csv', text, 'text/csv');
      toast('Overview exported as overview.csv');
    } else if (fmt === 'word') {
      downloadFile('overview.doc', overviewWordHtml(d), 'application/msword');
      toast('Overview exported as overview.doc');
    } else if (fmt === 'md') {
      downloadFile('overview.md', overviewMarkdown(d), 'text/markdown');
      toast('Overview exported as overview.md');
    }
  }

  function scrOverview() {
    var d = overviewStats(state.ovPeriod || 14);
    var tops = d.tops.map(function (r) {
      return '<tr class="rowlink" data-nav="#/persona/' + r.p.id + '"><td><div class="cellpersona">' + avatar(r.p.name, 'sm') + '<b>' + esc(r.p.name) + '</b></div></td>' +
        '<td>' + esc(IX.clientsById[r.p.client_id].name) + '</td><td class="num">' + nf(r.c) + '</td><td class="num"><b>' + nf(r.m) + '</b></td>' +
        '<td class="num chev">›</td></tr>';
    }).join('');

    var content = ph('Overview', 'usage across all clients', periodDropdown() + exportDropdown()) +
      '<div class="stats">' +
      '<div class="stat"><div class="l">Total minutes</div><div class="n">' + nf(d.totalMin) + '</div><div class="s"><span class="delta up">▲ 8%</span> vs prior period</div></div>' +
      '<div class="stat"><div class="l">Conversations</div><div class="n">' + nf(d.totalConv) + '</div><div class="s">across ' + d.assigned + ' active personas</div></div>' +
      '<div class="stat"><div class="l">Personas (PALs)</div><div class="n">' + DB.personas.length + '</div><div class="s">' + d.assigned + ' assigned · ' + d.unassigned + ' unassigned</div></div>' +
      '<div class="stat"><div class="l">Minutes vs budget</div><div class="n">' + d.pct + '<small>%</small></div><div class="meter"><i style="width:' + d.pct + '%"></i></div><div class="s">' + nf(d.remaining) + ' minutes left across all clients</div></div>' +
      '</div>' +
      '<div class="g2 eq">' +
      '<div class="card"><div class="cardh">Minutes used over time<span class="hsub">all clients</span></div><div class="cardp">' + areaChart(d.series.values, d.series.dates, 210) + '</div></div>' +
      '<div class="card"><div class="cardh">Usage by client</div><div class="cardp" style="display:flex;flex-direction:column;gap:12px">' + barRows(d.usage) + '</div></div>' +
      '</div>' +
      '<div class="card"><div class="cardh">Top personas<span class="hsub">by minutes</span><div class="r"><span class="btn sm" data-nav="#/personas">View all</span></div></div>' +
      '<table class="tbl"><tr><th>Persona (PAL)</th><th>Client</th><th class="num">Conversations</th><th class="num">Minutes</th><th></th></tr>' + tops + '</table></div>';
    return shell('#/overview', content);
  }

  function scrClients() {
    var rows = DB.clients.map(function (c) {
      var b = IX.clientBudget[c.id], pct = clientPctUsed(c.id);
      return '<tr class="rowlink" data-nav="#/client/' + c.id + '"><td><div class="cellpersona">' + avatar(c.name, 'sm') +
        '<span><b>' + esc(c.name) + '</b><span class="sub">' + c.term.months + '-month term · to ' + fmtDate(c.term.end) + '</span></span></div></td>' +
        '<td>' + statusPill(c.status) + '</td><td class="num">' + IX.clientTotals[c.id].personas + '</td>' +
        '<td style="min-width:150px"><div class="meter" style="margin:0"><i style="width:' + pct + '%"></i></div><span class="sub">' + nf(b.used) + ' / ' + nf(b.allocated) + ' min · ' + pct + '%</span></td>' +
        '<td class="num"><b>' + nf(clientRemaining(c.id)) + '</b></td><td class="num chev">›</td></tr>';
    }).join('');
    var right = (canProvision() ? '<span class="btnp" data-open="new-client">+ New client</span>' : '<span class="pill off"><span class="gd"></span>Read-only</span>');
    var content = ph('Clients', DB.clients.length + ' organizations', '<span class="sel">All statuses</span>' + right) +
      '<div class="card"><table class="tbl"><tr><th>Client</th><th>Status</th><th class="num">Personas</th><th>Minutes used</th><th class="num">Balance</th><th></th></tr>' + rows + '</table></div>';
    return shell('#/clients', content);
  }

  function scrClientDetail(cid) {
    var c = IX.clientsById[cid]; if (!c) return scrClients();
    var b = IX.clientBudget[cid];
    var tab = function (id, label) { return '<a class="' + (state.clientTab === id ? 'on' : '') + '" data-tab="' + id + '">' + label + '</a>'; };
    var body;
    if (state.clientTab === 'minutes') {
      var ledger = IX.clientLedger[cid].map(function (l) {
        return '<tr><td>' + fmtDate(l.date) + '</td><td><b>' + esc(l.note) + '</b><span class="sub">' + esc(l.type) + '</span></td><td>' + esc(l.admin || '—') + '</td>' +
          '<td class="num" style="color:' + (l.amount >= 0 ? 'var(--success-ink)' : 'var(--body)') + '">' + (l.amount >= 0 ? '+' : '') + nf(l.amount) + '</td>' +
          '<td class="num"><b>' + nf(l.balance_after) + '</b></td></tr>';
      }).join('');
      body = '<div class="card"><div class="cardh">Minute budget<span class="hsub">append-only ledger</span>' + (canProvision() ? '<div class="r"><span class="btnp sm" data-topup="' + cid + '">+ Add minutes</span></div>' : '') + '</div>' +
        '<div class="cardp" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap"><div><div class="l" style="font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Remaining</div>' +
        '<div class="d-sm" style="margin-top:6px">' + nf(clientRemaining(cid)) + ' <span style="font-size:13px;color:var(--muted);font-weight:500;letter-spacing:0">/ ' + nf(b.allocated) + '</span></div></div>' +
        '<div style="flex:1;min-width:200px"><div class="meter lg" style="margin:0"><i style="width:' + clientPctUsed(cid) + '%"></i></div>' +
        '<div class="note" style="margin-top:8px">' + clientPctUsed(cid) + '% used · ' + nf(b.used) + ' minutes consumed</div></div></div>' +
        '<table class="tbl"><tr><th>Date</th><th>Entry</th><th>Admin</th><th class="num">Amount</th><th class="num">Balance after</th></tr>' + ledger + '</table></div>';
    } else if (state.clientTab === 'logins') {
      var logins = DB.users.filter(function (u) { return u.client_id === cid; }).map(function (u) {
        return '<tr><td><div class="cellpersona">' + avatar(u.name, 'sm') + '<span><b>' + esc(u.name) + '</b><span class="sub">' + esc(u.title || '') + '</span></span></div></td>' +
          '<td class="mono">' + esc(u.email) + '</td><td>' + esc(roleLabel(u.group)) + '</td><td>' + statusPill(u.status) + '</td>' +
          '<td class="num"><span class="btn sm">' + (u.status === 'invited' ? 'Resend invite' : 'Edit') + '</span></td></tr>';
      }).join('');
      body = '<div class="card"><div class="cardh">Logins<span class="hsub">Cognito users for this org</span>' + (canProvision() ? '<div class="r"><span class="btnp sm" data-stub="Invite sent (prototype — not persisted)">+ Invite login</span></div>' : '') + '</div>' +
        '<table class="tbl"><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th class="num"></th></tr>' + logins + '</table></div>';
    } else if (state.clientTab === 'overview') {
      var s = seriesForClient(cid), t = IX.clientTotals[cid];
      body = '<div class="stats" style="grid-template-columns:repeat(4,1fr)">' +
        '<div class="stat"><div class="l">Minutes used</div><div class="n">' + nf(t.minutes) + '</div><div class="s">of ' + nf(b.allocated) + ' allocated</div></div>' +
        '<div class="stat"><div class="l">Conversations</div><div class="n">' + nf(t.convos) + '</div><div class="s">this period</div></div>' +
        '<div class="stat"><div class="l">Personas</div><div class="n">' + t.personas + '</div><div class="s">assigned to this client</div></div>' +
        '<div class="stat"><div class="l">Term</div><div class="n" style="font-size:20px;letter-spacing:-.5px">' + fmtDate(c.term.start) + ' → ' + fmtDate(c.term.end) + '</div><div class="s">' + c.term.months + ' months</div></div></div>' +
        '<div class="card"><div class="cardh">Usage over time<span class="hsub">' + esc(c.name) + '</span></div><div class="cardp">' + areaChart(s.values, s.dates, 210) + '</div></div>' +
        '<div class="g2 eq">' +
        '<div class="card"><div class="cardh">Usage by persona<span class="hsub">minutes this period</span></div><div class="cardp" style="display:flex;flex-direction:column;gap:12px">' +
        barRows(DB.personas.filter(function (p) { return p.client_id === cid; })
          .map(function (p) { return { label: p.name, value: (IX.personaTotals[p.id] || { minutes: 0 }).minutes }; })
          .sort(function (a, b) { return b.value - a.value; })) + '</div></div>' +
        '<div class="card"><div class="cardh">Daily usage<span class="hsub">every recorded day</span></div><div class="tscroll" style="max-height:300px">' +
        '<table class="tbl"><tr><th>Date</th><th class="num">Conversations</th><th class="num">Minutes</th></tr>' +
        (function () {
          var byDate = {};
          DB.usage_daily.filter(function (u) { return u.client_id === cid; }).forEach(function (u) {
            var d = byDate[u.date] || (byDate[u.date] = { c: 0, m: 0 });
            d.c += u.conversations; d.m += u.minutes;
          });
          return Object.keys(byDate).sort().reverse().map(function (d) {
            return '<tr><td>' + fmtDate(d) + '</td><td class="num">' + nf(byDate[d].c) + '</td><td class="num"><b>' + nf(byDate[d].m) + '</b></td></tr>';
          }).join('') || emptyRow(3, 'No usage yet', 'nothing recorded for this client');
        })() + '</table></div></div></div>';
    } else {
      var assigned = DB.personas.filter(function (p) { return p.client_id === cid; });
      var arows = assigned.length ? assigned.map(function (p) {
        var t = IX.personaTotals[p.id] || { minutes: 0, convos: 0 }, r = p.replica_id ? IX.replicasById[p.replica_id] : null;
        var sessions = DB.conversations.filter(function (x) { return x.persona_id === p.id; }).length;
        // row opens the persona (usage trend, config, sessions + transcripts); the Unassign
        // button sits inside the row but matches its own handler first, so it doesn't navigate
        return '<tr class="rowlink" data-nav="#/persona/' + p.id + '"><td><div class="cellpersona">' + avatar(p.name, 'sm') +
          '<span><b>' + esc(p.name) + '</b><span class="sub mono">' + esc(p.tavus_persona_id) + '</span></span></div></td>' +
          '<td>' + esc(r ? r.name : '—') + '</td><td class="num">' + nf(t.convos) + '</td><td class="num"><b>' + nf(t.minutes) + '</b></td>' +
          '<td class="num">' + sessions + '</td>' +
          '<td class="num">' + (canProvision() ? '<span class="btn sm" data-unassign="' + p.id + '">Unassign</span>' : '') + '</td>' +
          '<td class="num chev">›</td></tr>';
      }).join('') : emptyRow(7, 'No personas assigned yet', canProvision() ? 'use “+ Assign” to pull one from the unassigned pool' : 'an internal admin assigns personas to this client');
      body = '<div class="card"><div class="cardh">Assigned personas<span class="hsub">row → usage, config &amp; transcripts</span>' + (canProvision() ? '<div class="r"><span class="btnp sm" data-assign="' + cid + '">+ Assign</span></div>' : '') + '</div>' +
        '<table class="tbl"><tr><th>Persona (PAL)</th><th>Replica (Face)</th><th class="num">Conversations</th><th class="num">Minutes</th><th class="num">Sessions</th><th class="num"></th><th></th></tr>' + arows + '</table></div>';
    }
    var content = '<div class="crumb"><a data-nav="#/clients">Clients</a> / ' + esc(c.name) + '</div>' +
      ph(c.name, c.id, statusPill(c.status) + (canProvision() ? '<span class="btn">Edit</span><span class="btn" data-stub="Suspend is a prototype stub">Suspend</span>' : '')) +
      '<div class="tabs">' + tab('overview', 'Overview') + tab('personas', 'Personas') + tab('minutes', 'Minutes') + tab('logins', 'Logins') + '</div>' + body;
    return shell('#/clients', content);
  }

  function scrPersonas() {
    var f = state.personaFilter;
    var list = DB.personas.filter(function (p) { return f === 'all' ? true : f === 'assigned' ? !!p.client_id : !p.client_id; });
    var rows = list.length ? list.map(function (p) {
      var t = IX.personaTotals[p.id] || { minutes: 0, convos: 0 }, r = p.replica_id ? IX.replicasById[p.replica_id] : null;
      var client = p.client_id ? esc(IX.clientsById[p.client_id].name) : '<span class="pill off"><span class="gd"></span>Unassigned</span>';
      return '<tr class="rowlink" data-nav="#/persona/' + p.id + '"><td><div class="cellpersona">' + avatar(p.name, 'sm') +
        '<span><b>' + esc(p.name) + '</b><span class="sub mono">' + esc(p.tavus_persona_id) + '</span></span></div></td>' +
        '<td>' + esc(r ? r.name : '—') + '</td><td>' + client +
        '</td><td class="num">' + (p.client_id ? nf(t.convos) : '—') + '</td><td class="num"><b>' + (p.client_id ? nf(t.minutes) : '—') + '</b></td>' +
        '<td class="note">' + ago(p.last_synced_at) + '</td><td class="num chev">›</td></tr>';
    }).join('') : emptyRow(7, 'Nothing here', 'no personas match this filter');
    var filt = ['all', 'assigned', 'unassigned'].map(function (k) { return '<a class="' + (f === k ? 'on' : '') + '" data-pfilter="' + k + '">' + k.charAt(0).toUpperCase() + k.slice(1) + '</a>'; }).join('');
    var content = ph('Personas (PALs)', DB.personas.length + ' synced from Tavus', '<div class="tabs">' + filt + '</div>') +
      '<div class="card"><table class="tbl"><tr><th>Persona (PAL)</th><th>Replica</th><th>Client</th><th class="num">Conversations</th><th class="num">Minutes</th><th>Synced</th><th></th></tr>' + rows + '</table></div>';
    return shell('#/personas', content);
  }

  function scrPersonaDetail(pid) {
    var p = IX.personasById[pid]; if (!p) return scrPersonas();
    var t = IX.personaTotals[pid] || { minutes: 0, convos: 0 };
    var r = p.replica_id ? IX.replicasById[p.replica_id] : null;
    var client = p.client_id ? IX.clientsById[p.client_id] : null;
    var s = seriesForPersona(pid);
    var crumb = isClientView()
      ? '<div class="crumb"><a data-nav="#/c/personas">Your personas</a> / ' + esc(p.name) + '</div>'
      : (client
        ? '<div class="crumb"><a data-nav="#/clients">Clients</a> / <a data-nav="#/client/' + client.id + '">' + esc(client.name) + '</a> / ' + esc(p.name) + '</div>'
        : '<div class="crumb"><a data-nav="#/personas">Personas</a> / ' + esc(p.name) + '</div>');

    var all = DB.conversations.filter(function (c) { return c.persona_id === pid; });
    var tab = function (id, label, n) {
      return '<a class="' + (state.personaTab === id ? 'on' : '') + '" data-ptab="' + id + '">' + label +
        (n != null ? '<span class="tn">' + n + '</span>' : '') + '</a>';
    };

    var body;
    if (state.personaTab === 'conversations') {
      body = convCard(all, { of: 'this persona', cols: ['end_user', 'duration', 'turns'] });
    } else if (state.personaTab === 'config') {
      body = '<div class="g2 eq">' +
        '<div class="card"><div class="cardh">Configuration<span class="hsub">synced from Tavus</span></div><div class="cardp kv">' +
        '<span class="k">Persona ID</span><span class="v mono">' + esc(p.id) + '</span>' +
        '<span class="k">Tavus persona ID</span><span class="v mono">' + esc(p.tavus_persona_id) + '</span>' +
        '<span class="k">Owner (client_id)</span><span class="v">' + (client ? '<a class="lnk" data-nav="#/client/' + client.id + '">' + esc(client.name) + '</a> <span class="mono keyref">' + esc(client.id) + '</span>' : 'Unassigned') + '</span>' +
        '<span class="k">Replica (replica_id)</span><span class="v">' + (r ? '<a class="lnk" data-nav="#/replica/' + r.id + '">' + esc(r.name) + '</a> <span class="mono keyref">' + esc(r.id) + '</span>' : '—') + '</span>' +
        '<span class="k">Created</span><span class="v">' + fmtDateTime(p.created_at) + '</span>' +
        '<span class="k">Last synced</span><span class="v">' + ago(p.last_synced_at) + '</span>' +
        '<span class="k">Tags</span><span class="v">' + ((p.context_tags || []).map(function (x) { return '<span class="pill off">' + esc(x) + '</span>'; }).join(' ') || '—') + '</span>' +
        '</div></div>' +
        '<div class="card"><div class="cardh">System prompt</div><div class="cardp"><div class="prompt">' + esc(p.system_prompt) + '</div></div></div></div>';
    } else {
      var daily = (IX.personaSeries[pid] || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (d) {
        return '<tr><td>' + fmtDate(d.date) + '</td><td class="num">' + nf(d.conversations) + '</td><td class="num"><b>' + nf(d.minutes) + '</b></td>' +
          '<td class="num">' + (d.conversations ? (d.minutes / d.conversations).toFixed(1) : '—') + '</td></tr>';
      }).join('') || emptyRow(4, 'No usage rows', 'nothing recorded for this persona yet');
      var peak = (IX.personaSeries[pid] || []).slice().sort(function (a, b) { return b.minutes - a.minutes; })[0];
      body = '<div class="stats" style="grid-template-columns:repeat(4,1fr)">' +
        '<div class="stat"><div class="l">Minutes (period)</div><div class="n">' + nf(t.minutes) + '</div><div class="s">' + (s.values.length ? s.values.length + ' days of data' : 'no usage yet') + '</div></div>' +
        '<div class="stat"><div class="l">Conversations</div><div class="n">' + nf(t.convos) + '</div><div class="s">' + all.length + ' stored sessions</div></div>' +
        '<div class="stat"><div class="l">Avg session</div><div class="n">' + (t.convos ? (t.minutes / t.convos).toFixed(1) : '0') + '<small>min</small></div><div class="s">across the period</div></div>' +
        '<div class="stat"><div class="l">Busiest day</div><div class="n" style="font-size:21px">' + (peak ? fmtDate(peak.date) : '—') + '</div><div class="s">' + (peak ? nf(peak.minutes) + ' minutes' : 'no usage yet') + '</div></div></div>' +
        '<div class="card"><div class="cardh">Minutes over time<span class="hsub">' + esc(p.name) + '</span></div><div class="cardp">' + areaChart(s.values, s.dates, 210) + '</div></div>' +
        '<div class="card"><div class="cardh">Daily usage<span class="hsub">the rows behind the totals</span></div>' +
        '<div class="tscroll"><table class="tbl"><tr><th>Date</th><th class="num">Conversations</th><th class="num">Minutes</th><th class="num">Avg min / convo</th></tr>' + daily + '</table></div></div>';
    }

    var content = crumb +
      '<div class="ph"><div class="cellpersona">' + avatar(p.name, 'lg') + '<div><h1>' + esc(p.name) + '</h1><span class="sub mono">' + esc(p.tavus_persona_id) + '</span></div></div>' +
      '<div class="r">' + (r ? '<span class="btn" data-nav="#/replica/' + r.id + '">Face: ' + esc(r.name) + '</span>' : '') +
      (client ? statusPill('assigned') : '<span class="pill off"><span class="gd"></span>Unassigned</span>') + '</div></div>' +
      '<div class="tabs">' + tab('analytics', 'Analytics') + tab('conversations', 'Conversations', all.length) + tab('config', 'Configuration') + '</div>' + body;
    return shell(isClientView() ? '#/c/personas' : '#/personas', content);
  }

  /* Shared conversation card: filter bar + sortable table. `cols` picks the
     optional columns, so the same component serves the global log (which needs
     client + persona) and the drill-downs (which already know them). */
  function convCard(list, opt) {
    var total = list.length, rows = convApply(list);
    var want = {}; (opt.cols || []).forEach(function (c) { want[c] = 1; });
    var head = sortTh('started_at', 'Date / time') +
      (want.client ? sortTh('client', 'Client') : '') +
      (want.persona ? sortTh('persona', 'Persona') : '') +
      (want.replica ? '<th>Replica (face)</th>' : '') +
      (want.end_user ? sortTh('end_user_ref', 'End user') : '') +
      (want.duration ? sortTh('duration_seconds', 'Duration', 'num') : '') +
      (want.turns ? sortTh('turns', 'Turns', 'num') : '') +
      '<th class="num">Transcript</th>';
    var body = rows.map(function (c) {
      var p = IX.personasById[c.persona_id], cl = clientOf(c), rp = c.replica_id ? IX.replicasById[c.replica_id] : null;
      var turns = DB.transcripts[c.id] ? DB.transcripts[c.id].turns.length : 0;
      return '<tr class="rowlink" data-view="' + c.id + '">' +
        '<td><b>' + fmtDateTime(c.started_at) + '</b><span class="sub mono">' + esc(c.tavus_conversation_id) + '</span></td>' +
        (want.client ? '<td>' + (cl ? esc(cl.name) : '<span class="pill off"><span class="gd"></span>Unassigned</span>') + '</td>' : '') +
        (want.persona ? '<td><div class="cellpersona">' + avatar(p ? p.name : '?', 'sm') + esc(p ? p.name : '—') + '</div></td>' : '') +
        (want.replica ? '<td>' + esc(rp ? rp.name : '—') + '</td>' : '') +
        (want.end_user ? '<td class="mono">' + esc(c.end_user_ref) + '</td>' : '') +
        (want.duration ? '<td class="num">' + fmtDur(c.duration_seconds) + '</td>' : '') +
        (want.turns ? '<td class="num">' + (turns ? turns + ' turns' : '—') + '</td>' : '') +
        '<td class="num">' + (c.has_transcript ? '<span class="btn sm" data-view="' + c.id + '">Transcript</span>' : '<span class="pill off"><span class="gd"></span>None</span>') + '</td></tr>';
    }).join('') || emptyRow(9, state.convFilter ? 'Nothing matches that filter' : 'No conversations yet',
      state.convFilter ? 'try a different term, or clear the filter' : 'sessions appear here as the sync pulls them in');
    return '<div class="card"><div class="cardh">Conversations<span class="hsub">' + esc(opt.of || '') + ' · click a column to sort · row → full chat</span></div>' +
      convFilterBar(rows.length, total) +
      '<div class="tscroll"><table class="tbl"><tr>' + head + '</tr>' + body + '</table></div></div>';
  }

  function scrReplicaDetail(rid) {
    var rp = IX.replicasById[rid]; if (!rp) return scrReplicas();
    var client = rp.client_id ? IX.clientsById[rp.client_id] : null;
    var users = DB.personas.filter(function (p) { return p.replica_id === rid; });
    var convs = DB.conversations.filter(function (c) { return c.replica_id === rid; });
    var mins = 0, cvs = 0;
    users.forEach(function (p) { var t = IX.personaTotals[p.id] || { minutes: 0, convos: 0 }; mins += t.minutes; cvs += t.convos; });
    var s = seriesFrom(DB.usage_daily.filter(function (u) {
      return users.some(function (p) { return p.id === u.persona_id; });
    }));
    var tab = function (id, label, n) {
      return '<a class="' + (state.replicaTab === id ? 'on' : '') + '" data-rtab="' + id + '">' + label +
        (n != null ? '<span class="tn">' + n + '</span>' : '') + '</a>';
    };

    var body;
    if (state.replicaTab === 'personas') {
      var prows = users.map(function (p) {
        var t = IX.personaTotals[p.id] || { minutes: 0, convos: 0 };
        return '<tr class="rowlink" data-nav="#/persona/' + p.id + '"><td><div class="cellpersona">' + avatar(p.name, 'sm') +
          '<span><b>' + esc(p.name) + '</b><span class="sub mono">replica_id = ' + esc(rid) + '</span></span></div></td>' +
          '<td>' + (p.client_id ? esc(IX.clientsById[p.client_id].name) : '<span class="pill off"><span class="gd"></span>Unassigned</span>') + '</td>' +
          '<td class="num">' + nf(t.convos) + '</td><td class="num"><b>' + nf(t.minutes) + '</b></td><td class="num chev">›</td></tr>';
      }).join('') || emptyRow(5, 'No persona uses this face', 'assign it to a persona to put it to work');
      body = '<div class="card"><div class="cardh">Personas using this face<span class="hsub">joined on personas.replica_id</span></div>' +
        '<table class="tbl"><tr><th>Persona (PAL)</th><th>Client</th><th class="num">Conversations</th><th class="num">Minutes</th><th></th></tr>' + prows + '</table></div>';
    } else if (state.replicaTab === 'conversations') {
      body = convCard(convs, { of: 'recorded against this face', cols: ['persona', 'end_user', 'duration', 'turns'] });
    } else {
      body = '<div class="stats" style="grid-template-columns:repeat(4,1fr)">' +
        '<div class="stat"><div class="l">Minutes</div><div class="n">' + nf(mins) + '</div><div class="s">via ' + users.length + ' persona' + (users.length === 1 ? '' : 's') + '</div></div>' +
        '<div class="stat"><div class="l">Conversations</div><div class="n">' + nf(cvs) + '</div><div class="s">' + convs.length + ' stored sessions</div></div>' +
        '<div class="stat"><div class="l">Owner</div><div class="n" style="font-size:21px">' + esc(client ? client.name : 'Unassigned') + '</div><div class="s">follows the persona it backs</div></div>' +
        '<div class="stat"><div class="l">Status</div><div class="n" style="font-size:21px">' + esc(rp.status) + '</div><div class="s">synced ' + ago(rp.last_synced_at) + '</div></div></div>' +
        '<div class="g2 eq"><div class="card"><div class="cardh">Minutes over time<span class="hsub">all personas using this face</span></div><div class="cardp">' + areaChart(s.values, s.dates, 210) + '</div></div>' +
        '<div class="card"><div class="cardh">Record</div><div class="cardp kv">' +
        '<span class="k">Replica ID</span><span class="v mono">' + esc(rp.id) + '</span>' +
        '<span class="k">Tavus replica ID</span><span class="v mono">' + esc(rp.tavus_replica_id) + '</span>' +
        '<span class="k">Owner (client_id)</span><span class="v">' + (client ? '<a class="lnk" data-nav="#/client/' + client.id + '">' + esc(client.name) + '</a> <span class="mono keyref">' + esc(client.id) + '</span>' : 'null — unassigned') + '</span>' +
        '<span class="k">Status</span><span class="v">' + statusPill(rp.status) + '</span>' +
        '<span class="k">Last synced</span><span class="v">' + fmtDateTime(rp.last_synced_at) + '</span></div></div></div>';
    }

    var crumb = client
      ? '<div class="crumb"><a data-nav="#/clients">Clients</a> / <a data-nav="#/client/' + client.id + '">' + esc(client.name) + '</a> / ' + esc(rp.name) + '</div>'
      : '<div class="crumb"><a data-nav="#/replicas">Replicas</a> / ' + esc(rp.name) + '</div>';
    var content = crumb +
      '<div class="ph"><div class="cellpersona">' + avatar(rp.name, 'lg') + '<div><h1>' + esc(rp.name) + '</h1><span class="sub mono">' + esc(rp.tavus_replica_id) + '</span></div></div>' +
      '<div class="r">' + statusPill(rp.client_id ? 'assigned' : (rp.status === 'training' ? 'training' : 'unassigned')) + '</div></div>' +
      '<div class="tabs">' + tab('overview', 'Overview') + tab('personas', 'Personas', users.length) + tab('conversations', 'Conversations', convs.length) + '</div>' + body;
    return shell('#/replicas', content);
  }

  function scrReplicas() {
    var rows = DB.replicas.map(function (rp) {
      var usedBy = DB.personas.filter(function (p) { return p.replica_id === rp.id; }).map(function (p) { return p.name; });
      var client = rp.client_id ? esc(IX.clientsById[rp.client_id].name) : '<span class="pill off"><span class="gd"></span>Unassigned</span>';
      return '<tr class="rowlink" data-nav="#/replica/' + rp.id + '"><td><div class="cellpersona">' + avatar(rp.name, 'sm') + '<span><b>' + esc(rp.name) + '</b><span class="sub mono">' + esc(rp.tavus_replica_id) + '</span></span></div></td>' +
        '<td>' + (usedBy.length ? esc(usedBy.join(', ')) : '—') + '</td><td>' + client + '</td>' +
        '<td>' + statusPill(rp.client_id ? 'assigned' : (rp.status === 'training' ? 'training' : 'unassigned')) + '</td><td class="note">' + ago(rp.last_synced_at) + '</td>' +
        '<td class="num chev">›</td></tr>';
    }).join('');
    var content = ph('Replicas (Faces)', DB.replicas.length + ' synced from Tavus · row → the personas and sessions behind each face') +
      '<div class="card"><table class="tbl"><tr><th>Replica (Face)</th><th>Used by persona</th><th>Client</th><th>Status</th><th>Synced</th><th></th></tr>' + rows + '</table></div>';
    return shell('#/replicas', content);
  }

  function scrConversations() {
    var content = ph('Conversations', 'every stored session across all clients') +
      convCard(DB.conversations, { of: 'all clients', cols: ['client', 'persona', 'replica', 'end_user', 'duration', 'turns'] });
    return shell('#/conversations', content);
  }

  function scrReports() {
    var rows = REPORTS.map(function (r) {
      var n = r.build().length;
      return '<tr class="rowlink' + (state.report === r.id ? ' on' : '') + '" data-report="' + r.id + '"><td><b>' + esc(r.name) + '</b>' +
        '<span class="sub">' + r.headers.length + ' columns</span></td>' +
        '<td>' + esc(r.scope) + '</td><td>' + esc(r.period) + '</td><td class="num">' + nf(n) + '</td>' +
        '<td class="num"><span class="btn sm" data-csv="' + r.id + '">Export CSV</span></td></tr>';
    }).join('');

    var preview = '';
    var rep = state.report ? reportById(state.report) : null;
    if (rep) {
      var data = rep.build();
      var shown = data.slice(0, 50);
      preview = '<div class="card"><div class="cardh">' + esc(rep.name) + '<span class="hsub">' +
        nf(data.length) + ' rows' + (data.length > shown.length ? ' · showing first ' + shown.length : '') + '</span>' +
        '<div class="r"><span class="btnp sm" data-csv="' + rep.id + '">Export CSV</span><span class="btn sm" data-report="' + rep.id + '">Close</span></div></div>' +
        '<div class="tscroll"><table class="tbl"><tr>' +
        rep.headers.map(function (h, i) { return '<th' + (i >= 3 ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr>' +
        shown.map(function (row) {
          return '<tr>' + row.map(function (v, i) {
            return '<td' + (i >= 3 ? ' class="num"' : '') + '>' + (typeof v === 'number' ? nf(v) : esc(v)) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</table></div></div>';
    }

    var content = ph('Reports', 'built live from the dataset — pick one to preview, export to download a real CSV') +
      '<div class="card"><div class="cardh">Report definitions<span class="hsub">row → preview</span></div>' +
      '<table class="tbl"><tr><th>Report</th><th>Scope</th><th>Period</th><th class="num">Rows</th><th class="num"></th></tr>' + rows + '</table></div>' +
      preview;
    return shell('#/reports', content);
  }

  function scrUsers() {
    var rows = DB.users.map(function (u) {
      return '<tr><td><div class="cellpersona">' + avatar(u.name, 'sm') + '<span><b>' + esc(u.name) + '</b><span class="sub">' + esc(u.title || '') + '</span></span></div></td>' +
        '<td class="mono">' + esc(u.email) + '</td><td>' + esc(roleLabel(u.group)) + '</td>' +
        '<td>' + (u.client_id ? esc(IX.clientsById[u.client_id].name) : '—') + '</td><td>' + statusPill(u.status) + '</td>' +
        '<td>' + (u.last_active ? ago(u.last_active) : '—') + '</td>' +
        '<td class="num"><span class="btn sm" data-stub="Prototype stub — user management is not wired">' + (u.status === 'invited' ? 'Resend' : 'Edit') + '</span></td></tr>';
    }).join('');
    var content = ph('Users', 'internal + client logins', '<span class="sel">All roles</span>' + (canProvision() ? '<span class="btnp" data-stub="Invite flow is a prototype stub">+ Invite user</span>' : '')) +
      '<div class="card"><table class="tbl"><tr><th>Name</th><th>Email</th><th>Role (Cognito group)</th><th>Client</th><th>Status</th><th>Last active</th><th class="num">Actions</th></tr>' + rows + '</table></div>';
    return shell('#/users', content);
  }

  /* ========================= CLIENT SCREENS ============================= */
  function scopeBanner(c) {
    return '<div class="scope-banner"><span class="tag">Scoped</span>You are signed in as <b>' + esc(state.user.name) + '</b> (' + esc(roleLabel(state.user.group)) +
      ') — this portal shows <b>' + esc(c.name) + '</b> data only. No other client\'s data is reachable from this session.</div>';
  }
  function scrCDashboard(cid) {
    var c = IX.clientsById[cid], b = IX.clientBudget[cid], tot = IX.clientTotals[cid];
    var s = seriesForClient(cid), pct = clientPctUsed(cid);
    var byPersona = DB.personas.filter(function (p) { return p.client_id === cid; })
      .map(function (p) { return { label: p.name, value: (IX.personaTotals[p.id] || { minutes: 0 }).minutes }; })
      .sort(function (a, b) { return b.value - a.value; });
    var content = ph('Dashboard', esc(c.name), '<span class="sel">Last 14 days</span>') + scopeBanner(c) +
      '<div class="g3">' +
      '<div class="stat"><div class="l">Minutes remaining</div><div class="n">' + nf(clientRemaining(cid)) + ' <small>/ ' + nf(b.allocated) + '</small></div>' +
      '<div class="meter' + (pct >= 80 ? ' warn' : '') + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="s">' + pct + '% used' + (canManageOrgUsers() ? '<span class="btn sm" data-topup-req>Request top-up</span>' : '') + '</div></div>' +
      '<div class="stat"><div class="l">Conversations</div><div class="n">' + nf(tot.convos) + '</div><div class="s">this period</div></div>' +
      '<div class="stat"><div class="l">Personas</div><div class="n">' + tot.personas + '</div><div class="s">assigned to you</div></div></div>' +
      '<div class="g2"><div class="card"><div class="cardh">Minutes used over time</div><div class="cardp">' + areaChart(s.values, s.dates, 200) + '</div></div>' +
      '<div class="card"><div class="cardh">Usage by persona</div><div class="cardp" style="display:flex;flex-direction:column;gap:12px">' + barRows(byPersona) + '</div></div></div>';
    return shell('#/c/dashboard', content);
  }
  function scrCMinutes(cid) {
    var b = IX.clientBudget[cid], pct = clientPctUsed(cid);
    var ledger = IX.clientLedger[cid].map(function (l) {
      var typ = l.type === 'initial' ? 'Initial allocation' : l.type === 'topup' ? 'Top-up (added by admin)' : 'Usage (period)';
      return '<tr><td>' + fmtDate(l.date) + '</td><td><b>' + typ + '</b></td>' +
        '<td class="num" style="color:' + (l.amount >= 0 ? 'var(--success-ink)' : 'var(--body)') + '">' + (l.amount >= 0 ? '+' : '') + nf(l.amount) + '</td>' +
        '<td class="num"><b>' + nf(l.balance_after) + '</b></td></tr>';
    }).join('');
    var content = ph('Minutes', 'balance and ledger') +
      '<div class="card"><div class="cardp" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">' +
      '<div><div style="font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Remaining</div>' +
      '<div class="d-md" style="margin-top:6px">' + nf(clientRemaining(cid)) + ' <span style="font-size:14px;color:var(--muted);font-weight:500;letter-spacing:0">/ ' + nf(b.allocated) + ' min</span></div></div>' +
      '<div style="flex:1;min-width:220px"><div class="meter lg' + (pct >= 80 ? ' warn' : '') + '" style="margin:0"><i style="width:' + pct + '%"></i></div>' +
      '<div class="note" style="margin-top:8px">' + pct + '% used · ' + nf(b.used) + ' minutes consumed this term</div></div>' +
      (canManageOrgUsers() ? '<span class="btnp" data-topup-req>Request top-up</span>' : '') + '</div></div>' +
      '<div class="card"><div class="cardh">Ledger<span class="hsub">read-only</span></div>' +
      '<table class="tbl"><tr><th>Date</th><th>Entry</th><th class="num">Amount</th><th class="num">Balance after</th></tr>' + ledger + '</table></div>';
    return shell('#/c/minutes', content);
  }
  function scrCPersonas(cid) {
    var mine = DB.personas.filter(function (p) { return p.client_id === cid; });
    var cards = mine.length ? mine.map(function (p) {
      var t = IX.personaTotals[p.id] || { minutes: 0, convos: 0 }, r = p.replica_id ? IX.replicasById[p.replica_id] : null, s = seriesForPersona(p.id);
      return '<div class="card cardp rowlink" data-nav="#/persona/' + p.id + '" style="display:flex;flex-direction:column;gap:13px;cursor:pointer">' +
        '<div style="display:flex;align-items:center;gap:12px">' + avatar(p.name, 'lg') + '<div><b>' + esc(p.name) + '</b><div class="note">Face: ' + esc(r ? r.name : '—') + '</div></div></div>' +
        '<div style="display:flex;gap:20px;font-size:12.5px;color:var(--muted)"><span><b style="color:var(--ink)">' + nf(t.convos) + '</b> convos</span><span><b style="color:var(--ink)">' + nf(t.minutes) + '</b> min</span></div>' +
        sparkline(s.values, 52) + '</div>';
    }).join('') : '<div class="card cardp"><div class="empty"><b>No personas assigned yet</b>your Tevus admin assigns personas to your organisation</div></div>';
    var content = ph('Your personas', mine.length + ' assigned') + '<div class="pcards">' + cards + '</div>';
    return shell('#/c/personas', content);
  }
  function scrCConversations(cid) {
    var convs = DB.conversations.filter(function (c) { var p = IX.personasById[c.persona_id]; return p && p.client_id === cid; });
    var rows = convs.map(function (c) {
      var p = IX.personasById[c.persona_id];
      return '<tr class="rowlink" data-view="' + c.id + '"><td>' + fmtDateTime(c.started_at) + '</td>' +
        '<td><div class="cellpersona">' + avatar(p.name, 'sm') + esc(p.name) + '</div></td>' +
        '<td class="num">' + fmtDur(c.duration_seconds) + '</td><td class="num"><span class="btn sm" data-view="' + c.id + '">Transcript</span></td></tr>';
    }).join('') || emptyRow(4, 'No conversations in this period', 'sessions with your personas will appear here');
    var content = ph('Conversations', convs.length + ' sessions', '<span class="sel">Persona</span><span class="sel">Last 14 days</span>') +
      '<div class="card"><table class="tbl"><tr><th>Date / time</th><th>Persona</th><th class="num">Duration</th><th class="num">Transcript</th></tr>' + rows + '</table></div>';
    return shell('#/c/conversations', content);
  }
  function scrCProfile(cid) {
    var u = state.user;
    var profile = '<div class="card"><div class="cardh">Your profile</div><div class="cardp" style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="fld">Full name<input class="inp" value="' + esc(u.name) + '"></div>' +
      '<div class="fld">Email<div class="inp lock">' + esc(u.email) + '</div><span class="hint">your sign-in email is managed by your admin</span></div>' +
      '<div class="fld">Role<div class="inp lock">' + esc(roleLabel(u.group)) + ' · ' + esc(IX.clientsById[cid].name) + '</div></div>' +
      '<div class="fld">Password<div style="display:flex;gap:8px;align-items:center"><div class="inp" style="flex:1">••••••••</div><span class="btn" data-stub="Password change is a prototype stub">Change</span></div></div>' +
      '<div><span class="btnp" data-stub="Saved (prototype — nothing is persisted)">Save changes</span></div></div></div>';

    var org;
    if (canManageOrgUsers()) {
      var logins = DB.users.filter(function (x) { return x.client_id === cid; }).map(function (x) {
        return '<tr><td><div class="cellpersona">' + avatar(x.name, 'sm') + '<b>' + esc(x.name) + '</b></div></td><td>' + esc(roleLabel(x.group)) + '</td>' +
          '<td>' + statusPill(x.status) + '</td><td class="num"><span class="btn sm" data-stub="Prototype stub">' + (x.status === 'invited' ? 'Resend' : 'Edit') + '</span></td></tr>';
      }).join('');
      org = '<div class="card"><div class="cardh">Organization logins<span class="hsub">client-admin only</span><div class="r"><span class="btnp sm" data-stub="Invite sent (prototype)">+ Invite user</span></div></div>' +
        '<table class="tbl"><tr><th>Name</th><th>Role</th><th>Status</th><th class="num"></th></tr>' + logins + '</table>' +
        '</div>';
    } else {
      org = '<div class="card"><div class="cardh">Organization logins</div><div class="cardp"><div class="empty"><b>Not available to your role</b>' +
        'you are signed in as client-user — only a client-admin can view and invite organisation logins</div>' +
        '</div></div>';
    }
    return shell('#/c/profile', ph('Profile & Settings', esc(IX.clientsById[cid].name)) + '<div class="g2 even">' + profile + org + '</div>');
  }

  /* ============================================================================
     DATABASE — schema canvas (internal portal)

     Columns and row counts are DERIVED from window.DB, so the diagram can never
     drift from the dummy dataset. Only what JSON cannot express is declared
     below: the primary key, which column points at which table, and where each
     table sits on the canvas. Tables are laid out left → right in dependency
     order (parents left, children right) so every relationship line runs the
     same way and never doubles back.

     Geometry constants must stay in sync with the .erc rules in styles.css.
     ========================================================================= */
  var ER = { W: 290, HEAD: 48, ROW: 26, FOOT: 30, PAD: 40 };   // W fits the longest column name in Cutive Mono
  var ER_TABLES = [
    { name: 'clients', pk: ['id'], fk: {}, x: 40, y: 320,
      note: 'tenant — the isolation boundary', rows: function () { return DB.clients; } },
    { name: 'sync_status', pk: [], fk: {}, x: 40, y: 700, singleton: true,
      note: 'pipeline health · stands alone', rows: function () { return [DB.sync_status]; } },
    { name: 'users', pk: ['id'], fk: { client_id: 'clients' }, x: 420, y: 40,
      note: 'login · null client = internal team', rows: function () { return DB.users; } },
    { name: 'replicas', pk: ['id'], fk: { client_id: 'clients' }, x: 420, y: 400,
      note: 'face, synced from Tavus', rows: function () { return DB.replicas; } },
    { name: 'minute_ledger', pk: ['id'], fk: { client_id: 'clients' }, x: 420, y: 682,
      note: 'append-only — balance is derived', rows: function () { return DB.minute_ledger; } },
    { name: 'personas', pk: ['id'], fk: { client_id: 'clients', replica_id: 'replicas' }, x: 800, y: 270,
      note: 'PAL · null client = unassigned', rows: function () { return DB.personas; } },
    { name: 'conversations', pk: ['id'], fk: { persona_id: 'personas', replica_id: 'replicas' }, x: 1180, y: 120,
      note: 'session — owner inherited via persona', rows: function () { return DB.conversations; } },
    { name: 'usage_daily', pk: ['client_id', 'persona_id', 'date'], fk: { client_id: 'clients', persona_id: 'personas' },
      x: 1180, y: 500, note: 'daily rollup · composite key', rows: function () { return DB.usage_daily; } },
    { name: 'transcripts', pk: ['conversation_id'], fk: { conversation_id: 'conversations' }, x: 1560, y: 210,
      note: 'one per conversation · key is the link', rows: function () { return Object.keys(DB.transcripts).map(function (k) { return DB.transcripts[k]; }); } }
  ];

  // column list = union of the keys actually present in the data (keys starting
  // with "_" are dataset annotations, not schema). Type comes from the first
  // non-null value; a column is nullable if any row leaves it empty.
  function erCols(rows) {
    var out = [], seen = {};
    rows.forEach(function (r) {
      Object.keys(r).forEach(function (k) {
        if (k.charAt(0) === '_') return;
        if (!seen[k]) { seen[k] = { name: k, type: '', nullable: false }; out.push(seen[k]); }
      });
    });
    out.forEach(function (c) {
      rows.forEach(function (r) {
        var v = r[c.name];
        if (v == null) c.nullable = true;
        else if (!c.type) c.type = erType(v);
      });
      if (!c.type) c.type = 'null';
    });
    return out;
  }
  function erType(v) {
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'object') return 'json';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'number') return v % 1 === 0 ? 'int' : 'num';
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'timestamp';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
    return 'text';
  }
  function colIndex(cols, name) { for (var i = 0; i < cols.length; i++) if (cols[i].name === name) return i; return -1; }

  var erLast = null;   // last built model — the pan/zoom wiring needs its bounds
  function erBuild() {
    var byName = {};
    var tables = ER_TABLES.map(function (t) {
      var rows = t.rows(), cols = erCols(rows);
      var o = { t: t, cols: cols, count: rows.length, h: ER.HEAD + cols.length * ER.ROW + ER.FOOT };
      byName[t.name] = o;
      return o;
    });
    // one edge per foreign key: parent's PK row (right edge) → child's FK row (left edge)
    var edges = [];
    tables.forEach(function (child) {
      Object.keys(child.t.fk).forEach(function (col) {
        var parent = byName[child.t.fk[col]];
        var ci = colIndex(child.cols, col), pi = colIndex(parent.cols, parent.t.pk[0]);
        if (ci < 0 || pi < 0) return;
        edges.push({
          from: parent.t.name, to: child.t.name, nullable: child.cols[ci].nullable,
          x1: parent.t.x + ER.W, y1: parent.t.y + ER.HEAD + pi * ER.ROW + ER.ROW / 2,
          x2: child.t.x, y2: child.t.y + ER.HEAD + ci * ER.ROW + ER.ROW / 2
        });
      });
    });
    var w = 0, h = 0;
    tables.forEach(function (o) { w = Math.max(w, o.t.x + ER.W); h = Math.max(h, o.t.y + o.h); });
    return (erLast = { tables: tables, edges: edges, w: w + ER.PAD, h: h + ER.PAD });
  }

  var ER_MARKERS = ['', '-on'].map(function (s) {
    var c = s ? '#111111' : '#c2c7ce';
    return '<marker id="erOne' + s + '" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">' +
      '<circle cx="5" cy="5" r="2.6" fill="' + c + '"/></marker>' +
      '<marker id="erMany' + s + '" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">' +
      '<path d="M0,5 L10,0 M0,5 L10,5 M0,5 L10,10" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linecap="round"/></marker>';
  }).join('');

  function erCard(o, sel, related) {
    var t = o.t;
    var cls = sel ? (sel === t.name ? ' on' : (related[t.name] ? ' rel' : ' dim')) : '';
    var rows = o.cols.map(function (c) {
      var pk = t.pk.indexOf(c.name) >= 0, fk = !!t.fk[c.name];
      return '<div class="err' + (pk || fk ? ' key' : '') + '">' +
        '<span class="k">' + (pk ? '<em class="pk">PK</em>' : '') + (fk ? '<em class="fk">FK</em>' : '') + '</span>' +
        '<b>' + esc(c.name) + '</b><i>' + c.type + (c.nullable ? '?' : '') + '</i></div>';
    }).join('');
    return '<div class="erc' + cls + '" data-dbsel="' + t.name + '" style="left:' + t.x + 'px;top:' + t.y + 'px;width:' + ER.W + 'px">' +
      '<div class="erh"><b>' + t.name + '</b><span>' + (t.singleton ? 'single record' : nf(o.count) + ' rows') + '</span></div>' +
      '<div class="ercols">' + rows + '</div>' +
      '<div class="erf">' + esc(t.note) + '</div></div>';
  }

  function scrDatabase() {
    var er = erBuild(), sel = state.db.sel, related = {};
    if (sel) er.edges.forEach(function (e) {
      if (e.from === sel) related[e.to] = 1;
      if (e.to === sel) related[e.from] = 1;
    });

    var lines = er.edges.map(function (e) {
      var on = sel && (e.from === sel || e.to === sel);
      var k = Math.max(56, (e.x2 - e.x1) * 0.42), m = on ? '-on' : '';
      return '<path class="ere' + (sel ? (on ? ' on' : ' dim') : '') + '"' +
        ' d="M' + e.x1 + ',' + e.y1 + ' C' + (e.x1 + k) + ',' + e.y1 + ' ' + (e.x2 - k) + ',' + e.y2 + ' ' + e.x2 + ',' + e.y2 + '"' +
        (e.nullable ? ' stroke-dasharray="5 4"' : '') +
        ' marker-start="url(#erOne' + m + ')" marker-end="url(#erMany' + m + ')"/>';
    }).join('');

    var legend = '<div class="erlegend">' +
      '<div><span class="k"><em class="pk">PK</em></span>primary key</div>' +
      '<div><span class="k"><em class="fk">FK</em></span>points at another table</div>' +
      '<div><svg class="erleg-l" width="44" height="12" viewBox="0 0 44 12">' + ER_MARKERS +
      '<path class="ere" d="M6,6 L34,6" marker-start="url(#erOne)" marker-end="url(#erMany)"/></svg>one row → many rows</div>' +
      '<div><span class="k"><em class="q">?</em></span>nullable — link drawn dashed</div></div>';

    var zoom = '<div class="erzoom">' +
      '<button type="button" class="erz" data-dbz="out" title="Zoom out">−</button>' +
      '<span class="erpct" id="erPct">100%</span>' +
      '<button type="button" class="erz" data-dbz="in" title="Zoom in">+</button>' +
      '<span class="ersep"></span>' +
      '<button type="button" class="erz wide" data-dbz="fit">Fit</button></div>';

    var canvas = '<div class="ercanvas" id="erCanvas">' +
      '<div class="erpan" style="width:' + er.w + 'px;height:' + er.h + 'px">' +
      '<svg class="erlines" width="' + er.w + '" height="' + er.h + '">' + ER_MARKERS + lines + '</svg>' +
      er.tables.map(function (o) { return erCard(o, sel, related); }).join('') +
      '</div>' + legend + zoom + '</div>';

    // 'full' drops the content column's padding and width cap so the canvas
    // owns the whole viewport below the top bar.
    var content = '<div class="erbar">' +
      ph('Database') +
      '</div>' + canvas;
    return shell('#/database', content, 'full');
  }

  /* ---- Canvas pan / zoom -----------------------------------------------
     The app re-renders wholesale on every state change, so the view lives in
     state.db and is re-applied after each render. Panning writes the transform
     straight to the node (no re-render) to keep dragging smooth. */
  function wireDb() {
    var wrap = document.getElementById('erCanvas');
    if (!wrap) return;
    var pan = wrap.firstElementChild, pct = document.getElementById('erPct'), v = state.db;

    function apply() {
      pan.style.transform = 'translate(' + Math.round(v.x) + 'px,' + Math.round(v.y) + 'px) scale(' + v.z + ')';
      pct.textContent = Math.round(v.z * 100) + '%';
    }
    function zoomAt(cx, cy, z) {
      z = Math.max(0.25, Math.min(2.5, z));
      v.x = cx - (cx - v.x) * (z / v.z); v.y = cy - (cy - v.y) * (z / v.z); v.z = z; apply();
    }
    function fit() {
      var r = wrap.getBoundingClientRect();
      v.z = Math.max(0.25, Math.min((r.width - 40) / erLast.w, (r.height - 40) / erLast.h, 1));
      v.x = (r.width - erLast.w * v.z) / 2; v.y = (r.height - erLast.h * v.z) / 2; apply();
    }
    if (v.ready) apply(); else { v.ready = true; fit(); }

    var drag = null, moved = false;
    wrap.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.erzoom, .erlegend')) return;
      drag = { px: e.clientX, py: e.clientY, ox: v.x, oy: v.y }; moved = false;
      wrap.setPointerCapture(e.pointerId); wrap.classList.add('grabbing');
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.px, dy = e.clientY - drag.py;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) { v.x = drag.ox + dx; v.y = drag.oy + dy; apply(); }
    });
    function endDrag() { drag = null; wrap.classList.remove('grabbing'); }
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = wrap.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, v.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });

    wrap.addEventListener('click', function (e) {
      if (moved) { moved = false; return; }          // that was a pan, not a click
      if (e.target.closest('.erlegend')) return;
      var z = e.target.closest('[data-dbz]');
      if (z) {
        var a = z.getAttribute('data-dbz'), r = wrap.getBoundingClientRect();
        if (a === 'fit') fit(); else zoomAt(r.width / 2, r.height / 2, v.z * (a === 'in' ? 1.25 : 0.8));
        return;
      }
      var c = e.target.closest('[data-dbsel]'), name = c && c.getAttribute('data-dbsel');
      v.sel = name === v.sel ? null : name;          // click the canvas (or the same card) to clear
      render();
    });
  }

  /* ============================================================================
     EXPLORER — the same records the Database tab describes as a schema, walked
     as actual data. Every child node carries the foreign key that ties it to
     its parent, so the correlation is visible rather than implied:

       Manish Corporation                     clients.id = cli_acme
         └ Sales Assistant                    client_id = cli_acme
             ├ Rohit                          replica_id = rep_ava
             └ Jul 21, 14:02                  persona_id = per_sales
                 └ transcript                 conversation_id = conv_0001
     ========================================================================= */
  var TREE_KIND = {
    client: { table: 'clients', get: function (id) { return IX.clientsById[id]; }, route: function (id) { return '#/client/' + id; } },
    persona: { table: 'personas', get: function (id) { return IX.personasById[id]; }, route: function (id) { return '#/persona/' + id; } },
    replica: { table: 'replicas', get: function (id) { return IX.replicasById[id]; }, route: function (id) { return '#/replica/' + id; } },
    conversation: { table: 'conversations', get: function (id) { return IX.conversationsById[id]; }, route: null },
    transcript: { table: 'transcripts', get: function (id) { return DB.transcripts[id]; }, route: null }
  };
  var TABLE_KIND = { clients: 'client', personas: 'persona', replicas: 'replica', conversations: 'conversation', transcripts: 'transcript' };

  function treeRow(kind, id, label, meta, keyref, depth, kids) {
    var nid = kind + ':' + id;
    var open = !!state.tree.open[nid];
    return '<div class="trow' + (state.tree.sel === nid ? ' on' : '') + '" data-tsel="' + nid + '" style="padding-left:' + (8 + depth * 20) + 'px">' +
      (kids ? '<span class="tw' + (open ? ' open' : '') + '" data-topen="' + nid + '">▸</span>' : '<span class="tw sp"></span>') +
      '<span class="tk k-' + kind + '" title="' + kind + '">' + kind.charAt(0).toUpperCase() + '</span>' +
      '<span class="tl">' + label + '</span>' +
      (meta ? '<span class="tm">' + meta + '</span>' : '') +
      (keyref ? '<span class="tkey">' + keyref + '</span>' : '') + '</div>';
  }
  function isOpen(kind, id) { return !!state.tree.open[kind + ':' + id]; }

  function buildTree() {
    var html = '', n = 0;
    var groups = DB.clients.map(function (c) { return { c: c, id: c.id }; });
    groups.push({ c: null, id: '__pool__' });

    groups.forEach(function (g) {
      var personas, label, meta, keyref;
      if (g.c) {
        personas = DB.personas.filter(function (p) { return p.client_id === g.c.id; });
        label = esc(g.c.name);
        meta = personas.length + ' persona' + (personas.length === 1 ? '' : 's') + ' · ' + nf(IX.clientTotals[g.c.id].minutes) + ' min';
        keyref = 'id = ' + esc(g.c.id);
        n++;
        html += treeRow('client', g.c.id, label, meta, keyref, 0, personas.length > 0);
        if (!isOpen('client', g.c.id)) return;
      } else {
        personas = DB.personas.filter(function (p) { return !p.client_id; });
        var freeFaces = DB.replicas.filter(function (r) { return !r.client_id; });
        if (!personas.length && !freeFaces.length) return;
        html += '<div class="trow pool' + (state.tree.sel === 'pool:__pool__' ? ' on' : '') + '" data-tsel="pool:__pool__" style="padding-left:8px">' +
          '<span class="tw' + (isOpen('pool', '__pool__') ? ' open' : '') + '" data-topen="pool:__pool__">▸</span>' +
          '<span class="tk k-pool">∅</span><span class="tl">Unassigned pool</span>' +
          '<span class="tm">' + personas.length + ' personas · ' + freeFaces.length + ' faces</span>' +
          '<span class="tkey">client_id = null</span></div>';
        if (!isOpen('pool', '__pool__')) return;
        freeFaces.forEach(function (r) {
          n++;
          html += treeRow('replica', r.id, esc(r.name), esc(r.status), 'client_id = null', 1, false);
        });
      }

      personas.forEach(function (p) {
        n++;
        var pt = IX.personaTotals[p.id] || { minutes: 0, convos: 0 };
        var convs = DB.conversations.filter(function (x) { return x.persona_id === p.id; })
          .sort(function (a, b) { return Date.parse(b.started_at) - Date.parse(a.started_at); });
        var face = p.replica_id ? IX.replicasById[p.replica_id] : null;
        html += treeRow('persona', p.id, esc(p.name), nf(pt.minutes) + ' min · ' + nf(pt.convos) + ' convos',
          g.c ? 'client_id = ' + esc(p.client_id) : 'client_id = null', 1, !!(face || convs.length));
        if (!isOpen('persona', p.id)) return;

        if (face) { n++; html += treeRow('replica', face.id, esc(face.name), 'face · ' + esc(face.status), 'replica_id = ' + esc(face.id), 2, false); }
        convs.forEach(function (c) {
          n++;
          var tr = DB.transcripts[c.id];
          html += treeRow('conversation', c.id, fmtDateTime(c.started_at), fmtDur(c.duration_seconds) + ' · ' + esc(c.end_user_ref),
            'persona_id = ' + esc(c.persona_id), 2, !!tr);
          if (tr && isOpen('conversation', c.id)) {
            n++;
            html += treeRow('transcript', c.id, 'transcript', tr.turns.length + ' turns', 'conversation_id = ' + esc(c.id), 3, false);
          }
        });
      });
    });
    return { html: html, count: n };
  }

  function recordPanel() {
    var nid = state.tree.sel;
    if (!nid || nid.indexOf('pool:') === 0) {
      return '<div class="card"><div class="cardh">Record</div><div class="cardp"><div class="empty">' +
        '<b>Select a node</b>every stored field, plus the keys that tie it to the records above and below it</div></div></div>';
    }
    var kind = nid.slice(0, nid.indexOf(':')), id = nid.slice(nid.indexOf(':') + 1);
    var K = TREE_KIND[kind], rec = K.get(id);
    if (!rec) return '<div class="card"><div class="cardp"><div class="empty"><b>Record not found</b>it may have been reassigned</div></div></div>';

    var meta = ER_TABLES.filter(function (t) { return t.name === K.table; })[0] || { pk: [], fk: {} };
    var fields = Object.keys(rec).filter(function (k) { return k.charAt(0) !== '_'; }).map(function (k) {
      var v = rec[k], pk = meta.pk.indexOf(k) >= 0, fk = meta.fk[k];
      var shown;
      if (v == null) shown = '<span class="nullv">null</span>';
      else if (Array.isArray(v)) shown = v.length + ' item' + (v.length === 1 ? '' : 's');
      else if (typeof v === 'object') shown = esc(JSON.stringify(v));
      else shown = esc(String(v));
      // a foreign key is clickable — it selects the record it points at
      if (fk && v != null) {
        var tk = TABLE_KIND[fk];
        shown = '<a class="lnk" data-tsel="' + tk + ':' + esc(String(v)) + '">' + shown + '</a>' +
          '<span class="fkto">→ ' + fk + '</span>';
      }
      return '<tr><td class="fname">' + esc(k) + '</td>' +
        '<td class="num">' + (pk ? '<em class="kb pk">PK</em>' : '') + (fk ? '<em class="kb fk">FK</em>' : '') + '</td>' +
        '<td class="fval mono">' + shown + '</td></tr>';
    }).join('');

    // what points back at this record
    var refs = [];
    ER_TABLES.forEach(function (t) {
      Object.keys(t.fk).forEach(function (col) {
        if (t.fk[col] !== K.table) return;
        var rows = t.rows().filter(function (r) { return r[col] === id; });
        if (rows.length) refs.push(t.name + '.' + col + ' → ' + rows.length + ' row' + (rows.length === 1 ? '' : 's'));
      });
    });

    var open = K.route ? '<span class="btn sm" data-nav="' + K.route(id) + '">Open ' + kind + '</span>' :
      (kind === 'conversation' ? '<span class="btn sm" data-view="' + id + '">Transcript</span>' :
        '<span class="btn sm" data-view="' + id + '">View transcript</span>');

    return '<div class="card"><div class="cardh"><span class="tk k-' + kind + '">' + kind.charAt(0).toUpperCase() + '</span>' +
      esc(rec.name || id) + '<span class="hsub">' + K.table + '</span><div class="r">' + open + '</div></div>' +
      '<div class="tscroll"><table class="tbl rec"><tr><th>Field</th><th class="num">Key</th><th>Value</th></tr>' + fields + '</table></div>' +
      (refs.length ? '<div class="cardp note">referenced by · ' + refs.map(esc).join(' · ') + '</div>' : '') + '</div>';
  }

  /* open a node's ancestors so a selection made through a foreign key is visible */
  function revealInTree(nid) {
    var kind = nid.slice(0, nid.indexOf(':')), id = nid.slice(nid.indexOf(':') + 1);
    state.tree.seeded = true;
    var openOwner = function (cid) { state.tree.open[cid ? 'client:' + cid : 'pool:__pool__'] = true; };
    if (kind === 'client') { state.tree.open['client:' + id] = true; return; }
    if (kind === 'persona') {
      var p = IX.personasById[id];
      if (p) { openOwner(p.client_id); state.tree.open['persona:' + id] = true; }
      return;
    }
    if (kind === 'replica') {
      var rp = IX.replicasById[id]; if (!rp) return;
      if (!rp.client_id) state.tree.open['pool:__pool__'] = true;
      DB.personas.forEach(function (x) {          // a face sits under every persona that uses it
        if (x.replica_id === id) { openOwner(x.client_id); state.tree.open['persona:' + x.id] = true; }
      });
      return;
    }
    if (kind === 'conversation' || kind === 'transcript') {
      var c = IX.conversationsById[id]; if (!c) return;
      var pp = IX.personasById[c.persona_id];
      if (pp) { openOwner(pp.client_id); state.tree.open['persona:' + pp.id] = true; }
      if (kind === 'transcript') state.tree.open['conversation:' + id] = true;
    }
  }

  function scrExplorer() {
    if (!state.tree.seeded) {   // open the client level so the tree reads as a hierarchy on arrival
      DB.clients.forEach(function (c) { state.tree.open['client:' + c.id] = true; });
      state.tree.seeded = true;
    }
    var t = buildTree();
    var content = ph('Explorer', 'clients → personas → faces & sessions · every node shows the key that links it upward',
      '<span class="btn sm" data-texpand="all">Expand all</span><span class="btn sm" data-texpand="none">Collapse all</span>') +
      '<div class="explorer">' +
      '<div class="card treecard"><div class="cardh">Record tree<span class="hsub">' + nf(t.count) + ' nodes shown</span></div>' +
      '<div class="tree">' + t.html + '</div></div>' +
      recordPanel() + '</div>';
    return shell('#/explorer', content);
  }

  /* ============================ ROUTER ================================= */
  function render() {
    rebuild();
    var route = location.hash || '#/login';

    // not signed in → only the auth screens are reachable
    if (!state.user) {
      app.innerHTML = route === '#/set-password' ? scrSetPassword() : scrLogin();
      var f = document.getElementById('loginEmail');
      if (f && state.loginEmail) f.focus();
      return after();
    }
    if (route === '#/login' || route === '#/set-password') return go(homeRoute(state.user));

    // route guards: keep the URL consistent with the signed-in user's portal
    if (isClientView() && route.indexOf('#/c/') !== 0 && route.indexOf('#/persona/') !== 0) return go('#/c/dashboard');
    if (!isClientView() && route.indexOf('#/c/') === 0) return go('#/overview');
    // a client user may only open personas they own
    if (route.indexOf('#/persona/') === 0 && isClientView()) {
      var pp = IX.personasById[route.split('/')[2]];
      if (!pp || pp.client_id !== currentClientId()) return go('#/c/personas');
    }

    // a filter belongs to the table you typed it into — don't carry it to the next screen
    if (route !== state.lastRoute) { state.convFilter = ''; state.lastRoute = route; }

    if (route.indexOf('#/client/') === 0) { app.innerHTML = scrClientDetail(route.split('/')[2]); return after(); }
    if (route.indexOf('#/persona/') === 0) { app.innerHTML = scrPersonaDetail(route.split('/')[2]); return after(); }
    if (route.indexOf('#/replica/') === 0) { app.innerHTML = scrReplicaDetail(route.split('/')[2]); return after(); }

    var cid = currentClientId();
    var R = {
      '#/overview': scrOverview, '#/clients': scrClients, '#/personas': scrPersonas,
      '#/replicas': scrReplicas, '#/conversations': scrConversations, '#/reports': scrReports, '#/users': scrUsers,
      '#/database': scrDatabase, '#/explorer': scrExplorer,
      '#/c/dashboard': function () { return scrCDashboard(cid); }, '#/c/minutes': function () { return scrCMinutes(cid); },
      '#/c/personas': function () { return scrCPersonas(cid); }, '#/c/conversations': function () { return scrCConversations(cid); },
      '#/c/profile': function () { return scrCProfile(cid); }
    };
    var fn = R[route] || R[homeRoute(state.user)];
    if (route !== '#/clients' && route.indexOf('#/client/') !== 0) state.clientTab = 'personas';
    app.innerHTML = fn();
    after();
  }
  function after() { window.scrollTo(0, 0); wireDb(); }
  function go(route) { if (location.hash === route) render(); else location.hash = route; }

  function toast(msg) {
    state.toast = msg; render();
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { state.toast = ''; render(); }, 2600);
  }

  /* ---- Auth actions ----------------------------------------------------- */
  function findUser(email) {
    email = String(email || '').trim().toLowerCase();
    return DB.users.filter(function (u) { return u.email.toLowerCase() === email; })[0] || null;
  }
  function signIn(email) {
    var u = findUser(email);
    if (!u) { state.loginError = 'No account found for “' + email + '”. Pick one from the demo accounts panel.'; state.loginEmail = email; return render(); }
    if (u.status === 'disabled') { state.loginError = u.name + '’s login is disabled — ' + IX.clientsById[u.client_id].name + ' is paused. Ask a platform admin to re-enable it.'; state.loginEmail = email; return render(); }
    if (u.status === 'invited') { state.inviteUser = u; state.loginError = ''; state.loginEmail = email; return go('#/set-password'); }
    enter(u, 'Signed in as ' + u.name + ' · ' + roleLabel(u.group));
  }
  function enter(u, msg) {
    state.user = u; state.loginError = ''; state.loginEmail = ''; state.inviteUser = null;
    state.acctMenu = false; state.overlay = null; state.drawer = null; state.clientTab = 'personas';
    go(homeRoute(u));
    toast(msg);
  }
  function signOut() {
    state.user = null; state.acctMenu = false; state.overlay = null; state.drawer = null; state.mobileNav = false;
    state.demoPop = true; state.loginEmail = ''; state.loginError = '';
    go('#/login');
  }

  /* ---- Events ---------------------------------------------------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-nav],[data-signin],[data-switch],[data-signout],[data-demo-toggle],[data-acct-toggle],[data-menu-toggle],[data-nav-close],[data-open],[data-view],[data-close],[data-close-ov],[data-tab],[data-ptab],[data-rtab],[data-pfilter],[data-sort],[data-convclear],[data-report],[data-csv],[data-tsel],[data-topen],[data-texpand],[data-assign],[data-assign-toggle],[data-assign-commit],[data-unassign],[data-create-client],[data-sync],[data-topup],[data-topup-req],[data-stub],[data-period-toggle],[data-period],[data-export-toggle],[data-ovexport]');
    if (state.acctMenu && !(t && (t.hasAttribute('data-switch') || t.hasAttribute('data-acct-toggle')))) { state.acctMenu = false; render(); }
    if (state.periodMenu && !(t && (t.hasAttribute('data-period') || t.hasAttribute('data-period-toggle')))) { state.periodMenu = false; render(); }
    if (state.exportMenu && !(t && (t.hasAttribute('data-ovexport') || t.hasAttribute('data-export-toggle')))) { state.exportMenu = false; render(); }
    if (!t) return;

    if (t.hasAttribute('data-signin')) {
      // "auto" sign-in: fill the form, then submit it for the reviewer
      var mail = t.getAttribute('data-signin');
      state.loginEmail = mail; state.loginError = ''; render();
      setTimeout(function () { signIn(mail); }, 380);
      return;
    }
    if (t.hasAttribute('data-switch')) { var su = IX.usersById[t.getAttribute('data-switch')]; if (su) enter(su, 'Switched to ' + su.name + ' · ' + roleLabel(su.group)); return; }
    if (t.hasAttribute('data-signout')) { signOut(); return; }
    if (t.hasAttribute('data-demo-toggle')) { state.demoPop = !state.demoPop; render(); return; }
    if (t.hasAttribute('data-acct-toggle')) { state.acctMenu = !state.acctMenu; render(); return; }
    if (t.hasAttribute('data-menu-toggle')) { state.mobileNav = !state.mobileNav; render(); return; }
    if (t.hasAttribute('data-nav-close')) { state.mobileNav = false; render(); return; }
    if (t.hasAttribute('data-period-toggle')) { state.periodMenu = !state.periodMenu; state.exportMenu = false; render(); return; }
    if (t.hasAttribute('data-period')) { state.ovPeriod = parseInt(t.getAttribute('data-period'), 10); state.periodMenu = false; render(); return; }
    if (t.hasAttribute('data-export-toggle')) { state.exportMenu = !state.exportMenu; state.periodMenu = false; render(); return; }
    if (t.hasAttribute('data-ovexport')) {
      exportOverview(t.getAttribute('data-ovexport'), overviewStats(state.ovPeriod || 14));
      state.exportMenu = false; render();
      return;
    }

    if (t.hasAttribute('data-nav')) { e.preventDefault(); state.overlay = null; state.drawer = null; state.mobileNav = false; go(t.getAttribute('data-nav')); return; }
    if (t.hasAttribute('data-open')) { state.overlay = t.getAttribute('data-open'); render(); return; }
    if (t.hasAttribute('data-view')) { state.drawer = { type: 'transcript', id: t.getAttribute('data-view') }; render(); return; }
    if (t.hasAttribute('data-sync')) { state.drawer = { type: 'sync' }; render(); return; }
    if (t.hasAttribute('data-close')) { state.overlay = null; state.drawer = null; render(); return; }
    if (t.hasAttribute('data-close-ov') && e.target === t) { state.overlay = null; render(); return; }
    if (t.hasAttribute('data-tab')) { state.clientTab = t.getAttribute('data-tab'); render(); return; }
    if (t.hasAttribute('data-ptab')) { state.personaTab = t.getAttribute('data-ptab'); state.convFilter = ''; render(); return; }
    if (t.hasAttribute('data-rtab')) { state.replicaTab = t.getAttribute('data-rtab'); state.convFilter = ''; render(); return; }
    if (t.hasAttribute('data-pfilter')) { state.personaFilter = t.getAttribute('data-pfilter'); render(); return; }

    // conversation tables: click a header to sort, click again to flip
    if (t.hasAttribute('data-sort')) {
      var sk = t.getAttribute('data-sort');
      if (state.convSort.key === sk) state.convSort.dir = state.convSort.dir === 'asc' ? 'desc' : 'asc';
      else state.convSort = { key: sk, dir: sk === 'started_at' ? 'desc' : 'asc' };
      render(); return;
    }
    if (t.hasAttribute('data-convclear')) { state.convFilter = ''; render(); return; }

    // reports
    if (t.hasAttribute('data-csv')) {
      var rp = reportById(t.getAttribute('data-csv'));
      if (rp) { downloadCsv(rp.id + '.csv', toCsv(rp.headers, rp.build())); toast(rp.name + ' exported as ' + rp.id + '.csv'); }
      return;
    }
    if (t.hasAttribute('data-report')) {
      var rid = t.getAttribute('data-report');
      state.report = state.report === rid ? null : rid;
      render(); return;
    }

    // explorer tree
    if (t.hasAttribute('data-topen')) { var k = t.getAttribute('data-topen'); state.tree.open[k] = !state.tree.open[k]; render(); return; }
    if (t.hasAttribute('data-tsel')) {
      var sid = t.getAttribute('data-tsel');
      state.tree.sel = sid;
      // selecting through a foreign key from the record panel: reveal it in the tree
      if (location.hash !== '#/explorer') { revealInTree(sid); return go('#/explorer'); }
      revealInTree(sid); render(); return;
    }
    if (t.hasAttribute('data-texpand')) {
      if (t.getAttribute('data-texpand') === 'none') state.tree.open = {};
      else {
        DB.clients.forEach(function (c) { state.tree.open['client:' + c.id] = true; });
        state.tree.open['pool:__pool__'] = true;
        DB.personas.forEach(function (p) { state.tree.open['persona:' + p.id] = true; });
        DB.conversations.forEach(function (c) { state.tree.open['conversation:' + c.id] = true; });
      }
      render(); return;
    }

    if (t.hasAttribute('data-assign')) { state.overlay = 'assign'; state.assignFor = t.getAttribute('data-assign'); state.assignSel = {}; render(); return; }
    if (t.hasAttribute('data-assign-toggle')) { var id = t.getAttribute('data-assign-toggle'); state.assignSel[id] = !state.assignSel[id]; render(); return; }
    if (t.hasAttribute('data-assign-commit')) {
      var n = 0;
      Object.keys(state.assignSel).forEach(function (pid) {
        if (!state.assignSel[pid]) return;
        n++;
        IX.personasById[pid].client_id = state.assignFor;
        var rid = IX.personasById[pid].replica_id;
        if (rid && IX.replicasById[rid]) IX.replicasById[rid].client_id = state.assignFor;
      });
      state.overlay = null; state.assignSel = {};
      render(); if (n) toast(n + ' persona' + (n > 1 ? 's' : '') + ' assigned to ' + IX.clientsById[state.assignFor].name);
      return;
    }
    if (t.hasAttribute('data-unassign')) {
      var pid2 = t.getAttribute('data-unassign'), nm = IX.personasById[pid2].name;
      IX.personasById[pid2].client_id = null; render(); toast(nm + ' returned to the unassigned pool');
      return;
    }
    if (t.hasAttribute('data-topup') || t.hasAttribute('data-topup-req')) {
      toast('Prototype: a top-up appends a ledger entry — not persisted'); return;
    }
    if (t.hasAttribute('data-stub')) { toast(t.getAttribute('data-stub')); return; }

    if (t.hasAttribute('data-create-client')) {
      var name = (document.getElementById('nc_name').value || '').trim() || 'New Client';
      var alloc = parseInt((document.getElementById('nc_alloc').value || '0').replace(/[^0-9]/g, ''), 10) || 0;
      var cid = 'cli_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 12) + '_' + Math.floor(Math.random() * 900 + 100);
      DB.clients.push({ id: cid, name: name, status: 'active', term: { start: '2026-07-21', end: '2026-10-20', months: 3 }, budget_minutes: alloc, created_at: NOW });
      DB.minute_ledger.push({ id: 'led_' + cid, client_id: cid, date: '2026-07-21', type: 'initial', amount: alloc, balance_after: alloc, admin: state.user.name, note: 'Initial allocation' });
      state.overlay = null; state.clientTab = 'personas';
      go('#/client/' + cid); toast(name + ' created with ' + nf(alloc) + ' minutes');
      return;
    }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'loginForm') {
      e.preventDefault();
      signIn(document.getElementById('loginEmail').value);
    } else if (e.target.id === 'setPwForm') {
      e.preventDefault();
      var u = state.inviteUser;
      if (!u) return go('#/login');
      u.status = 'active'; u.last_active = NOW;          // invite accepted
      enter(u, 'Account created — signed in as ' + u.name);
    }
  });

  // keep the typed email in state so a re-render (popup toggle) doesn't wipe it
  document.addEventListener('input', function (e) {
    if (e.target.id === 'loginEmail') state.loginEmail = e.target.value;
    if (e.target.id === 'convq') {
      // re-render filters the table; put the caret back so typing is uninterrupted
      state.convFilter = e.target.value;
      var caret = e.target.selectionStart;
      render();
      var el = document.getElementById('convq');
      if (el) { el.focus(); el.setSelectionRange(caret, caret); }
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (state.overlay || state.drawer || state.acctMenu || state.mobileNav) { state.overlay = null; state.drawer = null; state.acctMenu = false; state.mobileNav = false; render(); }
  });

  window.addEventListener('hashchange', function () { state.overlay = null; state.drawer = null; state.mobileNav = false; render(); });

  rebuild();
  render();
})();
