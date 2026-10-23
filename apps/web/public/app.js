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
  let currentMemoryLimitMB = 512;

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
          const limit = currentMemoryLimitMB || 512;
          const pct = Math.min(100, Math.round((p.heapUsed / limit) * 100));
          ramProgressBar.style.width = `${pct}%`;
          ramLimitText.textContent = `از سقف ${Number(limit).toLocaleString("fa-IR")} مگابایت پلن (${pct.toLocaleString("fa-IR")}٪)`;
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

    evtSource.addEventListener("build_pipeline", (e) => {
      try {
        const bp = JSON.parse(e.data);
        updatePipelineStepper(bp);
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

  function updatePipelineStepper(pipeline) {
    if (!pipeline) return;
    const bannerText = document.getElementById("pipelineStatusText");
    if (bannerText && pipeline.message_fa) {
      bannerText.textContent = pipeline.message_fa;
    }

    for (let step = 1; step <= 4; step++) {
      const stepEl = document.getElementById(`pipeStep${step}`);
      const lineEl = document.getElementById(`pipeLine${step}`);
      if (!stepEl) continue;

      const circle = stepEl.querySelector(".step-circle");
      stepEl.classList.remove("completed", "active", "running");
      if (lineEl) lineEl.classList.remove("completed", "active");

      if (pipeline.status === "completed" || step < pipeline.step) {
        stepEl.classList.add("completed");
        if (circle) circle.innerHTML = icon("check");
        if (lineEl) lineEl.classList.add("completed");
      } else if (step === pipeline.step) {
        stepEl.classList.add("active");
        if (pipeline.status === "running") {
          stepEl.classList.add("running");
          if (circle) circle.innerHTML = icon("zap");
        } else {
          if (circle) circle.innerHTML = icon("check");
        }
        if (lineEl) lineEl.classList.add("active");
      } else {
        if (circle) circle.textContent = step.toLocaleString("fa-IR");
      }
    }
  }

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

        if (data.app.memoryLimitMB) {
          currentMemoryLimitMB = data.app.memoryLimitMB;
        }

        if (data.app.memoryLimitMB && data.app.heapUsedMB) {
          const limit = data.app.memoryLimitMB;
          const used = data.app.heapUsedMB;
          const pct = Math.min(100, Math.round((used / limit) * 100));
          ramLimitText.textContent = `از سقف ${Number(limit).toLocaleString("fa-IR")} مگابایت پلن (${pct.toLocaleString("fa-IR")}٪)`;
          ramProgressBar.style.width = `${pct}%`;
          ramProgressBar.classList.toggle("is-critical", pct > 80);
        }

        const planNameEl = document.querySelector(".app-plan-badge .plan-name");
        const planSpecEl = document.querySelector(".app-plan-badge .plan-spec");
        if (planNameEl && data.app.plan) planNameEl.textContent = data.app.plan;
        if (planSpecEl && data.app.memoryLimitMB) {
          const cores = data.app.planDetails?.cpuCores || (data.app.memoryLimitMB >= 1024 ? 1.0 : 0.5);
          planSpecEl.textContent = `${Number(data.app.memoryLimitMB).toLocaleString("fa-IR")} مگابایت رم · ${Number(cores).toLocaleString("fa-IR")} هسته`;
        }
      }

      if (data.buildPipeline) {
        updatePipelineStepper(data.buildPipeline);
      }

      // Render Audit
      if (data.audit) renderAudit(data.audit);

      // Render Incident
      renderIncident(data.currentIncident || null);

      // Render SRE Shields (§10, §Hackathon)
      if (data.predictiveShield) renderPredictiveShield(data.predictiveShield);
      if (data.chaosVaccine) renderChaosVaccine(data.chaosVaccine);
      if (data.hibernation) renderHibernation(data.hibernation);
    } catch (err) {}
  }
  fetchState();
  setInterval(fetchState, 4000);

  // Helper: Append thinking indicator
  function appendThinkingIndicator() {
    const row = document.createElement("div");
    row.className = "message-row agent-row agent-thinking-row";
    row.id = "agentThinkingIndicator";

    const avatar = document.createElement("div");
    avatar.className = "avatar agent-avatar";
    avatar.innerHTML = icon("compass");

    const bubble = document.createElement("div");
    bubble.className = "agent-thinking-bubble";
    bubble.innerHTML = `
      <span>سُکان در حال تحلیل تله‌متری و بررسی است</span>
      <div class="thinking-dots">
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
      </div>
    `;

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatFeed.appendChild(row);
    chatFeed.scrollTop = chatFeed.scrollHeight;
    return row;
  }

  function removeThinkingIndicator(row) {
    if (row && row.parentNode) {
      row.remove();
    } else {
      const el = document.getElementById("agentThinkingIndicator");
      if (el) el.remove();
    }
  }

  // Toast notification helper
  function showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "sokan-toast";
    toast.innerHTML = `<svg class="ico" aria-hidden="true" style="color: var(--mint);"><use href="#i-check-circle"/></svg><span>${escapeHtml(msg)}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = "opacity 0.4s ease, transform 0.4s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  function triggerConsoleSyncPulse(message) {
    const appCard = document.querySelector(".app-card");
    if (appCard) {
      appCard.classList.remove("console-pulse-highlight");
      void appCard.offsetWidth; // trigger reflow
      appCard.classList.add("console-pulse-highlight");
    }
    if (message) showToast(message);
  }

  // 4. Chat Handler
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    appendChatMessage("user", text);

    // Auto-collapse quick chips after user engagement to save vertical space
    const quickChipsEl = document.querySelector(".quick-chips");
    if (quickChipsEl && !quickChipsEl.classList.contains("collapsed")) {
      quickChipsEl.classList.add("collapsed");
    }

    const thinkingRow = appendThinkingIndicator();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      removeThinkingIndicator(thinkingRow);

      if (data.reply_fa) {
        appendChatMessage("agent", data.reply_fa, null, data.aiProvider);
      }

      if (data.approval) {
        renderApprovalCard(data.approval);
      }

      if (data.incident) {
        renderIncident(data.incident);
        // Switch to incident tab so user doesn't miss the diagnostic
        const incTabBtn = document.querySelector('.tab-btn[data-tab="tab-incident"]');
        if (incTabBtn && !incTabBtn.classList.contains("active")) {
          incTabBtn.click();
        }
      }
    } catch (err) {
      removeThinkingIndicator(thinkingRow);
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

  function appendChatMessage(role, text, tone, aiProvider) {
    const row = document.createElement("div");
    row.className = `message-row ${role}-row`;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${role}-avatar`;
    avatar.innerHTML = icon(role === "agent" ? "compass" : "user");

    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${role}-bubble`;
    const toneIcon = MESSAGE_TONES[tone] ? `<span class="msg-tone msg-tone--${tone}">${icon(MESSAGE_TONES[tone])}</span>` : "";
    const providerBadge = (role === "agent" && aiProvider)
      ? `<div class="msg-ai-tag">${icon("cpu")} ${escapeHtml(aiProvider)}</div>`
      : "";
    bubble.innerHTML = providerBadge + toneIcon + formatMarkdown(text);

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
    const raw = String(text ?? "");
    const lines = raw.split("\n");
    const htmlLines = lines.map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("### ")) {
        return `<div class="chat-md-heading">${icon("target")}<span>${escapeHtml(trimmed.slice(4))}</span></div>`;
      }
      if (trimmed.startsWith("• ") || trimmed.startsWith("- ")) {
        const itemContent = escapeHtml(trimmed.slice(2))
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/`([^`]+)`/g, '<code dir="ltr">$1</code>');
        return `<div class="chat-md-bullet"><span class="chat-md-bullet-dot">•</span><span>${itemContent}</span></div>`;
      }
      return escapeHtml(line)
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, '<code dir="ltr">$1</code>');
    });

    return htmlLines.join("<br/>");
  }

  // 5. Approval Card Component (§12.2, ISS-04)
  function renderApprovalCard(approval) {
    activeApprovalId = approval.id;
    approvalCardContainer.classList.remove("hidden");
    const isL3 = approval.riskLevel === "L3";
    const card = approval.card;

    // Helper: format env vars with collapsible badge list to prevent cognitive overload
    let formattedWhyHtml = escapeHtml(card.why_fa);
    const envMatch = card.why_fa.match(/(?:متغیرهای الزامی:|متغیرهای محیطی:)(.*)/);
    if (envMatch && envMatch[1]) {
      const prefixText = card.why_fa.slice(0, envMatch.index).trim();
      const envList = envMatch[1].split(/[,،]+/).map((s) => s.trim()).filter(Boolean);
      if (envList.length > 0) {
        const visibleList = envList.slice(0, 2);
        const hiddenList = envList.slice(2);
        const visibleBadges = visibleList.map((e) => `<span class="env-pill" dir="ltr">${escapeHtml(e)}</span>`).join("");
        let extraBadgesHtml = "";
        if (hiddenList.length > 0) {
          const hiddenBadges = hiddenList.map((e) => `<span class="env-pill" dir="ltr">${escapeHtml(e)}</span>`).join("");
          extraBadgesHtml = `
            <button type="button" class="btn-more-envs" id="btnToggleMoreEnvs" aria-expanded="false">+${hiddenList.length} متغیر دیگر</button>
            <span class="env-extra-pills hidden" id="extraEnvsBox">${hiddenBadges}</span>
          `;
        }
        formattedWhyHtml = `
          <span>${escapeHtml(prefixText)}</span>
          <div class="env-pill-container">
            <span class="env-label-prefix">متغیرهای الزامی:</span>
            ${visibleBadges}
            ${extraBadgesHtml}
          </div>
        `;
      }
    }

    approvalCardContainer.innerHTML = `
      <div class="approval-card ${isL3 ? "l3-card" : ""}" id="activeApprovalCard">
        <div class="approval-header">
          <div class="approval-title">
            ${icon(isL3 ? "siren" : "alert")}
            <span>نیاز به تأیید شما — ${escapeHtml(card.title_fa)}</span>
          </div>
          <span class="approval-risk-badge">${escapeHtml(approval.riskLevel)}</span>
        </div>

        <div class="approval-fields-compact">
          <div class="approval-field-row">
            <span class="field-label">اقدام:</span>
            <span class="field-value">${escapeHtml(card.what_fa)}</span>
          </div>
          <div class="approval-field-row">
            <span class="field-label">دلیل:</span>
            <span class="field-value">${formattedWhyHtml}</span>
          </div>
          <div class="approval-field-row">
            <span class="field-label">هزینه:</span>
            <span class="field-value approval-cost-val" style="color: var(--cyan);">${escapeHtml(card.cost_fa)}</span>
          </div>
        </div>

        <!-- Collapsible Technical Details (ISS-04) -->
        <button type="button" class="approval-details-toggle" id="btnToggleApprovalDetails" aria-expanded="false">
          <span class="toggle-text">${icon("info")} جزئیات اثر بر پایداری، بازگشت و معیار موفقیت</span>
          ${icon("chevron", "toggle-chevron")}
        </button>

        <div class="approval-details-drawer hidden" id="approvalDetailsDrawer">
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
            <input type="text" id="l3TypedInput" class="l3-input" placeholder="${escapeHtml(approval.confirmationText)}" aria-label="تأیید نام اپلیکیشن" dir="ltr" />
          </div>
        `
            : ""
        }

        <div id="approvalCountdownSlot"></div>

        <div class="approval-actions" id="approvalActionButtons">
          <button id="btnApprove" class="btn btn-approve" ${isL3 ? "disabled" : ""} tabindex="0">
            ${icon("check")} تأیید و اجرا
          </button>
          <button id="btnReject" class="btn btn-reject" tabindex="0">
            ${icon("x")} رد درخواست
          </button>
          <button id="btnExplain" class="btn btn-outline" tabindex="0" title="مشاهده تحلیل کامل و دریافت پرامپت راهنما">
            ${icon("help")} توضیح بیشتر
          </button>
        </div>
      </div>
    `;

    // Attach collapsible more envs toggle
    const btnToggleMore = document.getElementById("btnToggleMoreEnvs");
    const extraEnvsBox = document.getElementById("extraEnvsBox");
    if (btnToggleMore && extraEnvsBox) {
      btnToggleMore.addEventListener("click", () => {
        const isHidden = extraEnvsBox.classList.contains("hidden");
        extraEnvsBox.classList.toggle("hidden", !isHidden);
        btnToggleMore.textContent = isHidden ? "بستن لیست" : `+${extraEnvsBox.children.length} متغیر دیگر`;
        btnToggleMore.setAttribute("aria-expanded", String(isHidden));
      });
    }

    // Attach technical details toggle
    const toggleDetailsBtn = document.getElementById("btnToggleApprovalDetails");
    const detailsDrawer = document.getElementById("approvalDetailsDrawer");
    if (toggleDetailsBtn && detailsDrawer) {
      toggleDetailsBtn.addEventListener("click", () => {
        const isHidden = detailsDrawer.classList.contains("hidden");
        detailsDrawer.classList.toggle("hidden", !isHidden);
        toggleDetailsBtn.classList.toggle("is-open", isHidden);
        toggleDetailsBtn.setAttribute("aria-expanded", String(isHidden));
      });
    }

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
      // 1. Expand technical details inside the card
      if (detailsDrawer && detailsDrawer.classList.contains("hidden")) {
        detailsDrawer.classList.remove("hidden");
        if (toggleDetailsBtn) {
          toggleDetailsBtn.classList.add("is-open");
          toggleDetailsBtn.setAttribute("aria-expanded", "true");
        }
      }
      // 2. Query assistant for full explanation
      chatInput.value = `لطفاً درباره اقدام «${card.title_fa}» و دلایل آن با جزئیات توضیح بده.`;
      showToast("در حال دریافت تحلیل و مستندات SRE از سُکان...");
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
        appendChatMessage("agent", "خطا در تأیید درخواست: " + (data.error || "خطای ناشناخته"), "error");
        return;
      }

      if (isL3) {
        // Show 10-second cancel window countdown with prominent visual progress bar (§7.1, ISS-04)
        const countdownSlot = document.getElementById("approvalCountdownSlot");
        const actionSlot = document.getElementById("approvalActionButtons");
        actionSlot.innerHTML = `<button id="btnCancelL3" class="btn btn-danger" tabindex="0">${icon("stop")} لغو فوری عملیات</button>`;

        let remainingSec = 10;
        countdownSlot.innerHTML = `
          <div class="countdown-box">
            <span>${icon("timer")} پنجره لغو فعال است؛ اجرا تا <strong id="countdownSec">${remainingSec.toLocaleString("fa-IR")}</strong> ثانیه دیگر</span>
            <span class="pulse-dot"></span>
          </div>
          <div class="cancel-timer-bar" role="progressbar" aria-valuenow="10" aria-valuemin="0" aria-valuemax="10">
            <div class="cancel-timer-fill" id="cancelTimerFill" style="width: 100%;"></div>
          </div>
        `;

        cancelCountdownTimer = setInterval(() => {
          remainingSec--;
          const secEl = document.getElementById("countdownSec");
          const fillEl = document.getElementById("cancelTimerFill");
          if (secEl) secEl.textContent = remainingSec.toLocaleString("fa-IR");
          if (fillEl) fillEl.style.width = (remainingSec * 10) + "%";

          if (remainingSec <= 0) {
            clearInterval(cancelCountdownTimer);
            approvalCardContainer.classList.add("hidden");
            appendChatMessage("agent", "اقدام سطح L3 از گیت امنیتی عبور کرد و اجرا شد.", "success");
            triggerConsoleSyncPulse("اپلیکیشن طبق تأییدیه حذف گردید.");
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
        triggerConsoleSyncPulse("دستور استقرار/تنظیمات با موفقیت روی سرور اعمال شد.");
        setTimeout(fetchState, 1000);
      }
    } catch (err) {
      appendChatMessage("agent", "خطا در برقراری ارتباط هنگام تأیید: " + err.message, "error");
    }
  }

  async function handleReject(id) {
    try {
      await fetch(`/api/approvals/${id}/reject`, { method: "POST" });
      approvalCardContainer.classList.add("hidden");
      appendChatMessage("agent", "درخواست را رد کردید؛ هیچ تغییری اعمال نشد.", "error");
    } catch (err) {}
  }

  // Global Keyboard Shortcuts (Escape to dismiss approval or cancel L3)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const cardSlot = document.getElementById("approvalCardContainer");
      if (cardSlot && !cardSlot.classList.contains("hidden")) {
        const cancelL3Btn = document.getElementById("btnCancelL3");
        if (cancelL3Btn) {
          cancelL3Btn.click();
        } else if (activeApprovalId) {
          handleReject(activeApprovalId);
        }
      }
    }
  });

  // 6. Incident Renderer (§10.7)
  let lastIncidentKey = "";
  function renderIncident(inc) {
    if (!inc || !inc.hypotheses || inc.hypotheses.length === 0) {
      if (lastIncidentKey !== "empty") {
        lastIncidentKey = "empty";
        incidentEmptyState.classList.remove("hidden");
        incidentActiveView.classList.add("hidden");
        tabIncidentBadge.classList.add("hidden");
        incidentStateVal.innerHTML = '<span class="badge-clean">بدون حادثه فعال</span>';
      }
      return;
    }

    const currentKey = `${inc.id}_${inc.status}_${inc.verification ? inc.verification.message_fa : ""}_${inc.hypotheses.length}`;
    if (currentKey === lastIncidentKey) {
      return;
    }
    lastIncidentKey = currentKey;

    incidentEmptyState.classList.add("hidden");
    incidentActiveView.classList.remove("hidden");

    const isResolved = inc.status === "resolved";
    if (isResolved) {
      incidentStateVal.innerHTML = `<span class="text-success" style="font-weight: bold;">${icon("check-circle")} برطرف شد</span>`;
      tabIncidentBadge.classList.add("hidden");
    } else {
      incidentStateVal.innerHTML = `<span class="text-danger" style="font-weight: bold;">${icon("alert")} رخداد فعال</span>`;
      tabIncidentBadge.classList.remove("hidden");
    }

    const topHyp = inc.hypotheses[0];

    incidentActiveView.innerHTML = `
      <div class="incident-card-top">
        <div class="incident-header-row">
          <div class="incident-title">
            ${icon(isResolved ? "check-circle" : "siren")}<span>حادثه:</span>
            <span>${escapeHtml(inc.symptom)}</span>
          </div>
          <span class="confidence-tag" style="${isResolved ? "background: rgba(135,252,196,0.15); color: var(--mint);" : ""}">وضعیت: ${isResolved ? "برطرف شد" : "در حال پیگیری"}</span>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.4rem;">
          پنجره زمانی رخداد: ${new Date(inc.window.start).toLocaleTimeString("fa-IR")} تا ${new Date(inc.window.end).toLocaleTimeString("fa-IR")}
        </p>
      </div>

      ${
        inc.verification
          ? `
        <div class="verification-box" style="margin-top: 0.85rem; background: rgba(135, 252, 196, 0.12); border: 1px solid var(--mint); border-radius: var(--radius-md); padding: 0.75rem 1rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--mint); font-weight: 700; font-size: 0.9rem;">
            ${icon("check-circle")}<span>نتیجه راستی‌آزمایی SRE (Verification Succeeded)</span>
          </div>
          <p style="margin: 0.35rem 0 0; font-size: 0.85rem; color: var(--text);">${escapeHtml(inc.verification.message_fa)}</p>
          ${
            inc.verification.snapshot
              ? `
            <div style="margin-top: 0.5rem; display: flex; gap: 1rem; font-size: 0.8rem; color: #d0d7de; flex-wrap: wrap;">
              <span>تعداد خطاهای لاگ: <strong style="color: var(--mint);">${Number(inc.verification.snapshot.errorsPerMinute || 0).toLocaleString("fa-IR")}</strong></span>
              <span>پروب‌های موفق: <strong style="color: var(--mint);">${Number(inc.verification.snapshot.probeOk || 0).toLocaleString("fa-IR")} از ${Number(inc.verification.snapshot.probeTotal || 0).toLocaleString("fa-IR")}</strong></span>
              <span>اوج حافظه: <strong style="color: var(--mint);">${Number(inc.verification.snapshot.memoryPeakPct || 0).toLocaleString("fa-IR")}٪</strong></span>
            </div>
          `
              : ""
          }
        </div>
      `
          : ""
      }

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

      <button type="button" class="tech-details-toggle" id="toggleFixBrief" aria-expanded="false" aria-controls="fixBriefContent">
        <span class="toggle-label" style="display: flex; align-items: center; gap: 0.4rem;">${icon("file")} جزئیات فنی و خلاصهٔ اصلاح برای ایجنت کدنویس</span>
        ${icon("chevron", "toggle-chevron")}
      </button>
      <div id="fixBriefContent" class="hidden" style="margin-top: 0.5rem;">
        <pre class="fix-brief-pre" id="fixBriefPre">در حال بارگذاری…</pre>
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
      chatInput.value = "این پروژه رو دیپلوی کن";
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
    } else if (type === "chaos") {
      chatInput.value = "آزمون واکسیناسیون ابری و تاب‌آوری برنامه رو اجرا کن";
      chatForm.dispatchEvent(new Event("submit"));
    } else if (type === "predictive") {
      chatInput.value = "وضعیت سپر پیش‌دستانه امواج ترافیک و سرریز رم رو بررسی کن";
      chatForm.dispatchEvent(new Event("submit"));
    } else if (type === "hibernation") {
      chatInput.value = "وضعیت بهینه‌سازی خواب زمستانی و صرفه‌جویی ریالی کانتینر چطوره؟";
      chatForm.dispatchEvent(new Event("submit"));
    } else if (type === "buildtriage") {
      chatInput.value = "تریاژ هوشمند خطاهای لاگ بیلد استقرار رو نشون بده";
      chatForm.dispatchEvent(new Event("submit"));
    }
  };

  // 9. SRE Shields Dynamic Renderers (§10, §Hackathon)
  function renderPredictiveShield(shield) {
    const riskBadge = document.getElementById("shieldRiskBadge");
    const alertText = document.getElementById("shieldAlertText");
    const slopeVal = document.getElementById("shieldSlopeVal");
    const timeVal = document.getElementById("shieldTimeToOom");
    const actionText = document.getElementById("shieldActionText");

    if (riskBadge) {
      riskBadge.textContent = shield.riskLevel === "critical" ? "بحرانی 🚨" : shield.riskLevel === "warning" ? "هشدار ⚠️" : "پایدار و ایمن ✅";
      riskBadge.className = `badge ${shield.riskLevel === "critical" ? "badge-danger" : shield.riskLevel === "warning" ? "badge-warning" : "badge-success"}`;
    }
    if (alertText && shield.alert_fa) alertText.textContent = shield.alert_fa;
    if (slopeVal) slopeVal.textContent = `${Number(shield.memorySlopeMBPerMin || 0).toLocaleString("fa-IR")} MB/min`;
    if (timeVal) timeVal.textContent = shield.estimatedMinutesToImpact ? `حدود ${Number(shield.estimatedMinutesToImpact).toLocaleString("fa-IR")} دقیقه` : "نامحدود (امن)";
    if (actionText && shield.recommendedAction_fa) actionText.textContent = shield.recommendedAction_fa;
  }

  function renderChaosVaccine(res) {
    const scoreNum = document.getElementById("chaosScoreNum");
    const verdictBadge = document.getElementById("chaosVerdictBadge");
    const adviceText = document.getElementById("chaosAdviceText");
    const expList = document.getElementById("chaosExperimentsList");

    if (scoreNum && res.resilienceScore !== undefined) scoreNum.textContent = Number(res.resilienceScore).toLocaleString("fa-IR");
    if (verdictBadge && res.verdict_fa) verdictBadge.textContent = res.verdict_fa;
    if (adviceText && res.remediationAdvice_fa) adviceText.textContent = res.remediationAdvice_fa;
    if (expList && res.experiments) {
      expList.innerHTML = res.experiments
        .map((e) => `<div class="chaos-exp-item"><svg class="ico" style="color: ${e.passed ? "var(--mint)" : "var(--warning)"};" aria-hidden="true"><use href="#i-${e.passed ? "check" : "alert"}"/></svg><span>${escapeHtml(e.name)}: ${escapeHtml(e.observation_fa)}</span></div>`)
        .join("");
    }
  }

  function renderHibernation(hib) {
    const savingsVal = document.getElementById("hibernationSavingsVal");
    const percentVal = document.getElementById("hibernationPercentVal");
    if (savingsVal && hib.monthlySavingsTomans !== undefined) {
      savingsVal.textContent = `${Number(hib.monthlySavingsTomans).toLocaleString("fa-IR")} تومان`;
    }
    if (percentVal && hib.savingsPercent !== undefined) {
      percentVal.textContent = `${Number(hib.savingsPercent).toLocaleString("fa-IR")}٪ کل پلن`;
    }
  }

  window.generateAndShowPostmortem = async function() {
    const area = document.getElementById("postmortemOutputArea");
    const pre = document.getElementById("postmortemPreText");
    if (!area || !pre) return;
    area.classList.remove("hidden");
    pre.textContent = "در حال تولید خودکار گزارش کالبدشکافی SRE از موتور تحلیل حادثه...";
    try {
      const res = await fetch("/api/incident/postmortem");
      const pm = await res.json();
      pre.textContent = pm.markdown || JSON.stringify(pm, null, 2);
    } catch (e) {
      pre.textContent = "خطا در برقراری ارتباط با سرور: " + e.message;
    }
  };
});
