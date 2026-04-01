// === DOM Refs ===
const form = document.querySelector("#planner-form");
const threadIdInput = document.querySelector("#thread-id");
const messageInput = document.querySelector("#message");
const submitButton = document.querySelector("#submit-button");
const statusBar = document.querySelector("#status-bar");
const welcomeScreen = document.querySelector("#welcome-screen");
const messageArea = document.querySelector("#message-area");
const messageList = document.querySelector("#message-list");
const threadList = document.querySelector("#thread-list");
const threadSearch = document.querySelector("#thread-search");
const showActiveButton = document.querySelector("#show-active");
const showArchivedButton = document.querySelector("#show-archived");
const newThreadBtn = document.querySelector("#new-thread-btn");
const chatTitle = document.querySelector("#chat-title");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebar = document.querySelector("#sidebar");
const refreshLiveButton = document.querySelector("#refresh-live-btn");

// === State ===
let lastThreadId = "";
let currentThreadSelection = "";
let currentArchiveFilter = false;
let currentSearchQuery = "";
let currentProfile = null;
let currentLiveContext = "";
let currentRouteContext = "";
const INLINE_NEARBY_RADIUS_METERS = 1000;

// === Utilities ===
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c] || c));
}

function normalizeDisplayText(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => typeof item === "string" ? item : item?.text ?? "")
        .filter(Boolean)
        .join("\n\n")
        .trim() || value;
    }
  } catch {}
  return value;
}

function splitReportParagraphs(text) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function formatPaceLabel(v) {
  return { relaxed: "松弛", balanced: "均衡", packed: "紧凑" }[v] || v || "暂无";
}

function formatStyleLabel(v) {
  return { budget: "预算友好", balanced: "平衡体验", premium: "品质优先" }[v] || v || "暂无";
}

function formatTimeOfDayLabel(v) {
  return { morning: "上午", afternoon: "下午", evening: "晚上" }[v] || v || "";
}

function formatMinutes(v) {
  return typeof v === "number" ? `${v} 分钟` : "暂无";
}

function formatDateLabel(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatPoiType(v) {
  return v ? String(v).split("|")[0] : "类型未知";
}

// === Badge Logic ===
function getOptionBadgeMap(comparisons = []) {
  const map = new Map();
  const budgets = comparisons.map((c, i) => ({ i, t: c?.budget?.total })).filter((x) => typeof x.t === "number");
  const mobility = comparisons.map((c, i) => ({ i, m: c?.routeMetrics?.averagePreferredMinutesPerDay })).filter((x) => typeof x.m === "number");

  const cheapest = budgets.sort((a, b) => a.t - b.t)[0];
  const easiest = mobility.sort((a, b) => a.m - b.m)[0];

  if (cheapest) map.set(cheapest.i, [...(map.get(cheapest.i) || []), "最省钱"]);
  if (easiest) map.set(easiest.i, [...(map.get(easiest.i) || []), "最轻松"]);
  if (comparisons.length > 0) map.set(0, [...new Set([...(map.get(0) || []), "推荐"])]);
  return map;
}

// === API ===
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(formatApiError(err, res.status));
  }
  return res.json();
}

async function sendJson(url, method, payload) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(formatApiError(err, res.status));
  }
  return res.json();
}

function formatApiError(err, status) {
  const parts = [];
  if (err?.message) parts.push(String(err.message));
  if (Array.isArray(err?.issues) && err.issues.length > 0) {
    const issueText = err.issues
      .map((issue) => {
        const path = Array.isArray(issue?.path) && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue?.message || "参数错误"}`;
      })
      .join("；");
    if (issueText) parts.push(issueText);
  }
  if (err?.details) parts.push(`详情：${String(err.details)}`);
  if (!parts.length && err?.error) parts.push(String(err.error));
  if (!parts.length) parts.push(`请求失败（${status}）`);
  return parts.join("\n");
}

// === Status ===
function showStatus(msg, isError = false) {
  statusBar.textContent = msg;
  statusBar.classList.remove("hidden", "error");
  if (isError) statusBar.classList.add("error");
}

function hideStatus() {
  statusBar.classList.add("hidden");
}

function setBusy(busy) {
  submitButton.disabled = busy;
}

function setRefreshButtonVisible(visible) {
  refreshLiveButton?.classList.toggle("hidden", !visible);
}

function setRefreshBusy(busy) {
  if (!refreshLiveButton) return;
  refreshLiveButton.disabled = busy;
  refreshLiveButton.textContent = busy ? "刷新中..." : "刷新实时信息";
}

// === View Toggle ===
function showChat() {
  welcomeScreen.classList.add("hidden");
  messageArea.classList.remove("hidden");
}

function showWelcome() {
  welcomeScreen.classList.remove("hidden");
  messageArea.classList.add("hidden");
  chatTitle.textContent = "新对话";
}

// === Textarea Auto-grow ===
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

messageInput.addEventListener("input", () => autoGrow(messageInput));

// === Scroll ===
function scrollToBottom() {
  requestAnimationFrame(() => {
    messageArea.scrollTop = messageArea.scrollHeight;
  });
}

// === Copy ===
function createCopyButton(getText) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.title = "复制";
  const renderIdle = () => {
    btn.innerHTML = `<span class="copy-btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span><span class="copy-btn-text">复制</span>`;
  };
  const renderCopied = () => {
    btn.innerHTML = `<span class="copy-btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span class="copy-btn-text">已复制</span>`;
  };
  renderIdle();
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      btn.classList.add("copied");
      renderCopied();
      setTimeout(() => {
        btn.classList.remove("copied");
        renderIdle();
      }, 1500);
    } catch {}
  });
  return btn;
}

// === Message Rendering ===
function appendMessage(role, html, rawText) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = html;
  el.appendChild(bubble);
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.appendChild(createCopyButton(() => rawText || bubble.textContent || ""));
  el.appendChild(actions);
  messageList.appendChild(el);
  return el;
}

function appendRawBlock(className, html) {
  const el = document.createElement("div");
  el.className = className;
  el.innerHTML = html;
  messageList.appendChild(el);
  return el;
}

function appendErrorNotice(message) {
  appendRawBlock("error-notice", `
    <div class="error-notice-title">请求失败</div>
    <div class="error-notice-body">${escapeHtml(message)}</div>
  `);
}

function getOrCreateContextContainer() {
  let container = document.querySelector("#context-details-container");
  if (container) return container;

  container = document.createElement("div");
  container.id = "context-details-container";
  container.className = "context-details-container";
  messageList.appendChild(container);
  return container;
}

function appendUserMessage(text) {
  appendMessage("user", escapeHtml(text), text);
}

function appendAgentMessage(text) {
  const normalized = normalizeDisplayText(text || "");
  if (!normalized) {
    appendMessage("agent", "暂无结果。");
    return;
  }
  const paragraphs = splitReportParagraphs(normalized);
  const html = paragraphs.map((p) => {
    const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
  }).join("<br/>");
  appendMessage("agent", html, normalized);
}

// === Profile Strip ===
function appendProfileStrip(profile) {
  if (!profile) return;
  const chips = [
    profile.destination ? `📍 ${profile.destination}` : "",
    profile.startDate && profile.endDate ? `📅 ${profile.startDate} ~ ${profile.endDate}` : "",
    profile.budgetCny ? `💰 ${profile.budgetCny} 元` : "",
    profile.travelers ? `👥 ${profile.travelers} 人` : "",
    profile.pace ? formatPaceLabel(profile.pace) : "",
  ].filter(Boolean);
  if (!chips.length) return;
  appendRawBlock("profile-strip", chips.map((c) => `<span class="profile-chip">${escapeHtml(c)}</span>`).join(""));
}

// === Plan Cards ===
function renderBudgetBar(budget) {
  if (!budget || typeof budget.total !== "number") return "";
  const total = budget.total;
  const b = budget.breakdown || {};
  const hotel = b.hotelAndFood || 0;
  const transport = b.transport || 0;
  const activity = b.activities || 0;
  const sum = hotel + transport + activity || 1;
  return `
    <div class="budget-section">
      <div class="budget-total">
        <span class="budget-amount">${total.toLocaleString()}</span>
        <span class="budget-currency">CNY</span>
      </div>
      <div class="budget-bar">
        <div class="seg seg-hotel" style="width:${(hotel / sum * 100).toFixed(1)}%"></div>
        <div class="seg seg-transport" style="width:${(transport / sum * 100).toFixed(1)}%"></div>
        <div class="seg seg-activity" style="width:${(activity / sum * 100).toFixed(1)}%"></div>
      </div>
      <div class="budget-legend">
        <span><i class="seg-hotel"></i>住宿餐饮 ${hotel}</span>
        <span><i class="seg-transport"></i>交通 ${transport}</span>
        <span><i class="seg-activity"></i>活动 ${activity}</span>
      </div>
    </div>
  `;
}

function renderDayTimeline(dailyPlan, dayIndex) {
  const day = dailyPlan[dayIndex];
  if (!day) return "";
  const items = (day.items || []).map((item) => `
    <div class="tl-item">
      <span class="tl-dot ${escapeHtml(item.timeOfDay || "")}"></span>
      <div class="tl-body">
        <div class="tl-head">
          <span class="tl-time">${escapeHtml(formatTimeOfDayLabel(item.timeOfDay))}</span>
          <span class="tl-type">${escapeHtml(item.activityType || "")}</span>
        </div>
        <div class="tl-title">${escapeHtml(item.title || "未命名")}</div>
        <div class="tl-location">${escapeHtml(item.locationHint || "")}</div>
        <div class="tl-actions">
          <button type="button" class="nearby-btn" data-location-hint="${escapeHtml(item.locationHint || "")}">查附近吃饭</button>
        </div>
        <div class="inline-nearby hidden"></div>
      </div>
    </div>
  `).join("");
  return `
    <div class="day-theme">${escapeHtml(day.theme || `Day ${day.day}`)}</div>
    <div class="timeline">${items}</div>
  `;
}

function renderPlanCard(option, comparison, index, badges, cardId) {
  const rm = comparison?.routeMetrics || {};
  const budget = comparison?.budget;
  const isRecommended = badges.includes("推荐");

  const metricsHtml = `
    <div class="plan-metrics">
      <div class="plan-metric">
        <div class="plan-metric-label">节奏</div>
        <div class="plan-metric-value">${formatPaceLabel(option.pace)}</div>
      </div>
      <div class="plan-metric">
        <div class="plan-metric-label">风格</div>
        <div class="plan-metric-value">${formatStyleLabel(option.travelStyle)}</div>
      </div>
      <div class="plan-metric">
        <div class="plan-metric-label">日均移动</div>
        <div class="plan-metric-value">${formatMinutes(rm.averagePreferredMinutesPerDay)}</div>
      </div>
      <div class="plan-metric">
        <div class="plan-metric-label">拥挤度</div>
        <div class="plan-metric-value">
          <span class="congestion-indicator level-${escapeHtml(rm.congestionLevel || "未知")}">
            <span class="congestion-dot"></span>
            ${escapeHtml(rm.congestionLevel || "未知")}
          </span>
        </div>
      </div>
    </div>
  `;

  const highlightsHtml = (option.highlights || []).length
    ? `<ul class="plan-highlights">${option.highlights.slice(0, 4).map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`
    : "";

  const dailyPlan = option.dailyPlan || [];
  const hasDailyPlan = dailyPlan.length > 0;

  return `
    <article class="plan-card${isRecommended ? " recommended" : ""}" id="${cardId}">
      <div class="plan-card-header">
        <span class="plan-card-label">方案 ${String.fromCharCode(65 + index)}</span>
      </div>
      <div class="plan-card-badges">
        ${badges.map((b) => `<span class="plan-badge${b === "推荐" ? " rec" : " tag"}">${escapeHtml(b)}</span>`).join("")}
      </div>
      <div class="plan-card-title">${escapeHtml(option.title || `候选方案 ${index + 1}`)}</div>
      <div class="plan-card-summary">${escapeHtml(option.summary || "")}</div>
      ${metricsHtml}
      ${renderBudgetBar(budget)}
      ${highlightsHtml}
      ${hasDailyPlan ? `<button type="button" class="plan-expand-btn" data-card-id="${cardId}">查看 ${dailyPlan.length} 天完整日程</button>` : ""}
      <div class="daily-plan-section hidden" data-daily-section="${cardId}"></div>
    </article>
  `;
}

function appendPlanCards(options, comparisons) {
  if (!options || !options.length) return;
  const badgeMap = getOptionBadgeMap(comparisons);
  const cards = options.map((opt, i) => {
    const cardId = `plan-card-${Date.now()}-${i}`;
    return renderPlanCard(opt, comparisons[i], i, badgeMap.get(i) || [], cardId);
  }).join("");

  const block = appendRawBlock("plan-cards-block", cards);

  // Expand/collapse daily plan
  block.querySelectorAll(".plan-expand-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cardId = btn.getAttribute("data-card-id");
      const section = block.querySelector(`[data-daily-section="${cardId}"]`);
      const optIndex = options.findIndex((_, i) => `plan-card-${cardId.split("-").slice(2, -1).join("-")}-${i}` === cardId) !== -1
        ? options.findIndex((_, i) => block.querySelector(`#${cardId}`) === block.querySelectorAll(".plan-card")[i])
        : Array.from(block.querySelectorAll(".plan-card")).indexOf(block.querySelector(`#${cardId}`));
      const option = options[optIndex];
      if (!option || !section) return;

      if (!section.classList.contains("hidden")) {
        section.classList.add("hidden");
        section.innerHTML = "";
        btn.textContent = `查看 ${(option.dailyPlan || []).length} 天完整日程`;
        return;
      }

      const dailyPlan = option.dailyPlan || [];

      function renderDay(idx) {
        const tabs = dailyPlan.map((d, di) =>
          `<button type="button" class="day-tab${di === idx ? " active" : ""}" data-di="${di}">Day ${d.day}</button>`
        ).join("");
        section.innerHTML = `
          <div class="day-tabs">${tabs}</div>
          <div class="day-content">${renderDayTimeline(dailyPlan, idx)}</div>
        `;

        section.querySelectorAll(".day-tab").forEach((tab) => {
          tab.addEventListener("click", () => renderDay(Number(tab.getAttribute("data-di"))));
        });

        // Nearby food buttons
        section.querySelectorAll(".nearby-btn").forEach((nb) => {
          nb.addEventListener("click", async (e) => {
            e.stopPropagation();
            await handleNearbyFood(nb.getAttribute("data-location-hint") || "", nb);
          });
        });
      }

      section.classList.remove("hidden");
      btn.textContent = "收起日程";
      renderDay(0);
    });
  });
}

// === Confirmation Block ===
function appendConfirmation(data) {
  if (!data.requiresConfirmation) return;
  const opts = (data.confirmationOptions || []).map((o) => `
    <button type="button" class="confirm-btn" data-action="${escapeHtml(o.action)}" data-label="${escapeHtml(o.label)}">
      ${escapeHtml(o.label)}
      <span class="confirm-btn-desc">${escapeHtml(o.description)}</span>
    </button>
  `).join("");

  const block = appendRawBlock("confirmation-block", `
    <div class="confirmation-msg">${escapeHtml(data.confirmationMessage || "需要你确认下一步取舍：")}</div>
    <div class="confirmation-actions">${opts}</div>
  `);

  block.querySelectorAll(".confirm-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const label = btn.getAttribute("data-label");
      messageInput.value = label;
      showStatus(`已选择：${label}，正在重新规划...`);
      await handleSubmit();
    });
  });
}

// === Context Details ===
function appendContextDetails(liveContext, routeContext) {
  const sections = [
    { title: "实时信息（天气 / 景点）", content: liveContext },
    { title: "路线评估详情", content: routeContext }
  ].filter((s) => s.content && String(s.content).trim());

  currentLiveContext = liveContext || "";
  currentRouteContext = routeContext || "";

  const container = getOrCreateContextContainer();
  container.innerHTML = "";

  if (!sections.length) return;
  for (const s of sections) {
    const formatted = splitReportParagraphs(String(s.content)).map((p) => escapeHtml(p)).join("\n\n");
    const block = document.createElement("div");
    block.className = "context-details";
    block.innerHTML = `
      <details>
        <summary>${escapeHtml(s.title)}</summary>
        <div class="context-content">${formatted}</div>
      </details>
    `;
    container.appendChild(block);
  }
}

// === Missing Info ===
function appendMissingInfo(missingInfo) {
  if (!missingInfo || !missingInfo.length) return;
  appendRawBlock("missing-info-block", `
    <strong>还需要以下信息：</strong>
    <ul>${missingInfo.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
  `);
}

// === Skeleton ===
function showSkeleton() {
  const el = appendRawBlock("skeleton-group", `
    <div class="skeleton skeleton-sm"></div>
    <div class="skeleton skeleton-md"></div>
    <div class="skeleton skeleton-lg"></div>
  `);
  el.id = "loading-skeleton";
  scrollToBottom();
}

function removeSkeleton() {
  document.querySelector("#loading-skeleton")?.remove();
}

// === Nearby Food ===
function buildNearbyAddressQuery(hint, destination) {
  const h = String(hint || "").trim();
  const c = String(destination || "").trim();
  if (!h) return "";
  return !c || h.includes(c) ? h : `${c} ${h}`;
}

function buildNearbySummary(data) {
  const prefix = data.resolvedAddress ? `地址 ${data.resolvedAddress}` : `坐标 ${data.location}`;
  return `${prefix}，半径 ${data.radius} 米，共 ${data.count} 条`;
}

function buildNearbyMarkup(data) {
  if (!data?.pois?.length) {
    return `<div class="inline-nearby-empty">当前范围内没有查到合适的餐饮结果。</div>`;
  }
  return `
    <div class="inline-nearby-summary">${escapeHtml(buildNearbySummary(data))}</div>
    <div class="inline-nearby-list">
      ${data.pois.slice(0, 6).map((poi) => `
        <div class="inline-nearby-card">
          <div class="inline-nearby-card-head">
            <strong>${escapeHtml(poi.name || "未命名")}</strong>
            <span>${escapeHtml(formatPoiType(poi.type))}</span>
          </div>
          <p>${escapeHtml(poi.address || "暂无地址")}</p>
        </div>
      `).join("")}
    </div>
  `;
}

async function handleNearbyFood(locationHint, btn) {
  const address = buildNearbyAddressQuery(locationHint, currentProfile?.destination);
  const panel = btn?.closest(".tl-body")?.querySelector(".inline-nearby");
  if (!address) {
    if (panel) { panel.classList.remove("hidden"); panel.innerHTML = `<div class="inline-nearby-error">当前日程项没有可用地点。</div>`; }
    return;
  }
  const params = new URLSearchParams();
  params.set("address", address);
  params.set("radius", String(INLINE_NEARBY_RADIUS_METERS));
  params.set("keyword", "美食");
  if (currentProfile?.destination) params.set("city", currentProfile.destination);

  // Collapse others
  document.querySelectorAll(".inline-nearby:not(.hidden)").forEach((p) => { p.classList.add("hidden"); p.innerHTML = ""; });

  if (btn) btn.disabled = true;
  if (panel) { panel.classList.remove("hidden"); panel.innerHTML = `<div class="inline-nearby-loading">正在查询附近吃饭...</div>`; }

  try {
    const result = await fetchJson(`/api/pois/nearby-by-address?${params.toString()}`);
    if (panel) panel.innerHTML = buildNearbyMarkup(result);
  } catch (err) {
    if (panel) panel.innerHTML = `<div class="inline-nearby-error">${escapeHtml(err instanceof Error ? err.message : "查询失败")}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// === Agent Response ===
function appendAgentResponse(data) {
  applyThreadId(data.threadId);
  currentProfile = data.profile || currentProfile;
  setRefreshButtonVisible(Boolean(data.threadId));

  appendProfileStrip(data.profile);
  appendAgentMessage(data.finalAnswer);

  if (data.missingInfo?.length) {
    appendMissingInfo(data.missingInfo);
  }

  if (data.options?.length) {
    appendPlanCards(data.options, data.optionComparisons || []);
  }

  if (data.requiresConfirmation) {
    appendConfirmation(data);
  }

  appendContextDetails(data.liveContext, data.routeContext);
  scrollToBottom();
}

// === Thread Management ===
function applyThreadId(id) {
  if (!id) return;
  lastThreadId = id;
  threadIdInput.value = id;
  chatTitle.textContent = id;
}

function clearChat() {
  messageList.innerHTML = "";
  lastThreadId = "";
  threadIdInput.value = "";
  currentProfile = null;
  currentLiveContext = "";
  currentRouteContext = "";
  currentThreadSelection = "";
  setRefreshButtonVisible(false);
  showWelcome();
  hideStatus();
}

function normalizeThreadState(payload) {
  return payload?.state || payload;
}

async function loadThread(threadId) {
  showStatus("正在恢复线程...");
  try {
    const payload = await fetchJson(`/api/trips/thread/${encodeURIComponent(threadId)}`);
    const state = normalizeThreadState(payload);
    currentThreadSelection = threadId;
    applyThreadId(threadId);
    setRefreshButtonVisible(true);
    showChat();
    messageList.innerHTML = "";

    // Replay messages
    const messages = state.messages || [];
    for (const msg of messages) {
      if (msg.role === "user") {
        appendUserMessage(msg.content);
      } else if (msg.role === "agent") {
        appendAgentMessage(msg.content);
      }
    }

    // Append latest structured data after messages
    if (state.profile) appendProfileStrip(state.profile);
    currentProfile = state.profile || currentProfile;

    if (state.options?.length) {
      appendPlanCards(state.options, state.optionComparisons || []);
    }
    if (state.requiresConfirmation) {
      appendConfirmation(state);
    }
    appendContextDetails(state.liveContext, state.routeContext);

    hideStatus();
    scrollToBottom();
    await refreshThreadList();
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "线程恢复失败。", true);
    appendErrorNotice(err instanceof Error ? err.message : "线程恢复失败。");
  }
}

// === Thread List ===
function renderThreadList(threads = []) {
  threadList.innerHTML = "";
  if (!threads.length) {
    threadList.innerHTML = `<div class="thread-empty">暂无线程</div>`;
    return;
  }
  for (const t of threads) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `thread-item${t.threadId === currentThreadSelection ? " active" : ""}`;
    el.innerHTML = `
      <div class="thread-item-title">${escapeHtml(t.threadId)}</div>
      <div class="thread-item-preview">${escapeHtml(t.latestUserRequest || "暂无内容")}</div>
      <div class="thread-item-meta">
        <span class="thread-item-date">${formatDateLabel(t.updatedAt)}</span>
        ${t.requiresConfirmation ? '<span class="thread-item-badge">待确认</span>' : ""}
        <button type="button" class="thread-item-archive">${t.archived ? "取消归档" : "归档"}</button>
      </div>
    `;
    el.querySelector(".thread-item-archive").addEventListener("click", async (e) => {
      e.stopPropagation();
      await toggleArchive(t.threadId, !t.archived);
    });
    el.addEventListener("click", async () => {
      closeSidebar();
      await loadThread(t.threadId);
    });
    threadList.appendChild(el);
  }
}

async function refreshThreadList() {
  try {
    const params = new URLSearchParams();
    params.set("archived", String(currentArchiveFilter));
    if (currentSearchQuery) params.set("q", currentSearchQuery);
    const data = await fetchJson(`/api/trips?${params.toString()}`);
    renderThreadList(data.threads || []);
  } catch {
    threadList.innerHTML = `<div class="thread-empty">加载失败</div>`;
  }
}

async function toggleArchive(threadId, archived) {
  try {
    await sendJson("/api/trips/archive", "PATCH", { threadId, archived });
    if (archived && threadId === currentThreadSelection) currentThreadSelection = "";
    await refreshThreadList();
    showStatus(archived ? "线程已归档。" : "线程已恢复。");
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "操作失败。", true);
    appendErrorNotice(err instanceof Error ? err.message : "操作失败。");
  }
}

async function handleRefreshLiveContext() {
  const threadId = threadIdInput.value.trim() || lastThreadId || currentThreadSelection;
  if (!threadId) {
    showStatus("当前没有可刷新的线程。", true);
    return;
  }

  setRefreshBusy(true);
  showStatus("正在刷新实时信息...");

  try {
    const result = await sendJson(`/api/trips/${encodeURIComponent(threadId)}/refresh-live-context`, "POST", {});
    appendContextDetails(result.liveContext, result.routeContext);
    hideStatus();
    scrollToBottom();
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "刷新实时信息失败。", true);
    appendErrorNotice(err instanceof Error ? err.message : "刷新实时信息失败。");
  } finally {
    setRefreshBusy(false);
  }
}

// === Submit ===
async function handleSubmit() {
  const message = messageInput.value.trim();
  if (!message) {
    showStatus("请输入旅行需求。", true);
    return;
  }

  const threadId = threadIdInput.value.trim() || lastThreadId || undefined;
  const endpoint = threadId ? "/api/trips/revise" : "/api/trips/plan";

  showChat();
  appendUserMessage(message);
  messageInput.value = "";
  autoGrow(messageInput);
  setBusy(true);
  showStatus("正在生成规划，请稍候...");
  showSkeleton();
  scrollToBottom();

  try {
    const result = await sendJson(endpoint, "POST", { threadId, message });
    removeSkeleton();
    appendAgentResponse(result);
    hideStatus();
    await refreshThreadList();
  } catch (err) {
    removeSkeleton();
    showStatus(err instanceof Error ? err.message : "请求失败。", true);
    appendErrorNotice(err instanceof Error ? err.message : "请求失败。");
  } finally {
    setBusy(false);
  }
}

// === Mobile Sidebar ===
function openSidebar() {
  sidebar.classList.add("open");
  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  overlay.addEventListener("click", closeSidebar);
  document.body.appendChild(overlay);
}

function closeSidebar() {
  sidebar.classList.remove("open");
  document.querySelector(".sidebar-overlay")?.remove();
}

// === Event Listeners ===
form.addEventListener("submit", (e) => {
  e.preventDefault();
  handleSubmit();
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.dispatchEvent(new Event("submit"));
  }
});

newThreadBtn.addEventListener("click", () => {
  clearChat();
  closeSidebar();
  refreshThreadList();
  messageInput.focus();
});

threadSearch.addEventListener("input", (e) => {
  currentSearchQuery = e.target.value.trim();
  refreshThreadList();
});

showActiveButton.addEventListener("click", () => {
  currentArchiveFilter = false;
  showActiveButton.classList.add("active");
  showArchivedButton.classList.remove("active");
  refreshThreadList();
});

showArchivedButton.addEventListener("click", () => {
  currentArchiveFilter = true;
  showArchivedButton.classList.add("active");
  showActiveButton.classList.remove("active");
  refreshThreadList();
});

sidebarToggle?.addEventListener("click", openSidebar);
refreshLiveButton?.addEventListener("click", handleRefreshLiveContext);

// === Init ===
setRefreshButtonVisible(false);
refreshThreadList();
