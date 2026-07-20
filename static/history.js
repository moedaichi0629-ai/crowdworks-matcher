const listView = document.getElementById("listView");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");
const historyListError = document.getElementById("historyListError");

const detailView = document.getElementById("detailView");
const backToListBtn = document.getElementById("backToListBtn");
const detailTitle = document.getElementById("detailTitle");
const detailJudgment = document.getElementById("detailJudgment");
const detailJobText = document.getElementById("detailJobText");
const detailApplicationText = document.getElementById("detailApplicationText");
const replyThread = document.getElementById("replyThread");
const replyError = document.getElementById("replyError");
const clientMessageInput = document.getElementById("clientMessageInput");
const createReplyBtn = document.getElementById("createReplyBtn");
const suggestedReplySection = document.getElementById("suggestedReplySection");
const suggestedReplyText = document.getElementById("suggestedReplyText");
const copyReplyBtn = document.getElementById("copyReplyBtn");
const copyReplyStatus = document.getElementById("copyReplyStatus");
const deleteApplicationBtn = document.getElementById("deleteApplicationBtn");

let currentApplicationId = null;

const REASON_LABELS = {
  task_match: "業務内容の一致度",
  skill_match: "使用技術・ツールの一致度",
  schedule_match: "稼働時間・納期条件との整合性",
  reward_assessment: "報酬水準の妥当性",
  concerns: "懸念点・リスク",
};

function judgmentScoreClass(judgment) {
  switch (judgment) {
    case "◎":
      return "score-good";
    case "○":
      return "score-ok";
    case "△":
      return "score-caution";
    default:
      return "score-bad";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function apiGet(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && data.detail ? data.detail : "サーバーエラーが発生しました。";
    throw new Error(detail);
  }
  return data;
}

async function apiPost(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && data.detail ? data.detail : "サーバーエラーが発生しました。";
    throw new Error(detail);
  }
  return data;
}

async function apiDelete(path) {
  const response = await fetch(path, { method: "DELETE" });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && data.detail ? data.detail : "サーバーエラーが発生しました。";
    throw new Error(detail);
  }
  return data;
}

function setButtonLoading(button, loadingText, isLoading, originalText) {
  if (isLoading) {
    button.dataset.originalText = originalText;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || originalText;
    button.disabled = false;
  }
}

function showListViewUI() {
  currentApplicationId = null;
  detailView.classList.add("hidden");
  listView.classList.remove("hidden");
}

function showDetailViewUI() {
  listView.classList.add("hidden");
  detailView.classList.remove("hidden");
}

function renderList(items) {
  historyListError.classList.add("hidden");

  if (items.length === 0) {
    historyEmpty.classList.remove("hidden");
    historyList.innerHTML = "";
    return;
  }
  historyEmpty.classList.add("hidden");

  historyList.innerHTML = items
    .map((item) => {
      const badge = item.judgment
        ? `<span class="judgment-badge small ${judgmentScoreClass(item.judgment)}">${escapeHtml(item.judgment)}</span>`
        : "";
      const replyInfo =
        item.reply_count > 0
          ? `<span class="history-reply-count">やり取り ${item.reply_count}件</span>`
          : `<span class="history-reply-count muted">やり取りなし</span>`;
      return `
        <div class="card history-item" data-id="${item.id}">
          <div class="history-item-main">
            ${badge}
            <div class="history-item-body">
              <div class="history-item-title">${escapeHtml(item.title)}</div>
              <div class="history-item-meta">${formatDate(item.created_at)} ・ ${replyInfo}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  historyList.querySelectorAll(".history-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      history.pushState({}, "", `/history?id=${id}`);
      loadDetail(id);
    });
  });
}

async function loadList() {
  try {
    const items = await apiGet("/api/applications");
    renderList(items);
  } catch (err) {
    historyListError.textContent = err.message;
    historyListError.classList.remove("hidden");
  }
}

function renderReplyThread(replies) {
  if (replies.length === 0) {
    replyThread.innerHTML = `<p class="lead-small" style="margin:0;">まだやり取りはありません。</p>`;
    return;
  }
  replyThread.innerHTML = replies
    .map((r) => {
      const clientBubble = `<div class="chat-message assistant">${escapeHtml(r.client_message)}</div>`;
      const responseBubble = r.suggested_response
        ? `<div class="chat-message user">${escapeHtml(r.suggested_response)}</div>`
        : "";
      return clientBubble + responseBubble;
    })
    .join("");
  replyThread.scrollTop = replyThread.scrollHeight;
}

function renderDiagnosisBadge(diagnosis) {
  if (!diagnosis) {
    detailJudgment.innerHTML = "";
    return;
  }
  detailJudgment.innerHTML = `
    <div class="judgment-header">
      <span class="judgment-badge ${judgmentScoreClass(diagnosis.judgment)}">${escapeHtml(diagnosis.judgment)}</span>
      <span class="judgment-score">適合スコア: ${diagnosis.score} / 100</span>
    </div>
  `;
}

async function loadDetail(id) {
  showDetailViewUI();
  currentApplicationId = id;
  clientMessageInput.value = "";
  replyError.classList.add("hidden");
  suggestedReplySection.classList.add("hidden");

  try {
    const app = await apiGet(`/api/applications/${id}`);
    detailTitle.textContent = app.title;
    renderDiagnosisBadge(app.diagnosis);
    detailJobText.textContent = app.job_text;
    detailApplicationText.textContent = app.application_text;
    renderReplyThread(app.replies);
  } catch (err) {
    replyError.textContent = err.message;
    replyError.classList.remove("hidden");
  }
}

backToListBtn.addEventListener("click", () => {
  history.pushState({}, "", "/history");
  showListViewUI();
  loadList();
});

createReplyBtn.addEventListener("click", async () => {
  replyError.classList.add("hidden");
  const clientMessage = clientMessageInput.value.trim();
  if (!clientMessage) {
    replyError.textContent = "クライアントからのメッセージを入力してください。";
    replyError.classList.remove("hidden");
    return;
  }

  setButtonLoading(createReplyBtn, "作成中...", true, "返信案を作成する");
  suggestedReplySection.classList.add("hidden");

  try {
    const result = await apiPost(`/api/applications/${currentApplicationId}/replies`, {
      client_message: clientMessage,
    });
    suggestedReplyText.value = result.suggested_response;
    suggestedReplySection.classList.remove("hidden");
    clientMessageInput.value = "";

    const app = await apiGet(`/api/applications/${currentApplicationId}`);
    renderReplyThread(app.replies);
  } catch (err) {
    replyError.textContent = err.message;
    replyError.classList.remove("hidden");
  } finally {
    setButtonLoading(createReplyBtn, "", false, "返信案を作成する");
  }
});

copyReplyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(suggestedReplyText.value);
  } catch (err) {
    suggestedReplyText.select();
    document.execCommand("copy");
  }
  copyReplyStatus.classList.remove("hidden");
  setTimeout(() => copyReplyStatus.classList.add("hidden"), 2000);
});

deleteApplicationBtn.addEventListener("click", async () => {
  if (!currentApplicationId) return;
  const confirmed = window.confirm("この応募履歴を削除します。よろしいですか？（元に戻せません）");
  if (!confirmed) return;

  try {
    await apiDelete(`/api/applications/${currentApplicationId}`);
    history.pushState({}, "", "/history");
    showListViewUI();
    loadList();
  } catch (err) {
    replyError.textContent = err.message;
    replyError.classList.remove("hidden");
  }
});

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (id) {
    loadDetail(id);
  } else {
    showListViewUI();
    loadList();
  }
});

// 初期表示
(function init() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (id) {
    loadDetail(id);
  } else {
    showListViewUI();
    loadList();
  }
})();
