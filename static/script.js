const jobTextEl = document.getElementById("jobText");
const inputErrorEl = document.getElementById("inputError");
const diagnoseBtn = document.getElementById("diagnoseBtn");

const resetBtn = document.getElementById("resetBtn");

const resultSection = document.getElementById("resultSection");
const resultContent = document.getElementById("resultContent");
const generateBtn = document.getElementById("generateBtn");
const nextJobBtn = document.getElementById("nextJobBtn");

const applicationSection = document.getElementById("applicationSection");
const applicationTextEl = document.getElementById("applicationText");
const copyBtn = document.getElementById("copyBtn");
const copyStatus = document.getElementById("copyStatus");
const saveApplicationBtn = document.getElementById("saveApplicationBtn");
const saveError = document.getElementById("saveError");
const saveStatus = document.getElementById("saveStatus");

const chatLog = document.getElementById("chatLog");
const chatError = document.getElementById("chatError");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

let lastDiagnosis = null;
let chatHistory = [];

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

function showInputError(message) {
  inputErrorEl.textContent = message;
  inputErrorEl.classList.remove("hidden");
}

function clearInputError() {
  inputErrorEl.textContent = "";
  inputErrorEl.classList.add("hidden");
}

function showChatError(message) {
  chatError.textContent = message;
  chatError.classList.remove("hidden");
}

function clearChatError() {
  chatError.textContent = "";
  chatError.classList.add("hidden");
}

function resetSaveState() {
  saveApplicationBtn.disabled = false;
  saveApplicationBtn.textContent = "この案件を応募済みにする";
  saveError.classList.add("hidden");
  saveStatus.classList.add("hidden");
}

function resetForm() {
  jobTextEl.value = "";
  clearInputError();
  resultSection.classList.add("hidden");
  applicationSection.classList.add("hidden");
  resultContent.innerHTML = "";
  applicationTextEl.value = "";
  generateBtn.disabled = true;
  lastDiagnosis = null;
  chatHistory = [];
  chatLog.innerHTML = "";
  chatInput.value = "";
  clearChatError();
  resetSaveState();
  jobTextEl.focus();
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

async function callApi(path, payload) {
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

function renderDiagnosis(diagnosis) {
  const badgeClass = judgmentScoreClass(diagnosis.judgment);

  const reasonsHtml = Object.entries(REASON_LABELS)
    .map(([key, label]) => {
      const value = diagnosis.reasons && diagnosis.reasons[key] ? diagnosis.reasons[key] : "-";
      return `<li><span class="reason-label">${label}</span>${escapeHtml(value)}</li>`;
    })
    .join("");

  resultContent.innerHTML = `
    <div class="judgment-header">
      <span class="judgment-badge ${badgeClass}">${escapeHtml(diagnosis.judgment)}</span>
      <span class="judgment-score">適合スコア: ${diagnosis.score} / 100</span>
    </div>
    <div class="judgment-summary">${escapeHtml(diagnosis.summary)}</div>
    <ul class="reasons-list">${reasonsHtml}</ul>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function appendChatMessage(role, content, options = {}) {
  const bubble = document.createElement("div");
  bubble.className = `chat-message ${role}${options.pending ? " pending" : ""}`;
  bubble.textContent = content;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  return bubble;
}

diagnoseBtn.addEventListener("click", async () => {
  clearInputError();
  const jobText = jobTextEl.value.trim();

  if (!jobText) {
    showInputError("案件文章を入力してください。");
    return;
  }

  resultSection.classList.add("hidden");
  applicationSection.classList.add("hidden");
  generateBtn.disabled = true;
  lastDiagnosis = null;

  setButtonLoading(diagnoseBtn, "診断中...", true, "診断する");

  try {
    const diagnosis = await callApi("/api/diagnose", { job_text: jobText });
    lastDiagnosis = diagnosis;
    renderDiagnosis(diagnosis);
    resultSection.classList.remove("hidden");
    generateBtn.disabled = false;
  } catch (err) {
    showInputError(err.message);
  } finally {
    setButtonLoading(diagnoseBtn, "", false, "診断する");
  }
});

generateBtn.addEventListener("click", async () => {
  const jobText = jobTextEl.value.trim();
  if (!jobText || !lastDiagnosis) {
    return;
  }

  applicationSection.classList.add("hidden");
  setButtonLoading(generateBtn, "生成中...", true, "応募文を生成する");

  try {
    const result = await callApi("/api/generate", {
      job_text: jobText,
      diagnosis: lastDiagnosis,
    });
    applicationTextEl.value = result.application_text;
    applicationSection.classList.remove("hidden");
    resetSaveState();
  } catch (err) {
    showInputError(err.message);
  } finally {
    setButtonLoading(generateBtn, "", false, "応募文を生成する");
  }
});

resetBtn.addEventListener("click", () => {
  resetForm();
});

nextJobBtn.addEventListener("click", () => {
  resetForm();
});

async function sendChatMessage() {
  clearChatError();
  const jobText = jobTextEl.value.trim();
  const question = chatInput.value.trim();

  if (!jobText) {
    showChatError("先に案件文章を貼り付けてください。");
    return;
  }
  if (!question) {
    showChatError("質問内容を入力してください。");
    return;
  }

  appendChatMessage("user", question);
  chatInput.value = "";
  const pendingBubble = appendChatMessage("assistant", "回答を考えています...", { pending: true });

  setButtonLoading(chatSendBtn, "送信中...", true, "送信");
  chatInput.disabled = true;

  try {
    const result = await callApi("/api/chat", {
      job_text: jobText,
      message: question,
      diagnosis: lastDiagnosis,
      application_text: applicationTextEl.value.trim() || null,
      history: chatHistory,
    });

    pendingBubble.textContent = result.reply;
    pendingBubble.classList.remove("pending");

    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: result.reply });
  } catch (err) {
    pendingBubble.remove();
    showChatError(err.message);
  } finally {
    setButtonLoading(chatSendBtn, "", false, "送信");
    chatInput.disabled = false;
    chatInput.focus();
  }
}

chatSendBtn.addEventListener("click", () => {
  sendChatMessage();
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(applicationTextEl.value);
  } catch (err) {
    // クリップボードAPIが使えない場合のフォールバック
    applicationTextEl.select();
    document.execCommand("copy");
  }
  copyStatus.classList.remove("hidden");
  setTimeout(() => copyStatus.classList.add("hidden"), 2000);
});

saveApplicationBtn.addEventListener("click", async () => {
  saveError.classList.add("hidden");
  saveStatus.classList.add("hidden");

  const jobText = jobTextEl.value.trim();
  const applicationText = applicationTextEl.value.trim();
  if (!jobText || !applicationText) {
    saveError.textContent = "先に案件を診断し、応募文を生成してください。";
    saveError.classList.remove("hidden");
    return;
  }

  setButtonLoading(saveApplicationBtn, "保存中...", true, "この案件を応募済みにする");

  try {
    await callApi("/api/applications", {
      job_text: jobText,
      diagnosis: lastDiagnosis,
      application_text: applicationText,
    });
    saveApplicationBtn.textContent = "保存済み";
    saveApplicationBtn.disabled = true;
    saveStatus.classList.remove("hidden");
  } catch (err) {
    saveError.textContent = err.message;
    saveError.classList.remove("hidden");
    setButtonLoading(saveApplicationBtn, "", false, "この案件を応募済みにする");
  }
});
