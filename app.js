/* ===================== LifeQuest — игровой планировщик ===================== */

const STORAGE_KEY = "lifequest_data_v1";

const DEFAULT_CATEGORIES = [
  { id: "sport",   name: "Спорт",   icon: "🏋️", color: "#34d399" },
  { id: "family",  name: "Семья",   icon: "👨‍👩‍👧", color: "#ff8fb1" },
  { id: "work",    name: "Работа",  icon: "💼", color: "#00d2ff" },
  { id: "projects",name: "Проекты", icon: "🚀", color: "#ffb454" },
];

const COLORS = ["#6c5ce7","#00d2ff","#34d399","#ffb454","#ff5f6d","#ff8fb1","#fdcb6e","#74b9ff","#a29bfe","#55efc4"];

const MEETING_COLOR = "#e84393";

const ALARM_SHORTCUT_NAME = "Будильник Результат";

function subtractMinutes(time, minutes) {
  if (!time || !minutes) return time;
  const [h, m] = time.split(":").map(Number);
  let total = (h * 60 + m - minutes) % 1440;
  if (total < 0) total += 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function openAlarmShortcut(time) {
  if (!time) { alert("Сначала укажите время напоминания"); return; }
  const url = `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(ALARM_SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(time)}`;
  window.location.href = url;
}

const ACHIEVEMENTS = [
  { id: "first_task",  emoji: "🎯", title: "Первый шаг",        desc: "Выполните первую задачу", check: s => s.totalDone >= 1 },
  { id: "ten_tasks",   emoji: "🔥", title: "Разогрев",           desc: "Выполните 10 задач",       check: s => s.totalDone >= 10 },
  { id: "fifty_tasks", emoji: "💪", title: "В ритме",            desc: "Выполните 50 задач",       check: s => s.totalDone >= 50 },
  { id: "streak3",     emoji: "🌱", title: "Привычка рождается", desc: "Серия из 3 дней в любой сфере", check: s => s.maxStreak >= 3 },
  { id: "streak7",     emoji: "🌟", title: "Неделя силы",        desc: "Серия из 7 дней в любой сфере", check: s => s.maxStreak >= 7 },
  { id: "streak30",    emoji: "👑", title: "Железная воля",      desc: "Серия из 30 дней в любой сфере", check: s => s.maxStreak >= 30 },
  { id: "level5",      emoji: "⭐", title: "Растущий герой",     desc: "Достигните 5 уровня",      check: s => s.level >= 5 },
  { id: "level10",     emoji: "🏆", title: "Мастер планирования",desc: "Достигните 10 уровня",     check: s => s.level >= 10 },
  { id: "all_areas",   emoji: "🧩", title: "Гармония",           desc: "Выполните задачи во всех сферах за один день", check: s => s.allAreasOneDay },
];

/* ---------------------- State ---------------------- */
let state = loadState();
let currentDate = new Date();      // for "today" view navigation
let calMonth = new Date();         // for calendar view
let editingTaskId = null;
let editingMeetingId = null;
let editingCatId = null;
let editingNoteId = null;
let editingFolderId = null;
let selectedCatColor = COLORS[0];
let selectedCatFilter = null; // catId or null = show all
let selectedNoteFolderFilter = null; // folderId or null = show all

function todayStr(d = new Date()) {
  return formatDate(d);
}
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function parseDate(str) {
  const [y,m,d] = str.split("-").map(Number);
  return new Date(y, m-1, d);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate()+n);
  return d;
}
function uid() {
  return Math.random().toString(36).slice(2,10);
}

function loadDefaults() {
  return {
    categories: DEFAULT_CATEGORIES.map(c => ({...c})),
    tasks: [],
    meetings: [],
    notes: [],
    noteFolders: [],
    xp: 0,
    level: 1,
    unlockedAchievements: [],
    profileName: "",
    profilePhoto: "",
  };
}
function loadState() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch(e) {}
  const defaults = loadDefaults();
  return data ? Object.assign(defaults, data) : defaults;
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------------- XP / Level ---------------------- */
function xpForLevel(level) {
  return level * 100;
}
function addXp(amount) {
  state.xp += amount;
  let leveled = false;
  while (state.xp >= xpForLevel(state.level)) {
    state.xp -= xpForLevel(state.level);
    state.level += 1;
    leveled = true;
  }
  saveState();
  renderLevel();
  if (leveled) showToast(`🎉 Новый уровень: ${state.level}!`);
}
function removeXp(amount) {
  state.xp -= amount;
  while (state.xp < 0 && state.level > 1) {
    state.level -= 1;
    state.xp += xpForLevel(state.level);
  }
  if (state.xp < 0) state.xp = 0;
  saveState();
  renderLevel();
}

/* ---------------------- Task occurrence helpers ---------------------- */
// Returns true if a task occurs on a given date string "YYYY-MM-DD"
function taskOccursOn(task, dateStr) {
  const start = parseDate(task.date);
  const target = parseDate(dateStr);
  if (target < start) return false;
  if (task.repeat === "none") {
    return task.date === dateStr;
  }
  if (task.repeat === "daily") {
    return true;
  }
  if (task.repeat === "weekly") {
    return start.getDay() === target.getDay();
  }
  return false;
}

function tasksForDate(dateStr) {
  return state.tasks.filter(t => taskOccursOn(t, dateStr));
}

function isTaskDone(task, dateStr) {
  return !!task.completions[dateStr];
}

/* ---------------------- Streaks ---------------------- */
// For a category, compute current streak (consecutive days up to today/yesterday with >=1 done task that occurs that day)
function computeStreak(catId, refDateStr = todayStr()) {
  let streak = 0;
  let d = parseDate(refDateStr);

  // if today has no completions yet, start checking from yesterday (don't break streak before today's done)
  const todayTasks = tasksForDate(formatDate(d)).filter(t => t.catId === catId);
  const todayDone = todayTasks.some(t => isTaskDone(t, formatDate(d)));
  if (todayTasks.length > 0 && !todayDone) {
    d = addDays(d, -1);
  }

  while (true) {
    const ds = formatDate(d);
    const dayTasks = tasksForDate(ds).filter(t => t.catId === catId);
    if (dayTasks.length === 0) {
      // no tasks scheduled that day -> doesn't break streak, but doesn't count either; skip backwards
      d = addDays(d, -1);
      // safety limit
      if (streak === 0 && (parseDate(refDateStr) - d) > 1000*60*60*24*365) break;
      if (streak > 0 && (parseDate(refDateStr) - d) > 1000*60*60*24*365) break;
      // if we've gone too far without any tasks at all, stop
      const hasAnyEver = state.tasks.some(t => t.catId === catId && parseDate(t.date) <= d);
      if (!hasAnyEver) break;
      continue;
    }
    const allDone = dayTasks.every(t => isTaskDone(t, ds));
    if (allDone) {
      streak++;
      d = addDays(d, -1);
    } else {
      break;
    }
  }
  return streak;
}

function maxStreakAcrossCategories() {
  let max = 0;
  for (const cat of state.categories) {
    max = Math.max(max, computeStreak(cat.id));
  }
  return max;
}

/* ---------------------- Toast ---------------------- */
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 2200);
}

/* ---------------------- Navigation ---------------------- */
function switchView(viewId) {
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const btn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
  if (btn) btn.classList.add("active");
  document.getElementById(viewId).classList.add("active");
  if (viewId === "view-calendar") renderCalendar();
  if (viewId === "view-profile") { renderProfile(); renderCategories(); }
  if (viewId === "view-meetings") renderMeetings();
  if (viewId === "view-notes") renderNotes();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("brandBtn").addEventListener("click", () => switchView("view-profile"));

/* ---------------------- Today view ---------------------- */
let taskTab = "active";
let meetingTab = "active";

document.getElementById("taskTabActive").addEventListener("click", () => { taskTab = "active"; renderToday(); });
document.getElementById("taskTabDone").addEventListener("click", () => { taskTab = "done"; renderToday(); });
document.getElementById("meetingTabActive").addEventListener("click", () => { meetingTab = "active"; renderMeetings(); });
document.getElementById("meetingTabDone").addEventListener("click", () => { meetingTab = "done"; renderMeetings(); });

function setTaskTab(tab) {
  taskTab = tab;
  document.getElementById("taskTabActive").classList.toggle("active", tab === "active");
  document.getElementById("taskTabDone").classList.toggle("active", tab === "done");
}
function setMeetingTab(tab) {
  meetingTab = tab;
  const ma = document.getElementById("meetingTabActive");
  const md = document.getElementById("meetingTabDone");
  if (ma) ma.classList.toggle("active", tab === "active");
  if (md) md.classList.toggle("active", tab === "done");
}

function renderToday() {
  setTaskTab(taskTab);

  const today = todayStr();

  // Category filter strip (active tab only)
  const strip = document.getElementById("streakStrip");
  strip.innerHTML = "";
  if (taskTab === "active") {
    state.categories.forEach(cat => {
      const streak = computeStreak(cat.id);
      const catTasks = state.tasks.filter(t => t.catId === cat.id && (t.repeat !== "none" ? taskOccursOn(t, today) : true));
      const hasActive = catTasks.some(t => !isTaskDone(t, t.repeat !== "none" ? today : t.date));
      const allDone = catTasks.length > 0 && !hasActive;
      const chip = document.createElement("div");
      chip.className = "streak-chip" + (streak > 0 ? " on" : "") + (selectedCatFilter === cat.id ? " selected" : "") + (hasActive ? " has-active" : "") + (allDone ? " all-done-cat" : "");
      chip.innerHTML = `<span>${escapeHtml(cat.icon)}</span><span>${escapeHtml(cat.name)}</span><span class="flame">${streak > 0 ? "🔥 " + streak : "—"}</span>`;
      chip.addEventListener("click", () => {
        selectedCatFilter = selectedCatFilter === cat.id ? null : cat.id;
        renderToday();
      });
      strip.appendChild(chip);
    });
  }

  // Build task list
  const list = document.getElementById("taskList");
  list.innerHTML = "";

  let tasks;
  if (taskTab === "active") {
    tasks = state.tasks.filter(t => {
      if (t.repeat !== "none") return taskOccursOn(t, today) && !isTaskDone(t, today);
      return !isTaskDone(t, t.date);
    });
    tasks.sort((a,b) => (a.date + (a.time||"99:99")).localeCompare(b.date + (b.time||"99:99")));
  } else {
    tasks = state.tasks.filter(t => {
      if (t.repeat !== "none") return isTaskDone(t, today);
      return isTaskDone(t, t.date);
    });
    tasks.sort((a,b) => (b.date + (b.time||"99:99")).localeCompare(a.date + (a.time||"99:99")));
  }

  if (selectedCatFilter) tasks = tasks.filter(t => t.catId === selectedCatFilter);

  if (tasks.length === 0) {
    const cat = state.categories.find(c => c.id === selectedCatFilter);
    list.innerHTML = taskTab === "active"
      ? (selectedCatFilter
          ? `<div class="empty-state">Нет активных задач по сфере «${escapeHtml(cat ? cat.icon + " " + cat.name : "")}».</div>`
          : `<div class="empty-state">Нет активных задач.<br>Нажмите «+», чтобы добавить ✨</div>`)
      : `<div class="empty-state">Нет выполненных задач.</div>`;
    return;
  }

  tasks.forEach(task => {
    const cat = state.categories.find(c => c.id === task.catId) || { name: "—", icon: "❔", color: "#999" };
    const dateKey = task.repeat !== "none" ? today : task.date;
    const done = isTaskDone(task, dateKey);

    const card = document.createElement("div");
    card.className = "task-card" + (done ? " done" : "");
    card.style.borderLeftColor = cat.color;

    card.innerHTML = `
      <button class="task-checkbox">${done ? "✓" : ""}</button>
      <div class="task-body">
        <div class="task-title">${escapeHtml(task.title)}</div>
        ${task.comment ? `<div class="task-comment">${escapeHtml(task.comment)}</div>` : ""}
        <div class="task-meta">
          <span>📅 ${task.date}</span>
          ${task.time ? `<span>⏰ ${task.time}</span>` : ""}
          <span class="task-cat-badge" style="background:${cat.color}33;color:${cat.color}">${escapeHtml(cat.icon)} ${escapeHtml(cat.name)}</span>
          <span class="task-xp">+${task.xp} XP</span>
        </div>
      </div>
    `;

    card.querySelector(".task-checkbox").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTaskDone(task, dateKey);
    });
    card.addEventListener("click", () => openTaskModal(task));
    list.appendChild(card);
  });
}

function toggleTaskDone(task, dateStr) {
  const done = isTaskDone(task, dateStr);
  if (done) {
    delete task.completions[dateStr];
    removeXp(task.xp);
  } else {
    task.completions[dateStr] = true;
    addXp(task.xp);
    checkAchievements();
  }
  saveState();
  renderToday();
  renderCalendar();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------- Level UI ---------------------- */
function renderLevel() {
  document.getElementById("levelLabel").textContent = `Ур. ${state.level}`;
  document.getElementById("xpLabel").textContent = `${state.xp} / ${xpForLevel(state.level)} XP`;
  const pct = Math.min(100, (state.xp / xpForLevel(state.level)) * 100);
  document.getElementById("xpFill").style.width = pct + "%";
}

/* ---------------------- Calendar view ---------------------- */
document.getElementById("prevMonth").addEventListener("click", () => {
  calMonth.setMonth(calMonth.getMonth()-1);
  renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", () => {
  calMonth.setMonth(calMonth.getMonth()+1);
  renderCalendar();
});

function renderCalendar() {
  const label = document.getElementById("monthLabel");
  label.textContent = calMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  const grid = document.getElementById("calGrid");
  grid.innerHTML = "";

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // make Monday = 0
  const daysInMonth = new Date(year, month+1, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-day empty";
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = formatDate(date);
    const cell = document.createElement("div");
    cell.className = "cal-day";
    if (dateStr === todayStr()) cell.classList.add("today");

    const tasks = tasksForDate(dateStr);
    const meetings = meetingsForDate(dateStr);
    const allDone = tasks.length > 0 && tasks.every(t => isTaskDone(t, dateStr));
    if (allDone) cell.classList.add("all-done");

    const taskDots = tasks.slice(0,6).map(t => {
      const cat = state.categories.find(c => c.id === t.catId) || { color: "#999" };
      const done = isTaskDone(t, dateStr);
      return `<span class="dot" style="background:${cat.color};opacity:${done ? 1 : 0.35}"></span>`;
    }).join("");
    const meetingDots = meetings.slice(0,3).map(m => {
      const done = isMeetingDone(m, dateStr);
      return `<span class="dot" style="background:${MEETING_COLOR};opacity:${done ? 1 : 0.35}"></span>`;
    }).join("");
    const dotsHtml = taskDots + meetingDots;

    cell.innerHTML = `<span>${day}</span><div class="dots">${dotsHtml}</div>`;
    cell.addEventListener("click", () => {
      currentDate = date;
      switchView("view-today");
      renderToday();
    });
    grid.appendChild(cell);
  }

  // legend
  const legend = document.getElementById("catLegend");
  legend.innerHTML = state.categories.map(c =>
    `<div class="legend-item"><span class="legend-dot" style="background:${c.color}"></span>${escapeHtml(c.icon)} ${escapeHtml(c.name)}</div>`
  ).join("") + `<div class="legend-item"><span class="legend-dot" style="background:${MEETING_COLOR}"></span>🤝 Встречи</div>`;
}

/* ---------------------- Categories view ---------------------- */
function renderCategories() {
  const list = document.getElementById("catList");
  list.innerHTML = "";
  state.categories.forEach((cat, idx) => {
    const total = state.tasks.filter(t => t.catId === cat.id).length;
    const streak = computeStreak(cat.id);
    const card = document.createElement("div");
    card.className = "cat-card";
    card.innerHTML = `
      <div class="cat-icon" style="background:${cat.color}33;color:${cat.color}">${escapeHtml(cat.icon)}</div>
      <div class="cat-info">
        <div class="cat-name">${escapeHtml(cat.name)}</div>
        <div class="cat-stats">${total} задач(и) · 🔥 серия ${streak} дн.</div>
      </div>
      <div class="cat-actions">
        <div class="cat-actions-row">
          <button class="cat-btn cat-up" title="Выше" ${idx === 0 ? "disabled" : ""}>⬆️</button>
          <button class="cat-btn cat-down" title="Ниже" ${idx === state.categories.length-1 ? "disabled" : ""}>⬇️</button>
        </div>
        <div class="cat-actions-row">
          <button class="cat-btn cat-edit" title="Редактировать">✏️</button>
          <button class="cat-btn cat-delete" title="Удалить">🗑️</button>
        </div>
      </div>
    `;
    card.querySelector(".cat-up").addEventListener("click", (e) => { e.stopPropagation(); moveCategory(cat.id, -1); });
    card.querySelector(".cat-down").addEventListener("click", (e) => { e.stopPropagation(); moveCategory(cat.id, 1); });
    card.querySelector(".cat-edit").addEventListener("click", (e) => { e.stopPropagation(); openCatModal(cat); });
    card.querySelector(".cat-delete").addEventListener("click", (e) => { e.stopPropagation(); deleteCategory(cat.id); });
    card.addEventListener("click", () => openCatModal(cat));
    list.appendChild(card);
  });
}

function moveCategory(catId, dir) {
  const idx = state.categories.findIndex(c => c.id === catId);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.categories.length) return;
  const [cat] = state.categories.splice(idx, 1);
  state.categories.splice(newIdx, 0, cat);
  saveState();
  renderCategories();
  renderToday();
  renderCalendar();
}

function deleteCategory(catId) {
  if (state.tasks.some(t => t.catId === catId)) {
    if (!confirm("В этой сфере есть задачи. Удалить сферу и все связанные задачи?")) return;
    state.tasks = state.tasks.filter(t => t.catId !== catId);
  }
  state.categories = state.categories.filter(c => c.id !== catId);
  saveState();
  renderCategories();
  renderToday();
}

/* ---------------------- Category modal ---------------------- */
const catModal = document.getElementById("catModal");
document.getElementById("addCatBtn").addEventListener("click", () => openCatModal(null));

function openCatModal(cat) {
  editingCatId = cat ? cat.id : null;
  catModal.querySelector("h3").textContent = cat ? "Редактировать сферу" : "Новая сфера";
  document.getElementById("catNameInput").value = cat ? cat.name : "";
  document.getElementById("catIconInput").value = cat ? cat.icon : "✨";
  selectedCatColor = cat ? cat.color : COLORS[Math.floor(Math.random()*COLORS.length)];
  renderColorPicker();
  catModal.classList.remove("hidden");
}

document.getElementById("cancelCatBtn").addEventListener("click", () => catModal.classList.add("hidden"));
document.getElementById("saveCatBtn").addEventListener("click", () => {
  const name = document.getElementById("catNameInput").value.trim();
  const icon = document.getElementById("catIconInput").value.trim() || "✨";
  if (!name) { alert("Введите название сферы"); return; }
  if (editingCatId) {
    const cat = state.categories.find(c => c.id === editingCatId);
    Object.assign(cat, { name, icon, color: selectedCatColor });
  } else {
    state.categories.push({ id: uid(), name, icon, color: selectedCatColor });
  }
  saveState();
  catModal.classList.add("hidden");
  renderCategories();
  renderToday();
  renderCalendar();
  populateCatSelect();
});
function renderColorPicker() {
  const picker = document.getElementById("colorPicker");
  picker.innerHTML = "";
  COLORS.forEach(color => {
    const sw = document.createElement("div");
    sw.className = "color-swatch" + (color === selectedCatColor ? " selected" : "");
    sw.style.background = color;
    sw.addEventListener("click", () => {
      selectedCatColor = color;
      renderColorPicker();
    });
    picker.appendChild(sw);
  });
}

/* ---------------------- Notes ---------------------- */
const noteModal = document.getElementById("noteModal");
const folderModal = document.getElementById("folderModal");

function renderNoteFolderStrip() {
  const strip = document.getElementById("noteFolderStrip");
  strip.innerHTML = "";

  const allChip = document.createElement("div");
  allChip.className = "streak-chip" + (selectedNoteFolderFilter === null ? " selected" : "");
  allChip.innerHTML = `<span>🗒️</span><span>Все</span>`;
  allChip.addEventListener("click", () => {
    selectedNoteFolderFilter = null;
    renderNotes();
  });
  strip.appendChild(allChip);

  state.noteFolders.forEach(folder => {
    const count = state.notes.filter(n => n.folderId === folder.id).length;
    const chip = document.createElement("div");
    chip.className = "streak-chip" + (selectedNoteFolderFilter === folder.id ? " selected" : "");
    chip.innerHTML = `<span>📁</span><span>${escapeHtml(folder.name)}</span><span class="flame">${count}</span>`;
    chip.addEventListener("click", () => {
      selectedNoteFolderFilter = selectedNoteFolderFilter === folder.id ? null : folder.id;
      renderNotes();
    });
    chip.addEventListener("dblclick", () => openFolderModal(folder));
    strip.appendChild(chip);
  });

  const addChip = document.createElement("div");
  addChip.className = "streak-chip add-chip";
  addChip.innerHTML = `<span>+</span><span>Папка</span>`;
  addChip.addEventListener("click", () => openFolderModal(null));
  strip.appendChild(addChip);
}

function renderNotes() {
  renderNoteFolderStrip();

  const list = document.getElementById("noteList");
  list.innerHTML = "";

  let notes = [...state.notes];
  if (selectedNoteFolderFilter) {
    notes = notes.filter(n => n.folderId === selectedNoteFolderFilter);
  }
  notes.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (notes.length === 0) {
    list.innerHTML = `<div class="empty-state">Нет заметок.<br>Нажмите «+», чтобы добавить заметку 📝</div>`;
    return;
  }

  notes.forEach(note => {
    const folder = state.noteFolders.find(f => f.id === note.folderId);
    const card = document.createElement("div");
    card.className = "task-card";
    card.style.borderLeftColor = "#fdcb6e";
    card.innerHTML = `
      <div class="task-body">
        <div class="task-title">${escapeHtml(note.title || "Без названия")}</div>
        ${note.content ? `<div class="note-content">${escapeHtml(note.content)}</div>` : ""}
        ${folder ? `<div class="task-meta"><span class="task-cat-badge">📁 ${escapeHtml(folder.name)}</span></div>` : ""}
      </div>
    `;
    card.addEventListener("click", () => openNoteModal(note));
    list.appendChild(card);
  });
}

document.getElementById("addNoteBtn").addEventListener("click", () => openNoteModal(null));

function populateNoteFolderSelect() {
  const select = document.getElementById("noteFolderSelect");
  select.innerHTML = `<option value="">Без папки</option>` +
    state.noteFolders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");
}

function openNoteModal(note) {
  editingNoteId = note ? note.id : null;
  document.getElementById("noteModalTitle").textContent = note ? "Редактировать заметку" : "Новая заметка";
  document.getElementById("noteTitleInput").value = note ? note.title : "";
  populateNoteFolderSelect();
  document.getElementById("noteFolderSelect").value = note ? (note.folderId || "") : (selectedNoteFolderFilter || "");
  document.getElementById("noteContentInput").value = note ? (note.content || "") : "";
  document.getElementById("deleteNoteBtn").classList.toggle("hidden", !note);
  noteModal.classList.remove("hidden");
}

document.getElementById("cancelNoteBtn").addEventListener("click", () => noteModal.classList.add("hidden"));

document.getElementById("saveNoteBtn").addEventListener("click", () => {
  const title = document.getElementById("noteTitleInput").value.trim();
  const content = document.getElementById("noteContentInput").value.trim();
  if (!title && !content) { alert("Введите заголовок или текст заметки"); return; }
  const folderId = document.getElementById("noteFolderSelect").value || null;

  if (editingNoteId) {
    const note = state.notes.find(n => n.id === editingNoteId);
    Object.assign(note, { title, content, folderId, updatedAt: Date.now() });
  } else {
    state.notes.push({ id: uid(), title, content, folderId, updatedAt: Date.now() });
  }
  saveState();
  noteModal.classList.add("hidden");
  renderNotes();
});

document.getElementById("deleteNoteBtn").addEventListener("click", () => {
  if (!editingNoteId) return;
  if (!confirm("Удалить эту заметку?")) return;
  state.notes = state.notes.filter(n => n.id !== editingNoteId);
  saveState();
  noteModal.classList.add("hidden");
  renderNotes();
});

/* ---------------------- Note folders ---------------------- */
function openFolderModal(folder) {
  editingFolderId = folder ? folder.id : null;
  document.getElementById("folderModalTitle").textContent = folder ? "Редактировать папку" : "Новая папка";
  document.getElementById("folderNameInput").value = folder ? folder.name : "";
  document.getElementById("deleteFolderBtn").classList.toggle("hidden", !folder);
  document.getElementById("folderOrderActions").classList.toggle("hidden", !folder || state.noteFolders.length < 2);
  folderModal.classList.remove("hidden");
}

function moveFolder(folderId, toEnd) {
  const idx = state.noteFolders.findIndex(f => f.id === folderId);
  if (idx === -1) return;
  const [folder] = state.noteFolders.splice(idx, 1);
  if (toEnd) state.noteFolders.push(folder);
  else state.noteFolders.unshift(folder);
  saveState();
  folderModal.classList.add("hidden");
  renderNotes();
}

document.getElementById("folderToStartBtn").addEventListener("click", () => moveFolder(editingFolderId, false));
document.getElementById("folderToEndBtn").addEventListener("click", () => moveFolder(editingFolderId, true));

document.getElementById("cancelFolderBtn").addEventListener("click", () => folderModal.classList.add("hidden"));

document.getElementById("saveFolderBtn").addEventListener("click", () => {
  const name = document.getElementById("folderNameInput").value.trim();
  if (!name) { alert("Введите название папки"); return; }

  if (editingFolderId) {
    const folder = state.noteFolders.find(f => f.id === editingFolderId);
    Object.assign(folder, { name });
  } else {
    state.noteFolders.push({ id: uid(), name });
  }
  saveState();
  folderModal.classList.add("hidden");
  renderNotes();
});

document.getElementById("deleteFolderBtn").addEventListener("click", () => {
  if (!editingFolderId) return;
  if (!confirm("Удалить эту папку? Заметки останутся, но без папки.")) return;
  state.notes.forEach(n => { if (n.folderId === editingFolderId) n.folderId = null; });
  state.noteFolders = state.noteFolders.filter(f => f.id !== editingFolderId);
  if (selectedNoteFolderFilter === editingFolderId) selectedNoteFolderFilter = null;
  saveState();
  folderModal.classList.add("hidden");
  renderNotes();
});

/* ---------------------- Task modal ---------------------- */
const taskModal = document.getElementById("taskModal");

function populateCatSelect() {
  const select = document.getElementById("taskCatSelect");
  select.innerHTML = state.categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");
}

document.getElementById("addTaskBtn").addEventListener("click", () => openTaskModal(null));

function openTaskModal(task) {
  editingTaskId = task ? task.id : null;
  document.getElementById("modalTitle").textContent = task ? "Редактировать квест" : "Новый квест";
  document.getElementById("taskTitleInput").value = task ? task.title : "";
  document.getElementById("taskCommentInput").value = task ? (task.comment || "") : "";
  populateCatSelect();
  document.getElementById("taskCatSelect").value = task ? task.catId : state.categories[0]?.id;
  document.getElementById("taskDateInput").value = task ? task.date : todayStr(currentDate);
  document.getElementById("taskTimeInput").value = task ? (task.time || "") : "";
  document.getElementById("taskRepeatSelect").value = task ? task.repeat : "none";
  document.getElementById("taskReminderSelect").value = task ? String(task.reminder || 0) : "0";
  document.getElementById("taskXpInput").value = task ? task.xp : 10;
  document.getElementById("deleteTaskBtn").classList.toggle("hidden", !task);
  taskModal.classList.remove("hidden");
}

document.getElementById("cancelTaskBtn").addEventListener("click", () => taskModal.classList.add("hidden"));

document.getElementById("saveTaskBtn").addEventListener("click", () => {
  const title = document.getElementById("taskTitleInput").value.trim();
  if (!title) { alert("Введите название задачи"); return; }
  const comment = document.getElementById("taskCommentInput").value.trim();
  const catId = document.getElementById("taskCatSelect").value;
  const date = document.getElementById("taskDateInput").value || todayStr();
  const time = document.getElementById("taskTimeInput").value;
  const repeat = document.getElementById("taskRepeatSelect").value;
  const reminder = parseInt(document.getElementById("taskReminderSelect").value, 10) || 0;
  const xp = Math.max(1, parseInt(document.getElementById("taskXpInput").value) || 10);

  if (editingTaskId) {
    const task = state.tasks.find(t => t.id === editingTaskId);
    Object.assign(task, { title, comment, catId, date, time, repeat, reminder, xp });
  } else {
    state.tasks.push({ id: uid(), title, comment, catId, date, time, repeat, reminder, xp, completions: {} });
  }
  saveState();
  taskModal.classList.add("hidden");
  renderToday();
  scheduleNotifications();
});

/* ---------------------- Alarm integration ---------------------- */
document.getElementById("setAlarmBtn").addEventListener("click", () => {
  const time = document.getElementById("taskTimeInput").value;
  const reminder = parseInt(document.getElementById("taskReminderSelect").value, 10) || 0;
  openAlarmShortcut(subtractMinutes(time, reminder));
});

document.getElementById("deleteTaskBtn").addEventListener("click", () => {
  if (!editingTaskId) return;
  if (!confirm("Удалить этот квест?")) return;
  state.tasks = state.tasks.filter(t => t.id !== editingTaskId);
  saveState();
  taskModal.classList.add("hidden");
  renderToday();
  scheduleNotifications();
});

/* ---------------------- Meetings ---------------------- */
const meetingModal = document.getElementById("meetingModal");

function meetingsForDate(dateStr) {
  return state.meetings.filter(m => taskOccursOn(m, dateStr));
}

// Returns the date string for which "today's" completion checkbox should apply, or null if not applicable now
function meetingActiveDate(meeting) {
  if (meeting.repeat === "none") return meeting.date;
  return taskOccursOn(meeting, todayStr()) ? todayStr() : null;
}

function isMeetingDone(meeting, dateStr) {
  return !!(meeting.completions && meeting.completions[dateStr]);
}

function toggleMeetingDone(meeting, dateStr) {
  if (!meeting.completions) meeting.completions = {};
  const done = isMeetingDone(meeting, dateStr);
  const xp = meeting.xp || 15;
  if (done) {
    delete meeting.completions[dateStr];
    removeXp(xp);
  } else {
    meeting.completions[dateStr] = true;
    addXp(xp);
    checkAchievements();
  }
  saveState();
  renderMeetings();
  renderCalendar();
}

// Whether a one-off meeting should still be shown in the Встречи list:
// completed one-off meetings are dropped once their date is in the past.
function meetingVisibleInList(meeting) {
  if (meeting.repeat !== "none") return true;
  if (isMeetingDone(meeting, meeting.date)) return false;
  return true;
}

const repeatLabels = { none: "", daily: "Каждый день", weekly: "Каждую неделю" };

function createMeetingCard(meeting, dateStr) {
  const done = isMeetingDone(meeting, dateStr);

  const card = document.createElement("div");
  card.className = "task-card" + (done ? " done" : "");
  card.style.borderLeftColor = MEETING_COLOR;

  const dateLabel = parseDate(meeting.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const xp = meeting.xp || 15;

  card.innerHTML = `
    <button class="task-checkbox">${done ? "✓" : ""}</button>
    <div class="task-body">
      <div class="task-title">${escapeHtml(meeting.title)}</div>
      ${meeting.comment ? `<div class="task-comment">${escapeHtml(meeting.comment)}</div>` : ""}
      <div class="task-meta">
        <span>📅 ${dateLabel}</span>
        ${meeting.time ? `<span>⏰ ${meeting.time}</span>` : ""}
        <span class="task-cat-badge" style="background:${MEETING_COLOR}33;color:${MEETING_COLOR}">🤝 Встреча</span>
        ${repeatLabels[meeting.repeat] ? `<span>🔁 ${repeatLabels[meeting.repeat]}</span>` : ""}
        <span class="task-xp">+${xp} XP</span>
      </div>
    </div>
  `;
  card.querySelector(".task-checkbox").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMeetingDone(meeting, dateStr);
  });
  card.addEventListener("click", () => openMeetingModal(meeting));
  return card;
}

function renderMeetings() {
  setMeetingTab(meetingTab);
  const list = document.getElementById("meetingList");
  list.innerHTML = "";

  let sorted;
  if (meetingTab === "active") {
    sorted = [...state.meetings]
      .filter(meetingVisibleInList)
      .sort((a,b) => (a.date + (a.time||"00:00")).localeCompare(b.date + (b.time||"00:00")));
  } else {
    sorted = [...state.meetings]
      .filter(m => m.repeat === "none" && isMeetingDone(m, m.date))
      .sort((a,b) => (b.date + (b.time||"00:00")).localeCompare(a.date + (a.time||"00:00")));
  }

  if (sorted.length === 0) {
    list.innerHTML = meetingTab === "active"
      ? `<div class="empty-state">Нет встреч.<br>Нажмите «+», чтобы добавить встречу 🤝</div>`
      : `<div class="empty-state">Нет выполненных встреч.</div>`;
    return;
  }

  sorted.forEach(meeting => {
    const activeDate = meetingActiveDate(meeting) || meeting.date;
    list.appendChild(createMeetingCard(meeting, activeDate));
  });
}

document.getElementById("addMeetingBtn").addEventListener("click", () => openMeetingModal(null));

function openMeetingModal(meeting) {
  editingMeetingId = meeting ? meeting.id : null;
  document.getElementById("meetingModalTitle").textContent = meeting ? "Редактировать встречу" : "Новая встреча";
  document.getElementById("meetingTitleInput").value = meeting ? meeting.title : "";
  document.getElementById("meetingCommentInput").value = meeting ? (meeting.comment || "") : "";
  document.getElementById("meetingDateInput").value = meeting ? meeting.date : todayStr();
  document.getElementById("meetingTimeInput").value = meeting ? (meeting.time || "") : "";
  document.getElementById("meetingReminderSelect").value = meeting ? String(meeting.reminder || 0) : "0";
  document.getElementById("meetingXpInput").value = meeting ? (meeting.xp || 15) : 15;
  document.getElementById("deleteMeetingBtn").classList.toggle("hidden", !meeting);
  meetingModal.classList.remove("hidden");
}

document.getElementById("cancelMeetingBtn").addEventListener("click", () => meetingModal.classList.add("hidden"));

document.getElementById("saveMeetingBtn").addEventListener("click", () => {
  const title = document.getElementById("meetingTitleInput").value.trim();
  if (!title) { alert("Введите название встречи"); return; }
  const comment = document.getElementById("meetingCommentInput").value.trim();
  const date = document.getElementById("meetingDateInput").value || todayStr();
  const time = document.getElementById("meetingTimeInput").value;
  const reminder = parseInt(document.getElementById("meetingReminderSelect").value, 10) || 0;
  const xp = Math.max(1, parseInt(document.getElementById("meetingXpInput").value, 10) || 15);

  if (editingMeetingId) {
    const meeting = state.meetings.find(m => m.id === editingMeetingId);
    Object.assign(meeting, { title, comment, date, time, reminder, xp });
  } else {
    state.meetings.push({ id: uid(), title, comment, date, time, repeat: "none", reminder, xp, completions: {} });
  }
  saveState();
  meetingModal.classList.add("hidden");
  renderMeetings();
  renderCalendar();
  renderToday();
  scheduleNotifications();
});

document.getElementById("deleteMeetingBtn").addEventListener("click", () => {
  if (!editingMeetingId) return;
  if (!confirm("Удалить эту встречу?")) return;
  state.meetings = state.meetings.filter(m => m.id !== editingMeetingId);
  saveState();
  meetingModal.classList.add("hidden");
  renderMeetings();
  renderCalendar();
  renderToday();
  scheduleNotifications();
});

document.getElementById("setMeetingAlarmBtn").addEventListener("click", () => {
  const time = document.getElementById("meetingTimeInput").value;
  const reminder = parseInt(document.getElementById("meetingReminderSelect").value, 10) || 0;
  openAlarmShortcut(subtractMinutes(time, reminder));
});

/* ---------------------- Profile / Achievements ---------------------- */
function renderProfile() {
  const avatar = document.getElementById("avatar");
  const safePhoto = state.profilePhoto && /^data:image\//.test(state.profilePhoto) ? state.profilePhoto : null;
  avatar.innerHTML = safePhoto ? `<img src="${safePhoto}" alt="avatar">` : "🧙";

  const nameInput = document.getElementById("profileNameInput");
  if (document.activeElement !== nameInput) {
    nameInput.value = state.profileName || "";
  }

  document.getElementById("profileLevel").textContent = `Уровень ${state.level}`;
  document.getElementById("profileXp").textContent = `${state.xp} / ${xpForLevel(state.level)} XP до следующего уровня`;

  const streakList = document.getElementById("streakList");
  streakList.innerHTML = state.categories.map(cat => {
    const streak = computeStreak(cat.id);
    return `<div class="streak-row">${cat.icon} <strong>${escapeHtml(cat.name)}</strong> — серия ${streak} дн. ${streak > 0 ? "🔥" : ""}</div>`;
  }).join("") || `<div class="empty-state">Добавьте сферы и задачи</div>`;

  const achStats = computeAchievementStats();
  const achList = document.getElementById("achList");
  achList.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = a.check(achStats);
    return `<div class="ach-item ${unlocked ? "" : "locked"}">
      <span class="ach-emoji">${a.emoji}</span>
      <div class="ach-text">
        <div class="ach-title">${a.title}</div>
        <div class="ach-desc">${a.desc}</div>
      </div>
      ${unlocked ? "✅" : "🔒"}
    </div>`;
  }).join("");
}

function computeAchievementStats() {
  let totalDone = 0;
  state.tasks.forEach(t => totalDone += Object.keys(t.completions).length);
  state.meetings.forEach(m => totalDone += Object.keys(m.completions || {}).length);

  const maxStreak = maxStreakAcrossCategories();

  // check if all categories have at least one done task today
  const dateStr = todayStr();
  const allAreasOneDay = state.categories.length > 0 && state.categories.every(cat => {
    return tasksForDate(dateStr).some(t => t.catId === cat.id && isTaskDone(t, dateStr));
  });

  return { totalDone, maxStreak, level: state.level, allAreasOneDay };
}

function checkAchievements() {
  const stats = computeAchievementStats();
  ACHIEVEMENTS.forEach(a => {
    if (a.check(stats) && !state.unlockedAchievements.includes(a.id)) {
      state.unlockedAchievements.push(a.id);
      showToast(`${a.emoji} Достижение: ${a.title}`);
    }
  });
  saveState();
}

/* ---------------------- Profile name & photo ---------------------- */
document.getElementById("avatar").addEventListener("click", () => {
  document.getElementById("photoInput").click();
});

document.getElementById("photoInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.profilePhoto = reader.result;
    saveState();
    renderProfile();
  };
  reader.readAsDataURL(file);
});

document.getElementById("profileNameInput").addEventListener("input", (e) => {
  state.profileName = e.target.value;
  saveState();
});

/* ---------------------- Alarm setup instructions ---------------------- */
document.getElementById("alarmSetupBtn").addEventListener("click", () => {
  const card = document.getElementById("alarmSetupCard");
  if (!card.classList.contains("hidden")) {
    card.classList.add("hidden");
    return;
  }
  card.innerHTML =
    `Чтобы кнопка «📱 Поставить будильник на телефоне» реально создавала будильник в приложении Часы — один раз настройте команду в приложении «Команды» (Shortcuts):\n\n` +
    `1. Откройте «Команды» → вкладка «Команды моих программ» → «+»\n` +
    `2. Добавьте действие «Дата» и в поле выберите магическую переменную «Входные данные команды» (Shortcut Input), формат «Особый», шаблон «ЧЧ:мм»\n` +
    `3. Добавьте действие «Установить будильник», в поле времени выберите результат предыдущего шага «Дата», отключите «Показывать при выполнении»\n` +
    `4. Назовите команду ровно так: «${ALARM_SHORTCUT_NAME}»\n` +
    `5. Откройте детали команды (значок «···») и отключите «Спрашивать перед запуском»\n\n` +
    `После этого при нажатии кнопки в приложении откроется «Команды» и автоматически создаст будильник на указанное время — без подтверждений.`;
  card.classList.remove("hidden");
});

/* ---------------------- Data export / import ---------------------- */
document.getElementById("exportDataBtn").addEventListener("click", () => {
  const card = document.getElementById("dataTransferCard");
  const area = document.getElementById("dataTransferArea");
  const actionBtn = document.getElementById("dataTransferActionBtn");
  area.value = JSON.stringify(state);
  area.readOnly = true;
  actionBtn.textContent = "Скопировать в буфер";
  actionBtn.onclick = () => {
    area.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(area.value).then(() => showToast("📋 Скопировано")).catch(() => {
        document.execCommand("copy");
        showToast("📋 Скопировано");
      });
    } else {
      document.execCommand("copy");
      showToast("📋 Скопировано");
    }
  };
  card.classList.remove("hidden");
});

document.getElementById("importDataBtn").addEventListener("click", () => {
  const card = document.getElementById("dataTransferCard");
  const area = document.getElementById("dataTransferArea");
  const actionBtn = document.getElementById("dataTransferActionBtn");
  area.value = "";
  area.readOnly = false;
  area.placeholder = "Вставьте сюда скопированный код";
  actionBtn.textContent = "Загрузить данные";
  actionBtn.onclick = () => {
    try {
      const data = JSON.parse(area.value);
      state = Object.assign(loadDefaults(), data);
      saveState();
      init();
      card.classList.add("hidden");
      showToast("✅ Данные импортированы");
    } catch (e) {
      alert("Не удалось прочитать данные. Проверьте, что код скопирован полностью.");
    }
  };
  card.classList.remove("hidden");
});

/* ---------------------- Notifications ---------------------- */
const notifBtn = document.getElementById("notifBtn");

function updateNotifBtn() {
  if ("Notification" in window && Notification.permission === "granted") {
    notifBtn.classList.add("active");
  } else {
    notifBtn.classList.remove("active");
  }
}

notifBtn.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    alert("Браузер не поддерживает уведомления");
    return;
  }
  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      showToast("🔔 Напоминания включены");
      scheduleNotifications();
    }
  } else if (Notification.permission === "granted") {
    showToast("Напоминания уже включены");
  } else {
    alert("Уведомления заблокированы в настройках браузера. Разрешите их вручную, чтобы получать напоминания.");
  }
  updateNotifBtn();
});

let scheduledTimers = [];
function scheduleNotifications() {
  scheduledTimers.forEach(clearTimeout);
  scheduledTimers = [];
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const now = new Date();
  const dateStr = todayStr();
  const tasks = tasksForDate(dateStr);

  tasks.forEach(task => {
    if (!task.time || isTaskDone(task, dateStr)) return;
    const [h,m] = task.time.split(":").map(Number);
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    const diff = target - now;
    if (diff > 0 && diff < 1000*60*60*24) {
      const cat = state.categories.find(c => c.id === task.catId);
      const timer = setTimeout(() => {
        new Notification("⏰ Результат — пора действовать!", {
          body: `${cat ? cat.icon + " " : ""}${task.title}`,
          icon: "icon.svg"
        });
      }, diff);
      scheduledTimers.push(timer);
    }
  });

  const meetings = meetingsForDate(dateStr);
  meetings.forEach(meeting => {
    if (!meeting.time) return;
    const [h,m] = meeting.time.split(":").map(Number);
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    const diff = target - now;
    if (diff > 0 && diff < 1000*60*60*24) {
      const timer = setTimeout(() => {
        new Notification("🤝 Встреча — " + meeting.title, {
          body: meeting.comment || "Время встречи",
          icon: "icon.svg"
        });
      }, diff);
      scheduledTimers.push(timer);
    }
  });
}

/* ---------------------- Init ---------------------- */
function autoRollover() {
  const today = todayStr();
  let changed = false;
  state.tasks.forEach(t => {
    if (t.repeat === "none" && !t.done && t.date < today) {
      t.date = today;
      changed = true;
    }
  });
  state.meetings.forEach(m => {
    if (m.repeat === "none" && !isMeetingDone(m, m.date) && m.date < today) {
      m.date = today;
      changed = true;
    }
  });
  if (changed) saveState();
}

function init() {
  populateCatSelect();
  document.getElementById("taskDateInput").value = todayStr();
  renderLevel();
  renderToday();
  renderMeetings();
  renderCalendar();
  renderCategories();
  renderProfile();
  updateNotifBtn();
  scheduleNotifications();

  setInterval(() => {
    renderToday();
    renderMeetings();
    renderCalendar();
    scheduleNotifications();
  }, 60 * 1000);
}

init();
