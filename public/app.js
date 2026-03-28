const form = document.querySelector("#planner-form");
const threadIdInput = document.querySelector("#thread-id");
const messageInput = document.querySelector("#message");
const submitButton = document.querySelector("#submit-button");
const reviseButton = document.querySelector("#revise-button");
const statusPanel = document.querySelector("#status-panel");
const resultPanel = document.querySelector("#result-panel");
const threadLabel = document.querySelector("#thread-label");
const finalAnswer = document.querySelector("#final-answer");
const liveContext = document.querySelector("#live-context");
const routeContext = document.querySelector("#route-context");
const optionsContainer = document.querySelector("#options");
const dailyPlanView = document.querySelector("#daily-plan-view");
const confirmationPanel = document.querySelector("#confirmation-panel");
const confirmationMessage = document.querySelector("#confirmation-message");
const confirmationOptions = document.querySelector("#confirmation-options");
const conversationLog = document.querySelector("#conversation-log");
const threadList = document.querySelector("#thread-list");
const threadSearch = document.querySelector("#thread-search");
const showActiveButton = document.querySelector("#show-active");
const showArchivedButton = document.querySelector("#show-archived");

let lastThreadId = "";
const conversationItems = [];
let activeOptionIndex = 0;
let currentThreadSelection = "";
let currentArchiveFilter = false;
let currentSearchQuery = "";

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  reviseButton.disabled = isBusy;
}

function showStatus(message, isError = false) {
  statusPanel.textContent = message;
  statusPanel.classList.remove("hidden");
  statusPanel.style.color = isError ? "#b42318" : "#115e59";
}

function renderOptions(options = []) {
  optionsContainer.innerHTML = "";

  options.forEach((option, index) => {
    const element = document.createElement("article");
    element.className = `option${index === activeOptionIndex ? " active" : ""}`;
    element.innerHTML = `
      <h4>${option.title}</h4>
      <p>${option.summary}</p>
      <p>节奏：${option.pace} / 风格：${option.travelStyle}</p>
      <p>${option.suitableFor}</p>
    `;
    element.addEventListener("click", () => {
      activeOptionIndex = index;
      renderOptions(options);
      renderDailyPlan(options[index]?.dailyPlan || []);
    });
    optionsContainer.appendChild(element);
  });
}

function renderDailyPlan(dailyPlan = []) {
  dailyPlanView.innerHTML = "";

  if (!dailyPlan.length) {
    dailyPlanView.innerHTML = "<p>暂无结构化日程。</p>";
    return;
  }

  for (const day of dailyPlan) {
    const card = document.createElement("article");
    card.className = "day-card";
    const items = day.items
      .map((item) => `<p>${item.timeOfDay} · ${item.title} · ${item.locationHint}</p>`)
      .join("");
    card.innerHTML = `
      <h4>Day ${day.day} · ${day.theme}</h4>
      ${items}
    `;
    dailyPlanView.appendChild(card);
  }
}

function formatDateLabel(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function applyThreadId(threadId) {
  if (!threadId) {
    return;
  }

  lastThreadId = threadId;
  threadIdInput.value = threadId;
}

async function sendPlanningRequest(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || `Request failed with ${response.status}`);
  }

  return response.json();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return response.json();
}

async function sendJson(url, method, payload) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json();
}

function renderConfirmation(data) {
  if (!data.requiresConfirmation) {
    confirmationPanel.classList.add("hidden");
    confirmationOptions.innerHTML = "";
    return;
  }

  confirmationPanel.classList.remove("hidden");
  confirmationMessage.textContent = data.confirmationMessage || "需要你确认下一步取舍。";
  confirmationOptions.innerHTML = "";

  for (const option of data.confirmationOptions || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = option.label;
    button.title = option.description;
    button.addEventListener("click", async () => {
      messageInput.value = option.label;
      showStatus(`已选择：${option.label}，正在重新规划...`);
      await handleSubmit("/api/trips/revise");
    });
    confirmationOptions.appendChild(button);
  }
}

function renderConversation() {
  conversationLog.innerHTML = "";

  for (const item of conversationItems) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${item.role}`;
    bubble.textContent = item.content;
    conversationLog.appendChild(bubble);
  }
}

function setConversation(items = []) {
  conversationItems.length = 0;
  for (const item of items) {
    if (item?.role && item?.content) {
      conversationItems.push({
        role: item.role,
        content: item.content
      });
    }
  }
  renderConversation();
}

function renderThreadList(threads = []) {
  threadList.innerHTML = "";

  if (!threads.length) {
    threadList.innerHTML = "<p>还没有可恢复的线程。</p>";
    return;
  }

  for (const thread of threads) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `thread-item${thread.threadId === currentThreadSelection ? " active" : ""}`;
    item.innerHTML = `
      <div class="thread-meta">
        <strong>${thread.threadId}</strong>
        ${thread.requiresConfirmation ? '<span class="badge">待确认</span>' : ""}
      </div>
      <p>${thread.latestUserRequest || "暂无内容"}</p>
      <p>${formatDateLabel(thread.updatedAt)}</p>
      <div class="thread-actions">
        <button class="secondary" type="button">${thread.archived ? "取消归档" : "归档"}</button>
      </div>
    `;
    item.querySelector(".thread-actions button").addEventListener("click", async (event) => {
      event.stopPropagation();
      await toggleArchive(thread.threadId, !thread.archived);
    });
    item.addEventListener("click", async () => {
      await loadThread(thread.threadId);
    });
    threadList.appendChild(item);
  }
}

function normalizeThreadState(payload) {
  return payload?.state || payload;
}

async function refreshThreadList() {
  try {
    const params = new URLSearchParams();
    params.set("archived", String(currentArchiveFilter));
    if (currentSearchQuery) {
      params.set("q", currentSearchQuery);
    }
    const data = await fetchJson(`/api/trips?${params.toString()}`);
    renderThreadList(data.threads || []);
  } catch (_error) {
    threadList.innerHTML = "<p>线程列表加载失败。</p>";
  }
}

async function toggleArchive(threadId, archived) {
  try {
    await sendJson("/api/trips/archive", "PATCH", {
      threadId,
      archived
    });
    if (archived && threadId === currentThreadSelection) {
      currentThreadSelection = "";
    }
    await refreshThreadList();
    showStatus(archived ? "线程已归档。" : "线程已恢复到活跃列表。");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "归档失败。", true);
  }
}

async function loadThread(threadId) {
  showStatus("正在恢复线程...");

  try {
    const payload = await fetchJson(`/api/trips/thread/${encodeURIComponent(threadId)}`);
    const state = normalizeThreadState(payload);
    currentThreadSelection = threadId;
    applyThreadId(threadId);
    setConversation(state.messages || []);
    renderResult({
      threadId,
      finalAnswer: state.finalAnswer,
      liveContext: state.liveContext,
      routeContext: state.routeContext,
      options: state.options,
      requiresConfirmation: state.requiresConfirmation,
      confirmationMessage: state.confirmationMessage,
      confirmationOptions: state.confirmationOptions,
      messages: state.messages
    });
    showStatus("线程已恢复。");
    await refreshThreadList();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "线程恢复失败。", true);
  }
}

function renderResult(data) {
  resultPanel.classList.remove("hidden");
  applyThreadId(data.threadId);
  currentThreadSelection = data.threadId;
  threadLabel.textContent = `thread_id: ${data.threadId}`;
  finalAnswer.textContent = data.finalAnswer || "";
  liveContext.textContent = data.liveContext || "暂无";
  routeContext.textContent = data.routeContext || "暂无";
  activeOptionIndex = 0;
  renderOptions(data.options || []);
  renderDailyPlan(data.options?.[0]?.dailyPlan || []);
  renderConfirmation(data);
  if (data.messages?.length) {
    setConversation(data.messages);
  } else {
    const lastMessage = conversationItems[conversationItems.length - 1];
    if (!lastMessage || lastMessage.role !== "agent" || lastMessage.content !== data.finalAnswer) {
      conversationItems.push({
        role: "agent",
        content: data.finalAnswer || "已返回空结果。"
      });
      renderConversation();
    }
  }
  refreshThreadList();
}

async function handleSubmit(endpoint) {
  const message = messageInput.value.trim();
  if (!message) {
    showStatus("请输入旅行需求。", true);
    return;
  }

  const threadId = threadIdInput.value.trim() || lastThreadId || undefined;
  setBusy(true);
  showStatus("正在生成规划，请稍候...");
  if (!threadId || threadId !== currentThreadSelection) {
    currentThreadSelection = threadId || currentThreadSelection;
  }
  conversationItems.push({
    role: "user",
    content: message
  });
  renderConversation();

  try {
    const result = await sendPlanningRequest(endpoint, {
      threadId,
      message
    });

    renderResult(result);
    showStatus(result.requiresConfirmation ? "已生成确认请求。" : "规划完成。");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "请求失败。", true);
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await handleSubmit("/api/trips/plan");
});

reviseButton.addEventListener("click", async () => {
  await handleSubmit("/api/trips/revise");
});

threadSearch.addEventListener("input", async (event) => {
  currentSearchQuery = event.target.value.trim();
  await refreshThreadList();
});

showActiveButton.addEventListener("click", async () => {
  currentArchiveFilter = false;
  await refreshThreadList();
});

showArchivedButton.addEventListener("click", async () => {
  currentArchiveFilter = true;
  await refreshThreadList();
});

refreshThreadList();
