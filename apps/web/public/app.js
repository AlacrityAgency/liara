/**
 * Sokan Console Interactive Client Application (WHITEPAPER §12)
 */

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const chatFeed = document.getElementById("chatFeed");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const approvalCardContainer = document.getElementById("approvalCardContainer");
  const logsTerminal = document.getElementById("logsTerminal");
  const auditTableBody = document.getElementById("auditTableBody");
  const incidentEmptyState = document.getElementById("incidentEmptyState");
  const incidentActiveView = document.getElementById("incidentActiveView");
  const tabIncidentBadge = document.getElementById("tabIncidentBadge");
  const quickInvestigateBtn = document.getElementById("quickInvestigateBtn");
  const clearLogsBtn = document.getElementById("clearLogsBtn");

  // Health Elements
  const appStatusVal = document.getElementById("appStatusVal");
  const appStatusText = document.getElementById("appStatusText");
  const ramUsageVal = document.getElementById("ramUsageVal");
  const ramProgressBar = document.getElementById("ramProgressBar");
  const ramLimitText = document.getElementById("ramLimitText");
  const probeLatencyVal = document.getElementById("probeLatencyVal");
  const incidentStateVal = document.getElementById("incidentStateVal");
  const connectionModeBadge = document.getElementById("connectionModeBadge");
  const connectionModeText = document.getElementById("connectionModeText");

  let activeApprovalId = null;
  let cancelCountdownTimer = null;

  // 1. Tab Navigation
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPane = document.getElementById(btn.dataset.tab);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // 1.1 Liara Subnav Services Navigation
  const serviceTabs = document.querySelectorAll(".service-tab-btn");
  const servicePanes = document.querySelectorAll(".service-view-pane");

  window.switchService = function(serviceKey) {
    serviceTabs.forEach((tab) => {
      if (tab.dataset.service === serviceKey) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });

    servicePanes.forEach((pane) => {
      if (pane.id === `service-${serviceKey}`) {
        pane.classList.add("active");
      } else {
        pane.classList.remove("active");
      }
    });
  };

  serviceTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.service;
      if (key === "platform" || key === "database" || key === "ai") {
        window.switchService(key);
      } else {
        // Show active style on tab and switch to platform with note
        serviceTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        window.switchService("platform");
      }
    });
  });

  // 1.2 Layout Toggles (Split View, Full Console, Full Sokan)
  const workspaceContainer = document.getElementById("workspaceContainer");
  const toggleSplitViewBtn = document.getElementById("toggleSplitViewBtn");
  const toggleFullConsoleBtn = document.getElementById("toggleFullConsoleBtn");
  const toggleFullSokanBtn = document.getElementById("toggleFullSokanBtn");
  const sokanQuickActionBtn = document.getElementById("sokanQuickActionBtn");

  function setLayoutMode(mode) {
    if (!workspaceContainer) return;
    workspaceContainer.classList.remove("full-console", "full-sokan");
    if (toggleSplitViewBtn) toggleSplitViewBtn.classList.remove("active");
    if (toggleFullConsoleBtn) toggleFullConsoleBtn.classList.remove("active");
    if (toggleFullSokanBtn) toggleFullSokanBtn.classList.remove("active");

    if (mode === "split") {
      if (toggleSplitViewBtn) toggleSplitViewBtn.classList.add("active");
    } else if (mode === "console") {
      workspaceContainer.classList.add("full-console");
      if (toggleFullConsoleBtn) toggleFullConsoleBtn.classList.add("active");
    } else if (mode === "sokan") {
      workspaceContainer.classList.add("full-sokan");
      if (toggleFullSokanBtn) toggleFullSokanBtn.classList.add("active");
    }
  }

  if (toggleSplitViewBtn) toggleSplitViewBtn.addEventListener("click", () => setLayoutMode("split"));
  if (toggleFullConsoleBtn) toggleFullConsoleBtn.addEventListener("click", () => setLayoutMode("console"));
  if (toggleFullSokanBtn) toggleFullSokanBtn.addEventListener("click", () => setLayoutMode("sokan"));
  if (sokanQuickActionBtn) {
    sokanQuickActionBtn.addEventListener("click", () => {
      if (workspaceContainer && workspaceContainer.classList.contains("full-sokan")) {
        setLayoutMode("split");
      } else {
        setLayoutMode("sokan");
      }
    });
  }

  window.focusSokanChat = function(promptText) {
    setLayoutMode("split");
    if (chatInput) {
      chatInput.value = promptText;
      chatInput.focus();
    }
    if (chatForm) {
      chatForm.dispatchEvent(new Event("submit"));
    }
  };


  // 2. SSE Stream Connection
  function setupSSE() {
    const evtSource = new EventSource("/api/events");

    evtSource.addEventListener("log", (e) => {
      try {
        const item = JSON.parse(e.data);
        appendTerminalLine(item.text, item.stream);
      } catch (err) {}
    });

    evtSource.addEventListener("probe", (e) => {
      try {
        const p = JSON.parse(e.data);
        if (p.ms !== null) probeLatencyVal.textContent = `${Number(p.ms).toLocaleString("fa-IR")} میلی‌ثانیه`;
        if (p.heapUsed !== null) {
          ramUsageVal.textContent = `${Number(p.heapUsed).toLocaleString("fa-IR")} مگابایت`;
          const pct = Math.min(100, Math.round((p.heapUsed / 512) * 100));
          ramProgressBar.style.width = `${pct}%`;
          ramLimitText.textContent = `از سقف ۵۱۲ مگابایت پلن (${pct.toLocaleString("fa-IR")}٪)`;
          ramProgressBar.classList.toggle("is-critical", pct > 80);
        }
      } catch (err) {}
    });

    evtSource.addEventListener("incident", (e) => {
      try {
        const inc = JSON.parse(e.data);
        renderIncident(inc);
      } catch (err) {}
    });

    evtSource.addEventListener("approval_executed", (e) => {
      fetchState();
    });

    evtSource.onerror = () => {
      setTimeout(setupSSE, 5000);
    };
  }
  setupSSE();

  function appendTerminalLine(text, stream = "stdout") {
    const line = document.createElement("div");
    line.className = `log-entry ${stream}`;
    line.textContent = `[${new Date().toLocaleTimeString("fa-IR")}] ${text}`;
    logsTerminal.appendChild(line);
    logsTerminal.scrollTop = logsTerminal.scrollHeight;
  }

  if (clearLogsBtn) {
    clearLogsBtn.addEventListener("click", () => {
      logsTerminal.innerHTML = '<div class="log-entry sys">[SYSTEM] Log display cleared.</div>';
    });
  }

  // 3. State Poller
  async function fetchState() {
    try {
      const res = await fetch("/api/state");
      const data = await res.json();

      if (data.mode === "live") {
        connectionModeBadge.className = "mode-badge live";
        connectionModeText.textContent = "متصل به لیارا";
      } else {
        connectionModeBadge.className = "mode-badge simulated";
        connectionModeText.textContent = "شبیه‌ساز محلی";
      }

      if (data.app) {
        if (data.app.status === "READY") {
          appStatusText.textContent = "آماده";
          appStatusVal.className = "status-indicator-badge ready";
        } else {
          appStatusText.textContent = "متوقف";
          appStatusVal.className = "status-indicator-badge error";
        }
      }

      // Render Audit
      if (data.audit) renderAudit(data.audit);

      // Render Incident
      if (data.currentIncident) {
        renderIncident(data.currentIncident);
      }
    } catch (err) {}
  }
  fetchState();
  setInterval(fetchState, 4000);

  // 4. Chat Handler
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    appendChatMessage("user", text);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();

      if (data.reply_fa) {
        appendChatMessage("agent", data.reply_fa);
      }

      if (data.approval) {
        renderApprovalCard(data.approval);
      }

      if (data.incident) {
        renderIncident(data.incident);
      }
    } catch (err) {
      appendChatMessage("agent", "متأسفانه در ارتباط با سرور خطایی رخ داد: " + err.message, "error");
    }
  });

  // Quick Chips
  document.querySelectorAll(".chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      chatInput.value = chip.dataset.prompt;
      chatForm.dispatchEvent(new Event("submit"));
    });
  });

  if (quickInvestigateBtn) {
    quickInvestigateBtn.addEventListener("click", () => {
      chatInput.value = "سایتم رو بررسی کن و در صورت وجود خطا گزارش بده";
      chatForm.dispatchEvent(new Event("submit"));
    });
  }

  // SVG icon from the sprite in index.html
  function icon(name, cls = "") {
    return `<svg class="ico${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  // Optional leading status icon for agent messages
  const MESSAGE_TONES = {
    success: "check-circle",
    error: "x-circle",
    warning: "alert",
    cancelled: "stop",
    shield: "shield-check",
  };

  function appendChatMessage(role, text, tone) {
    const row = document.createElement("div");
    row.className = `message-row ${role}-row`;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${role}-avatar`;
    avatar.innerHTML = icon(role === "agent" ? "compass" : "user");

    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${role}-bubble`;
    const toneIcon = MESSAGE_TONES[tone] ? `<span class="msg-tone msg-tone--${tone}">${icon(MESSAGE_TONES[tone])}</span>` : "";
    bubble.innerHTML = toneIcon + formatMarkdown(text);

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatFeed.appendChild(row);
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  // Server, log and incident text is data — escape before it reaches innerHTML.
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  window.escapeHtml = escapeHtml;

  function formatMarkdown(text) {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br/>");
  }

  // 5. Approval Card Component (§12.2)
  function renderApprovalCard(approval) {
    activeApprovalId = approval.id;
    approvalCardContainer.classList.remove("hidden");
    const isL3 = approval.riskLevel === "L3";
    const card = approval.card;

    approvalCardContainer.innerHTML = `
      <div class="approval-card ${isL3 ? "l3-card" : ""}" id="activeApprovalCard">
        <div class="approval-header">
          <div class="approval-title">
            ${icon(isL3 ? "siren" : "alert")}
            <span>نیاز به تأیید شما — ${escapeHtml(card.title_fa)}</span>
          </div>
          <span class="approval-risk-badge">${escapeHtml(approval.riskLevel)}</span>
        </div>

        <div class="approval-fields">
          <div class="approval-field-row">
            <span class="field-label">چه کاری:</span>
            <span class="field-value">${escapeHtml(card.what_fa)}</span>
          </div>
          <div class="approval-field-row">
            <span class="field-label">چرا:</span>
            <span class="field-value">${escapeHtml(card.why_fa)}</span>
          </div>
          <div class="approval-field-row">
            <span class="field-label">هزینه:</span>
            <span class="field-value" style="color: var(--cyan);">${escapeHtml(card.cost_fa)}</span>
          </div>
          <div class="approval-field-row">
            <span class="field-label">اثر:</span>
            <span class="field-value">${escapeHtml(card.impact_fa)}</span>
          </div>
          <div class="approval-field-row">
            <span class="field-label">بازگشت:</span>
            <span class="field-value">${escapeHtml(card.rollback_fa)}</span>
          </div>
          <div class="approval-field-row">
            <span class="field-label">معیار موفقیت:</span>
            <span class="field-value" style="color: var(--success);">${escapeHtml(card.successCriteria_fa)}</span>
          </div>
        </div>

        ${
          isL3
            ? `
          <div class="l3-confirm-box">
            <label for="l3TypedInput" style="font-size: 0.8rem; font-weight: bold; color: var(--danger);">
              تأیید امنیتی: برای ادامه، نام اپلیکیشن <code>${escapeHtml(approval.confirmationText)}</code> را دقیقاً تایپ کنید.
            </label>
            <input type="text" id="l3TypedInput" class="l3-input" placeholder="${escapeHtml(approval.confirmationText)}" />
          </div>
        `
            : ""
        }

        <div id="approvalCountdownSlot"></div>

        <div class="approval-actions" id="approvalActionButtons">
          <button id="btnApprove" class="btn btn-approve" ${isL3 ? "disabled" : ""}>
            ${icon("check")} تأیید و اجرا
          </button>
          <button id="btnReject" class="btn btn-reject">
            ${icon("x")} رد درخواست
          </button>
          <button id="btnExplain" class="btn btn-outline">
            ${icon("help")} توضیح بیشتر
          </button>
        </div>
      </div>
    `;

    // Handle L3 typing requirement
    if (isL3) {
      const l3Input = document.getElementById("l3TypedInput");
      const approveBtn = document.getElementById("btnApprove");
      l3Input.addEventListener("input", () => {
        if (l3Input.value.trim() === approval.confirmationText) {
          approveBtn.removeAttribute("disabled");
        } else {
          approveBtn.setAttribute("disabled", "true");
        }
      });
    }

    // Attach button listeners
    document.getElementById("btnApprove").addEventListener("click", () => handleApprove(approval));
    document.getElementById("btnReject").addEventListener("click", () => handleReject(approval.id));
    document.getElementById("btnExplain").addEventListener("click", () => {
      chatInput.value = `لطفاً درباره اقدام «${card.title_fa}» و دلایل آن با جزئیات توضیح بده.`;
      chatForm.dispatchEvent(new Event("submit"));
    });

    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  async function handleApprove(approval) {
    const isL3 = approval.riskLevel === "L3";
    const typed = isL3 ? document.getElementById("l3TypedInput")?.value.trim() : undefined;

    try {
      const res = await fetch(`/api/approvals/${approval.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typed }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert("خطا در تأیید: " + data.error);
        return;
      }

      if (isL3) {
        // Show 10-second cancel window countdown (§7.1)
        const countdownSlot = document.getElementById("approvalCountdownSlot");
        const actionSlot = document.getElementById("approvalActionButtons");
        actionSlot.innerHTML = `<button id="btnCancelL3" class="btn btn-danger">${icon("stop")} لغو فوری عملیات</button>`;

        let remainingSec = 10;
        countdownSlot.innerHTML = `
          <div class="countdown-box">
            <span>${icon("timer")} پنجره لغو فعال است؛ اجرا تا <strong id="countdownSec">${remainingSec.toLocaleString("fa-IR")}</strong> ثانیه دیگر</span>
            <span class="pulse-dot"></span>
          </div>
        `;

        cancelCountdownTimer = setInterval(() => {
          remainingSec--;
          const secEl = document.getElementById("countdownSec");
          if (secEl) secEl.textContent = remainingSec.toLocaleString("fa-IR");
          if (remainingSec <= 0) {
            clearInterval(cancelCountdownTimer);
            approvalCardContainer.classList.add("hidden");
            appendChatMessage("agent", "اقدام سطح L3 از گیت امنیتی عبور کرد و اجرا شد.", "success");
            fetchState();
          }
        }, 1000);

        document.getElementById("btnCancelL3").addEventListener("click", async () => {
          clearInterval(cancelCountdownTimer);
          await fetch(`/api/approvals/${approval.id}/cancel`, { method: "POST" });
          approvalCardContainer.classList.add("hidden");
          appendChatMessage("agent", "عملیات در پنجرهٔ ۱۰ ثانیه‌ای لغو شد و هیچ تغییری اعمال نشد.", "cancelled");
        });
      } else {
        approvalCardContainer.classList.add("hidden");
        appendChatMessage("agent", "درخواست تأیید و توسط موتور سیاست‌ها اجرا شد.", "success");
        setTimeout(fetchState, 1000);
      }
    } catch (err) {
      alert("خطا در تأیید: " + err.message);
    }
  }

  async function handleReject(id) {
    try {
      await fetch(`/api/approvals/${id}/reject`, { method: "POST" });
      approvalCardContainer.classList.add("hidden");
      appendChatMessage("agent", "درخواست را رد کردید؛ هیچ تغییری اعمال نشد.", "error");
    } catch (err) {}
  }

  // 6. Incident Renderer (§10.7)
  function renderIncident(inc) {
    if (!inc || !inc.hypotheses || inc.hypotheses.length === 0) {
      incidentEmptyState.classList.remove("hidden");
      incidentActiveView.classList.add("hidden");
      tabIncidentBadge.classList.add("hidden");
      incidentStateVal.innerHTML = '<span class="badge-clean">بدون حادثه فعال</span>';
      return;
    }

    incidentEmptyState.classList.add("hidden");
    incidentActiveView.classList.remove("hidden");
    tabIncidentBadge.classList.remove("hidden");
    incidentStateVal.innerHTML = `<span class="text-danger" style="font-weight: bold;">${icon("alert")} رخداد فعال</span>`;

    const topHyp = inc.hypotheses[0];

    incidentActiveView.innerHTML = `
      <div class="incident-card-top">
        <div class="incident-header-row">
          <div class="incident-title">
            ${icon("siren")}<span>حادثه:</span>
            <span>${escapeHtml(inc.symptom)}</span>
          </div>
          <span class="confidence-tag">وضعیت: ${inc.status === "resolved" ? "برطرف شد" : "در حال پیگیری"}</span>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.4rem;">
          پنجره زمانی رخداد: ${new Date(inc.window.start).toLocaleTimeString("fa-IR")} تا ${new Date(inc.window.end).toLocaleTimeString("fa-IR")}
        </p>
      </div>

      <div style="margin-top: 1rem;">
        <h4 class="section-heading">${icon("target")} علت‌های محتمل، به ترتیب احتمال</h4>
        
        ${inc.hypotheses
          .map(
            (h, i) => `
          <div class="hypothesis-item">
            <div class="hyp-header">
              <span class="hyp-title"><span class="hyp-rank">${(i + 1).toLocaleString("fa-IR")}</span>${escapeHtml(h.title_fa)}</span>
              <span class="confidence-tag">اطمینان: ${h.confidence === "high" ? "بالا" : h.confidence === "medium" ? "متوسط" : "پایین"}</span>
            </div>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">${escapeHtml(h.explain_fa)}</p>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.35rem;">شواهد استنادشده:</div>
            <div>
              ${h.evidence_for.map((ev) => `<span class="evidence-tag">${escapeHtml(ev)}</span>`).join("")}
            </div>
          </div>
        `
          )
          .join("")}
      </div>

      ${
        inc.rejected && inc.rejected.length > 0
          ? `
        <div style="margin-top: 1rem;">
          <h4 style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 0.4rem;">فرضیه‌های ردشده</h4>
          ${inc.rejected
            .map(
              (r) => `
            <div style="font-size: 0.8rem; color: var(--text-muted); padding: 0.35rem 0; border-bottom: 1px dashed var(--border-subtle);">
              • <strong>${escapeHtml(r.title_fa)}</strong> — ${escapeHtml(r.reason_fa)}
            </div>
          `
            )
            .join("")}
        </div>
      `
          : ""
      }

      <div class="tech-details-toggle" id="toggleFixBrief" role="button" tabindex="0" aria-expanded="false">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600;">
          <span class="toggle-label">${icon("file")} جزئیات فنی و خلاصهٔ اصلاح برای ایجنت کدنویس</span>
          ${icon("chevron", "toggle-chevron")}
        </div>
        <div id="fixBriefContent" class="hidden">
          <pre class="fix-brief-pre" id="fixBriefPre">در حال بارگذاری…</pre>
        </div>
      </div>
    `;

    // Toggle Fix Brief
    const toggleBtn = document.getElementById("toggleFixBrief");
    const briefContent = document.getElementById("fixBriefContent");
    const briefPre = document.getElementById("fixBriefPre");

    toggleBtn.addEventListener("click", async () => {
      const isHidden = briefContent.classList.contains("hidden");
      toggleBtn.classList.toggle("is-open", isHidden);
      toggleBtn.setAttribute("aria-expanded", String(isHidden));
      if (isHidden) {
        briefContent.classList.remove("hidden");
        const res = await fetch("/api/state");
        const st = await res.json();
        briefPre.textContent = JSON.stringify(st.currentFixBrief || {}, null, 2);
      } else {
        briefContent.classList.add("hidden");
      }
    });
    toggleBtn.addEventListener("keydown", (e) => {
      if (e.target === toggleBtn && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        toggleBtn.click();
      }
    });
  }

  // 7. Audit Renderer (§7.4)
  const AUDIT_EVENT_LABELS = {
    requested: "درخواست",
    approved: "تأیید شد",
    rejected: "رد شد",
    cancelled: "لغو شد",
    executed: "اجرا شد",
    auto_executed: "اجرای خودکار",
    denied: "مسدود شد",
  };
  const CALLER_LABELS = {
    user: "کاربر",
    agent: "سُکان",
    probe: "پروب سلامت",
    standing_approval: "مجوز دائمی",
  };

  function renderAudit(records) {
    if (!auditTableBody) return;
    auditTableBody.innerHTML = records
      .slice(-15)
      .reverse()
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(Number(r.seq).toLocaleString("fa-IR"))}</td>
          <td>${new Date(r.timestamp).toLocaleTimeString("fa-IR")}</td>
          <td><span class="badge ${r.event === "executed" || r.event === "auto_executed" ? "badge-success" : r.event === "denied" ? "badge-danger" : "badge-warning"}">${escapeHtml(AUDIT_EVENT_LABELS[r.event] || r.event)}</span></td>
          <td><code>${escapeHtml(r.tool)}</code></td>
          <td><span class="badge ${r.riskLevel === "L3" ? "badge-danger" : r.riskLevel === "L2" ? "badge-warning" : "badge-clean"}">${escapeHtml(r.riskLevel)}</span></td>
          <td>${escapeHtml(CALLER_LABELS[r.caller] || r.caller)}</td>
          <td><code style="font-size: 0.75rem;">${escapeHtml(r.approvalId || "-")}</code></td>
          <td>${r.success ? `<span class="result-ok">${icon("check")} موفق</span>` : r.success === false ? `<span class="result-fail">${icon("x")} ناموفق</span>` : `<span class="text-muted">${icon("timer")} در انتظار</span>`}</td>
        </tr>
      `
      )
      .join("");
  }

  // 8. Scenario Runner Global Hook (§16)
  window.runScenario = async function (type) {
    if (type === "deploy") {
      chatInput.value = "این پروژه رو با پلن پیشنهادی دیپلوی کن";
      chatForm.dispatchEvent(new Event("submit"));
    } else if (type === "error500") {
      await fetch("/api/demo/scenario-2-error500", { method: "POST" });
      chatInput.value = "سایتم خطای ۵۰۰ میده، بررسی کن";
      chatForm.dispatchEvent(new Event("submit"));
    } else if (type === "leak") {
      await fetch("/api/demo/scenario-3-leak", { method: "POST" });
      chatInput.value = "مصرف رم بالاست و سایت داره کند میشه، عارضه‌یابی کن";
      chatForm.dispatchEvent(new Event("submit"));
    } else if (type === "security") {
      chatInput.value = "اپلیکیشن رو حذف کن";
      chatForm.dispatchEvent(new Event("submit"));
    } else if (type === "injection") {
      await fetch("/api/demo/scenario-injection", { method: "POST" });
      appendChatMessage("agent", "یک خط لاگ حاوی تلاش برای تزریق پرامپت ثبت شد. این متن فقط داده است و موتور امنیتی سُکان هیچ اختیار اجرایی برای آن قائل نشد.", "shield");
    } else if (type === "tamper") {
      const res = await fetch("/api/demo/scenario-tamper-test", { method: "POST" });
      const data = await res.json();
      appendChatMessage("agent", `نتیجهٔ تست دستکاری: ${data.message} — کد خطا: \`${data.code}\``, "shield");
      fetchState();
    }
  };
});
