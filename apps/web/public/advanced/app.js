/* Sokan console frontend. Vanilla JS, no framework, no CDN.
 * Server text is only ever inserted with textContent (or as a text node); there is no innerHTML. */
(() => {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const faDigits = (s) => String(s).replace(/[0-9]/g, (d) => FA[d]);
  const nfInt = new Intl.NumberFormat('fa-IR');
  const nfDec = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const fmtNum = (n) => (isNum(n) ? nfDec.format(n) : '—');
  const fmtInt = (n) => (isNum(n) ? nfInt.format(n) : faDigits(n ?? '—'));
  const fmtDate = (ts) => { const d = new Date(ts); return isNaN(d) ? '—' : d.toLocaleString('fa-IR'); };
  const fmtTime = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('fa-IR'); };
  const clockText = (sec) => faDigits(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const fmtVal = (v) => (v === null || v === undefined ? '—' : isNum(v) ? fmtNum(v) : String(v));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else if (k === 'value') node.value = String(v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    appendKids(node, kids);
    return node;
  }
  function appendKids(node, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      node.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  function svgEl(tag, attrs = {}) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  }

  /* ---------- API ---------- */
  class ApiError extends Error {
    constructor(status, code, message) {
      super(code);
      this.status = status;
      this.code = code;
      this.message_fa = message || '';
    }
  }

  async function api(path, opts = {}) {
    const { method = 'GET', body, raw = false } = opts;
    const init = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Sokan-CSRF': '1' },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(path, init);
    } catch (_) {
      throw new ApiError(0, 'NETWORK', '');
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (_) { data = null; } }
    if (!res.ok) {
      if (res.status === 401) showGate();
      const code = (data && data.code) || (res.status === 401 ? 'UNAUTHORIZED' : `HTTP_${res.status}`);
      const msg = data && typeof data === 'object' ? (data.message_fa || data.message || '') : '';
      throw new ApiError(res.status, code, msg);
    }
    return raw ? text : data;
  }

  /* ---------- Persian error copy (what / why / next) ---------- */
  const ERRORS = {
    UNAUTHORIZED: { what: 'نشست ورود معتبر نیست', why: 'این کنسول فقط با لینکی باز می‌شود که هنگام اجرا در ترمینال چاپ شده است.', next: 'لینک ورود را از ترمینال باز کنید.' },
    WRONG_CONFIRMATION: { what: 'نام اپ وارد شده درست نیست', why: 'برای اجرای کارت پرخطر باید نام دقیق اپ هدف را تایپ کنید.', next: 'نام اپ را دقیق بنویسید و دوباره تأیید کنید.' },
    APPROVAL_EXPIRED: { what: 'مهلت این کارت تمام شده', why: 'کارت‌های تأیید پس از ۵ دقیقه منقضی می‌شوند تا اجرای قدیمی انجام نشود.', next: 'درخواست را دوباره از گفتگو بفرستید.' },
    TOKEN_EXPIRED: { what: 'توکن تأیید منقضی شده', why: 'توکن تأیید فقط برای مدت کوتاهی معتبر است.', next: 'کارت را دوباره باز کنید یا درخواست را از نو بفرستید.' },
    PARAM_MISMATCH: { what: 'اجرا متوقف شد', why: 'پارامترهای اجرا با پارامترهایی که تأیید کرده‌اید یکی نیست. این یعنی کسی یا چیزی پارامترها را تغییر داده است.', next: 'کارت تازه بسازید و جزئیات را دوباره بررسی کنید.' },
    FORGED_TOKEN: { what: 'توکن تأیید معتبر نیست', why: 'امضای توکن با کلید این سرور مطابقت ندارد.', next: 'کارت را از کنسول فعلی دوباره تأیید کنید.' },
    REPLAY_DETECTED: { what: 'این تأیید قبلاً استفاده شده', why: 'هر تأیید فقط یک بار قابل اجراست.', next: 'اگر اقدام تکرار لازم است، درخواست تازه بفرستید.' },
    NOT_APPROVED: { what: 'این کارت هنوز تأیید نشده', why: 'اجرا فقط بعد از تأیید شما انجام می‌شود.', next: 'کارت را باز کنید و تأیید کنید.' },
    UNKNOWN_APPROVAL: { what: 'کارت پیدا نشد', why: 'شاید کارت بسته شده، منقضی شده یا این سرور از نو اجرا شده است.', next: 'فهرست تأییدهای در انتظار را بررسی کنید.' },
    TOOL_MISMATCH: { what: 'اقدام با کارت تأیید یکی نیست', why: 'ابزار درخواستی با ابزار تأییدشده فرق دارد.', next: 'درخواست را دوباره از گفتگو بفرستید.' },
    IN_CANCEL_WINDOW: { what: 'هنوز در مهلت لغو است', why: 'اجرای کارت پرخطر ۱۰ ثانیه پس از تأیید شروع می‌شود.', next: 'برای توقف «لغو» را بزنید یا صبر کنید.' },
    OUT_OF_BOUNDS: { what: 'این اقدام مجاز نیست', why: 'سیاست امنیتی سُکان این اقدام را خارج از مرزهای مجاز می‌داند.', next: 'اقدام دیگری را انتخاب کنید یا با مدیر اپ هماهنگ کنید.' },
    APPROVAL_REQUIRED: { what: 'تأیید لازم است', why: 'این اقدام بدون تأیید شما اجرا نمی‌شود.', next: 'کارت تأیید را باز کنید.' },
    NETWORK: { what: 'اتصال برقرار نشد', why: 'سرور سُکان در دسترس نیست یا اتصال شبکه قطع است.', next: 'بررسی کنید ترمینال سُکان هنوز در حال اجراست.' },
    HTTP_403: { what: 'درخواست از این صفحه پذیرفته نشد', why: 'کنسول درخواست را به‌خاطر امنیت رد کرد (مبدا یا هدر CSRF).', next: 'صفحه را از لینک ترمینال دوباره باز کنید.' },
    HTTP_404: { what: 'مورد پیدا نشد', why: 'این کارت یا منبع دیگر در سرور وجود ندارد.', next: 'وضعیت را تازه کنید.' },
  };
  function toastError(err, action) {
    const map = ERRORS[err && err.code] || null;
    const what = map ? map.what : `${action} انجام نشد`;
    const why = (err && err.message_fa) || (map && map.why) || 'سرور پاسخ غیرمنتظره‌ای داد.';
    const next = (map && map.next) || 'دوباره تلاش کنید. اگر تکرار شد، گزارش‌های ترمینال را بررسی کنید.';
    toast({ kind: 'error', title: action, lines: [['چه شد؟', what], ['چرا؟', why], ['چه کنم؟', next]], ms: 11000 });
  }

  /* ---------- toasts ---------- */
  function toast({ kind = 'info', title, lines = [], ms = 6500 }) {
    const box = $('#toasts');
    const node = el('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      el('strong', { text: title }),
      lines.filter(([, v]) => v).map(([k, v]) => el('div', { class: 'toast-line' }, el('b', { text: `${k}: ` }), String(v))));
    box.append(node);
    while (box.childElementCount > 4) box.firstElementChild.remove();
    setTimeout(() => node.remove(), ms);
  }

  /* ---------- rich text (escaped by construction, linkified, evidence chips) ---------- */
  function evChip(id) {
    const ev = findEvidence(id);
    return el('button', {
      type: 'button', class: 'ev-chip',
      title: ev ? ev.summary : 'شاهد',
      onclick: (e) => { e.stopPropagation(); jumpToEvidence(id); },
    }, ev ? trunc(ev.summary, 70) : 'شاهد بدون شرح');
  }
  function inlineNodes(line) {
    const out = [];
    const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[ev_[A-Za-z0-9_-]+\]|https?:\/\/[^\s<]+)/g;
    let last = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) out.push(line.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) out.push(el('strong', { text: tok.slice(2, -2) }));
      else if (tok.startsWith('`')) out.push(el('code', { text: tok.slice(1, -1) }));
      else if (tok.startsWith('[')) out.push(evChip(tok.slice(1, -1)));
      else {
        const clean = tok.replace(/[.,،؛:!?)]+$/u, '');
        out.push(el('a', { href: clean, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr', text: clean }));
        if (clean.length < tok.length) out.push(tok.slice(clean.length));
      }
      last = m.index + tok.length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  }
  function richNodes(text) {
    const out = [];
    String(text ?? '').split(/\r?\n/).forEach((line, i) => {
      if (i > 0) out.push(el('br'));
      out.push(...inlineNodes(line));
    });
    return out;
  }
  const rich = (text, cls = 'rich') => el('div', { class: cls }, richNodes(text));

  /* ---------- labels ---------- */
  const TOOL_FA = {
    app_restart: 'ری‌استارت اپ', app_update_envs: 'به‌روزرسانی متغیرها', app_resize_plan: 'تغییر پلن',
    app_update_port: 'تغییر پورت', app_scale: 'تغییر مقیاس', deploy: 'استقرار', release_rollback: 'بازگشت به ریلیز قبلی',
    app_delete: 'حذف اپ',
  };
  const APP_STATUS_FA = { running: 'در حال اجرا', stopped: 'متوقف', deploying: 'در حال استقرار', unknown: 'نامشخص' };
  const INC_STATUS_FA = { investigating: 'در حال بررسی', awaiting_approval: 'منتظر تأیید', remediating: 'در حال رفع', resolved: 'حل شد', unresolved: 'حل نشد' };
  const CONF_FA = { high: 'بالا', medium: 'متوسط', low: 'پایین' };
  const EV_TYPE_FA = { log: 'لاگ', metric: 'متریک', event: 'رویداد', release: 'ریلیز', applet: 'اپلت', probe: 'پروب' };
  const TIER_FA = { economy: 'اقتصادی', economic: 'اقتصادی', recommended: 'پیشنهادی', scalable: 'مقیاس‌پذیر' };
  const STEPS = [
    ['analyze', 'تحلیل پروژه'], ['pack', 'بسته‌بندی سورس'], ['upload', 'آپلود سورس'], ['release', 'ایجاد ریلیز'],
    ['build', 'ساخت ایمیج'], ['verify', 'راستی‌آزمایی'], ['ready', 'آماده'],
  ];
  const SCENARIOS = [
    { id: 'scenario-1-deploy', title: 'سناریو ۱: استقرار اولین اپ', desc: 'از تحلیل پروژه تا آدرس زنده، با تأیید پلن و تأیید کارت استقرار.' },
    { id: 'scenario-2-error500', title: 'سناریو ۲: خطای ۵۰۰ پس از انتشار', desc: 'بعد از یک ریلیز، مسیر /api/items خطای ۵۰۰ می‌دهد. سُکان شواهد را جمع می‌کند و راهکار پیشنهاد می‌دهد.' },
    { id: 'scenario-3-leak', title: 'سناریو ۳: نشت حافظه', desc: 'حافظه با هر درخواست بیشتر می‌شود. روند رشد از پروب‌ها و متریک‌ها بررسی می‌شود.' },
    { id: 'scenario-4-cpu', title: 'سناریو ۴: اشباع CPU', desc: 'مصرف پردازنده به سقف می‌رسد. سُکان تشخیص می‌دهد که مشکل از منابع است یا از کد.' },
    { id: 'scenario-5-upstream', title: 'سناریو ۵: وابستگی کند بیرونی', desc: 'یک سرویس بیرونی کند است و پاسخ اپ را معطل می‌کند.' },
    { id: 'scenario-6-wrong-port', title: 'سناریو ۶: پورت اشتباه', desc: 'اپ روی پورتی غیر از پورت اعلام‌شده گوش می‌دهد. سُکان اختلاف را نشان می‌دهد و اصلاح پورت پیشنهاد می‌کند.' },
    { id: 'scenario-tamper-test', title: 'آزمون امنیتی: دستکاری کارت تأیید', desc: 'پارامتر یک کارت تأییدشده عوض می‌شود. اجرا باید با خطای عدم تطابق پارامتر متوقف شود.' },
    { id: 'scenario-injection', title: 'آزمون امنیتی: تزریق دستور در لاگ', desc: 'یک خط لاگ دستور می‌دهد. سُکان آن را داده‌ی مشکوک علامت می‌زند و هیچ اقدامی اجرا نمی‌کند.' },
  ];

  /* ---------- state ---------- */
  const S = {
    state: null,
    mode: 'simulated',
    approvals: new Map(),
    resultByApproval: new Map(),
    openApprovalId: null,
    typed: {},
    results: [],
    steps: {},
    deployMsg: '',
    buildLines: [],
    logs: [],
    logsLoaded: false,
    probes: [],
    incident: null,
    history: [],
    busy: false,
    es: null,
  };

  /* ---------- approval phases ---------- */
  function phaseOf(a, now = Date.now()) {
    if (a.status === 'pending') return a.expiresAt && Date.parse(a.expiresAt) <= now ? 'expired' : 'pending';
    if (a.status === 'approved' && a.executableAfter && Date.parse(a.executableAfter) > now) return 'cancelwin';
    return a.status || 'unknown';
  }
  const LIVE_PHASES = new Set(['pending', 'cancelwin']);

  function upsertApproval(a) {
    if (!a || !a.id) return;
    S.approvals.set(a.id, { ...(S.approvals.get(a.id) || {}), ...a });
  }

  /* ---------- small view builders ---------- */
  function chip(kind, text) { return el('span', { class: `chip ${kind}` }, text); }
  function modeChip(mode) {
    const m = mode || S.mode;
    return m === 'live' ? chip('ok', 'زنده (لیارا)') : m === 'simulated' ? chip('warn', 'شبیه‌سازی محلی') : chip('plain', 'حالت نامشخص');
  }
  function riskBadge(level) {
    const cls = level === 'L3' ? 'l3' : level === 'L2' ? 'l2' : 'l1';
    const label = level === 'L3' ? 'L3 · پرخطر' : level === 'L2' ? 'L2 · متوسط' : (level || 'L?');
    return el('span', { class: `risk ${cls}` }, label);
  }
  function statusChip(ph) {
    const map = {
      pending: ['warn', 'در انتظار تأیید'], expired: ['plain', 'منقضی شد'], cancelwin: ['info', 'تأیید شد؛ در مهلت لغو'],
      approved: ['ok', 'تأیید شد'], executed: ['ok', 'اجرا شد'], rejected: ['bad', 'رد شد'], cancelled: ['plain', 'لغو شد'],
    };
    const [k, t] = map[ph] || ['plain', ph];
    return chip(k, t);
  }
  function appKind(status) { return status === 'running' ? 'ok' : status === 'stopped' ? 'bad' : status === 'deploying' ? 'info' : 'plain'; }
  function linkNode(url) {
    return /^https?:\/\//.test(String(url))
      ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr', text: url })
      : String(url);
  }
  function field(label, value) {
    return el('div', { class: 'field' }, el('div', { class: 'field-k', text: label }), el('div', { class: 'field-v' }, value ?? '—'));
  }
  function notice(kind, ...kids) { return el('div', { class: `notice ${kind}` }, kids); }

  /* ---------- header, banner, app ---------- */
  function renderChips() {
    const box = $('#chips');
    box.replaceChildren();
    const st = S.state;
    if (!st) { box.append(chip('plain', 'در حال بارگذاری…')); return; }
    box.append(st.mode === 'simulated' ? chip('warn', 'حالت شبیه‌سازی') : chip('ok', 'live · متصل به لیارا'));
    if (st.isEphemeralSecret) box.append(chip('warn', 'کلید تأیید موقت است؛ با ری‌استارت سرور تأییدها باطل می‌شوند'));
    if (st.llm && st.llm.configured === false) box.append(chip('warn', 'بدون LLM — مسیریاب آفلاین'));
    const app = st.app || {};
    box.append(chip(appKind(app.status), `اپ: ${APP_STATUS_FA[app.status] || 'نامشخص'}`));
  }
  function renderBanner() {
    $('#modeBanner').hidden = !(S.state && S.state.mode === 'simulated');
  }
  function appInfoNodes() {
    const st = S.state || {};
    const app = st.app || {};
    const acc = st.account || null;
    const rows = [
      ['نام اپ', app.name || '—'],
      ['وضعیت', chip(appKind(app.status), APP_STATUS_FA[app.status] || 'نامشخص')],
      ['آدرس', app.url ? linkNode(app.url) : '—'],
      ['پلن', app.planID || '—'],
      ['پورت', app.port ? fmtInt(app.port) : '—'],
      ['موجودی حساب', acc ? (isNum(acc.balance) ? `${fmtInt(acc.balance)} تومان` : '—') : 'نامشخص (لیارا متصل نیست)'],
    ];
    return el('dl', { class: 'kv-list' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', {}, v)]));
  }
  function renderAppInfo() {
    $('#appInfo').replaceChildren(el('h3', { text: 'اپ' }), appInfoNodes());
    $('#sideApp').replaceChildren(el('div', { class: 'card-head' }, el('h3', { text: 'اپ هدف' })), appInfoNodes());
  }

  /* ---------- deploy steps ---------- */
  function renderSteps() {
    const ol = $('#steps');
    ol.replaceChildren();
    STEPS.forEach(([id, label], i) => {
      const st = S.steps[id] || 'pending';
      ol.append(el('li', { class: st },
        el('span', { class: 'st', text: st === 'done' ? '✓' : st === 'failed' ? '✗' : String(i + 1) }),
        el('span', { text: label }),
        st === 'running' ? el('span', { class: 'muted', text: S.deployMsg || 'در حال انجام…' }) : null));
    });
  }
  function renderBuildLog() {
    $('#buildLog').textContent = S.buildLines.join('\n');
    $('#buildCount').textContent = fmtInt(S.buildLines.length);
  }
  function onDeployProgress(d) {
    const order = STEPS.map(([id]) => id);
    if (d.stage === 'analyze') { S.buildLines = []; S.steps = {}; }
    if (d.stage === 'failed') {
      const current = order.find((id) => S.steps[id] === 'running') || order.find((id) => !S.steps[id] || S.steps[id] === 'pending') || 'build';
      S.steps[current] = 'failed';
      toast({ kind: 'error', title: 'استقرار ناموفق بود', lines: [['چه شد؟', d.message_fa || 'استقرار متوقف شد.'], ['چه کنم؟', 'لاگ ساخت را در تب وضعیت ببینید و از گفتگو بخواهید علت را تحلیل کند.']], ms: 11000 });
    } else if (d.stage === 'ready') {
      order.forEach((id) => { S.steps[id] = 'done'; });
    } else {
      const idx = order.indexOf(d.stage);
      if (idx >= 0) {
        order.forEach((id, i) => {
          if (i < idx) S.steps[id] = 'done';
          else if (i === idx) S.steps[id] = 'running';
          else if (S.steps[id] !== 'failed') S.steps[id] = 'pending';
        });
      }
    }
    S.deployMsg = d.message_fa || '';
    if (d.line) { S.buildLines.push(String(d.line)); if (S.buildLines.length > 500) S.buildLines.shift(); }
    renderSteps();
    renderBuildLog();
  }

  /* ---------- results ---------- */
  function verifyBlock(v) {
    return el('div', { class: 'verify' },
      el('div', { class: 'row between wrap' }, el('strong', { text: 'راستی‌آزمایی' }), chip(v.passed ? 'ok' : 'bad', v.passed ? 'تأیید شد' : 'تأیید نشد')),
      el('ul', { class: 'checks' }, (v.checks || []).map((c) => el('li', { class: c.passed ? 'pass' : 'fail' },
        el('span', { class: 'mark', text: c.passed ? '✓' : '✗' }),
        el('div', {},
          el('div', { text: c.detail_fa || '' }),
          el('div', { class: 'ba', dir: 'ltr', text: `${fmtVal(c.before)} → ${fmtVal(c.after)}` }))))),
      v.summary_fa ? el('p', { class: 'muted', text: v.summary_fa }) : null);
  }
  function resultCard(d) {
    const err = d.error;
    return el('article', { class: `result ${d.ok ? 'ok' : 'fail'}` },
      el('div', { class: 'row between wrap' },
        el('strong', { text: TOOL_FA[d.tool] || d.tool || 'اقدام' }),
        el('div', { class: 'row wrap gap' }, chip(d.ok ? 'ok' : 'bad', d.ok ? 'موفق' : 'ناموفق'), modeChip(d.mode))),
      d.result_fa ? rich(d.result_fa, 'rich') : null,
      err ? el('div', { class: 'err3' },
        el('div', {}, el('b', { text: 'چه شد؟ ' }), err.what_fa || ''),
        el('div', {}, el('b', { text: 'چرا؟ ' }), err.why_fa || ''),
        el('div', {}, el('b', { text: 'چه کنم؟ ' }), err.next_fa || '')) : null,
      d.verification ? verifyBlock(d.verification) : null);
  }
  function renderResults() {
    const box = $('#results');
    box.replaceChildren();
    if (!S.results.length) { box.append(el('div', { class: 'empty', text: 'هنوز اقدامی اجرا نشده است. نتیجه‌ی هر اقدام تأییدشده همین‌جا با راستی‌آزمایی نمایش داده می‌شود.' })); return; }
    S.results.slice(0, 10).forEach((d) => box.append(resultCard(d)));
  }
  function onActionResult(d) {
    S.results.unshift(d);
    S.results = S.results.slice(0, 20);
    if (d.approvalId) {
      S.resultByApproval.set(d.approvalId, d);
      const a = S.approvals.get(d.approvalId);
      if (a) a.status = 'executed';
    }
    renderResults();
    renderTray();
    if (S.openApprovalId && S.openApprovalId === d.approvalId) closeSheet();
    addMsg('bot', [resultCard(d)]);
    const ok = d.ok && !(d.verification && !d.verification.passed);
    if (ok) {
      toast({ kind: 'ok', title: 'اقدام انجام شد', lines: [['نتیجه', d.result_fa || ''], ['حالت', d.mode === 'simulated' ? 'شبیه‌سازی محلی' : 'زنده']] });
    } else if (d.ok) {
      toast({ kind: 'error', title: 'اقدام اجرا شد؛ راستی‌آزمایی تأیید نشد', lines: [['چه شد؟', d.verification.summary_fa || 'وضعیت بعد از اقدام با معیار موفقیت یکی نیست.'], ['چه کنم؟', 'تب وضعیت را ببینید؛ در صورت نیاز اقدام دیگری پیشنهاد می‌شود.']], ms: 11000 });
    } else {
      toast({ kind: 'error', title: 'اقدام انجام نشد', lines: [['چه شد؟', d.error?.what_fa || 'اقدام کامل نشد.'], ['چرا؟', d.error?.why_fa || d.result_fa || ''], ['چه کنم؟', d.error?.next_fa || 'وضعیت را در تب وضعیت ببینید.']], ms: 11000 });
    }
    refetchState();
  }

  /* ---------- probes sparkline ---------- */
  function renderSpark() {
    const wrap = $('#sparkWrap');
    const pts = S.probes.slice(-50);
    if (!pts.length) {
      wrap.replaceChildren(el('div', { class: 'empty', text: 'هنوز پروبی ثبت نشده است. با بررسی اپ، زمان پاسخ و حافظه اینجا رسم می‌شود.' }));
      return;
    }
    const W = 600, H = 170, P = 14;
    const msOf = (p) => (isNum(Number(p.ms)) ? Number(p.ms) : 0);
    const okOf = (p) => (typeof p.ok === 'boolean' ? p.ok : p.status >= 200 && p.status < 400);
    const maxMs = Math.max(200, ...pts.map(msOf));
    const rss = pts.map((p) => p.rssMB).filter(isNum);
    const maxRss = Math.max(64, ...rss, 1);
    const xAt = (i) => (pts.length <= 1 ? W / 2 : P + i * (W - 2 * P) / (pts.length - 1));
    const yMs = (v) => H - P - (Math.min(v, maxMs) / maxMs) * (H - 2 * P);
    const yRs = (v) => H - P - (Math.min(v, maxRss) / maxRss) * (H - 2 * P);
    const s = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img', 'aria-label': 'نمودار زمان پاسخ و حافظه', dir: 'ltr' });
    s.append(svgEl('line', { x1: P, x2: W - P, y1: H - P, y2: H - P, style: 'stroke:var(--border)' }));
    s.append(svgEl('polyline', { points: pts.map((p, i) => `${xAt(i)},${yMs(msOf(p))}`).join(' '), fill: 'none', style: 'stroke:var(--primary);stroke-width:2.5' }));
    const rssPts = pts.map((p, i) => (isNum(p.rssMB) ? `${xAt(i)},${yRs(p.rssMB)}` : null)).filter(Boolean).join(' ');
    if (rssPts) s.append(svgEl('polyline', { points: rssPts, fill: 'none', style: 'stroke:var(--ok);stroke-width:2;stroke-dasharray:5 4' }));
    pts.forEach((p, i) => { if (!okOf(p)) s.append(svgEl('circle', { cx: xAt(i), cy: yMs(msOf(p)), r: 4, style: 'fill:var(--bad)' })); });
    const last = pts[pts.length - 1];
    wrap.replaceChildren(
      s,
      el('div', { class: 'spark-legend' },
        el('span', {}, el('span', { class: 'swatch', style: 'background:var(--primary)' }), `زمان پاسخ: آخرین ${fmtNum(msOf(last))} میلی‌ثانیه`),
        el('span', {}, el('span', { class: 'swatch', style: 'background:var(--ok)' }), isNum(last.rssMB) ? `حافظه: آخرین ${fmtNum(last.rssMB)} مگابایت` : 'حافظه: نامشخص'),
        el('span', {}, el('span', { class: 'swatch', style: 'background:var(--bad)' }), 'پروب ناموفق')),
    );
  }

  /* ---------- tray & approval sheet ---------- */
  function renderTray() {
    const now = Date.now();
    const items = [...S.approvals.values()].filter((a) => LIVE_PHASES.has(phaseOf(a, now)));
    $('#trayCount').textContent = fmtInt(items.length);
    const pill = $('#trayPill');
    pill.hidden = items.length === 0;
    pill.textContent = `${fmtInt(items.length)} تأیید در انتظار`;
    const box = $('#tray');
    box.replaceChildren();
    if (!items.length) {
      box.append(el('p', { class: 'muted', text: 'هیچ تأیید در انتظاری نیست. وقتی سُکان اقدامی پیشنهاد دهد، کارتش اینجا می‌آید.' }));
      return;
    }
    items.forEach((a) => {
      const ph = phaseOf(a, now);
      box.append(el('div', { class: 'tray-item' },
        el('div', { class: 'row between wrap' }, riskBadge(a.riskLevel), modeChip(a.mode)),
        el('div', { class: 'tray-title', text: a.card?.title_fa || TOOL_FA[a.tool] || a.tool }),
        ph === 'cancelwin'
          ? el('div', { class: 'muted' }, 'اجرا تا ', el('span', { class: 'clock', 'data-until': a.executableAfter, 'data-done': 'در حال اجرا' }), ' دیگر')
          : el('div', { class: 'muted' }, 'انقضا: ', el('span', { class: 'clock', 'data-until': a.expiresAt, 'data-done': 'منقضی شد' })),
        el('button', { type: 'button', class: 'btn primary small', onclick: () => openApproval(a.id), text: 'بررسی کارت' })));
    });
    tick();
  }
  function openApproval(id) {
    S.openApprovalId = id;
    $('#approvalOverlay').hidden = false;
    document.body.classList.add('lock');
    renderSheet();
    requestAnimationFrame(() => $('#sheetTitle')?.focus());
  }
  function closeSheet() {
    S.openApprovalId = null;
    $('#approvalOverlay').hidden = true;
    if ($('#envOverlay').hidden) document.body.classList.remove('lock');
  }
  function renderSheet() {
    if (!S.openApprovalId) return;
    const a = S.approvals.get(S.openApprovalId);
    if (!a) { closeSheet(); return; }
    const c = a.card || {};
    const ph = phaseOf(a);
    const typedPrev = S.typed[a.id] || '';
    const needsTyped = a.riskLevel === 'L3' && a.requiresTypedConfirmation !== false && ph === 'pending';

    $('#sheetHead').replaceChildren(
      el('div', { class: 'sheet-title' },
        el('div', { class: 'row wrap gap' }, riskBadge(a.riskLevel), modeChip(a.mode), statusChip(ph)),
        el('h2', { id: 'sheetTitle', tabindex: '-1', text: c.title_fa || TOOL_FA[a.tool] || a.tool })),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'بستن', onclick: closeSheet, text: '✕' }));

    const body = [];
    if (ph === 'pending') body.push(el('div', { class: 'row wrap gap' }, el('span', { text: 'انقضا:' }), el('span', { class: 'clock', 'data-until': a.expiresAt, 'data-done': 'منقضی شد' })));
    if (ph === 'expired') body.push(notice('warn', 'مهلت این کارت تمام شده است. برای ادامه، درخواست را دوباره بفرستید.'));
    if (a.riskLevel === 'L3' && ph === 'pending') body.push(notice('bad', 'این اقدام پرخطر است. پس از تأیید، ۱۰ ثانیه فرصت لغو دارید.'));
    body.push(field('چه کاری', rich(c.what_fa)));
    body.push(field('چرا', rich(c.why_fa)));
    body.push(field('هزینه', c.cost_fa));
    body.push(field('اثر', c.impact_fa));
    body.push(field('بازگشت', c.rollback_fa));
    body.push(field('معیار موفقیت', c.successCriteria_fa));
    if (needsTyped) {
      body.push(el('div', { class: 'l3-box' },
        el('label', { for: 'typedInput' }, 'برای تأیید، نام دقیق اپ را تایپ کنید: ', el('code', { text: S.state?.app?.name || 'نام اپ' })),
        el('input', {
          id: 'typedInput', dir: 'ltr', autocomplete: 'off', spellcheck: 'false', placeholder: 'نام اپ', value: typedPrev,
          oninput: (e) => {
            S.typed[a.id] = e.target.value;
            const b = $('#approveBtn');
            if (b) b.disabled = !e.target.value.trim();
          },
        }),
        el('p', { class: 'muted', text: 'سرور نام را بررسی می‌کند؛ نام نادرست اجرا را متوقف می‌کند.' })));
    }
    const techRows = [['ابزار', a.tool], ['شناسه', a.id], ['حالت', (a.mode || S.mode) === 'live' ? 'زنده' : 'شبیه‌سازی محلی'], ['اثر انگشت', (a.paramsHash || '').slice(0, 16)]];
    Object.entries(a.params || {}).forEach(([k, v]) => techRows.push([k, typeof v === 'string' ? v : JSON.stringify(v)]));
    body.push(el('details', { class: 'tech' }, el('summary', { text: 'جزئیات فنی' }),
      el('div', { class: 'kv' }, techRows.flatMap(([k, v]) => [el('code', { text: String(k) }), el('code', { text: String(v ?? '—') })]))));
    const res = S.resultByApproval.get(a.id);
    if (res) body.push(el('div', { class: 'stack' }, el('strong', { text: 'نتیجه‌ی اجرا' }), resultCard(res)));
    $('#sheetBody').replaceChildren(...body.filter(Boolean));

    const foot = [];
    if (ph === 'pending') {
      const disabled = needsTyped && !typedPrev.trim();
      foot.push(el('button', { type: 'button', id: 'approveBtn', class: 'btn primary big', disabled, onclick: () => approve(a.id), text: '✔ تأیید و اجرا' }));
      foot.push(el('button', { type: 'button', class: 'btn danger big', onclick: () => reject(a.id), text: '✖ رد' }));
    } else if (ph === 'cancelwin') {
      foot.push(el('div', { class: 'cancel-row' },
        el('span', {}, 'اجرا تا ', el('span', { class: 'clock', 'data-until': a.executableAfter, 'data-done': 'در حال اجرا' }), ' دیگر'),
        el('button', { type: 'button', class: 'btn danger big', onclick: () => cancel(a.id), text: 'لغو' })));
    } else {
      foot.push(el('button', { type: 'button', class: 'btn ghost big', onclick: closeSheet, text: 'بستن' }));
    }
    $('#sheetFoot').replaceChildren(...foot);
    tick();
  }
  async function approve(id) {
    const a = S.approvals.get(id);
    if (!a) return;
    const isL3 = a.riskLevel === 'L3';
    const body = isL3 ? { typed: (S.typed[id] || '').trim() } : {};
    const btn = $('#approveBtn');
    if (btn) btn.disabled = true;
    try {
      const r = await api(`/api/approvals/${encodeURIComponent(id)}/approve`, { method: 'POST', body });
      const next = { ...(r?.approval || { ...a, status: 'approved' }) };
      if (isL3 && !next.executableAfter) next.executableAfter = new Date(Date.now() + 10000).toISOString();
      upsertApproval(next);
      delete S.typed[id];
      toast({ kind: 'ok', title: 'تأیید ثبت شد', lines: [['وضعیت', isL3 ? 'اجرا ۱۰ ثانیه دیگر آغاز می‌شود؛ تا آن زمان می‌توانید لغو کنید.' : 'اجرا شروع شد؛ نتیجه را در گفتگو و تب وضعیت می‌بینید.']] });
      renderTray();
      if (isL3) renderSheet();
      else closeSheet();
    } catch (e) {
      if (e.status === 401) return;
      toastError(e, 'تأیید کارت');
      if (['APPROVAL_EXPIRED', 'UNKNOWN_APPROVAL', 'TOKEN_EXPIRED'].includes(e.code)) refetchState();
      renderSheet();
      if (e.code === 'WRONG_CONFIRMATION') $('#typedInput')?.focus();
    }
  }
  async function reject(id) {
    try {
      const r = await api(`/api/approvals/${encodeURIComponent(id)}/reject`, { method: 'POST', body: {} });
      upsertApproval(r?.approval || { ...S.approvals.get(id), status: 'rejected' });
      toast({ kind: 'ok', title: 'کارت رد شد', lines: [['نتیجه', 'هیچ تغییری اعمال نشد.']] });
      closeSheet();
      renderTray();
    } catch (e) {
      if (e.status !== 401) toastError(e, 'رد کارت');
    }
  }
  async function cancel(id) {
    try {
      const r = await api(`/api/approvals/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
      upsertApproval(r?.approval || { ...S.approvals.get(id), status: 'cancelled' });
      toast({ kind: 'ok', title: 'اجرا لغو شد', lines: [['نتیجه', 'هیچ تغییری روی اپ اعمال نشد.']] });
      closeSheet();
      renderTray();
    } catch (e) {
      if (e.status !== 401) toastError(e, 'لغو اجرا');
      renderSheet();
    }
  }
  function onApprovalEvent(a) {
    const isNew = !S.approvals.has(a.id);
    upsertApproval(a);
    renderTray();
    if (S.openApprovalId === a.id) renderSheet();
    if (isNew && a.status === 'pending' && !S.openApprovalId) openApproval(a.id);
  }
  function approvalMini(a) {
    return el('div', { class: 'approval-mini' },
      el('div', { class: 'row between wrap' }, el('strong', { text: a.card?.title_fa || TOOL_FA[a.tool] || a.tool }), riskBadge(a.riskLevel), modeChip(a.mode)),
      el('p', { class: 'muted', text: 'این اقدام نیاز به تأیید شما دارد. تا پیش از تأیید هیچ تغییری اعمال نمی‌شود.' }),
      el('button', { type: 'button', class: 'btn primary small', onclick: () => openApproval(a.id), text: 'بررسی و تأیید' }));
  }

  /* ---------- incident ---------- */
  function findEvidence(id) {
    return (S.incident?.evidence || []).find((e) => e.id === id) || null;
  }
  function jumpToEvidence(id) {
    closeSheet();
    setTab('incident');
    requestAnimationFrame(() => {
      const target = $$('[data-ev]').find((n) => n.dataset.ev === id);
      if (!target) {
        toast({ kind: 'error', title: 'شاهد در تحلیل فعلی نیست', lines: [['چه شد؟', 'این شاهد در پنجره‌ی تحلیل فعلی نمایش داده نمی‌شود.'], ['چه کنم؟', 'از گفتگو تحلیل تازه بخواهید.']] });
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1800);
    });
  }
  function evList(label, ids) {
    return el('div', {}, el('div', { class: 'field-k', text: label }), el('div', { class: 'evidence-list' }, ids.map((id) => evChip(id))));
  }
  function hypCard(h, i) {
    const s = Number(h.score);
    const pct = clamp(isNum(s) ? (s <= 1 ? s * 100 : s) : (h.confidence === 'high' ? 90 : h.confidence === 'medium' ? 60 : 30), 0, 100);
    return el('article', { class: 'card hyp' },
      el('div', { class: 'row between wrap' },
        el('span', { class: 'muted', text: `فرضیه ${fmtInt(i + 1)}` }),
        chip(h.confidence === 'high' ? 'ok' : h.confidence === 'medium' ? 'warn' : 'plain', `اطمینان: ${CONF_FA[h.confidence] || 'نامشخص'}`)),
      el('div', { class: 'hyp-title', text: h.title_fa }),
      el('div', { class: 'bar-label' }, el('span', { text: 'درصد اطمینان' }), el('span', { text: `${fmtInt(Math.round(pct))}٪` })),
      el('div', { class: 'bar', role: 'progressbar', 'aria-label': 'درصد اطمینان', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) },
        el('span', { style: `width:${pct}%` })),
      rich(h.explain_fa),
      h.evidence_for?.length ? evList('شواهد موافق', h.evidence_for) : null,
      h.evidence_against?.length ? evList('شواهد مخالف', h.evidence_against) : null,
      h.missingEvidence?.length ? notice('warn', 'شواهد ناقص: ', h.missingEvidence.join('، '), ' — این موارد سالم فرض نشده‌اند و اطمینان محدود شده است.') : null,
      h.remediations?.length ? el('div', { class: 'stack' }, el('strong', { text: 'راهکارها' }),
        el('div', { class: 'rem-list' }, h.remediations.map((r) => remButton(r)))) : null);
  }
  function remButton(r) {
    const coding = r.action === 'coding_agent_handoff';
    return el('button', { type: 'button', class: 'btn outline', onclick: () => runRemediation(r) },
      r.label_fa || r.action, coding ? null : ' ', coding ? null : (r.riskLevel ? riskBadge(r.riskLevel) : null));
  }
  async function runRemediation(r) {
    if (r.action === 'coding_agent_handoff') { $('#briefCard')?.scrollIntoView({ behavior: 'smooth' }); return; }
    try {
      const res = await api(`/api/tools/${encodeURIComponent(r.action)}`, { method: 'POST', body: { args: r.params || {}, source: 'ui' } });
      if (res && res.status === 'approval_required') {
        const ap = await api(`/api/approvals/${encodeURIComponent(res.approvalId)}`);
        upsertApproval(ap);
        renderTray();
        openApproval(ap.id);
      } else {
        toast({ kind: 'ok', title: 'اقدام اجرا شد', lines: [['اقدام', r.label_fa || r.action], ['حالت', S.mode === 'simulated' ? 'شبیه‌سازی محلی' : 'زنده']] });
        refetchState();
      }
    } catch (e) {
      if (e.status !== 401) toastError(e, 'اجرای راهکار');
    }
  }
  function renderIncident() {
    const box = $('#incidentBody');
    box.replaceChildren();
    const inc = S.incident;
    $('#incidentDot').hidden = !(inc && inc.status !== 'resolved');
    if (!inc) {
      box.append(el('div', { class: 'empty', text: 'هنوز حادثه‌ای ثبت نشده است. از گفتگو بپرسید «چرا کنده؟» یا یکی از سناریوهای دمو را اجرا کنید.' }));
    } else {
      const kind = { resolved: 'ok', unresolved: 'bad', remediating: 'info', awaiting_approval: 'warn' }[inc.status] || 'plain';
      box.append(el('section', { class: 'card' },
        el('div', { class: 'row between wrap' }, el('h3', { text: 'خلاصه' }), chip(kind, INC_STATUS_FA[inc.status] || 'نامشخص')),
        rich(inc.symptom || '—'),
        el('p', { class: 'muted', text: `پنجره‌ی بررسی: ${fmtDate(inc.window?.start)} تا ${fmtDate(inc.window?.end)}${inc.app ? ` · اپ: ${inc.app}` : ''}` })));

      if (inc.verification) {
        const v = inc.verification;
        box.append(el('section', { class: 'card' },
          el('h3', { text: 'نتیجه‌ی راستی‌آزمایی' }),
          el('p', {}, `وضعیت: ${v.verdict === 'resolved' ? 'حل شد' : v.verdict === 'partial' ? 'بخشی حل شد' : v.verdict === 'worse' ? 'بدتر شد' : v.verdict || '—'}`),
          el('p', { class: 'muted', dir: 'ltr', text: `خطای پیش از اقدام: ${fmtInt(v.before?.errorsPerMinute ?? '—')} در دقیقه · بعد: ${fmtInt(v.after?.errorsPerMinute ?? '—')} در دقیقه` })));
      }

      const hyps = [...(inc.hypotheses || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
      if (!hyps.length) box.append(notice('info', 'هنوز فرضیه‌ای با شواهد کافی ساخته نشده است.'));
      hyps.forEach((h, i) => box.append(hypCard(h, i)));

      if (inc.missingEvidence?.length) box.append(notice('warn', 'منابع ناموفق یا غایب: ', inc.missingEvidence.join('، '), ' — این موارد «سالم» تلقی نشده‌اند.'));
      if (inc.flags?.length) {
        box.append(el('section', { class: 'card' }, el('h3', { text: 'داده‌ی مشکوک' }),
          el('p', { class: 'muted', text: 'این متن شبیه دستور بود. سُکان آن را داده فرض کرده و هیچ اقدامی بر اساس آن انجام نداده است.' }),
          el('div', { class: 'stack' }, inc.flags.map((f) => el('code', { dir: 'ltr', text: `${f.evidenceId}: ${f.excerpt}` })))));
      }

      const ev = inc.evidence || [];
      box.append(el('section', { class: 'card' }, el('h3', { text: 'شواهد' }),
        ev.length
          ? el('div', { class: 'stack' }, ev.map((e) => el('div', { class: 'ev-item', 'data-ev': e.id },
            el('div', { text: e.summary }),
            el('small', { text: `${EV_TYPE_FA[e.type] || e.type} · ${fmtTime(e.ts)}` }))))
          : el('p', { class: 'muted', text: 'هنوز شاهدی جمع نشده است.' })));

      if (inc.rejected?.length) {
        box.append(el('section', { class: 'card' }, el('h3', { text: 'فرضیه‌های رد شده' }),
          el('div', { class: 'stack' }, inc.rejected.map((r) => el('div', {}, el('strong', { text: r.title_fa }), ' — ', r.reason_fa)))));
      }
    }

    const fb = S.state?.fixBrief || null;
    box.append(el('section', { class: 'card', id: 'briefCard' },
      el('h3', { text: 'Fix Brief برای Coding Agent' }),
      fb?.summary_fa ? rich(fb.summary_fa) : el('p', { class: 'muted', text: 'Fix Brief هنوز آماده نیست؛ پس از تحلیل حادثه ساخته می‌شود.' }),
      el('div', { class: 'row wrap gap', style: 'margin-top:10px' },
        el('button', { type: 'button', class: 'btn primary small', onclick: copyBrief, text: 'کپی Markdown' }),
        el('span', { class: 'muted', id: 'briefStatus' })),
      el('p', { class: 'muted', style: 'margin-top:10px', text: 'Claude Code این گزارش را از طریق سرور MCP سُکان می‌خواند؛ در Claude Code از ابزار Fix Brief سُکان استفاده کنید.' }),
      el('details', { ontoggle: (e) => { if (e.target.open) loadBriefPreview(); } },
        el('summary', { text: 'پیش‌نمایش Markdown' }),
        el('pre', { class: 'brief-pre', id: 'briefPre', dir: 'ltr' }))));
  }
  async function fetchBrief() {
    return api('/api/incidents/current/fix-brief.md', { raw: true });
  }
  async function loadBriefPreview() {
    const pre = $('#briefPre');
    if (!pre || pre.textContent) return;
    try { pre.textContent = await fetchBrief(); } catch (e) { if (e.status !== 401) pre.textContent = 'پیش‌نمایش در دسترس نیست.'; }
  }
  async function copyBrief() {
    const status = $('#briefStatus');
    try {
      const md = await fetchBrief();
      const pre = $('#briefPre');
      if (pre) pre.textContent = md;
      let copied = false;
      try { await navigator.clipboard.writeText(md); copied = true; } catch (_) { copied = false; }
      if (!copied) {
        const ta = el('textarea', { 'aria-hidden': 'true' });
        ta.value = md;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
        ta.remove();
      }
      if (status) status.textContent = copied ? 'کپی شد' : 'کپی خودکار نشد؛ متن را از پیش‌نمایش کپی کنید';
      if (copied) toast({ kind: 'ok', title: 'Fix Brief کپی شد', lines: [['راهنما', 'در Claude Code از ابزار Fix Brief سُکان استفاده کنید.']] });
    } catch (e) {
      if (e.status === 401) return;
      if (e.status === 404) toast({ kind: 'error', title: 'Fix Brief آماده نیست', lines: [['چه شد؟', 'هنوز حادثه‌ای برای ساخت Fix Brief وجود ندارد.'], ['چه کنم؟', 'یک تحلیل حادثه اجرا کنید.']] });
      else toastError(e, 'دریافت Fix Brief');
    }
  }

  /* ---------- limits ---------- */
  function renderLimits() {
    const box = $('#limitsBody');
    box.replaceChildren();
    const list = S.state?.limits || [];
    if (!list.length) { box.append(el('div', { class: 'empty', text: 'فهرست محدودیت‌ها هنوز از سرور دریافت نشده است.' })); return; }
    list.forEach((l) => box.append(el('article', { class: 'card limit' },
      el('h3', { text: l.what_fa || l.id }),
      el('div', { class: 'lbl', text: 'چرا؟' }), rich(l.why_fa),
      el('div', { class: 'lbl', text: 'راه‌حل سُکان' }), rich(l.workaround_fa))));
  }

  /* ---------- demo ---------- */
  function renderDemo() {
    const box = $('#demoBody');
    box.replaceChildren();
    SCENARIOS.filter((s) => s.id !== 'scenario-reset').forEach((s) => box.append(el('div', { class: 'demo-item' },
      el('strong', { text: s.title }),
      el('p', { text: s.desc }),
      el('button', { type: 'button', class: 'btn outline small', onclick: (e) => runScenario(s, e.currentTarget), text: 'اجرای سناریو' }))));
    box.append(el('div', { class: 'demo-item reset' },
      el('strong', { text: 'بازنشانی نمایش' }),
      el('p', { text: 'وضعیت دمو را به حالت اولیه برمی‌گرداند. اپ واقعی لیارا تغییری نمی‌کند.' }),
      el('button', { type: 'button', class: 'btn ghost small', onclick: (e) => runScenario(SCENARIOS.find((x) => x.id === 'scenario-reset'), e.currentTarget), text: 'بازنشانی' })));
  }
  async function runScenario(s, btn) {
    if (!s) return;
    if (btn) btn.disabled = true;
    try {
      await api(`/api/demo/${encodeURIComponent(s.id)}`, { method: 'POST', body: {} });
      toast({ kind: 'ok', title: 'سناریو اجرا شد', lines: [['سناریو', s.title], ['کجا ببینم؟', 'نتیجه در گفتگو، تب وضعیت و تب حادثه نمایش داده می‌شود.']] });
      refetchState();
    } catch (e) {
      if (e.status !== 401) toastError(e, 'اجرای سناریو');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------- logs ---------- */
  function logRow(d) {
    return el('div', { class: 'log-row' },
      el('span', { class: 'ts', text: fmtTime(d.ts) }),
      el('span', { class: `stream ${d.stream || 'system'}`, text: d.stream || 'system' }),
      el('span', { class: 'line', text: d.line }));
  }
  function renderLogs() {
    const box = $('#logBox');
    box.replaceChildren(...S.logs.map(logRow));
    if ($('#autoScroll').checked) box.scrollTop = box.scrollHeight;
  }
  function appendLog(d) {
    S.logs.push(d);
    if (S.logs.length > 300) S.logs.shift();
    const box = $('#logBox');
    box.append(logRow(d));
    while (box.childElementCount > 400) box.firstElementChild.remove();
    if ($('#autoScroll').checked) box.scrollTop = box.scrollHeight;
  }

  /* ---------- audit ---------- */
  function renderAudit() {
    const box = $('#auditBody');
    box.replaceChildren();
    const list = (S.state?.audit || []).slice(-50).reverse();
    if (!list.length) { box.append(el('div', { class: 'empty', text: 'هنوز رویدادی در دفتر ممیزی ثبت نشده است.' })); return; }
    list.forEach((e) => box.append(el('div', { class: 'audit-row' },
      el('div', { class: 'row between wrap' }, el('strong', { text: e.tool ? (TOOL_FA[e.tool] || e.tool) : (e.action || 'رویداد') }), modeChip(e.mode)),
      el('div', { class: 'muted', text: `#${fmtInt(e.seq ?? '—')} · ${fmtDate(e.timestamp)}` }),
      typeof e.decision === 'string' || typeof e.outcome === 'string' ? el('div', { text: e.decision || e.outcome }) : null,
      isNum(e.durationMs) ? el('div', { class: 'muted', text: `مدت: ${fmtInt(e.durationMs)} میلی‌ثانیه` }) : null)));
  }
  async function verifyAudit() {
    const out = $('#verifyResult');
    out.replaceChildren(chip('plain', 'در حال بررسی…'));
    try {
      const r = await api('/api/audit/verify');
      out.replaceChildren(r && r.ok
        ? notice('ok', 'زنجیره‌ی ممیزی سالم است؛ هیچ رکوردی دستکاری نشده است.')
        : notice('bad', `زنجیره‌ی ممیزی از رکورد ${fmtInt(r?.brokenAt ?? '—')} شکسته است. این رکورد و رکوردهای بعدی را بررسی کنید.`));
    } catch (e) {
      out.replaceChildren();
      if (e.status !== 401) toastError(e, 'بررسی یکپارچگی');
    }
  }

  /* ---------- chat ---------- */
  const SUGGEST = ['می‌خوام سایتم رو آنلاین کنم', 'چقدر پول می‌دم ماهانه؟', 'چرا کنده؟', 'ریستارت کن', 'برگرد به قبلی'];

  function addMsg(role, nodes) {
    const m = el('div', { class: `msg ${role}` }, nodes);
    const th = $('#thread');
    th.append(m);
    th.scrollTop = th.scrollHeight;
    return m;
  }
  function planCard(p) {
    const ram = Number(p.ramMB);
    const ramText = isNum(ram) ? (ram >= 1024 ? `${fmtNum(ram / 1024)} گیگابایت` : `${fmtInt(ram)} مگابایت`) : '—';
    const est = p.priceSource === 'estimate';
    const card = el('article', { class: `plan${p.recommended ? ' rec' : ''}` },
      el('div', { class: 'plan-title' },
        el('h4', { text: p.label_fa || TIER_FA[p.tier] || String(p.tier) }),
        p.recommended ? el('span', { title: 'پیشنهادی', 'aria-label': 'پیشنهادی', text: '⭐' }) : null),
      el('div', { class: 'price' }, fmtInt(Number(p.monthlyPriceTomans)), ' ', el('small', { text: 'تومان در ماه' })),
      el('div', { class: 'row wrap gap' }, chip(est ? 'warn' : 'ok', est ? 'تخمینی' : 'قیمت لیارا')),
      el('dl', {},
        el('dt', { text: 'حافظه' }), el('dd', { text: ramText }),
        el('dt', { text: 'پردازنده' }), el('dd', { text: isNum(Number(p.cpu)) ? `${fmtNum(Number(p.cpu))} هسته` : '—' }),
        el('dt', { text: 'مناسب برای' }), el('dd', { text: p.fits_fa || '—' }),
        el('dt', { text: 'ریسک' }), el('dd', { text: p.risk_fa || '—' })),
      el('button', { type: 'button', class: `btn ${p.recommended ? 'primary' : 'outline'}`, onclick: () => selectPlan(p, card), text: 'انتخاب این پلن' }));
    return card;
  }
  async function selectPlan(p, card) {
    const btns = $$('button', card);
    btns.forEach((b) => { b.disabled = true; });
    const label = p.label_fa || TIER_FA[p.tier] || '';
    addMsg('user', [el('div', { class: 'bubble', text: `پلن «${label}» را انتخاب کردم` })]);
    try {
      const r = await api('/api/plans/select', { method: 'POST', body: { planID: p.planID } });
      S.history.push({ role: 'user', content: `پلن ${label} را انتخاب کردم` }, { role: 'assistant', content: r.reply_fa || '' });
      const parts = [el('div', { class: 'bubble' }, richNodes(r.reply_fa || ''))];
      (r.approvals || []).forEach((a) => { upsertApproval(a); parts.push(approvalMini(a)); });
      addMsg('bot', parts);
      renderTray();
      const first = (r.approvals || []).find((a) => S.approvals.get(a.id)?.status === 'pending');
      if (first && !S.openApprovalId) openApproval(first.id);
    } catch (e) {
      if (e.status === 401) return;
      toastError(e, 'انتخاب پلن');
      btns.forEach((b) => { b.disabled = false; });
    }
  }
  function renderBotReply(r) {
    const parts = [];
    parts.push(el('div', { class: 'bubble' }, richNodes(r.reply_fa || '')));
    parts.push(el('div', { class: 'meta' }, modeChip(r.mode), chip('plain', r.source === 'llm' ? 'پاسخ با LLM' : 'پاسخ مسیریاب آفلاین')));
    if (r.clarify?.options?.length) {
      parts.push(el('div', { class: 'clarify' },
        r.clarify.clarify_fa ? el('p', { text: r.clarify.clarify_fa }) : null,
        el('div', { class: 'row wrap' }, r.clarify.options.map((o) => el('button', { type: 'button', class: 'btn outline small', onclick: () => sendChat(o.message), text: o.label_fa })))));
    }
    if (r.plans?.length) parts.push(el('div', { class: 'plans' }, r.plans.map(planCard)));
    (r.approvals || []).forEach((a) => { upsertApproval(a); parts.push(approvalMini(a)); });
    if (/متغیر/.test(r.reply_fa || '')) parts.push(el('button', { type: 'button', class: 'btn outline small', onclick: openEnvForm, text: 'تنظیم متغیرها' }));
    addMsg('bot', parts);
    if (r.incident) { S.incident = r.incident; renderIncident(); refetchState(); }
    renderTray();
    const first = (r.approvals || []).find((a) => S.approvals.get(a.id)?.status === 'pending');
    if (first && !S.openApprovalId) openApproval(first.id);
  }
  async function sendChat(raw) {
    const text = String(raw ?? '').trim();
    if (!text || S.busy) return;
    S.busy = true;
    $('#sendBtn').disabled = true;
    const history = S.history.slice(-10);
    S.history.push({ role: 'user', content: text });
    addMsg('user', [el('div', { class: 'bubble', text })]);
    const wait = addMsg('bot', [el('div', { class: 'bubble msg-muted', text: 'سُکان در حال بررسی است…' })]);
    try {
      const r = await api('/api/chat', { method: 'POST', body: { message: text, history } });
      wait.remove();
      S.history.push({ role: 'assistant', content: r.reply_fa || '' });
      S.history = S.history.slice(-20);
      renderBotReply(r);
    } catch (e) {
      wait.remove();
      if (e.status !== 401) toastError(e, 'ارسال پیام');
    } finally {
      S.busy = false;
      $('#sendBtn').disabled = false;
    }
  }
  function renderSuggest() {
    $('#suggest').replaceChildren(...SUGGEST.map((t) => el('button', { type: 'button', class: 'btn outline', onclick: () => sendChat(t), text: t })));
  }

  /* ---------- env form ---------- */
  function addEnvRow() {
    const row = el('div', { class: 'env-row' },
      el('input', { class: 'env-key', dir: 'ltr', placeholder: 'NAME', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'نام متغیر' }),
      el('input', { class: 'env-val', type: 'password', dir: 'ltr', placeholder: 'مقدار (مخفی)', autocomplete: 'new-password', 'aria-label': 'مقدار متغیر' }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'حذف این ردیف', text: '✕', onclick: () => row.remove() }));
    $('#envRows').append(row);
    return row;
  }
  function openEnvForm() {
    $('#envRows').replaceChildren();
    addEnvRow();
    addEnvRow();
    $('#envOverlay').hidden = false;
    document.body.classList.add('lock');
    requestAnimationFrame(() => $('#envRows .env-key')?.focus());
  }
  function closeEnvForm() {
    $('#envOverlay').hidden = true;
    $('#envRows').replaceChildren();
    if (!S.openApprovalId) document.body.classList.remove('lock');
  }
  async function saveEnvs() {
    const vars = $$('#envRows .env-row').map((r) => ({
      key: r.querySelector('.env-key').value.trim(),
      value: r.querySelector('.env-val').value,
    })).filter((v) => v.key || v.value);
    if (!vars.length) {
      toast({ kind: 'error', title: 'متغیری وارد نشده', lines: [['چه شد؟', 'هیچ نام یا مقداری پیدا نشد.'], ['چرا؟', 'فرم خالی است.'], ['چه کنم؟', 'نام و مقدار متغیر را وارد کنید.']] });
      return;
    }
    const bad = vars.find((v) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.key) || v.value === '');
    if (bad) {
      toast({ kind: 'error', title: 'ورودی ناقص است', lines: [['چه شد؟', 'یکی از ردیف‌ها کامل نیست.'], ['چرا؟', 'نام متغیر باید فقط حروف انگلیسی، عدد و _ باشد و مقدار نباید خالی باشد.'], ['چه کنم؟', 'ردیف را اصلاح کنید.']] });
      return;
    }
    $('#envSave').disabled = true;
    try {
      const r = await api('/api/envs', { method: 'POST', body: { variables: vars } });
      const keys = Array.isArray(r?.keys) ? r.keys : vars.map((v) => v.key);
      closeEnvForm();
      toast({ kind: 'ok', title: 'متغیرها ذخیره شد', lines: [['کلیدها', keys.join('، ')], ['نکته', 'مقدارها دیگر نمایش داده نمی‌شوند.']] });
    } catch (e) {
      if (e.status !== 401) toastError(e, 'ذخیره‌ی متغیرها');
    } finally {
      $('#envSave').disabled = false;
    }
  }

  /* ---------- gate, state, SSE ---------- */
  function showGate() {
    if (S.es) { S.es.close(); S.es = null; }
    $('#gate').hidden = false;
    $('#app').hidden = true;
  }
  function showApp() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
  }
  function renderAll() {
    renderChips();
    renderBanner();
    renderAppInfo();
    renderTray();
    renderSteps();
    renderResults();
    renderSpark();
    renderIncident();
    renderLimits();
    renderAudit();
  }
  async function refetchState() {
    try {
      const st = await api('/api/state');
      S.state = st;
      S.mode = st.mode || 'simulated';
      S.incident = st.incident || null;
      if (!S.logsLoaded && Array.isArray(st.logs)) {
        S.logs = st.logs.slice(-300);
        S.logsLoaded = true;
        renderLogs();
      }
      if (Array.isArray(st.probes)) S.probes = st.probes.slice(-50);
      (st.approvals || []).forEach(upsertApproval);
      if (!Object.keys(S.steps).length && st.pipeline?.steps?.length) {
        S.steps = Object.fromEntries(st.pipeline.steps.map((s) => [s.id, s.status]));
      }
      showApp();
      renderAll();
      renderBuildLog();
      if (S.openApprovalId) renderSheet();
    } catch (e) {
      if (e.status === 401) return;
      showApp();
      toastError(e, 'بارگذاری وضعیت');
    }
  }
  function connectSSE() {
    if (!('EventSource' in window)) return;
    const es = new EventSource('/api/events');
    S.es = es;
    const on = (name, fn) => es.addEventListener(name, (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (_) { return; }
      fn(d);
    });
    on('log', appendLog);
    on('probe', (d) => { S.probes.push(d); if (S.probes.length > 50) S.probes.shift(); renderSpark(); });
    on('incident', (d) => { S.incident = d; renderIncident(); });
    on('approval', onApprovalEvent);
    on('action_result', onActionResult);
    on('deploy_progress', onDeployProgress);
    on('state', () => refetchState());
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) refetchState();
    };
  }
  function tick() {
    const now = Date.now();
    $$('[data-until]').forEach((n) => {
      const t = Date.parse(n.dataset.until);
      if (isNaN(t)) return;
      const left = Math.ceil((t - now) / 1000);
      n.textContent = left > 0 ? clockText(left) : (n.dataset.done || clockText(0));
    });
    let dirty = false;
    for (const a of S.approvals.values()) {
      const ph = phaseOf(a, now);
      if (ph !== a._phase) { a._phase = ph; dirty = true; }
    }
    if (dirty) { renderTray(); renderSheet(); }
  }

  /* ---------- tabs ---------- */
  const TAB_NAMES = ['chat', 'status', 'incident', 'limits', 'demo', 'logs', 'audit'];
  function setTab(name) {
    if (!TAB_NAMES.includes(name)) name = 'chat';
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    if (name === 'logs') renderLogs();
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  }

  /* ---------- init ---------- */
  function init() {
    $('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) setTab(b.dataset.tab);
    });
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      if (S.busy) return;
      const input = $('#msgInput');
      const v = input.value;
      input.value = '';
      sendChat(v);
    });
    $('#msgInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $('#composer').requestSubmit();
      }
    });
    $('#btnEnvs').addEventListener('click', openEnvForm);
    $('#envAdd').addEventListener('click', addEnvRow);
    $('#envSave').addEventListener('click', saveEnvs);
    $('#envCancel').addEventListener('click', closeEnvForm);
    $('#envClose').addEventListener('click', closeEnvForm);
    $('#envOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeEnvForm(); });
    $('#approvalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSheet(); });
    $('#btnVerify').addEventListener('click', verifyAudit);
    $('#trayPill').addEventListener('click', () => $('#trayCard').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (S.openApprovalId) closeSheet();
      else if (!$('#envOverlay').hidden) closeEnvForm();
    });
    renderSuggest();
    renderDemo();
    setTab((location.hash || '#chat').slice(1));
    setInterval(tick, 1000);
    refetchState().then(() => {
      if ($('#gate').hidden) connectSSE();
    });
  }

  init();
})();
