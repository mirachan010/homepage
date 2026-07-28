let scheduleData;
let exceptionRequestId = 0;

window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("exceptionForm").addEventListener("submit", saveException);
  document.getElementById("deleteException").addEventListener("click", deleteException);
  document.getElementById("periodForm").addEventListener("submit", addPeriod);
  document.getElementById("patternForm").addEventListener("submit", savePattern);
  document.getElementById("syncHolidays").addEventListener("click", syncHolidays);
  document.querySelector('[name="scheduleDate"]').addEventListener("change", loadExceptionIntoForm);
  document.querySelector('[name="type"]').addEventListener("change", syncStatusWithType);

  const today = formatDate(new Date());
  document.querySelector('[name="scheduleDate"]').value = today;
  document.querySelector('[name="validFrom"]').value = today;
  document.querySelector('[name="baseDate"]').value = today;
  await Promise.all([refreshConfig(), refreshHolidayStatus()]);
  await loadExceptionIntoForm();
});

async function refreshConfig() {
  try {
    scheduleData = await api("/api/admin/config");
    renderPatterns();
    renderHistory();
  } catch (error) {
    showMessage(error.message, true);
  }
}

function renderPatterns() {
  const select = document.getElementById("patternSelect");
  select.innerHTML = "";
  for (const [name, pattern] of Object.entries(scheduleData.settings.patterns)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${pattern.label || name} (${name})`;
    select.appendChild(option);
  }
}

function renderHistory() {
  const container = document.getElementById("periodHistory");
  container.innerHTML = "<h3>変更履歴</h3>";
  const periods = [...scheduleData.settings.periods].sort((a, b) => b.from.localeCompare(a.from));

  for (const period of periods) {
    const item = document.createElement("div");
    item.className = "history-item";
    const pattern = scheduleData.settings.patterns[period.pattern];
    item.textContent = `${period.from}から：${pattern?.label || period.pattern}`
      + (period.baseDate ? `／基準日 ${period.baseDate}` : "")
      + (period.note ? `／${period.note}` : "");
    container.appendChild(item);
  }
}

async function loadExceptionIntoForm() {
  const form = document.getElementById("exceptionForm");
  const date = form.elements.scheduleDate.value;
  if (!date) return;
  const requestId = ++exceptionRequestId;

  try {
    const result = await api(`/api/admin/exceptions/${encodeURIComponent(date)}`);
    if (requestId !== exceptionRequestId) return;
    const item = result.exception || {};
    form.elements.mode.value = item.mode || "";
    form.elements.status.value = item.status || "";
    form.elements.type.value = item.type || "";
    form.elements.shift.value = item.shift || 0;
    form.elements.note.value = item.note || "";
    form.elements.memo.value = item.memo || "";
  } catch (error) {
    if (requestId === exceptionRequestId) showMessage(error.message, true);
  }
}

async function saveException(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await perform(async () => {
    await api("/api/admin/exceptions", {
      method: "POST",
      body: JSON.stringify({
        scheduleDate: form.elements.scheduleDate.value,
        mode: form.elements.mode.value || null,
        status: form.elements.status.value || null,
        type: form.elements.type.value || null,
        shift: Number(form.elements.shift.value || 0),
        note: form.elements.note.value.trim(),
        memo: form.elements.memo.value.trim()
      })
    });
    await loadExceptionIntoForm();
  }, "日ごとの変更を保存しました");
}

function syncStatusWithType(event) {
  const form = event.currentTarget.form;
  if (event.currentTarget.value === "paid_leave") form.elements.status.value = "rest";
  if (event.currentTarget.value === "holiday_work") form.elements.status.value = "work";
}

async function deleteException() {
  const date = document.querySelector('[name="scheduleDate"]').value;
  if (!date || !window.confirm(`${date} の変更を削除しますか？`)) return;

  await perform(async () => {
    await api(`/api/admin/exceptions/${encodeURIComponent(date)}`, { method: "DELETE" });
    await loadExceptionIntoForm();
  }, "日ごとの変更を削除しました");
}

async function addPeriod(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await perform(async () => {
    await api("/api/admin/periods", {
      method: "POST",
      body: JSON.stringify({
        validFrom: form.elements.validFrom.value,
        patternName: form.elements.patternName.value,
        baseDate: form.elements.baseDate.value || null,
        note: form.elements.note.value.trim()
      })
    });
    form.elements.note.value = "";
    await refreshConfig();
  }, "新しい設定履歴を追加しました");
}

async function savePattern(event) {
  event.preventDefault();
  const form = event.currentTarget;

  await perform(async () => {
    const patternBlocks = parseBlocks(form.elements.blocks.value);
    await api("/api/admin/patterns", {
      method: "POST",
      body: JSON.stringify({
        name: form.elements.name.value.trim(),
        label: form.elements.label.value.trim(),
        definition: { type: "cycle", patternBlocks }
      })
    });
    await refreshConfig();
  }, "勤務パターンを保存しました");
}

async function refreshHolidayStatus() {
  const element = document.getElementById("holidaySyncStatus");
  try {
    const status = await api("/api/admin/holidays/status");
    if (status.status === "not_synced") {
      element.textContent = "まだ公式データを取得していません。";
      return;
    }

    const label = {
      updated: "公式データを更新",
      unchanged: "変更なし",
      failed: "取得失敗"
    }[status.status] || status.status;
    const checkedAt = status.checkedAt
      ? new Date(`${status.checkedAt.replace(" ", "T")}Z`).toLocaleString("ja-JP")
      : "不明";
    const range = status.firstDate && status.lastDate
      ? `／${status.firstDate}〜${status.lastDate}`
      : "";
    element.textContent =
      `最終確認: ${checkedAt}／${label}／${status.rowCount || 0}件${range}`
      + (status.error ? `／${status.error}` : "");
  } catch (error) {
    element.textContent = `同期状態を取得できません: ${error.message}`;
  }
}

async function syncHolidays() {
  const button = document.getElementById("syncHolidays");
  button.disabled = true;
  await perform(async () => {
    const result = await api("/api/admin/holidays/sync", { method: "POST" });
    await refreshHolidayStatus();
    return result;
  }, "公式祝日データを確認しました");
  button.disabled = false;
}

function parseBlocks(text) {
  const blocks = text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const [mode, status, rawDays] = line.split(",").map(value => value.trim());
    const days = Number(rawDays);
    if (!["day", "night"].includes(mode) || !["work", "rest"].includes(status)
      || !Number.isInteger(days) || days < 1 || days > 31) {
      throw new Error(`${index + 1}行目は「dayまたはnight, workまたはrest, 日数」で入力してください`);
    }
    return { mode, status, days };
  });

  if (!blocks.length) throw new Error("パターンを1行以上入力してください");
  return blocks;
}

async function perform(action, successMessage) {
  try {
    await action();
    showMessage(successMessage, false);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `通信に失敗しました (${response.status})`);
  return data;
}

function showMessage(text, isError) {
  const element = document.getElementById("message");
  element.textContent = text;
  element.classList.remove("hidden", "error");
  if (isError) element.classList.add("error");
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
