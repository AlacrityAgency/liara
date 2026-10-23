/* سُکان — صفحه‌ی ساده: وصل شدن، انتخاب پلن، انتشار و نگهداری سایت.
 * همه‌ی متن‌های سرور با textContent نمایش داده می‌شوند (بدون innerHTML). */
(function () {
  'use strict';

  var HEADERS = { 'Content-Type': 'application/json', 'X-Sokan-CSRF': '1' };
  var STEP_LABELS = ['اتصال', 'پروژه', 'پلن', 'انتشار'];
  var TITLES = {
    deploy: 'در حال بالا آوردن سایتت…',
    redeploy: 'در حال انتشار نسخه‌ی جدید…',
    fix: 'در حال درست کردن…',
    domain: 'در حال وصل کردن دامنه…',
    zone: 'در حال ساختن منطقه‌ی DNS…',
  };
  // Phases under the progress bar: [server step, Persian name]. Server steps not listed here are ignored.
  var DEPLOY_PHASES = [
    ['create', 'ساخت اپ'], ['envs', 'تنظیم متغیرها'], ['pack', 'بسته‌بندی'], ['upload', 'آپلود'],
    ['build', 'ساخت (build)'], ['start', 'راه‌اندازی'], ['check', 'بررسی سلامت'],
  ];
  var PHASES = {
    deploy: DEPLOY_PHASES,
    redeploy: DEPLOY_PHASES,
    fix: [['fix', 'اعمال تغییر'], ['verify', 'بررسی نتیجه']],
    domain: [['domain', 'ثبت رکورد DNS'], ['fix', 'گواهی امن (SSL)']],
    zone: [['domain', 'ساخت منطقه‌ی DNS']],
  };
  var SITE_POLL_MS = 15000;
  var LIVE_THROTTLE_MS = 8000;

  var stage = document.getElementById('stage');
  var stepper = document.getElementById('stepper');
  var simBanner = document.getElementById('simBanner');
  var auditBanner = document.getElementById('auditBanner');
  var footer = document.getElementById('footer');
  var dlg = document.getElementById('confirmDlg');
  var nf = new Intl.NumberFormat('fa-IR');
  var dtf = null;
  try { dtf = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { dtf = null; }

  // Incident status labels from the diagnostics contract (IncidentStatus).
  var INCIDENT_FA = {
    investigating: 'در حال بررسی',
    diagnosed: 'تشخیص داده شد',
    awaiting_approval: 'منتظر تأیید',
    remediating: 'در حال رفع',
    resolved: 'حل شد',
    mitigated: 'موقتاً مهار شد',
    unresolved: 'حل نشد',
  };

  var state = {
    session: null,
    project: null,
    plans: null,
    planID: null,
    job: null,        // { id, kind, ui }
    pendingJob: false,
    early: [],        // SSE events that arrive before the job id is known
    es: null,
    domainName: '',   // last domain typed, so the domain screen can resume after the zone is built
    siteUi: null,     // live references into the site card, updated in place (no re-render)
    sitePoll: null,
    liveTimer: null,
    lastLive: 0,
  };

  /* ---------- small helpers ---------- */

  function fa(n) { return nf.format(Number(n) || 0); }

  function pad2(n) { return nf.format(n).padStart(2, '۰'); }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function pctOf(v) {
    var n = Number(v) || 0;
    return Math.round(n <= 1 ? n * 100 : n);
  }

  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return dtf ? dtf.format(d) : d.toLocaleString();
    } catch (_) { return String(iso); }
  }

  function parse(s) {
    try { return JSON.parse(s); } catch (_) { return null; }
  }

  // h(tag, props, ...children): DOM builder. Strings become text nodes.
  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') node.textContent = String(v);
        else if (k === 'class') node.className = String(v);
        else if (k === 'value' || k === 'checked') node[k] = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) appendKids(node, arguments[i]);
    return node;
  }

  function appendKids(node, kid) {
    if (Array.isArray(kid)) { kid.forEach(function (k) { appendKids(node, k); }); return; }
    if (kid === null || kid === undefined || kid === false) return;
    node.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }

  function card() {
    var kids = Array.prototype.slice.call(arguments);
    return h.apply(null, ['section', { class: 'card' }].concat(kids));
  }

  function setView(node) {
    stopSitePolling();
    state.siteUi = null;
    stage.replaceChildren(node);
    window.scrollTo(0, 0);
    var t = stage.querySelector('h2');
    if (t) {
      t.setAttribute('tabindex', '-1');
      try { t.focus({ preventScroll: true }); } catch (_) { /* older browsers */ }
    }
  }

  function notice(kind, what, why, next) {
    return h('div', { class: 'notice ' + kind, role: kind === 'err' ? 'alert' : 'status' },
      what ? h('p', { class: 'n-what', text: what }) : null,
      why ? h('p', { class: 'n-why', text: why }) : null,
      next ? h('p', { class: 'n-next', text: next }) : null);
  }

  function working(text) {
    return h('div', { class: 'working', role: 'status' },
      h('span', { class: 'spin', 'aria-hidden': 'true' }),
      h('p', { text: text }));
  }

  function errorOf(e) {
    var er = (e && e.error) || {};
    return {
      what: er.what_fa || 'این کار انجام نشد.',
      why: er.why_fa || '',
      next: er.next_fa || 'چند لحظه صبر کن و دوباره امتحان کن.',
    };
  }

  function errNotice(e) {
    var x = errorOf(e);
    return notice('err', x.what, x.why, x.next);
  }

  function failInto(box, e) {
    if (e && e.unauthorized) return showGate();
    box.replaceChildren(errNotice(e));
  }

  function retryBtn(fn) {
    return h('button', { type: 'button', class: 'btn ghost', text: 'دوباره امتحان کن', onclick: fn });
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.textContent = label || '…';
    } else {
      btn.disabled = false;
      if (btn.dataset.label) {
        btn.textContent = btn.dataset.label;
        delete btn.dataset.label;
      }
    }
  }

  // Calls the Simple API. Throws {ok:false, error:{...}} or {unauthorized:true} (console session missing).
  async function api(path, method, body) {
    var opts = { method: method || 'GET', credentials: 'same-origin', headers: HEADERS };
    opts.body = JSON.stringify(body === undefined ? {} : body);
    if (opts.method === 'GET') delete opts.body;
    var res;
    try {
      res = await fetch(path, opts);
    } catch (_) {
      throw { ok: false, error: {
        code: 'network',
        what_fa: 'به سُکان وصل نشدم.',
        why_fa: 'ممکن است سرور خاموش شده باشد یا اینترنت قطع باشد.',
        next_fa: 'چند ثانیه صبر کن و دوباره امتحان کن.',
      } };
    }
    var data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    // A 401 with a structured error is a Liara answer (a wrong or expired key), not a missing console session.
    if (res.status === 401 && !(data && data.error && typeof data.error === 'object')) throw { unauthorized: true };
    if (!res.ok || !data || data.ok === false) {
      throw { ok: false, error: (data && data.error && typeof data.error === 'object') ? data.error : {
        code: 'http_' + res.status,
        what_fa: 'این کار انجام نشد.',
        why_fa: 'سرور جواب درستی نداد (کد ' + fa(res.status) + ').',
        next_fa: 'دوباره امتحان کن.',
      } };
    }
    return data;
  }

  function copyBtn(text, label, cls) {
    var original = label || 'کپی';
    var b = h('button', { type: 'button', class: cls || 'btn ghost small', text: original });
    b.addEventListener('click', function () { copyText(text, b, original); });
    return b;
  }

  function copyText(text, btn, original) {
    function done(ok) {
      btn.textContent = ok ? 'کپی شد ✓' : 'کپی نشد؛ دستی کپی کن';
      setTimeout(function () { btn.textContent = original; }, 2000);
    }
    function fallback() {
      var ta = h('textarea', { class: 'ltr', readonly: true });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      done(ok);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function technicalDetails(children) {
    return h('details', { class: 'details' },
      h('summary', { text: 'جزئیات فنی' }),
      children);
  }

  /* ---------- chrome: stepper, banner, footer, gate ---------- */

  // n = 1..4 marks that step active; 5 marks all four done (deploy finished).
  function setStep(n) {
    if (!n) { stepper.hidden = true; return; }
    stepper.hidden = false;
    var items = stepper.querySelectorAll('li');
    items.forEach(function (li, i) {
      li.classList.toggle('done', i < n - 1);
      li.classList.toggle('active', i === n - 1);
      if (i === n - 1) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
  }

  function chrome(s) {
    var live = !!(s && (s.connected || s.mode === 'simulated'));
    simBanner.hidden = !(s && s.mode === 'simulated');
    auditBanner.hidden = !(s && s.auditOk === false);
    footer.hidden = !live;
  }

  function showGate() {
    stopSitePolling();
    if (state.es) { try { state.es.close(); } catch (_) { /* ignore */ } state.es = null; }
    closeDialog();
    simBanner.hidden = true;
    footer.hidden = true;
    setStep(0);
    setView(card(
      h('div', { class: 'gate-icon', 'aria-hidden': 'true', text: '🔒' }),
      h('h2', { text: 'نشست ورود پیدا نشد' }),
      h('p', { class: 'lead', text: 'لینک ورود را از ترمینال باز کن.' }),
      h('p', { class: 'muted small', text: 'سُکان فقط با لینکی باز می‌شود که هنگام اجرا در ترمینال چاپ می‌شود.' })
    ));
  }

  function resetLocal() {
    state.project = null;
    state.plans = null;
    state.planID = null;
    state.job = null;
    state.pendingJob = false;
    state.early = [];
  }

  async function refreshSession() {
    state.session = await api('/api/simple/session');
    chrome(state.session);
  }

  function route() {
    var s = state.session || {};
    chrome(s);
    var live = !!(s.connected || s.mode === 'simulated');
    if (!live) return showConnect();
    if (s.project) state.project = s.project;
    if (s.site && s.site.url) return showSite(null);
    if (!state.project) return showProject();
    return showPlans();
  }

  async function reloadRoute() {
    try { await refreshSession(); } catch (e) { if (e && e.unauthorized) return showGate(); }
    route();
  }

  /* ---------- step 1: connect ---------- */

  function showConnect() {
    setStep(1);
    var input = h('input', {
      id: 'tok', type: 'password', class: 'ltr', autocomplete: 'off', spellcheck: 'false',
      autocapitalize: 'off', placeholder: 'کلید را اینجا بچسبان', 'aria-describedby': 'tokHint',
    });
    var remember = h('input', { id: 'rem', type: 'checkbox', checked: true });
    var box = h('div', { class: 'err-box' });
    var submit = h('button', { type: 'submit', class: 'btn primary', text: 'وصل شو' });
    var tryBtn = h('button', { type: 'button', class: 'link-btn center', text: 'بدون حساب امتحان کن' });

    tryBtn.addEventListener('click', async function () {
      box.replaceChildren();
      busy(tryBtn, true, '…');
      try {
        await api('/api/simple/try', 'POST', {});
        resetLocal();
        await refreshSession();
        route();
      } catch (e) {
        busy(tryBtn, false);
        failInto(box, e);
      }
    });

    var form = h('form', { class: 'stack', novalidate: true },
      h('a', {
        href: 'https://console.liara.ir/API', target: '_blank', rel: 'noopener',
        class: 'inline-link', text: 'کلید API را از اینجا بگیر ↗',
      }),
      h('div', { class: 'field' },
        h('label', { for: 'tok', class: 'label', text: 'کلید API' }),
        input),
      h('p', { id: 'tokHint', class: 'hint' },
        h('strong', { text: 'کلید API چیست؟' }),
        ' کلیدی مثل رمز ورود برای برنامه‌ها. با آن سُکان فقط از طرف تو سایتت را منتشر می‌کند.'),
      h('label', { class: 'check' }, remember, h('span', { text: 'یادم بماند' })),
      box,
      submit);

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var token = input.value.trim();
      box.replaceChildren();
      if (!token) {
        box.replaceChildren(notice('err', 'کلید خالی است.', 'کلید API را در کادر بالا بچسبان.', 'اگر کلید نداری، از لینک بالا بگیرش.'));
        input.focus();
        return;
      }
      busy(submit, true, 'در حال بررسی…');
      try {
        var r = await api('/api/simple/connect', 'POST', { token: token, remember: remember.checked });
        input.value = '';
        token = '';
        showGreeting(r.account || {});
      } catch (e) {
        busy(submit, false);
        failInto(box, e);
      }
    });

    setView(card(
      h('h2', { text: 'وصل شدن به لیارا' }),
      h('p', { class: 'lead', text: 'کلید حساب لیارایت را بچسبان. فقط یک بار لازم است.' }),
      form,
      tryBtn
    ));
  }

  function showGreeting(acc) {
    setStep(1);
    resetLocal();
    var name = acc.name || acc.email || '';
    var kids = [h('h2', { text: name ? 'سلام ' + name + ' 👋' : 'سلام 👋' })];
    if (acc.balanceTomans !== undefined && acc.balanceTomans !== null) {
      kids.push(h('p', { class: 'lead', text: 'موجودی: ' + fa(acc.balanceTomans) + ' تومان' }));
    }
    var box = h('div', { class: 'err-box' });
    var go = h('button', { type: 'button', class: 'btn primary', text: 'ادامه' });
    go.addEventListener('click', async function () {
      busy(go, true, '…');
      try {
        await refreshSession();
        route();
      } catch (e) {
        busy(go, false);
        failInto(box, e);
      }
    });
    kids.push(box, go);
    setView(card.apply(null, kids));
  }

  /* ---------- step 2: project ---------- */

  async function showProject() {
    setStep(2);
    if (!state.project) {
      setView(card(h('h2', { text: 'پروژه‌ات' }), h('p', { class: 'lead', text: 'در حال خواندن پروژه‌ات…' })));
      try {
        var r = await api('/api/simple/project', 'POST', {});
        state.project = r.project;
      } catch (e) {
        if (e && e.unauthorized) return showGate();
        var box0 = h('div', { class: 'err-box' }, errNotice(e));
        return setView(card(h('h2', { text: 'پروژه‌ات' }), box0, retryBtn(showProject)));
      }
    }
    renderProject();
  }

  /** Last segment of the folder path: the name a vibe coder recognises. */
  function folderName(dir) {
    var parts = String(dir || '').split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '—';
  }

  function renderProject() {
    var p = state.project;
    var envs = p.envs || [];
    var errBox = h('div', { class: 'err-box' });

    // folder path edit («تغییر پوشه»)
    var dirInput = h('input', { id: 'dirInput', type: 'text', class: 'ltr', value: p.dir || '', spellcheck: 'false', autocomplete: 'off' });
    var dirSave = h('button', { type: 'button', class: 'btn ghost small', text: 'ذخیره' });
    var dirCancel = h('button', { type: 'button', class: 'link-btn', text: 'انصراف' });
    var dirEdit = h('div', { class: 'stack', hidden: true },
      h('label', { class: 'label', for: 'dirInput', text: 'مسیر پوشه‌ی سایت' }),
      dirInput,
      h('div', { class: 'row' }, dirSave, dirCancel));
    var changeBtn = h('button', { type: 'button', class: 'btn ghost small', text: 'تغییر پوشه' });
    changeBtn.addEventListener('click', function () {
      dirEdit.hidden = false;
      dirInput.focus();
    });
    dirCancel.addEventListener('click', function () { dirEdit.hidden = true; });
    dirSave.addEventListener('click', async function () {
      var dir = dirInput.value.trim();
      if (!dir) { errBox.replaceChildren(notice('err', 'مسیر خالی است.', '', 'مسیر پوشه‌ی سایتت را بنویس.')); return; }
      errBox.replaceChildren();
      busy(dirSave, true, '…');
      try {
        var r = await api('/api/simple/project', 'POST', { dir: dir });
        state.project = r.project;
        renderProject();
      } catch (e) {
        busy(dirSave, false);
        failInto(errBox, e);
      }
    });

    // «این پوشه‌ی سایتت است؟» — the Sokan repo itself is never the default site: the demo is suggested.
    var yes = h('button', { type: 'button', class: 'btn primary', text: p.isSokanRepo ? 'از پوشه‌ی نمونه استفاده کن' : 'بله' });
    var question = h('p', { class: 'folder-question', text: p.isSokanRepo
      ? 'این پوشه خود سُکان است، نه سایت تو. پوشه‌ی نمونه‌ی یک سایت را پیشنهاد می‌کنم.'
      : 'این پوشه‌ی سایتت است؟' });
    var answered = h('p', { class: 'folder-answer', hidden: true, text: '✓ این پوشه‌ی سایتت است' });
    var questionRow = h('div', { class: 'row' }, yes, changeBtn);
    var questionBox = h('div', { class: 'stack' }, question, questionRow, answered);

    // env inputs
    var envInputs = envs.map(function (e, i) {
      var id = 'env-' + i;
      var input = h('input', {
        id: id,
        type: e.secret ? 'password' : 'text',
        class: 'ltr',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: e.hasValue ? 'بدون تغییر' : '',
      });
      // Only a value read from the project's .env gets the .env note; a value saved from this form says so.
      var badge = e.fromDotEnv
        ? h('span', { class: 'badge ok', text: 'از فایل .env خوانده شد ✓' })
        : (e.hasValue ? h('span', { class: 'badge ok', text: 'ذخیره شد ✓' }) : null);
      return {
        key: e.key,
        el: h('div', { class: 'field' },
          h('div', { class: 'label-row' },
            h('label', { class: 'label ltr', for: id, text: e.key }),
            badge),
          input),
        input: input,
      };
    });

    var envBlock = envInputs.length ? h('div', { class: 'stack-lg' },
      h('div', { class: 'stack' },
        h('h3', { text: 'مقدارهای لازم' }),
        h('p', { class: 'muted small', text: 'بعد از ذخیره، مقدارها دوباره نمایش داده نمی‌شوند.' })),
      envInputs.map(function (x) { return x.el; })) : null;

    // app name
    var nameInput = h('input', {
      id: 'appName', type: 'text', class: 'ltr', value: p.appName || '', maxlength: '32',
      spellcheck: 'false', autocomplete: 'off',
    });

    var cont = h('button', { type: 'button', class: 'btn primary', text: 'ادامه' });
    cont.addEventListener('click', async function () {
      errBox.replaceChildren();
      busy(cont, true, 'در حال ذخیره…');
      try {
        var variables = envInputs
          .filter(function (x) { return x.input.value !== ''; })
          .map(function (x) { return { key: x.key, value: x.input.value }; });
        if (variables.length) {
          await api('/api/simple/envs', 'POST', { variables: variables });
          (state.project.envs || []).forEach(function (e) {
            if (variables.some(function (v) { return v.key === e.key; })) e.hasValue = true;
          });
        }
        var name = nameInput.value.trim();
        if (name && name !== p.appName) {
          var r = await api('/api/simple/app-name', 'POST', { name: name });
          state.project.appName = r.appName || name;
        }
        showPlans();
      } catch (e) {
        busy(cont, false);
        failInto(errBox, e);
      }
    });

    // Asked only after «بله»: the rest of the form waits until the folder is confirmed.
    var rest = h('div', { class: 'stack-lg', hidden: !!p.isSokanRepo },
      envBlock,
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'appName', text: 'نام سایت' }),
        nameInput,
        h('p', { class: 'muted small', text: 'فقط حروف انگلیسی کوچک، عدد و خط تیره.' })),
      errBox,
      cont);

    yes.addEventListener('click', async function () {
      if (!p.isSokanRepo) {
        questionRow.hidden = true;
        question.hidden = true;
        answered.hidden = false;
        rest.hidden = false;
        return;
      }
      errBox.replaceChildren();
      busy(yes, true, '…');
      try {
        var sug = await api('/api/simple/project', 'POST', { dir: p.suggestDir });
        state.project = sug.project;
        renderProject();
      } catch (e) {
        busy(yes, false);
        failInto(errBox, e);
      }
    });

    setView(card(
      h('h2', { text: 'پروژه‌ات' }),
      h('div', { class: 'folder' },
        h('p', { class: 'folder-label muted small', text: 'پوشه‌ی سایت' }),
        h('p', { class: 'folder-name', text: folderName(p.dir) }),
        h('p', { class: 'folder-path ltr muted small', text: p.dir || '' }),
        h('p', { class: 'summary', text: p.summary_fa || 'پروژه‌ات را خواندم.' })),
      questionBox,
      dirEdit,
      rest
    ));
  }

  /* ---------- step 3: plans ---------- */

  async function showPlans() {
    setStep(3);
    if (!state.plans) {
      setView(card(h('h2', { text: 'پلن را انتخاب کن' }), h('p', { class: 'lead', text: 'در حال بررسی پلن‌ها…' })));
      try {
        state.plans = await api('/api/simple/plans');
      } catch (e) {
        if (e && e.unauthorized) return showGate();
        return setView(card(h('h2', { text: 'پلن را انتخاب کن' }), errNotice(e), retryBtn(function () { state.plans = null; showPlans(); })));
      }
    }
    renderPlans();
  }

  function renderPlans() {
    var data = state.plans || {};
    var plans = data.plans || [];
    var short = Number(data.shortfallTomans) || 0;
    var balance = data.balanceTomans;
    var errBox = h('div', { class: 'err-box' });

    if (state.planID === null || state.planID === undefined || !plans.some(function (p) { return String(p.planID) === String(state.planID); })) {
      var rec = plans.find(function (p) { return p.recommended; }) || plans[0];
      state.planID = rec ? rec.planID : null;
    }

    var cont = h('button', { type: 'button', class: 'btn primary', text: 'ادامه' });

    function updateCont() {
      cont.disabled = short > 0 || state.planID === null;
    }

    function select(id) {
      state.planID = id;
      list.querySelectorAll('.plan').forEach(function (b) {
        var on = b.dataset.id === String(id);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.classList.toggle('selected', on);
      });
      updateCont();
    }

    var list = h('div', { class: 'plans', role: 'radiogroup', 'aria-label': 'پلن‌ها' });
    plans.forEach(function (p) {
      var on = String(p.planID) === String(state.planID);
      var btn = h('button', {
        type: 'button', class: 'plan' + (on ? ' selected' : ''), role: 'radio',
        'aria-checked': on ? 'true' : 'false', 'data-id': p.planID,
      },
        h('span', { class: 'plan-top' },
          h('strong', { class: 'plan-name', text: p.label_fa || '' }),
          p.recommended ? h('span', { class: 'badge star', text: '⭐ پیشنهادی' }) : null),
        p.fits_fa ? h('p', { text: p.fits_fa }) : null,
        h('span', { class: 'plan-price' },
          h('span', { class: 'price', text: fa(p.monthlyTomans) + ' تومان/ماه' }),
          p.priceSource === 'estimate' ? h('span', { class: 'badge', text: 'تخمینی' }) : null));
      btn.addEventListener('click', function () { select(p.planID); });
      list.appendChild(btn);
    });

    var shortBox = null;
    if (short > 0) {
      var recheck = h('button', { type: 'button', class: 'btn ghost small', text: 'شارژ کردم' });
      recheck.addEventListener('click', async function () {
        busy(recheck, true, '…');
        try {
          state.plans = await api('/api/simple/plans');
          renderPlans();
        } catch (e) {
          busy(recheck, false);
          failInto(errBox, e);
        }
      });
      shortBox = h('div', { class: 'notice warn', role: 'status' },
        h('p', { class: 'n-what', text: 'موجودی کافی نیست؛ ' + fa(short) + ' تومان کم داری.' }),
        h('p', { class: 'n-next', text: 'حساب را شارژ کن و بعد دکمه‌ی «شارژ کردم» را بزن.' }),
        h('div', { class: 'row' },
          h('a', {
            class: 'btn ghost small', href: data.topupUrl || 'https://console.liara.ir/settings/billing',
            target: '_blank', rel: 'noopener', text: 'شارژ حساب ↗',
          }),
          recheck));
    }

    cont.addEventListener('click', function () { showPublish(); });
    updateCont();

    setView(card(
      h('h2', { text: 'پلن را انتخاب کن' }),
      h('p', { class: 'lead', text: 'سُکان پلنی را پیشنهاد داده که برای سایتت مناسب‌تر است. می‌توانی عوضش کنی.' }),
      balance !== undefined && balance !== null ? h('p', { class: 'muted small', text: 'موجودی حساب: ' + fa(balance) + ' تومان' }) : null,
      list,
      shortBox,
      errBox,
      cont,
      h('button', { type: 'button', class: 'link-btn center', text: 'برگشت به پروژه', onclick: function () { showProject(); } })
    ));
  }

  /* ---------- step 4: publish ---------- */

  function showPublish() {
    setStep(4);
    var plans = (state.plans && state.plans.plans) || [];
    var plan = plans.find(function (p) { return String(p.planID) === String(state.planID); });
    var errBox = h('div', { class: 'err-box' });
    var go = h('button', { type: 'button', class: 'btn primary', text: 'سایتم را بالا بیاور' });

    go.addEventListener('click', async function () {
      errBox.replaceChildren();
      busy(go, true, 'در حال آماده‌سازی…');
      try {
        var r = await api('/api/simple/deploy/prepare', 'POST', { planID: state.planID });
        busy(go, false);
        openConfirmOrFail(r.confirm, 'deploy', errBox);
      } catch (e) {
        busy(go, false);
        failInto(errBox, e);
      }
    });

    var appName = (state.project && state.project.appName) || '';
    setView(card(
      h('h2', { text: 'سایتت را منتشر کنیم؟' }),
      h('p', { class: 'lead', text: 'یک بار دیگر نگاه کن و بعد دکمه را بزن.' }),
      h('dl', { class: 'summary-list' },
        h('div', { class: 'kv' }, h('dt', { text: 'نام سایت' }), h('dd', { class: 'ltr', text: appName || '—' })),
        h('div', { class: 'kv' }, h('dt', { text: 'پلن' }), h('dd', { text: plan ? plan.label_fa : '—' })),
        h('div', { class: 'kv' }, h('dt', { text: 'هزینه' }), h('dd', { text: plan ? fa(plan.monthlyTomans) + ' تومان در ماه' : '—' }))),
      errBox,
      go,
      h('button', { type: 'button', class: 'link-btn center', text: 'برگشت به پلن‌ها', onclick: function () { showPlans(); } })
    ));
  }

  /* ---------- confirmation dialog ---------- */

  var dlgTimer = null;

  function stopDlgTimer() {
    if (dlgTimer) { clearInterval(dlgTimer); dlgTimer = null; }
  }

  function closeDialog() {
    stopDlgTimer();
    if (dlg.open) dlg.close();
  }

  function openConfirmOrFail(c, kind, box) {
    if (!c || !c.approvalId) {
      box.replaceChildren(errNotice({ error: {
        what_fa: 'این کار الان قابل انجام نیست.',
        why_fa: 'تأیید کار پیدا نشد.',
        next_fa: 'صفحه را دوباره باز کن و دوباره امتحان کن.',
      } }));
      return;
    }
    openConfirm(c, kind);
  }

  function openConfirm(c, kind) {
    var decided = false;
    var enc = encodeURIComponent(c.approvalId);
    var typedInput = null;
    var yes = h('button', { type: 'button', class: 'btn primary', text: 'بله، انجام بده' });
    var no = h('button', { type: 'button', class: 'btn ghost', text: 'نه' });
    var expiry = h('p', { class: 'muted small expiry', 'aria-live': 'polite' });
    var err = h('div', { class: 'err-box' });

    var typed = null;
    if (c.requiresTypedName) {
      typedInput = h('input', { id: 'dlgTyped', type: 'text', class: 'ltr', autocomplete: 'off', spellcheck: 'false' });
      typed = h('div', { class: 'field' },
        h('label', { class: 'label', for: 'dlgTyped', text: 'برای تأیید، «' + c.requiresTypedName + '» را تایپ کن' }),
        typedInput);
      yes.disabled = true;
      typedInput.addEventListener('input', function () {
        yes.disabled = typedInput.value.trim() !== String(c.requiresTypedName);
      });
    }

    dlg.replaceChildren.apply(dlg, [
      h('h2', { id: 'dlgTitle', text: c.title_fa || 'تأیید کار' }),
      (c.bullets_fa && c.bullets_fa.length) ? h('ul', { class: 'bullets' }, c.bullets_fa.map(function (b) { return h('li', { text: String(b) }); })) : null,
      c.cost_fa ? h('p', { class: 'cost', text: c.cost_fa }) : null,
      typed,
      expiry,
      err,
      h('div', { class: 'dlg-actions' }, yes, no)
    ].filter(Boolean));

    var end = Date.parse(c.expiresAt);
    function tick() {
      if (isNaN(end)) { expiry.textContent = ''; return; }
      var left = Math.floor((end - Date.now()) / 1000);
      if (left <= 0) {
        expiry.textContent = 'زمان این تأیید تمام شد. دوباره از اول شروع کن.';
        yes.disabled = true;
        stopDlgTimer();
        return;
      }
      var m = Math.floor(left / 60);
      var s = left % 60;
      expiry.textContent = 'این تأیید تا ' + pad2(m) + ':' + pad2(s) + ' دیگر معتبر است.';
    }
    stopDlgTimer();
    tick();
    if (!isNaN(end)) dlgTimer = setInterval(tick, 1000);

    no.addEventListener('click', function () {
      closeDialog();
    });

    yes.addEventListener('click', async function () {
      if (typedInput && typedInput.value.trim() !== String(c.requiresTypedName)) return;
      err.replaceChildren();
      busy(yes, true, 'در حال شروع…');
      no.disabled = true;
      decided = true;
      state.pendingJob = true;
      state.early = [];
      try {
        var body = typedInput ? { typed: typedInput.value.trim() } : {};
        var r = await api('/api/simple/confirm/' + enc, 'POST', body);
        closeDialog();
        startJob(r.jobId, kind);
      } catch (e) {
        state.pendingJob = false;
        decided = false;
        busy(yes, false);
        no.disabled = false;
        if (e && e.unauthorized) { closeDialog(); return showGate(); }
        err.replaceChildren(errNotice(e));
      }
    });

    dlg.onclose = function () {
      stopDlgTimer();
      if (!decided) {
        decided = true;
        api('/api/simple/cancel/' + enc, 'POST', {}).catch(function () { /* best effort */ });
      }
    };

    if (!dlg.open) dlg.showModal();
    yes.focus();
  }

  /* ---------- progress & results (SSE) ---------- */

  function startJob(jobId, kind) {
    state.pendingJob = false;
    state.job = { id: jobId || null, kind: kind, ui: null };
    renderProgress();
    var early = state.early;
    state.early = [];
    early.forEach(function (e) { handleEvent(e.name, e.d); });
  }

  function renderProgress() {
    var j = state.job;
    var phases = PHASES[j.kind] || [];
    var fill = h('div', { class: 'fill' });
    var bar = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
    var pct = h('p', { class: 'pct', text: '۰٪' });
    var msg = h('p', { class: 'step-msg', text: 'در حال شروع…' });
    var items = phases.map(function (ph) {
      return h('li', { class: 'pending' },
        h('span', { class: 'mark', 'aria-hidden': 'true', text: '○' }),
        h('span', { text: ph[1] }));
    });
    var logList = h('ol', { class: 'log' });
    j.ui = { fill: fill, bar: bar, pct: pct, msg: msg, logList: logList, items: items, phases: phases, shown: 0, phase: -1 };
    setStep(j.kind === 'deploy' || j.kind === 'redeploy' ? 4 : 0);
    var spin = h('span', { class: 'spin', 'aria-hidden': 'true' });
    setView(card(
      h('h2', { text: TITLES[j.kind] || 'در حال انجام…' }),
      h('div', { class: 'progress' }, bar, pct),
      phases.length ? h('ol', { class: 'phases' }, items) : null,
      h('div', { class: 'working', role: 'status' }, spin, msg),
      h('details', { class: 'details' },
        h('summary', { text: 'جزئیات' }),
        logList)
    ));
  }

  /** Ticks the checklist: phases before the reported one are done, the reported one is current. Never moves back. */
  function markPhase(u, step) {
    if (!u.items.length) return;
    var idx = -1;
    if (step === 'done') idx = u.items.length;
    else u.phases.forEach(function (ph, i) { if (ph[0] === step) idx = i; });
    if (idx < 0 || idx < u.phase) return;
    u.phase = idx;
    u.items.forEach(function (li, i) {
      var st = i < idx ? 'done' : (i === idx ? 'current' : 'pending');
      li.className = st;
      li.querySelector('.mark').textContent = st === 'done' ? '✓' : (st === 'current' ? '…' : '○');
    });
  }

  function applyProgress(d) {
    var u = state.job && state.job.ui;
    if (!u) return;
    var p = d.step === 'done' ? 100 : clamp(Math.round(Number(d.percent) || 0), 0, 100);
    // Percent only moves forward; the bar's CSS transition makes each phase glide.
    u.shown = Math.max(u.shown, p);
    u.fill.style.width = u.shown + '%';
    u.bar.setAttribute('aria-valuenow', String(u.shown));
    u.pct.textContent = fa(u.shown) + '٪';
    if (d.message_fa) u.msg.textContent = String(d.message_fa);
    markPhase(u, d.step);
    var line = [d.message_fa, d.detail].filter(Boolean).join(' — ');
    if (line && (!u.logList.lastChild || u.logList.lastChild.textContent !== line)) {
      u.logList.appendChild(h('li', { text: line }));
    }
  }

  async function applyResult(d) {
    if (!state.job) return;
    var kind = state.job.kind;
    state.job = null;
    if (!d.ok) return viewFailed(d, kind);
    if (kind === 'fix') {
      if (d.outcome === 'mitigated') return viewMitigated(d);
      if (d.verification && d.verification.passed === false) return viewFailed(d, kind);
      return viewFixed(d);
    }
    if (kind === 'domain') return viewDomainDone(d.message_fa, d.url);
    if (kind === 'zone') return showDomain(state.domainName, d.message_fa);
    try {
      await refreshSession();
    } catch (e) {
      if (e && e.unauthorized) return showGate();
    }
    // The success line is the title; the URL line below it is the only subtitle.
    showSite({
      hero: kind === 'redeploy' ? 'نسخه‌ی جدید منتشر شد ✅' : 'سایتت آنلاین شد 🎉',
      url: d.url || '',
    });
  }

  function handleEvent(name, d) {
    if (!d || typeof d !== 'object') return;
    if (!state.job) {
      if (state.pendingJob) state.early.push({ name: name, d: d });
      return;
    }
    if (state.job.id && d.jobId && d.jobId !== state.job.id) return;
    if (name === 'simple_progress') applyProgress(d);
    else if (name === 'simple_result') applyResult(d);
  }

  function connectEvents() {
    if (!window.EventSource) return;
    var es;
    try { es = new EventSource('/api/events'); } catch (_) { return; }
    state.es = es;
    ['simple_progress', 'simple_result'].forEach(function (name) {
      es.addEventListener(name, function (ev) { handleEvent(name, parse(ev.data)); });
    });
    // Server state and probe events: refresh the site card so a broken site turns red without a reload.
    ['state', 'probe'].forEach(function (name) {
      es.addEventListener(name, function () { onLiveEvent(); });
    });
    es.onmessage = function (ev) {
      var d = parse(ev.data);
      if (!d || typeof d !== 'object') return;
      if (d.type === 'simple_progress' || d.type === 'simple_result') {
        handleEvent(d.type, d.data && typeof d.data === 'object' ? d.data : d);
      }
    };
  }

  /** Result of a fix: the title says it once; the line under it is the before/after only. */
  function beforeAfter(message) {
    var m = String(message || '');
    if (m.indexOf('درست شد') !== 0) return m;
    var i = m.indexOf('—');
    return i >= 0 ? m.slice(i + 1).trim() : '';
  }

  function viewFixed(d) {
    setStep(0);
    var line = beforeAfter(d.message_fa) || (d.verification && d.verification.summary_fa) || '';
    setView(card(
      h('h2', { text: 'درست شد ✅' }),
      line ? h('p', { class: 'lead', text: line }) : null,
      h('button', { type: 'button', class: 'btn primary', text: 'برگشت به سایتم', onclick: function () { reloadRoute(); } })
    ));
  }

  /** The restart held, but the leak is still in the code: say so, and hand over the Fix Brief. */
  function viewMitigated(d) {
    setStep(0);
    var kids = [
      h('h2', { text: 'موقتاً مهار شد' }),
      h('p', { class: 'lead', text: d.message_fa || '' }),
    ];
    if (d.verification && d.verification.summary_fa) {
      kids.push(notice('warn', 'قبل و بعد', d.verification.summary_fa, ''));
    }
    if (d.fixBriefMarkdown) kids.push(copyBtn(d.fixBriefMarkdown, 'برای Cursor/Claude کپی کن', 'btn primary'));
    kids.push(h('button', { type: 'button', class: 'btn ghost', text: 'برگشت به سایتم', onclick: function () { reloadRoute(); } }));
    setView(card.apply(null, kids));
  }

  function viewDomainDone(message, url) {
    setStep(0);
    var kids = [
      h('h2', { text: 'دامنه آماده است ✅' }),
      message ? h('p', { class: 'lead', text: message }) : null,
    ];
    if (url) {
      kids.push(h('a', { class: 'btn primary', href: url, target: '_blank', rel: 'noopener', text: url + ' ↗' }));
    }
    kids.push(h('button', { type: 'button', class: 'link-btn center', text: 'برگشت به سایتم', onclick: function () { reloadRoute(); } }));
    setView(card.apply(null, kids));
  }

  function viewFailed(d, kind) {
    var deployish = kind === 'deploy' || kind === 'redeploy';
    setStep(deployish ? 4 : 0);
    var titles = {
      fix: 'هنوز درست نشده',
      domain: 'دامنه وصل نشد',
      zone: 'منطقه‌ی DNS ساخته نشد',
      redeploy: 'نسخه‌ی جدید منتشر نشد',
      deploy: 'انتشار کامل نشد',
    };
    var retry = {
      fix: function () { runDiagnoseNow(); },
      domain: function () { showDomain(state.domainName); },
      zone: function () { showDomain(state.domainName); },
      redeploy: function () { reloadRoute(); },
      deploy: function () { showPublish(); },
    };
    // The site exists (it answered, or only the check failed): offer the site, not another publish.
    var again = (deployish && d.url) ? { text: 'سایتم را ببینم', fn: reloadRoute } : { text: 'دوباره امتحان کن', fn: retry[kind] || reloadRoute };
    var techErr = typeof d.error === 'string' ? d.error : ((d.error && (d.error.what_fa || d.error.why_fa || d.error.message)) || '');
    var brief = d.fixBriefMarkdown || '';
    var kids = [
      h('h2', { text: titles[kind] || 'کار کامل نشد' }),
      h('p', { class: 'lead', text: d.message_fa || 'یک مشکل پیش آمد.' }),
    ];
    if (brief) kids.push(copyBtn(brief, 'برای Cursor/Claude کپی کن', 'btn primary'));
    kids.push(h('button', { type: 'button', class: 'btn ghost', text: again.text, onclick: again.fn }));
    if (techErr || brief) {
      kids.push(technicalDetails([
        techErr ? h('pre', { class: 'log-pre', text: String(techErr) }) : null,
        brief ? h('pre', { class: 'log-pre', text: brief }) : null,
      ]));
    }
    setView(card.apply(null, kids));
  }

  /* ---------- site card ---------- */

  function statusInfo(s) {
    var map = {
      up: ['up', 'آنلاین است'],
      degraded: ['degraded', 'سایت کند است'],
      down: ['down', 'سایت خطا می‌دهد'],
    };
    return map[s] || ['unknown', 'وضعیت نامشخص است'];
  }

  /** Writes the site verdict into the card that is on screen. Does nothing when another screen is shown. */
  function paintSite(s) {
    var ui = state.siteUi;
    if (!ui) return;
    var st = statusInfo(s.status);
    ui.panel.setAttribute('data-state', st[0]);
    ui.dot.className = 'status-dot ' + st[0];
    ui.label.textContent = st[1];
    ui.note.textContent = s.statusNote_fa || '';
    ui.note.hidden = !s.statusNote_fa;
    ui.fix.hidden = !(s.status === 'down' || s.status === 'degraded');
    // A success title ("online") is only true while the site is up; otherwise the card says just the name.
    if (ui.title) ui.title.textContent = (ui.hero && st[0] === 'up') ? ui.hero : 'سایتت';
  }

  async function refreshSiteStatus() {
    if (!state.siteUi || document.hidden) return;
    try {
      await refreshSession();
    } catch (e) {
      if (e && e.unauthorized) showGate();
      return;
    }
    if (!state.siteUi) return;
    paintSite((state.session && state.session.site) || {});
  }

  function startSitePolling() {
    stopSitePolling();
    state.sitePoll = setInterval(refreshSiteStatus, SITE_POLL_MS);
  }

  function stopSitePolling() {
    if (state.sitePoll) { clearInterval(state.sitePoll); state.sitePoll = null; }
    if (state.liveTimer) { clearTimeout(state.liveTimer); state.liveTimer = null; }
  }

  /** SSE state/probe events: refresh at most every few seconds, and only while the site card is shown. */
  function onLiveEvent() {
    if (!state.siteUi || state.liveTimer) return;
    var wait = Math.max(0, LIVE_THROTTLE_MS - (Date.now() - state.lastLive));
    state.liveTimer = setTimeout(function () {
      state.liveTimer = null;
      state.lastLive = Date.now();
      refreshSiteStatus();
    }, wait);
  }

  function showSite(opts) {
    setStep(opts && opts.hero ? 5 : 0);
    var s = (state.session && state.session.site) || {};
    var url = (opts && opts.url) || s.url || '';
    var errBox = h('div', { class: 'err-box' });
    var dot = h('span', { class: 'status-dot', 'aria-hidden': 'true' });
    var label = h('span', { class: 'status-label' });
    var note = h('p', { class: 'status-note', hidden: true });
    var fix = h('button', { type: 'button', class: 'btn primary', text: 'بررسی و درست کردن' });
    fix.addEventListener('click', function () { runDiagnoseNow(); });
    var panel = h('div', { class: 'site-status', 'data-state': 'unknown' },
      h('div', { class: 'status-row' }, dot, label),
      note,
      fix);

    var title = h('h2', { class: opts && opts.hero ? 'hero' : '', text: 'سایتت' });
    var kids = [title];
    kids.push(panel);
    if (url) {
      kids.push(h('div', { class: 'url-row' },
        h('a', { class: 'url ltr', href: url, target: '_blank', rel: 'noopener', text: url }),
        copyBtn(url, 'کپی لینک')));
      if (opts && opts.hero) {
        kids.push(h('a', { class: 'btn ghost', href: url, target: '_blank', rel: 'noopener', text: 'باز کردن سایت ↗' }));
      }
    }
    var meta = [];
    if (s.lastDeployAt) meta.push(['آخرین انتشار', fmtDate(s.lastDeployAt)]);
    if (s.monthlyTomans !== undefined && s.monthlyTomans !== null) meta.push(['هزینه‌ی ماهانه', fa(s.monthlyTomans) + ' تومان']);
    if (meta.length) {
      kids.push(h('dl', { class: 'summary-list' }, meta.map(function (m) {
        return h('div', { class: 'kv' }, h('dt', { text: m[0] }), h('dd', { text: m[1] }));
      })));
    }
    kids.push(errBox);

    var redeployBtn = h('button', { type: 'button', class: 'btn ghost', text: 'انتشار نسخه‌ی جدید' });
    redeployBtn.addEventListener('click', async function () {
      errBox.replaceChildren();
      busy(redeployBtn, true, '…');
      try {
        var r = await api('/api/simple/redeploy/prepare', 'POST', {});
        busy(redeployBtn, false);
        openConfirmOrFail(r.confirm, 'redeploy', errBox);
      } catch (e) {
        busy(redeployBtn, false);
        failInto(errBox, e);
      }
    });

    kids.push(h('div', { class: 'site-actions' },
      redeployBtn,
      h('button', { type: 'button', class: 'btn ghost', text: 'اتصال دامنه', onclick: function () { showDomain(''); } }),
      h('button', { type: 'button', class: 'btn ghost', text: 'سایتم مشکل داره', onclick: function () { showDiagnose(); } })));

    setView(card.apply(null, kids));
    state.siteUi = { panel: panel, dot: dot, label: label, note: note, fix: fix, title: title, hero: (opts && opts.hero) || '' };
    paintSite(s);
    startSitePolling();
  }

  /* ---------- diagnose ---------- */

  /** One tap from the site card: runs the diagnosis at once, then offers the fix card. */
  function runDiagnoseNow() {
    var box = h('div', { class: 'stack-lg' });
    var wait = working('در حال بررسی…');
    setStep(0);
    setView(card(
      h('h2', { text: 'بررسی سایتت' }),
      wait,
      box,
      h('button', { type: 'button', class: 'link-btn center', text: 'برگشت به سایتم', onclick: function () { reloadRoute(); } })
    ));
    api('/api/simple/diagnose', 'POST', {}).then(function (d) {
      wait.remove();
      renderDiagnosis(box, d);
    }, function (e) {
      if (e && e.unauthorized) return showGate();
      wait.remove();
      box.replaceChildren(errNotice(e));
    });
  }

  function showDiagnose() {
    setStep(0);
    var symptom = h('textarea', {
      id: 'symptom', rows: '2', maxlength: '200',
      placeholder: 'مثلاً: صفحه‌ی اصلی خطا می‌دهد',
    });
    var errBox = h('div', { class: 'err-box' });
    var result = h('div', { class: 'stack-lg' });
    var go = h('button', { type: 'button', class: 'btn primary', text: 'بررسی کن' });

    go.addEventListener('click', async function () {
      errBox.replaceChildren();
      result.replaceChildren();
      busy(go, true, 'در حال بررسی…');
      try {
        var d = await api('/api/simple/diagnose', 'POST', { symptom_fa: symptom.value.trim() });
        busy(go, false);
        renderDiagnosis(result, d);
      } catch (e) {
        busy(go, false);
        failInto(errBox, e);
      }
    });

    setView(card(
      h('h2', { text: 'چه اتفاقی افتاده؟' }),
      h('p', { class: 'lead', text: 'اگر می‌دانی چه می‌بینی بنویس؛ اگر نه، خالی بگذار.' }),
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'symptom', text: 'چه مشکلی می‌بینی؟ (اختیاری)' }),
        symptom),
      errBox,
      go,
      result,
      h('button', { type: 'button', class: 'link-btn center', text: 'برگشت به سایتم', onclick: function () { reloadRoute(); } })
    ));
  }

  function renderDiagnosis(box, d) {
    var kids = [];
    var brief = d.fixBriefMarkdown || '';
    if (d.incidentStatus && INCIDENT_FA[d.incidentStatus]) {
      kids.push(h('p', { class: 'muted small', text: 'وضعیت: ' + INCIDENT_FA[d.incidentStatus] }));
    }
    if (d.found) {
      kids.push(h('div', { class: 'diag' },
        h('p', { class: 'diag-label', text: 'مشکل' }),
        h('p', { class: 'diag-text', text: d.problem_fa || '' }),
        h('p', { class: 'diag-label', text: 'راه‌حل' }),
        h('p', { class: 'diag-text', text: d.solution_fa || '' })));
      var acts = [];
      if (d.confirm) {
        acts.push(h('button', { type: 'button', class: 'btn primary', text: 'درستش کن', onclick: function () { openConfirmOrFail(d.confirm, 'fix', box); } }));
      }
      if (brief) acts.push(copyBtn(brief, 'برای Cursor/Claude کپی کن', 'btn ghost'));
      kids.push(h('div', { class: 'stack' }, acts));
    } else {
      kids.push(notice('info', d.problem_fa || 'علت مشخصی پیدا نکردم.', '', d.solution_fa || 'لاگ‌ها را ببین یا متن زیر را برای Cursor/Claude کپی کن.'));
      var logsBox = h('div');
      var logsBtn = h('button', { type: 'button', class: 'btn ghost', text: 'لاگ‌ها را ببین' });
      logsBtn.addEventListener('click', async function () {
        busy(logsBtn, true, '…');
        try {
          var r = await api('/api/simple/logs');
          var lines = (r.lines || []).map(function (l) { return [l.ts, l.line].filter(Boolean).join('  '); });
          logsBox.replaceChildren(h('pre', { class: 'log-pre', text: lines.length ? lines.join('\n') : 'لاگی پیدا نشد.' }));
          busy(logsBtn, false);
        } catch (e) {
          busy(logsBtn, false);
          if (e && e.unauthorized) return showGate();
          logsBox.replaceChildren(errNotice(e));
        }
      });
      kids.push(h('div', { class: 'stack' },
        brief ? copyBtn(brief, 'برای Cursor/Claude کپی کن', 'btn primary') : null,
        logsBtn,
        logsBox));
    }

    var det = d.details || {};
    var hyp = (det.hypotheses || []).map(function (x) {
      return h('li', { text: (x.title_fa || '') + ' — ' + fa(pctOf(x.confidence)) + '٪' });
    });
    var ev = (det.evidence || []).map(function (x) {
      return h('li', { text: (x.id ? x.id + ': ' : '') + (x.summary_fa || '') });
    });
    if (hyp.length || ev.length) {
      kids.push(technicalDetails([
        hyp.length ? h('h3', { text: 'فرضیه‌ها' }) : null,
        hyp.length ? h('ol', { class: 'plain' }, hyp) : null,
        ev.length ? h('h3', { text: 'شواهد' }) : null,
        ev.length ? h('ul', { class: 'plain' }, ev) : null,
      ]));
    }
    box.replaceChildren.apply(box, kids);
  }

  /* ---------- domain ---------- */

  /** Domain screen. A non-empty prefill is looked up at once (used after the zone was built). */
  function showDomain(prefill, message) {
    setStep(0);
    var domain0 = prefill || '';
    var input = h('input', { id: 'domain', type: 'text', class: 'ltr', placeholder: 'example.ir', value: domain0, autocomplete: 'off', spellcheck: 'false', inputmode: 'url' });
    var errBox = h('div', { class: 'err-box' });
    var out = h('div', { class: 'stack-lg' });
    var go = h('button', { type: 'submit', class: 'btn primary', text: 'ادامه' });

    function lookup() {
      var domain = input.value.trim().toLowerCase();
      errBox.replaceChildren();
      out.replaceChildren();
      if (!domain) {
        errBox.replaceChildren(notice('err', 'دامنه را ننوشتی.', '', 'مثلاً mysite.ir را بنویس.'));
        input.focus();
        return;
      }
      state.domainName = domain;
      busy(go, true, '…');
      api('/api/simple/domain', 'POST', { domain: domain }).then(function (r) {
        busy(go, false);
        renderDomainSteps(out, errBox, r, domain);
      }, function (e) {
        busy(go, false);
        failInto(errBox, e);
      });
    }

    // Enter in the domain field submits the form.
    var form = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'domain', text: 'نام دامنه' }),
        input),
      errBox,
      go);
    form.addEventListener('submit', function (ev) { ev.preventDefault(); lookup(); });

    setView(card(
      h('h2', { text: 'اتصال دامنه' }),
      h('p', { class: 'lead', text: 'اگر دامنه‌ای داری، می‌توانی به سایتت وصل کنی.' }),
      message ? notice('ok', message, '', '') : null,
      form,
      out,
      h('button', { type: 'button', class: 'link-btn center', text: 'برگشت به سایتم', onclick: function () { reloadRoute(); } })
    ));
    if (domain0) lookup();
  }

  function renderDomainSteps(box, errBox, r, domain) {
    var kids = [];
    var steps = (r.steps || []).map(function (s) {
      return h('li', null,
        h('span', { class: 'num', text: fa(s.n) }),
        h('div', { class: 'stack' },
          h('p', { text: s.text_fa || '' }),
          s.copy ? h('div', { class: 'ns-row' }, h('code', { text: s.copy }), copyBtn(s.copy, 'کپی')) : null));
    });
    if (steps.length) kids.push(h('ol', { class: 'steps' }, steps));
    if (r.nsNote_fa) kids.push(h('p', { class: 'muted small', text: r.nsNote_fa }));
    if (r.exampleNameservers) {
      kids.push(h('p', { class: 'muted small', text: 'سرورهای نام بالا نمونه‌اند؛ مقدارهای واقعی را بعد از ساخت منطقه در حساب لیارا می‌بینی.' }));
    }

    var checkErr = h('div', { class: 'err-box' });
    if (r.confirm) {
      // The zone has to exist before its name servers can be shown.
      kids.push(h('button', { type: 'button', class: 'btn primary', text: 'منطقه‌ی DNS را بساز', onclick: function () { openConfirmOrFail(r.confirm, 'zone', checkErr); } }));
    } else {
      var check = h('button', { type: 'button', class: 'btn primary', text: 'انجام دادم، بررسی کن' });
      check.addEventListener('click', async function () {
        checkErr.replaceChildren();
        busy(check, true, 'در حال بررسی…');
        try {
          var c = await api('/api/simple/domain/check', 'POST', { domain: domain });
          busy(check, false);
          if (c.propagated) {
            if (c.confirm) return openConfirmOrFail(c.confirm, 'domain', checkErr);
            return viewDomainDone(c.message_fa, c.url || ('https://' + domain));
          }
          checkErr.replaceChildren(notice('info', c.message_fa || 'هنوز به سُکان نرسیده.', '', 'چند دقیقه دیگر دوباره بزن.'));
        } catch (e) {
          busy(check, false);
          failInto(checkErr, e);
        }
      });
      kids.push(check);
    }
    kids.push(checkErr);
    box.replaceChildren.apply(box, kids);
    if (!r.isIr) {
      errBox.replaceChildren(notice('info', 'این دامنه را در پنل ثبت‌کننده‌ی دامنه‌ات تنظیم کن.', '', 'مراحل بالا را دنبال کن و بعد دکمه‌ی «بررسی» را بزن.'));
    }
  }

  /* ---------- boot ---------- */

  async function boot() {
    try {
      state.session = await api('/api/simple/session');
    } catch (e) {
      if (e && e.unauthorized) return showGate();
      return setView(card(h('h2', { text: 'به سُکان وصل نشدم' }), errNotice(e), retryBtn(boot)));
    }
    route();
  }

  function init() {
    stepper.replaceChildren(h('ol', { class: 'stepper-list' },
      STEP_LABELS.map(function (t) {
        return h('li', null, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'step-label', text: t }));
      })));

    document.getElementById('simConnectBtn').addEventListener('click', function () {
      resetLocal();
      showConnect();
    });

    document.getElementById('disconnectBtn').addEventListener('click', async function () {
      var btn = this;
      busy(btn, true, '…');
      try {
        await api('/api/simple/disconnect', 'POST', {});
      } catch (e) {
        busy(btn, false);
        if (e && e.unauthorized) return showGate();
        return setView(card(errNotice(e)));
      }
      busy(btn, false);
      resetLocal();
      state.session = { connected: false, mode: null };
      route();
    });

    connectEvents();
    boot();
  }

  init();
})();
