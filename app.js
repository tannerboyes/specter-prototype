/* Specter Prototype tracker — rendering logic. Edit data.js, not this file, to update content. */

/* ---------- Supabase sync ---------- */
/*
 * Shared data store so Tasks/Bench/Shipments/Build Log sync across every
 * browser and device instead of being stuck in one browser's localStorage.
 * The publishable key is meant to be public in client-side code; access
 * control is the app's own password gate, not this key.
 */

const SUPABASE_URL = "https://mopbcmurfguubahthaho.supabase.co";
const SUPABASE_KEY = "sb_publishable_jQQaI6HbSvwePBQxGqZFgA_niWC1QFe";

async function supabaseFetchTable(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=data`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase fetch failed for ${table}: ${res.status}`);
  const rows = await res.json();
  return rows.map((r) => r.data);
}

/*
 * Per-table snapshot of what this browser last saw on (or sent to) the
 * server: id -> JSON string. Saving compares against it so a browser only
 * sends what IT changed:
 *  - items new or edited here are upserted;
 *  - items this browser knew about and then removed are deleted by id;
 *  - anything it never saw (added from another device after this page
 *    loaded) is left alone, so a stale tab can't wipe other people's work.
 */
const syncedSnapshot = {};

function rememberSynced(table, items) {
  const snap = {};
  items.forEach((it) => { if (it && it.id) snap[it.id] = JSON.stringify(it); });
  syncedSnapshot[table] = snap;
}

async function supabaseSyncTable(table, items) {
  const prev = syncedSnapshot[table] || {};
  const changed = items.filter((it) => it && it.id && prev[it.id] !== JSON.stringify(it));
  const currentIds = new Set(items.map((it) => it && it.id));
  const removedIds = Object.keys(prev).filter((id) => !currentIds.has(id));
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  try {
    for (const id of removedIds) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) delete prev[id];
    }
    if (changed.length > 0) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(changed.map((it) => ({ id: it.id, data: it, updated_at: new Date().toISOString() }))),
      });
      if (res.ok) changed.forEach((it) => { prev[it.id] = JSON.stringify(it); });
    }
    syncedSnapshot[table] = prev;
  } catch (e) {
    console.warn(`Supabase sync failed for ${table}`, e);
  }
}

async function bootstrapFromSupabase() {
  try {
    // Promise.allSettled, not Promise.all: one missing/broken table (e.g. a
    // migration SQL step never run) must not abort syncing for every other
    // table too. Each table below only updates if ITS OWN fetch succeeded;
    // a failed fetch leaves that table's local data untouched this round.
    const [tasksResult, benchResult, shipsResult, logResult, projsResult] = await Promise.allSettled([
      supabaseFetchTable("tasks"),
      supabaseFetchTable("bench_items"),
      supabaseFetchTable("shipments"),
      supabaseFetchTable("activity_log"),
      supabaseFetchTable("projects"),
    ]);

    // If the shared table is empty but this browser already has local data
    // (e.g. the first load after turning this on), push it up instead of
    // wiping it with the empty remote table.
    if (tasksResult.status === "fulfilled") {
      const tasks = tasksResult.value;
      rememberSynced("tasks", tasks);
      if (tasks.length === 0 && taskItems.length > 0) supabaseSyncTable("tasks", taskItems);
      else taskItems = tasks;
    } else {
      console.warn("Supabase fetch failed for tasks, keeping local data", tasksResult.reason);
    }

    if (benchResult.status === "fulfilled") {
      const bench = benchResult.value;
      rememberSynced("bench_items", bench);
      if (bench.length === 0 && benchItems.length > 0) supabaseSyncTable("bench_items", benchItems);
      else benchItems = bench;
    } else {
      console.warn("Supabase fetch failed for bench_items, keeping local data", benchResult.reason);
    }

    if (shipsResult.status === "fulfilled") {
      const ships = shipsResult.value;
      rememberSynced("shipments", ships);
      if (ships.length === 0 && shipments.length > 0) supabaseSyncTable("shipments", shipments);
      else shipments = ships;
    } else {
      console.warn("Supabase fetch failed for shipments, keeping local data", shipsResult.reason);
    }

    if (logResult.status === "fulfilled") {
      const log = logResult.value;
      rememberSynced("activity_log", log);
      if (log.length === 0 && activityLog.length > 0) supabaseSyncTable("activity_log", activityLog);
      else activityLog = log;
    } else {
      console.warn("Supabase fetch failed for activity_log, keeping local data", logResult.reason);
    }

    if (projsResult.status === "fulfilled") {
      const projs = projsResult.value;
      rememberSynced("projects", projs);
      if (projs.length === 0 && projects.length > 0) supabaseSyncTable("projects", projects);
      else projects = projs;
    } else {
      console.warn("Supabase fetch failed for projects, keeping local data", projsResult.reason);
    }

    ensureDefaultProject();

    try {
      localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(taskItems));
      localStorage.setItem(BENCH_STORAGE_KEY, JSON.stringify(benchItems));
      localStorage.setItem(SHIPMENT_STORAGE_KEY, JSON.stringify(shipments));
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(activityLog));
      localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
    } catch (e) {}
    renderAll();
    renderProjectSelector();
  } catch (e) {
    console.warn("Supabase bootstrap failed, showing local data only", e);
  }
}

/* ---------- Projects ---------- */
/*
 * Multiple cars/projects can share this one site. Every task/bench/
 * shipment/log entry carries a projectId; the sidebar dropdown picks
 * which project's data is currently shown.
 */

const PROJECT_STORAGE_KEY = "specter-projects";
const ACTIVE_PROJECT_KEY = "specter-active-project";
const DEFAULT_PROJECT_ID = "proj-default";
let projects = [];
let activeProjectId = null;

function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveProjects() {
  try { localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects)); } catch (e) {}
  supabaseSyncTable("projects", projects);
}

function loadActiveProjectId() {
  try { return localStorage.getItem(ACTIVE_PROJECT_KEY); } catch (e) { return null; }
}

function setActiveProjectId(id) {
  activeProjectId = id;
  try { localStorage.setItem(ACTIVE_PROJECT_KEY, id); } catch (e) {}
}

// Makes sure a project always exists and every item belongs to one —
// migrates any pre-multi-project data (no projectId, or a projectId that no
// longer matches any project — e.g. recovering items orphaned by a previous
// sync race) onto a single default/fallback project.
//
// persist=false skips writing to localStorage/Supabase entirely: used for
// the very first synchronous render on load, before bootstrapFromSupabase()
// has had a chance to pull down the real remote state. Without this, a
// fresh install with empty local storage would push its (incomplete, local
// state) default project up to Supabase and delete every other project
// that was only known to the server — exactly what caused a real data-loss
// bug here.
function ensureDefaultProject(persist) {
  if (persist === undefined) persist = true;

  if (projects.length === 0) {
    projects = [{
      id: DEFAULT_PROJECT_ID,
      name: DATA.meta.carName || "Default Project",
      createdAt: DATA.meta.updated || new Date().toISOString().slice(0, 10),
    }];
    if (persist) saveProjects();
  }

  const fallbackId = projects[0].id;
  const validIds = new Set(projects.map((p) => p.id));
  let changed = false;
  [taskItems, benchItems, shipments, activityLog].forEach((arr) => {
    arr.forEach((item) => {
      if (!item.projectId || !validIds.has(item.projectId)) {
        item.projectId = fallbackId;
        changed = true;
      }
    });
  });
  if (changed && persist) {
    saveTaskItems();
    saveBenchItems();
    saveShipments();
    saveActivityLog();
  }

  if (!activeProjectId || !projects.some((p) => p.id === activeProjectId)) {
    setActiveProjectId(projects[0].id);
  }
}

function inActiveProject(item) {
  return item.projectId === activeProjectId;
}

// A plain <select> for moving a miscategorized task/bench item to a
// different project. Omitted entirely when there's nowhere else to move it.
function moveSelectHtml(item) {
  const others = projects.filter((p) => p.id !== item.projectId);
  if (others.length === 0) return "";
  return `
    <select class="move-project-select" data-item="${escapeAttr(item.id)}" aria-label="Move to another project">
      <option value="" selected disabled>Move to&hellip;</option>
      ${others.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`).join("")}
    </select>
  `;
}

function renderAll() {
  renderDashboard();
  renderTasks();
  renderBench();
  renderShipments();
  renderLog();
}

function switchProject(id) {
  setActiveProjectId(id);
  taskFormOpen = false;
  taskEditingId = null;
  benchFormOpen = false;
  benchEditingId = null;
  renderAll();
  renderProjectSelector();
}

function addProjectPrompt() {
  const name = prompt("Name this project (e.g. Car No. 2):");
  if (!name || !name.trim()) return;
  const project = {
    id: "proj" + Date.now(),
    name: name.trim(),
    createdAt: new Date().toISOString().slice(0, 10),
  };
  projects.push(project);
  saveProjects();
  switchProject(project.id);
}

function renameProject(id) {
  const project = projects.find((p) => p.id === id);
  if (!project) return;
  const name = prompt("Rename project:", project.name);
  if (!name || !name.trim() || name.trim() === project.name) return;
  project.name = name.trim();
  saveProjects();
  renderProjectSelector();
}

function deleteProject(id) {
  const project = projects.find((p) => p.id === id);
  if (!project) return;
  if (projects.length <= 1) {
    alert("You need at least one project — add another before deleting this one.");
    return;
  }

  const itemCount =
    taskItems.filter((i) => i.projectId === id).length +
    benchItems.filter((i) => i.projectId === id).length +
    shipments.filter((i) => i.projectId === id).length +
    activityLog.filter((i) => i.projectId === id).length;
  const warning = itemCount > 0
    ? `Delete "${project.name}"? This permanently deletes its ${itemCount} item${itemCount === 1 ? "" : "s"} (tasks, bench items, shipments, log entries). This can't be undone.`
    : `Delete "${project.name}"? This can't be undone.`;
  if (!confirm(warning)) return;

  projects = projects.filter((p) => p.id !== id);
  taskItems = taskItems.filter((i) => i.projectId !== id);
  benchItems = benchItems.filter((i) => i.projectId !== id);
  shipments = shipments.filter((i) => i.projectId !== id);
  activityLog = activityLog.filter((i) => i.projectId !== id);

  saveProjects();
  saveTaskItems();
  saveBenchItems();
  saveShipments();
  saveActivityLog();

  if (activeProjectId === id) {
    setActiveProjectId(projects[0].id);
  }
  taskFormOpen = false;
  taskEditingId = null;
  benchFormOpen = false;
  benchEditingId = null;
  renderAll();
  renderProjectSelector();
}

function closeProjectMenu() {
  const menu = document.getElementById("project-picker-menu");
  const trigger = document.getElementById("project-picker-trigger");
  if (menu) menu.hidden = true;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function renderProjectSelector() {
  const container = document.getElementById("project-selector");
  if (!container) return;
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const rows = projects
    .map((p) => `
      <div class="project-picker-row ${p.id === activeProjectId ? "is-active" : ""}">
        <button type="button" class="project-picker-name" data-select="${escapeAttr(p.id)}">${escapeHtml(p.name)}</button>
        <div class="project-picker-row-actions">
          <button type="button" class="project-picker-icon-btn" data-rename="${escapeAttr(p.id)}" aria-label="Rename project" title="Rename project">${pencilIconHtml()}</button>
          <button type="button" class="project-picker-icon-btn project-picker-icon-btn-danger" data-delete="${escapeAttr(p.id)}" aria-label="Delete project" title="Delete project">${trashIconHtml()}</button>
        </div>
      </div>
    `)
    .join("");

  container.innerHTML = `
    <div class="project-picker" id="project-picker">
      <button type="button" id="project-picker-trigger" class="project-picker-trigger" aria-haspopup="true" aria-expanded="false">
        <span class="project-picker-label">${escapeHtml(activeProject ? activeProject.name : "Select project")}</span>
        <span class="project-picker-chevron">&#9662;</span>
      </button>
      <div class="project-picker-menu" id="project-picker-menu" hidden>
        ${rows}
        <button type="button" class="project-picker-add" data-add="1">+ Add a project&hellip;</button>
      </div>
    </div>
  `;

  const trigger = document.getElementById("project-picker-trigger");
  const menu = document.getElementById("project-picker-menu");

  trigger.addEventListener("click", () => {
    const open = !menu.hidden;
    if (open) {
      closeProjectMenu();
    } else {
      // Positioned via fixed + JS (not CSS absolute) so the sidebar's own
      // overflow-y:auto can't clip the menu and hide options at the bottom.
      const rect = trigger.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.left = `${rect.left}px`;
      menu.style.width = `${rect.width}px`;
      menu.style.maxHeight = `${Math.min(260, window.innerHeight - rect.bottom - 16)}px`;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    }
  });

  menu.addEventListener("click", (e) => {
    const selectBtn = e.target.closest("[data-select]");
    const renameBtn = e.target.closest("[data-rename]");
    const deleteBtn = e.target.closest("[data-delete]");
    const addBtn = e.target.closest("[data-add]");

    if (renameBtn) {
      e.stopPropagation();
      renameProject(renameBtn.dataset.rename);
      return;
    }
    if (deleteBtn) {
      e.stopPropagation();
      deleteProject(deleteBtn.dataset.delete);
      return;
    }
    if (addBtn) {
      closeProjectMenu();
      addProjectPrompt();
      return;
    }
    if (selectBtn) {
      closeProjectMenu();
      if (selectBtn.dataset.select !== activeProjectId) switchProject(selectBtn.dataset.select);
    }
  });
}

document.addEventListener("click", (e) => {
  const picker = document.getElementById("project-picker");
  if (picker && !picker.contains(e.target)) closeProjectMenu();
});

/* ---------- Dashboard ---------- */

// Downloads everything (every project's tasks/bench items/shipments/log) as
// one JSON file — a manual backup independent of Supabase/localStorage, so
// there's always a copy in the user's own hands.
function exportAllData() {
  const backup = {
    exportedAt: new Date().toISOString(),
    projects,
    tasks: taskItems,
    benchItems,
    shipments,
    activityLog,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `specter-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderDashboard() {
  const openTasks = taskItems.filter((t) => inActiveProject(t) && !t.done).length;
  const doneTasks = taskItems.filter((t) => inActiveProject(t) && t.done).length;
  const benchOpen = benchItems.filter((b) => inActiveProject(b) && b.status !== "approved").length;
  const shipmentsInbound = shipments.filter((s) => inActiveProject(s) && (s.status === "ordered" || s.status === "in-transit")).length;
  const blockedSystems = DATA.systems.filter((s) => s.status === "blocked").length;

  document.getElementById("dashboard").innerHTML = `
    <h1>Development Dashboard</h1>
    <p class="view-sub">${DATA.meta.tagline}</p>

    <button type="button" id="export-data-btn" class="bench-secondary-btn">Export data (backup)</button>

    <div class="grid">
      <div class="card card-link" data-nav="tasks">
        <div class="card-title">Open Tasks</div>
        <div class="card-value">${openTasks}</div>
      </div>
      <div class="card card-link" data-nav="tasks">
        <div class="card-title">Completed Tasks</div>
        <div class="card-value">${doneTasks}</div>
      </div>
      <div class="card card-link" data-nav="bench">
        <div class="card-title">Bench Decisions Needed</div>
        <div class="card-value">${benchOpen}</div>
      </div>
      <div class="card card-link" data-nav="shipments">
        <div class="card-title">Shipments Inbound</div>
        <div class="card-value">${shipmentsInbound}</div>
      </div>
      ${blockedSystems > 0 ? `
      <div class="card">
        <div class="card-title">Blocked Systems</div>
        <div class="card-value" style="color:var(--red)">${blockedSystems}</div>
      </div>` : ""}
    </div>

    <h2>Recent Log Entries</h2>
    ${allProjectsLogEntries().slice(0, 3).map((e) => logEntryHtml(e, false, true)).join("") || `<p class="view-sub">No entries yet.</p>`}
  `;

  document.querySelectorAll("#dashboard .card-link").forEach((card) => {
    card.addEventListener("click", () => showView(card.dataset.nav));
  });

  document.getElementById("export-data-btn").addEventListener("click", exportAllData);
}


/* ---------- Tasks ---------- */
/*
 * Things to check, measure or decide at the shop — nothing to buy (that's
 * what Bench is for). No backend, so persisted per-browser in localStorage.
 */

const TASK_STORAGE_KEY = "specter-task-items";
let taskItems = [];
let taskFormOpen = false;
let taskLinkCounter = 0;
let taskEditingId = null;
let taskTechFilter = "";

const TECHNICIANS = ["Tanner", "Angel", "Skyler", "Jason"];

function techMatches(item, name) {
  return (item.technician || "").trim().toLowerCase() === name.trim().toLowerCase();
}

function projectNameFor(id) {
  const p = projects.find((x) => x.id === id);
  return p ? p.name : "";
}

function loadTaskItems() {
  try {
    const raw = localStorage.getItem(TASK_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveTaskItems() {
  try { localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(taskItems)); } catch (e) {}
  supabaseSyncTable("tasks", taskItems);
}

function taskLinkRowHtml(rowId, link) {
  link = link || {};
  return `
    <div class="bench-link-row" data-row-id="${rowId}">
      <input type="text" class="al-label" placeholder="Link name (optional)" value="${escapeAttr(link.label || "")}" />
      <input type="url" class="al-url" placeholder="https://..." value="${escapeAttr(link.url || "")}" />
      <button type="button" class="bench-remove-option" data-remove-link="${rowId}">Remove</button>
    </div>
  `;
}

function taskFormHtml() {
  const editing = taskEditingId ? taskItems.find((i) => i.id === taskEditingId) : null;
  const linkRowsHtml = editing
    ? editing.links.map((l, i) => taskLinkRowHtml("pl" + i, l)).join("")
    : "";

  return `
    <div class="bench-form-panel">
      <h2 class="bench-form-title">${editing ? "Edit task" : "Add a task"}</h2>
      <p class="view-sub">Something to check, measure or decide at the shop.</p>

      <form id="task-form">
        <label class="field-label" for="af-name">Your name</label>
        <input type="text" id="af-name" value="${editing ? escapeAttr(editing.submitter) : ""}" required />

        <label class="field-label" for="af-what">What needs doing</label>
        <input type="text" id="af-what" placeholder="e.g. Confirm the rear door pattern" value="${editing ? escapeAttr(editing.whatNeedsDoing) : ""}" required />

        <label class="field-label" for="af-estimate">Estimated time (optional)</label>
        <input type="text" id="af-estimate" placeholder="e.g. 2 hours" value="${editing ? escapeAttr(editing.estimatedTime || "") : ""}" />

        <label class="field-label" for="af-category">Category</label>
        <input type="text" id="af-category" placeholder="e.g. Interior" value="${editing ? escapeAttr(editing.category) : ""}" />
        <div class="bench-pills" id="task-category-pills">
          ${TASK_CATEGORIES.map((c) => `<button type="button" class="pill ${editing && editing.category === c ? "active" : ""}" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join("")}
        </div>

        <label class="field-label" for="af-reason">What to check or decide, and why</label>
        <textarea id="af-reason" rows="3" required>${editing ? escapeHtml(editing.reason) : ""}</textarea>

        <label class="field-label" for="af-technician">Technician (optional)</label>
        <input type="text" id="af-technician" placeholder="Who's doing it?" value="${editing ? escapeAttr(editing.technician || "") : ""}" />
        <div class="bench-pills" id="task-tech-pills">
          ${TECHNICIANS.map((t) => `<button type="button" class="pill ${editing && techMatches(editing, t) ? "active" : ""}" data-tech="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join("")}
        </div>

        <label class="field-label" for="af-picture">Photo (optional)</label>
        <input type="text" id="af-picture" class="af-picture" placeholder="Paste a copied image or image link..." value="${editing ? escapeAttr(editing.picture || "") : ""}" />
        <p class="field-hint">Paste a copied screenshot or image directly (Ctrl+V / Cmd+V), or right-click a photo online and "Copy image address" and paste that link instead.</p>

        <div class="bench-options-divider">Reference links (optional)</div>
        <div id="task-links-container">${linkRowsHtml}</div>
        <button type="button" id="task-add-link" class="bench-secondary-btn bench-add-link-btn">+ Add a link</button>

        <div class="bench-form-actions">
          <button type="button" id="task-cancel" class="bench-secondary-btn">Cancel</button>
          <button type="submit" class="bench-primary-btn">${editing ? "Save changes" : "Add"}</button>
        </div>
      </form>
    </div>
  `;
}

function wireTaskForm() {
  const pills = document.getElementById("task-category-pills");
  const categoryInput = document.getElementById("af-category");
  pills.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    categoryInput.value = btn.dataset.cat;
    pills.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p === btn));
  });

  const techPills = document.getElementById("task-tech-pills");
  const techInput = document.getElementById("af-technician");
  techPills.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    techInput.value = btn.dataset.tech;
    techPills.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p === btn));
  });
  techInput.addEventListener("input", () => {
    techPills.querySelectorAll(".pill").forEach((p) =>
      p.classList.toggle("active", p.dataset.tech.toLowerCase() === techInput.value.trim().toLowerCase()));
  });

  const linksContainer = document.getElementById("task-links-container");

  document.getElementById("task-add-link").addEventListener("click", () => {
    taskLinkCounter += 1;
    linksContainer.insertAdjacentHTML("beforeend", taskLinkRowHtml("l" + taskLinkCounter));
  });

  linksContainer.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-link]");
    if (!btn) return;
    document.querySelector(`.bench-link-row[data-row-id="${btn.dataset.removeLink}"]`).remove();
  });

  document.getElementById("task-cancel").addEventListener("click", () => {
    closeTaskForm();
  });

  document.getElementById("task-form").addEventListener("paste", (e) => {
    const pictureInput = e.target.closest(".af-picture");
    if (!pictureInput) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const imageItem = Array.from(items).find((it) => it.type.startsWith("image/"));
    if (!imageItem) return; // not an image — let a pasted link paste normally
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    pictureInput.value = "Processing image...";
    pictureInput.disabled = true;
    resizeImageToDataUrl(file, 1000, 0.75)
      .then((dataUrl) => {
        pictureInput.value = dataUrl;
        pictureInput.disabled = false;
      })
      .catch(() => {
        pictureInput.value = "";
        pictureInput.disabled = false;
        alert("Couldn't read that image. Try pasting a link instead.");
      });
  });

  document.getElementById("task-form").addEventListener("submit", (e) => {
    e.preventDefault();

    const links = Array.from(linksContainer.querySelectorAll(".bench-link-row"))
      .map((row) => ({
        label: row.querySelector(".al-label").value.trim(),
        url: row.querySelector(".al-url").value.trim(),
      }))
      .filter((l) => l.url)
      .map((l) => ({ label: l.label || l.url, url: l.url }));

    const submitter = document.getElementById("af-name").value.trim();
    const whatNeedsDoing = document.getElementById("af-what").value.trim();
    const estimatedTime = document.getElementById("af-estimate").value.trim();
    const category = document.getElementById("af-category").value.trim();
    const reason = document.getElementById("af-reason").value.trim();
    const technician = document.getElementById("af-technician").value.trim();
    const picture = document.getElementById("af-picture").value.trim();

    if (taskEditingId) {
      const item = taskItems.find((i) => i.id === taskEditingId);
      if (item) {
        item.submitter = submitter;
        item.whatNeedsDoing = whatNeedsDoing;
        item.estimatedTime = estimatedTime;
        item.category = category;
        item.reason = reason;
        item.technician = technician;
        item.picture = picture;
        item.links = links;
      }
    } else {
      taskItems.unshift({
        id: "task" + Date.now(),
        projectId: activeProjectId,
        createdAt: new Date().toISOString().slice(0, 10),
        submitter,
        whatNeedsDoing,
        estimatedTime,
        category,
        reason,
        technician,
        picture,
        links,
        done: false,
        doneAt: null,
        actualTime: "",
      });
    }

    saveTaskItems();
    closeTaskForm();
  });
}

function openTaskForm(item) {
  taskFormOpen = true;
  taskEditingId = item ? item.id : null;
  taskLinkCounter = item ? item.links.length : 0;
  renderTasks();
}

function closeTaskForm() {
  taskFormOpen = false;
  taskEditingId = null;
  renderTasks();
  renderDashboard();
}

function taskItemCardHtml(item) {
  return `
    <div class="bench-item-card ${item.done ? "is-done" : ""}">
      <div class="item-head">
        <div class="item-name">
          ${escapeHtml(item.whatNeedsDoing)}
          ${item.category ? `<span class="item-cat">${escapeHtml(item.category)}</span>` : ""}
        </div>
        <span class="badge ${item.done ? "badge-complete" : "badge-in-progress"}">${item.done ? "Done" : "Open"}</span>
      </div>
      <div class="bench-item-meta">${taskTechFilter && projectNameFor(item.projectId) ? `<strong>${escapeHtml(projectNameFor(item.projectId))}</strong> &middot; ` : ""}Added by ${escapeHtml(item.submitter || "Unknown")} &middot; ${escapeHtml(item.createdAt)}${item.estimatedTime ? ` &middot; Est. ${escapeHtml(item.estimatedTime)}` : ""}${item.technician ? ` &middot; Tech: <strong>${escapeHtml(item.technician)}</strong>` : ""}</div>
      <div class="item-notes">${escapeHtml(item.reason)}</div>
      ${item.checkFirst ? `<p class="bench-before"><strong>Check first:</strong> ${escapeHtml(item.checkFirst)}</p>` : ""}
      ${item.picture ? `
        <a href="${escapeAttr(item.picture)}" target="_blank" rel="noopener noreferrer" class="bench-thumb-link" aria-label="View photo">
          <span class="bench-thumb-fallback">&#8599;</span>
          <img src="${escapeAttr(item.picture)}" alt="${escapeAttr(item.whatNeedsDoing || "task photo")}" class="bench-thumb" onerror="this.style.display='none'" />
        </a>` : ""}
      ${item.links.length ? `
        <div class="bench-more-links">
          ${item.links.map((l) => `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`).join("")}
        </div>` : ""}

      ${item.done ? `
      <label class="field-label" for="actual-${item.id}">Actual time (optional)</label>
      <input type="text" id="actual-${item.id}" class="task-actual-time-input" data-item="${item.id}" value="${escapeAttr(item.actualTime || "")}" placeholder="e.g. 3 hours" />
      ` : ""}

      <div class="item-actions-bar">
        <button type="button" class="action-btn" data-edit-item="${item.id}">${pencilIconHtml()} Edit</button>
        ${item.done
          ? `<button type="button" class="action-btn task-reopen-btn" data-item="${item.id}">${reopenIconHtml()} Reopen</button>`
          : `<button type="button" class="action-btn bench-approve-btn" data-item="${item.id}">${checkIconHtml()} Mark done</button>`}
        ${commentActionBtnHtml(item)}
        <button type="button" class="action-btn action-btn-danger bench-delete-item" data-item="${item.id}">${trashIconHtml()} Delete</button>
        ${moveSelectHtml(item)}
      </div>
      ${commentsSectionHtml(item)}
    </div>
  `;
}

function wireTaskList() {
  wireComments("#tasks", taskItems, saveTaskItems, renderTasks);

  document.querySelectorAll("#tasks .task-actual-time-input").forEach((input) => {
    input.addEventListener("change", () => {
      const item = taskItems.find((i) => i.id === input.dataset.item);
      if (!item) return;
      item.actualTime = input.value.trim();
      saveTaskItems();
    });
  });

  document.querySelectorAll("#tasks .move-project-select").forEach((select) => {
    select.addEventListener("change", () => {
      const item = taskItems.find((i) => i.id === select.dataset.item);
      if (!item || !select.value) return;
      item.projectId = select.value;
      saveTaskItems();
      renderTasks();
      renderDashboard();
    });
  });

  document.querySelectorAll("#tasks [data-edit-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = taskItems.find((i) => i.id === btn.dataset.editItem);
      if (item) openTaskForm(item);
    });
  });

  document.querySelectorAll("#tasks .task-reopen-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = taskItems.find((i) => i.id === btn.dataset.item);
      if (!item) return;
      item.done = false;
      item.doneAt = null;
      saveTaskItems();
      renderTasks();
      renderDashboard();
    });
  });

  document.querySelectorAll("#tasks .bench-approve-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = taskItems.find((i) => i.id === btn.dataset.item);
      if (!item) return;
      item.done = true;
      item.doneAt = new Date().toISOString().slice(0, 10);
      saveTaskItems();
      addLogEntry(
        "Task completed",
        `"${item.whatNeedsDoing}"${item.category ? " (" + item.category + ")" : ""} marked done${item.submitter ? " by " + item.submitter : ""}.`
      );
      renderTasks();
      renderDashboard();
      renderLog();
    });
  });

  document.querySelectorAll("#tasks .bench-delete-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this task?")) return;
      taskItems = taskItems.filter((i) => i.id !== btn.dataset.item);
      saveTaskItems();
      renderTasks();
      renderDashboard();
    });
  });
}

function renderTasks() {
  const el = document.getElementById("tasks");

  const header = taskFormOpen
    ? taskFormHtml()
    : `
      <h1>Tasks</h1>
      <p class="view-sub">Things to check, measure or decide at the shop — nothing to buy.</p>
      <button type="button" id="task-open" class="bench-primary-btn">+ Add task</button>
      <label class="field-label" for="task-tech-search">Find a technician's tasks (all projects)</label>
      <input type="text" id="task-tech-search" placeholder="Type a name..." value="${escapeAttr(taskTechFilter)}" />
      <div class="bench-pills" id="task-tech-filter">
        <button type="button" class="pill ${taskTechFilter ? "" : "active"}" data-tech="">This project</button>
        ${TECHNICIANS.map((t) => `<button type="button" class="pill ${taskTechFilter.toLowerCase() === t.toLowerCase() ? "active" : ""}" data-tech="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join("")}
      </div>
    `;

  const shown = taskTechFilter
    ? taskItems.filter((i) => (i.technician || "").toLowerCase().includes(taskTechFilter.toLowerCase()))
    : taskItems.filter(inActiveProject);
  const projectTasks = shown.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  const list = projectTasks.length
    ? `${taskTechFilter ? `<p class="view-sub">Tasks assigned to ${escapeHtml(taskTechFilter)} across all projects &middot; ${projectTasks.filter((i) => !i.done).length} open</p>` : ""}<div class="bench-item-list">${projectTasks.map(taskItemCardHtml).join("")}</div>`
    : `<p class="view-sub">${taskTechFilter ? `No tasks assigned to ${escapeHtml(taskTechFilter)}.` : "Nothing on the list right now."}</p>`;

  el.innerHTML = `${header}<div class="bench-list-wrap">${list}</div>`;

  if (taskFormOpen) {
    wireTaskForm();
  } else {
    document.getElementById("task-open").addEventListener("click", () => openTaskForm(null));
    document.getElementById("task-tech-filter").addEventListener("click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      taskTechFilter = btn.dataset.tech;
      renderTasks();
    });
    const search = document.getElementById("task-tech-search");
    search.addEventListener("change", () => {
      taskTechFilter = search.value.trim();
      renderTasks();
    });
  }
  wireTaskList();
}

/* ---------- Build Log ---------- */

const LOG_STORAGE_KEY = "specter-activity-log";
let activityLog = [];

function loadActivityLog() {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveActivityLog() {
  try { localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(activityLog)); } catch (e) {}
  supabaseSyncTable("activity_log", activityLog);
}

function addLogEntry(title, body) {
  activityLog.unshift({
    id: "log" + Date.now() + Math.random().toString(36).slice(2, 7),
    date: new Date().toISOString().slice(0, 10),
    title,
    body,
    projectId: activeProjectId,
  });
  saveActivityLog();
}

function allLogEntries() {
  // The static seed entries in data.js predate multi-project support, so
  // they only show up under the original default project, not new ones.
  const staticEntries = activeProjectId === DEFAULT_PROJECT_ID ? DATA.log : [];
  return [...activityLog.filter(inActiveProject), ...staticEntries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Build Log tab: every project's entries in one timeline, newest first.
function allProjectsLogEntries() {
  const staticEntries = DATA.log.map((e) => ({ ...e, projectId: e.projectId || DEFAULT_PROJECT_ID }));
  return [...activityLog, ...staticEntries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function logEntryHtml(entry, deletable, showProject) {
  return `
    <div class="log-entry">
      <div class="log-entry-head">
        <div class="log-date">${escapeHtml(entry.date)}${showProject && projectNameFor(entry.projectId) ? ` &middot; <strong>${escapeHtml(projectNameFor(entry.projectId))}</strong>` : ""}</div>
        ${deletable && entry.id ? `<button type="button" class="bench-delete-item icon-trash-btn log-delete-btn" data-item="${entry.id}" aria-label="Delete log entry" title="Delete log entry">${trashIconHtml()}</button>` : ""}
      </div>
      <div class="log-title">${escapeHtml(entry.title)}</div>
      <div class="log-body">${escapeHtml(entry.body)}</div>
    </div>
  `;
}

function wireLogList() {
  document.querySelectorAll("#log .log-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this log entry?")) return;
      activityLog = activityLog.filter((e) => e.id !== btn.dataset.item);
      saveActivityLog();
      renderLog();
    });
  });
}

function renderLog() {
  document.getElementById("log").innerHTML = `
    <h1>Build Log</h1>
    <p class="view-sub">Progress, decisions, and notes across all projects.</p>
    ${allProjectsLogEntries().map((e) => logEntryHtml(e, true, true)).join("") || `<p class="view-sub">No entries yet.</p>`}
  `;
  wireLogList();
}

/* ---------- Bench ---------- */
/*
 * The Bench is a "part that needs a decision" tracker. Someone submits a
 * part with one or more purchase options (link, vendor, price, picture);
 * the shop reviews and approves one option to order. No backend, so
 * everything persists in this browser's localStorage.
 */

const BENCH_STORAGE_KEY = "specter-bench-items";
const BENCH_CATEGORIES = [
  "Glass", "Body & Trim", "Interior", "Audio", "Lighting", "Drivetrain",
  "Chassis & Exterior Steel", "Electrical", "Hardware", "Cage & Rack",
  "HVAC", "Wheels",
];

const TASK_CATEGORIES = [
  "Transportation", "Body & Paint", "Metalwork", "Mechanical", "Interior",
  "Wheels & Tires", "Electrical", "Lighting", "Hardware", "Glass", "Misc",
  "Suspension", "Brakes",
  "Docs", "Office", "Shopkeeping", "Shipping", "Process", "Research",
  "Web", "Materials",
];

let benchItems = [];
let benchFormOpen = false;
let benchOptionCounter = 0;
let benchEditingId = null;

const BENCH_COUNTER_KEY = "specter-bench-counter";

function nextBenchNumber() {
  let n = 1;
  try {
    const raw = localStorage.getItem(BENCH_COUNTER_KEY);
    n = raw ? parseInt(raw, 10) + 1 : 1;
  } catch (e) {}
  try { localStorage.setItem(BENCH_COUNTER_KEY, String(n)); } catch (e) {}
  return n;
}

function extractDomainLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toUpperCase();
  } catch (e) {
    return url;
  }
}

function editIconHtml(itemId) {
  return `<button type="button" class="edit-icon" data-edit-item="${itemId}" aria-label="Edit">&#9998;</button>`;
}

function pencilIconHtml() {
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.4 2.4a1.4 1.4 0 0 1 2 2L5 12.8l-2.8.7.7-2.8L11.4 2.4Z"/><path d="M9.8 4l2 2"/></svg>`;
}

function checkIconHtml() {
  return `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>`;
}

function reopenIconHtml() {
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4v3.5h3.5"/><path d="M4.2 7A5 5 0 1 1 4 10.5"/></svg>`;
}

function commentIconHtml() {
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.3h12v7.4H6.3L3 13.3v-2.6H2z"/></svg>`;
}

/* ---------- Comments (shared by Tasks & Bench items) ---------- */

const openCommentThreads = new Set();

function commentsSectionHtml(item) {
  const comments = item.comments || [];
  return `
    <div class="comments-section${openCommentThreads.has(item.id) ? "" : " hidden-section"}" data-comments-for="${item.id}">
      ${comments.length ? `
        <div class="comment-list">
          ${comments.map((c) => `
            <div class="comment">
              <div class="comment-meta">${escapeHtml(c.author || "Unknown")} &middot; ${escapeHtml(c.date)}</div>
              <div class="comment-text">${escapeHtml(c.text)}</div>
            </div>
          `).join("")}
        </div>
      ` : `<p class="view-sub comment-empty">No comments yet.</p>`}
      <form class="comment-form" data-comment-form="${item.id}">
        <input type="text" class="comment-author" placeholder="Your name" />
        <textarea class="comment-text-input" rows="2" placeholder="Add a comment..." required></textarea>
        <button type="submit" class="bench-secondary-btn">Post comment</button>
      </form>
    </div>
  `;
}

function commentActionBtnHtml(item) {
  const count = (item.comments || []).length;
  return `<button type="button" class="action-btn comment-toggle-btn" data-item="${item.id}">${commentIconHtml()} Comment${count ? ` (${count})` : ""}</button>`;
}

function wireComments(containerSelector, items, saveFn, renderFn) {
  document.querySelectorAll(`${containerSelector} .comment-toggle-btn`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.item;
      if (openCommentThreads.has(id)) openCommentThreads.delete(id);
      else openCommentThreads.add(id);
      renderFn();
    });
  });

  document.querySelectorAll(`${containerSelector} [data-comment-form]`).forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const item = items.find((i) => i.id === form.dataset.commentForm);
      if (!item) return;
      const author = form.querySelector(".comment-author").value.trim();
      const text = form.querySelector(".comment-text-input").value.trim();
      if (!text) return;
      if (!item.comments) item.comments = [];
      item.comments.push({ id: "c" + Date.now(), author, text, date: new Date().toISOString().slice(0, 10) });
      saveFn();
      openCommentThreads.add(item.id);
      renderFn();
    });
  });
}

function expandableHtml(text) {
  if (!text) return "";
  return `
    <div class="expandable">
      <p class="expandable-text">${escapeHtml(text)}</p>
      <button type="button" class="more-toggle">More <span class="chevron">&#9662;</span></button>
    </div>
  `;
}

function wireExpandables(root) {
  const boxes = root.querySelectorAll(".expandable");

  const measure = () => {
    boxes.forEach((box) => {
      const textEl = box.querySelector(".expandable-text");
      const btn = box.querySelector(".more-toggle");
      // -webkit-line-clamp discards the overflow at layout time rather than
      // just hiding it, so scrollHeight === clientHeight even when clamped.
      // Briefly un-clamp to measure the true full height, then restore.
      const clampedHeight = textEl.clientHeight;
      textEl.classList.add("measuring");
      const fullHeight = textEl.scrollHeight;
      textEl.classList.remove("measuring");
      btn.style.display = fullHeight <= clampedHeight + 2 ? "none" : "";
    });
  };

  measure();
  // The custom typeface loads asynchronously; re-measure once it's in so
  // wrapping (and therefore overflow) reflects the final rendered font.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measure);
  }

  boxes.forEach((box) => {
    const btn = box.querySelector(".more-toggle");
    btn.addEventListener("click", () => {
      const expanded = box.classList.toggle("expanded");
      btn.innerHTML = expanded ? `Less <span class="chevron up">&#9662;</span>` : `More <span class="chevron">&#9662;</span>`;
    });
  });
}

function loadBenchItems() {
  try {
    const raw = localStorage.getItem(BENCH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveBenchItems() {
  try { localStorage.setItem(BENCH_STORAGE_KEY, JSON.stringify(benchItems)); } catch (e) {}
  supabaseSyncTable("bench_items", benchItems);
}

// Downscales a pasted image and re-encodes it as JPEG so a full-size
// screenshot doesn't blow up localStorage/Supabase with a multi-MB data URI.
function resizeImageToDataUrl(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, "&#96;");
}

function trashIconHtml() {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.2h11M6.2 4.2V2.4a.6.6 0 0 1 .6-.6h2.4a.6.6 0 0 1 .6.6v1.8M3.6 4.2l.6 8.9c.04.6.53 1 1.1 1h5.4c.57 0 1.06-.4 1.1-1l.6-8.9M6.6 7v4.2M9.4 7v4.2"/></svg>`;
}

/* ---- More-links parsing: one per line, "Name | https://..." or a bare URL ---- */

function parseMoreLinks(text) {
  return (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|");
      if (parts.length > 1) {
        return { label: parts[0].trim(), url: parts.slice(1).join("|").trim() };
      }
      return { label: line, url: line };
    });
}

/* ---- Add-item form ---- */

function benchOptionBlockHtml(blockId, number, opt) {
  opt = opt || {};
  return `
    <div class="bench-option-block" data-block-id="${blockId}">
      <div class="bench-option-head">
        <span class="bench-option-num">OPTION ${number}</span>
        <button type="button" class="bench-remove-option" data-remove="${blockId}">Remove option</button>
      </div>

      <label class="field-label" for="${blockId}-what">What it is</label>
      <input type="text" id="${blockId}-what" class="bo-what" placeholder="e.g. Genuine upper shroud LR048112" value="${escapeAttr(opt.whatItIs || "")}" required />

      <div class="bench-option-row bench-option-row-3">
        <div>
          <label class="field-label" for="${blockId}-vendor">Vendor</label>
          <input type="text" id="${blockId}-vendor" class="bo-vendor" value="${escapeAttr(opt.vendor || "")}" />
        </div>
        <div>
          <label class="field-label" for="${blockId}-partnum">Part number</label>
          <input type="text" id="${blockId}-partnum" class="bo-partnum" value="${escapeAttr(opt.partNumber || "")}" />
        </div>
        <div>
          <label class="field-label" for="${blockId}-price">Price</label>
          <input type="text" id="${blockId}-price" class="bo-price" placeholder="e.g. $45.00" value="${escapeAttr(opt.price || "")}" />
        </div>
      </div>

      <label class="field-label" for="${blockId}-link">Link</label>
      <input type="url" id="${blockId}-link" class="bo-link" placeholder="https://..." value="${escapeAttr(opt.link || "")}" />

      <label class="field-label" for="${blockId}-picture">Picture (optional)</label>
      <input type="text" id="${blockId}-picture" class="bo-picture" placeholder="Paste a copied image or image link..." value="${escapeAttr(opt.picture || "")}" />
      <p class="field-hint">Paste a copied screenshot or image directly (Ctrl+V / Cmd+V), or right-click a photo online and "Copy image address" and paste that link instead. Shows as a thumbnail.</p>

      <label class="field-label" for="${blockId}-notes">Notes</label>
      <textarea id="${blockId}-notes" class="bo-notes" rows="2">${escapeHtml(opt.notes || "")}</textarea>

      <label class="field-label" for="${blockId}-morelinks">More links (optional)</label>
      <textarea id="${blockId}-morelinks" class="bo-morelinks" rows="2" placeholder="https://...">${escapeHtml(opt.moreLinks || "")}</textarea>
      <p class="field-hint">One per line. To name a link, put the name first: Lower shroud | https://...</p>

      <label class="bench-recommend">
        <input type="radio" name="bench-recommended" value="${blockId}" ${opt.recommended ? "checked" : ""} />
        Recommended option
      </label>
    </div>
  `;
}

function benchFormHtml() {
  const editing = benchEditingId ? benchItems.find((i) => i.id === benchEditingId) : null;
  const opts = editing && editing.options.length ? editing.options : [null];
  const optionBlocksHtml = opts.map((opt, i) => benchOptionBlockHtml(opt ? opt.id : "o0", i + 1, opt)).join("");

  return `
    <div class="bench-form-panel">
      <h2 class="bench-form-title">${editing ? "Edit bench item" : "Add an item to the bench"}</h2>
      <p class="view-sub">A part that needs a decision. Give each option a link and a picture; the shop approves an option to order.</p>

      <form id="bench-form">
        <label class="field-label" for="bf-name">Your name</label>
        <input type="text" id="bf-name" value="${editing ? escapeAttr(editing.submitter) : ""}" required />

        <label class="field-label" for="bf-part">What the part is</label>
        <input type="text" id="bf-part" placeholder="e.g. Rear wiper for the rear door" value="${editing ? escapeAttr(editing.partName) : ""}" required />

        <label class="field-label" for="bf-category">Category</label>
        <input type="text" id="bf-category" placeholder="e.g. Interior" value="${editing ? escapeAttr(editing.category) : ""}" />
        <div class="bench-pills" id="bench-category-pills">
          ${BENCH_CATEGORIES.map((c) => `<button type="button" class="pill ${editing && editing.category === c ? "active" : ""}" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join("")}
        </div>

        <label class="field-label" for="bf-reason">What needs deciding and why</label>
        <textarea id="bf-reason" rows="3" required>${editing ? escapeHtml(editing.reason) : ""}</textarea>

        <label class="field-label" for="bf-before">Before ordering (optional)</label>
        <textarea id="bf-before" rows="2">${editing ? escapeHtml(editing.beforeOrdering) : ""}</textarea>
        <p class="field-hint">Anything the shop must measure or confirm before this is ordered.</p>

        <div class="bench-options-divider">Options</div>
        <div id="bench-options-container">
          ${optionBlocksHtml}
        </div>
        <button type="button" id="bench-add-option" class="bench-secondary-btn">+ Add another option</button>

        <div class="bench-form-actions">
          <button type="button" id="bench-cancel" class="bench-secondary-btn">Cancel</button>
          <button type="submit" class="bench-primary-btn">${editing ? "Save changes" : "Submit to the bench"}</button>
        </div>
      </form>
    </div>
  `;
}

function refreshBenchOptionNumbering() {
  const blocks = document.querySelectorAll("#bench-options-container .bench-option-block");
  blocks.forEach((block, i) => {
    block.querySelector(".bench-option-num").textContent = `OPTION ${i + 1}`;
    block.querySelector(".bench-remove-option").style.display = blocks.length > 1 ? "" : "none";
  });
}

function wireBenchForm() {
  const pills = document.getElementById("bench-category-pills");
  const categoryInput = document.getElementById("bf-category");
  pills.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    categoryInput.value = btn.dataset.cat;
    pills.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p === btn));
  });

  const optionsContainer = document.getElementById("bench-options-container");

  document.getElementById("bench-add-option").addEventListener("click", () => {
    benchOptionCounter += 1;
    const blockId = "o" + benchOptionCounter;
    optionsContainer.insertAdjacentHTML("beforeend", benchOptionBlockHtml(blockId, 0));
    refreshBenchOptionNumbering();
  });

  optionsContainer.addEventListener("click", (e) => {
    const btn = e.target.closest(".bench-remove-option");
    if (!btn) return;
    const block = document.querySelector(`.bench-option-block[data-block-id="${btn.dataset.remove}"]`);
    if (block && optionsContainer.querySelectorAll(".bench-option-block").length > 1) {
      block.remove();
      refreshBenchOptionNumbering();
    }
  });

  optionsContainer.addEventListener("paste", (e) => {
    const pictureInput = e.target.closest(".bo-picture");
    if (!pictureInput) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const imageItem = Array.from(items).find((it) => it.type.startsWith("image/"));
    if (!imageItem) return; // not an image — let a pasted link paste normally
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    pictureInput.value = "Processing image...";
    pictureInput.disabled = true;
    resizeImageToDataUrl(file, 1000, 0.75)
      .then((dataUrl) => {
        pictureInput.value = dataUrl;
        pictureInput.disabled = false;
      })
      .catch(() => {
        pictureInput.value = "";
        pictureInput.disabled = false;
        alert("Couldn't read that image. Try pasting a link instead.");
      });
  });

  document.getElementById("bench-cancel").addEventListener("click", () => {
    closeBenchForm();
  });

  document.getElementById("bench-form").addEventListener("submit", (e) => {
    e.preventDefault();

    const recommendedInput = document.querySelector('input[name="bench-recommended"]:checked');
    const recommendedBlockId = recommendedInput ? recommendedInput.value : null;

    const options = Array.from(optionsContainer.querySelectorAll(".bench-option-block")).map((block) => {
      const blockId = block.dataset.blockId;
      return {
        id: blockId,
        whatItIs: block.querySelector(".bo-what").value.trim(),
        vendor: block.querySelector(".bo-vendor").value.trim(),
        partNumber: block.querySelector(".bo-partnum").value.trim(),
        price: block.querySelector(".bo-price").value.trim(),
        link: block.querySelector(".bo-link").value.trim(),
        picture: block.querySelector(".bo-picture").value.trim(),
        notes: block.querySelector(".bo-notes").value.trim(),
        moreLinks: block.querySelector(".bo-morelinks").value.trim(),
        recommended: blockId === recommendedBlockId,
      };
    });

    const submitter = document.getElementById("bf-name").value.trim();
    const partName = document.getElementById("bf-part").value.trim();
    const category = document.getElementById("bf-category").value.trim();
    const reason = document.getElementById("bf-reason").value.trim();
    const beforeOrdering = document.getElementById("bf-before").value.trim();

    if (benchEditingId) {
      const item = benchItems.find((i) => i.id === benchEditingId);
      if (item) {
        item.submitter = submitter;
        item.partName = partName;
        item.category = category;
        item.reason = reason;
        item.beforeOrdering = beforeOrdering;
        item.options = options;
        if (item.approvedOptionId && !options.some((o) => o.id === item.approvedOptionId)) {
          item.approvedOptionId = null;
          item.status = "needs-decision";
        }
      }
    } else {
      benchItems.unshift({
        id: "bench" + Date.now(),
        projectId: activeProjectId,
        number: nextBenchNumber(),
        createdAt: new Date().toISOString().slice(0, 10),
        submitter,
        partName,
        category,
        reason,
        beforeOrdering,
        options,
        status: "needs-decision",
        approvedOptionId: null,
      });
    }

    saveBenchItems();
    closeBenchForm();
  });
}

function openBenchForm(item) {
  benchFormOpen = true;
  benchEditingId = item ? item.id : null;
  if (item && item.options.length) {
    const nums = item.options.map((o) => {
      const m = /^o(\d+)$/.exec(o.id);
      return m ? parseInt(m[1], 10) : -1;
    });
    benchOptionCounter = Math.max(0, ...nums) + 1;
  } else {
    benchOptionCounter = 0;
  }
  renderBench();
}

function closeBenchForm() {
  benchFormOpen = false;
  benchEditingId = null;
  renderBench();
  renderDashboard();
}

/* ---- Saved item list ---- */

function benchOptionCardHtml(item, opt) {
  const isApproved = item.approvedOptionId === opt.id;
  const links = parseMoreLinks(opt.moreLinks);
  return `
    <div class="bench-option-card ${isApproved ? "approved" : ""}">
      ${opt.recommended ? `<span class="option-recommended-tag">Recommended</span>` : ""}
      <div class="bench-option-card-head">
        ${opt.picture ? `
          <a href="${escapeAttr(opt.link || opt.picture)}" target="_blank" rel="noopener noreferrer" class="bench-thumb-link" aria-label="View photo">
            <span class="bench-thumb-fallback">&#8599;</span>
            <img src="${escapeAttr(opt.picture)}" alt="${escapeAttr(opt.whatItIs || "part photo")}" class="bench-thumb" onerror="this.style.display='none'" />
          </a>` : ""}
        <div class="bench-option-head-text">
          <div class="bench-option-title-row">
            <div class="bench-option-what">${escapeHtml(opt.whatItIs || "Untitled option")}</div>
            ${editIconHtml(item.id)}
          </div>
          ${(opt.vendor || opt.partNumber || opt.price) ? `<div class="bench-option-meta">${[opt.vendor, opt.partNumber, opt.price].filter(Boolean).map(escapeHtml).join(" &middot; ")}</div>` : ""}
        </div>
      </div>

      ${expandableHtml(opt.notes)}

      <div class="bench-option-footer">
        ${opt.link ? `<a href="${escapeAttr(opt.link)}" target="_blank" rel="noopener noreferrer" class="bench-link-btn">${escapeHtml(extractDomainLabel(opt.link))} &#8599;</a>` : ""}
        ${links.length ? `
          <div class="bench-more-links">
            ${links.map((l) => `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`).join("")}
          </div>` : ""}
      </div>

      ${isApproved
        ? `<span class="bench-approved-tag">&#10003; Approved to order</span>`
        : (item.status !== "approved" ? `<button type="button" class="bench-approve-btn" data-item="${item.id}" data-option="${opt.id}">&#10003; Approve to order</button>` : "")}
    </div>
  `;
}

function benchItemCardHtml(item) {
  const statusLabel = item.status === "approved" ? "APPROVED" : "OPEN &mdash; DECISION NEEDED";
  return `
    <div class="bench-item-card">
      <div class="bench-eyebrow">
        <span>${escapeHtml((item.category || "Uncategorized").toUpperCase())}</span>
        <span class="bench-eyebrow-sep">&middot;</span>
        <span class="bench-eyebrow-status ${item.status === "approved" ? "is-approved" : "is-open"}">${statusLabel}</span>
        <span class="bench-item-number">${String(item.number || 0).padStart(2, "0")}</span>
      </div>

      <div class="bench-title-row">
        <h3 class="bench-item-title">${escapeHtml(item.partName)}</h3>
      </div>

      <div class="bench-item-meta">Submitted by ${escapeHtml(item.submitter || "Unknown")} &middot; ${escapeHtml(item.createdAt)}</div>

      ${expandableHtml(item.reason)}

      ${item.beforeOrdering ? `
        <p class="bench-before"><strong>Before ordering:</strong> ${escapeHtml(item.beforeOrdering)}</p>
      ` : ""}

      <div class="bench-options-list">
        ${item.options.map((opt) => benchOptionCardHtml(item, opt)).join("")}
      </div>

      <div class="item-actions-bar">
        <button type="button" class="action-btn" data-edit-item="${item.id}">${pencilIconHtml()} Edit</button>
        ${item.status === "approved" ? `<button type="button" class="action-btn bench-reopen-btn" data-item="${item.id}">${reopenIconHtml()} Reopen decision</button>` : ""}
        ${commentActionBtnHtml(item)}
        <button type="button" class="action-btn action-btn-danger bench-delete-item" data-item="${item.id}">${trashIconHtml()} Delete</button>
        ${moveSelectHtml(item)}
      </div>
      ${commentsSectionHtml(item)}
    </div>
  `;
}

function wireBenchList() {
  wireComments("#bench", benchItems, saveBenchItems, renderBench);

  document.querySelectorAll("#bench .move-project-select").forEach((select) => {
    select.addEventListener("change", () => {
      const item = benchItems.find((i) => i.id === select.dataset.item);
      if (!item || !select.value) return;
      item.projectId = select.value;
      const relatedShipments = shipments.filter((s) => s.benchItemId === item.id);
      relatedShipments.forEach((s) => { s.projectId = select.value; });
      saveBenchItems();
      if (relatedShipments.length) saveShipments();
      renderBench();
      renderDashboard();
      renderShipments();
    });
  });

  document.querySelectorAll("#bench [data-edit-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = benchItems.find((i) => i.id === btn.dataset.editItem);
      if (item) openBenchForm(item);
    });
  });

  document.querySelectorAll("#bench .bench-approve-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = benchItems.find((i) => i.id === btn.dataset.item);
      if (!item) return;
      item.status = "approved";
      item.approvedOptionId = btn.dataset.option;
      saveBenchItems();
      const chosen = item.options.find((o) => o.id === item.approvedOptionId);
      addLogEntry(
        "Bench item approved",
        `"${item.partName}" approved to order${chosen ? " — " + chosen.whatItIs : ""}.`
      );
      createShipmentFromBenchApproval(item, chosen);
      renderBench();
      renderShipments();
      renderDashboard();
      renderLog();
    });
  });

  document.querySelectorAll("#bench .bench-reopen-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = benchItems.find((i) => i.id === btn.dataset.item);
      if (!item) return;
      item.status = "needs-decision";
      item.approvedOptionId = null;
      saveBenchItems();
      renderBench();
      renderDashboard();
    });
  });

  document.querySelectorAll("#bench .bench-delete-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this bench item?")) return;
      benchItems = benchItems.filter((i) => i.id !== btn.dataset.item);
      saveBenchItems();
      renderBench();
      renderDashboard();
    });
  });
}

function renderBench() {
  const el = document.getElementById("bench");

  const header = benchFormOpen
    ? benchFormHtml()
    : `
      <h1>Bench</h1>
      <p class="view-sub">Parts that need a decision before they're ordered.</p>
      <button type="button" id="bench-open" class="bench-primary-btn">+ Add an item to the bench</button>
    `;

  const projectBenchItems = benchItems.filter(inActiveProject);
  const list = projectBenchItems.length
    ? `<div class="bench-item-list">${projectBenchItems.map(benchItemCardHtml).join("")}</div>`
    : `<p class="view-sub">Nothing on the bench right now.</p>`;

  el.innerHTML = `${header}<div class="bench-list-wrap">${list}</div>`;

  if (benchFormOpen) {
    wireBenchForm();
  } else {
    document.getElementById("bench-open").addEventListener("click", () => openBenchForm(null));
  }
  wireBenchList();
  wireExpandables(el);
}

/* ---------- Shipments ---------- */
/*
 * Auto-created when a bench item is approved to order. Tracks each
 * shipment from ordered -> in transit -> delivered.
 */

const SHIPMENT_STORAGE_KEY = "specter-shipments";
let shipments = [];

function loadShipments() {
  try {
    const raw = localStorage.getItem(SHIPMENT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveShipments() {
  try { localStorage.setItem(SHIPMENT_STORAGE_KEY, JSON.stringify(shipments)); } catch (e) {}
  supabaseSyncTable("shipments", shipments);
}

function createShipmentFromBenchApproval(item, chosenOption) {
  shipments.unshift({
    id: "ship" + Date.now(),
    projectId: item.projectId,
    benchItemId: item.id,
    partName: item.partName,
    optionName: chosenOption ? chosenOption.whatItIs : "",
    vendor: chosenOption ? chosenOption.vendor : "",
    link: chosenOption ? chosenOption.link : "",
    createdAt: new Date().toISOString().slice(0, 10),
    orderConfirmation: "",
    orderedDate: null,
    trackingNumber: "",
    status: "needs-ordering",
    deliveredDate: null,
  });
  saveShipments();
}

function shipmentBadge(status) {
  const map = {
    "needs-ordering": { cls: "pending", label: "Needs Ordering" },
    "ordered": { cls: "not-started", label: "Ordered" },
    "in-transit": { cls: "in-progress", label: "In Transit" },
    "delivered": { cls: "complete", label: "Delivered" },
  };
  const m = map[status] || { cls: "not-started", label: status };
  return `<span class="badge badge-${m.cls}">${m.label}</span>`;
}

function shipmentCardHtml(s) {
  const needsOrdering = s.status === "needs-ordering";
  return `
    <div class="bench-item-card">
      <div class="bench-eyebrow">
        <span>${escapeHtml(s.vendor || "Vendor unknown")}</span>
        <span class="bench-eyebrow-sep">&middot;</span>
        <span>${needsOrdering ? `Approved ${escapeHtml(s.createdAt)}` : `Ordered ${escapeHtml(s.orderedDate || "")}`}</span>
        <span class="bench-item-number">${shipmentBadge(s.status)}</span>
      </div>

      <div class="bench-title-row">
        <h3 class="bench-item-title">${escapeHtml(s.partName)}</h3>
      </div>
      ${s.optionName ? `<div class="bench-item-meta">${escapeHtml(s.optionName)}</div>` : ""}

      ${s.link ? `<a href="${escapeAttr(s.link)}" target="_blank" rel="noopener noreferrer" class="bench-link-btn">${needsOrdering ? "Order from " + escapeHtml(s.vendor || "vendor") : "View order page"} &#8599;</a>` : ""}

      ${!needsOrdering ? `
      <label class="field-label" for="conf-${s.id}">Order confirmation # (optional)</label>
      <input type="text" id="conf-${s.id}" class="ship-confirmation-input" data-item="${s.id}" value="${escapeAttr(s.orderConfirmation || "")}" placeholder="Add confirmation number..." />

      <label class="field-label" for="track-${s.id}">Tracking number (optional)</label>
      <input type="text" id="track-${s.id}" class="ship-tracking-input" data-item="${s.id}" value="${escapeAttr(s.trackingNumber || "")}" placeholder="Add tracking number..." />
      ` : ""}

      <div class="bench-item-actions">
        ${needsOrdering ? `<button type="button" class="bench-approve-btn ship-mark-ordered-btn" data-item="${s.id}">Mark as ordered</button>` : ""}
        ${s.status === "ordered" ? `<button type="button" class="bench-approve-btn ship-advance-btn" data-item="${s.id}" data-next="in-transit">Mark in transit</button>` : ""}
        ${s.status === "in-transit" ? `<button type="button" class="bench-approve-btn ship-advance-btn" data-item="${s.id}" data-next="delivered">Mark delivered</button>` : ""}
        ${s.status === "delivered" ? `<button type="button" class="bench-secondary-btn ship-reopen-btn" data-item="${s.id}">Reopen</button>` : ""}
        <button type="button" class="bench-delete-item icon-trash-btn ship-delete-btn" data-item="${s.id}" aria-label="Delete shipment" title="Delete shipment">${trashIconHtml()}</button>
      </div>
    </div>
  `;
}

function wireShipmentsList() {
  document.querySelectorAll("#shipments .ship-mark-ordered-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = shipments.find((x) => x.id === btn.dataset.item);
      if (!s) return;
      s.status = "ordered";
      s.orderedDate = new Date().toISOString().slice(0, 10);
      saveShipments();
      addLogEntry(
        "Order placed",
        `"${s.partName}" ordered${s.vendor ? " from " + s.vendor : ""}.`
      );
      renderShipments();
      renderDashboard();
      renderLog();
    });
  });

  document.querySelectorAll("#shipments .ship-confirmation-input").forEach((input) => {
    input.addEventListener("change", () => {
      const s = shipments.find((x) => x.id === input.dataset.item);
      if (!s) return;
      s.orderConfirmation = input.value.trim();
      saveShipments();
    });
  });

  document.querySelectorAll("#shipments .ship-advance-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = shipments.find((x) => x.id === btn.dataset.item);
      if (!s) return;
      s.status = btn.dataset.next;
      if (s.status === "delivered") s.deliveredDate = new Date().toISOString().slice(0, 10);
      saveShipments();
      renderShipments();
      renderDashboard();
    });
  });

  document.querySelectorAll("#shipments .ship-reopen-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = shipments.find((x) => x.id === btn.dataset.item);
      if (!s) return;
      s.status = "in-transit";
      s.deliveredDate = null;
      saveShipments();
      renderShipments();
      renderDashboard();
    });
  });

  document.querySelectorAll("#shipments .ship-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this shipment record?")) return;
      shipments = shipments.filter((x) => x.id !== btn.dataset.item);
      saveShipments();
      renderShipments();
      renderDashboard();
    });
  });

  document.querySelectorAll("#shipments .ship-tracking-input").forEach((input) => {
    input.addEventListener("change", () => {
      const s = shipments.find((x) => x.id === input.dataset.item);
      if (!s) return;
      s.trackingNumber = input.value.trim();
      saveShipments();
    });
  });
}

function renderShipments() {
  const projectShipments = shipments.filter(inActiveProject);
  document.getElementById("shipments").innerHTML = `
    <h1>Shipments</h1>
    <p class="view-sub">Inbound shipments from approved bench orders.</p>
    ${projectShipments.length
      ? `<div class="bench-item-list">${projectShipments.map(shipmentCardHtml).join("")}</div>`
      : `<p class="view-sub">Nothing inbound right now. Approving a bench item to order adds it here.</p>`}
  `;
  wireShipmentsList();
}

/* ---------- Tab navigation ---------- */

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.querySelectorAll("nav.tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === id);
  });
  try { localStorage.setItem("specter-active-view", id); } catch (e) {}
}

function initNav() {
  document.querySelectorAll("nav.tabs button").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });
  let start = "dashboard";
  try {
    const saved = localStorage.getItem("specter-active-view");
    if (saved && document.getElementById(saved)) start = saved;
  } catch (e) {}
  showView(start);
}

/* ---------- Init ---------- */

function initApp() {
  document.getElementById("updated").textContent = `Updated ${DATA.meta.updated}`;
  benchItems = loadBenchItems();
  taskItems = loadTaskItems();
  activityLog = loadActivityLog();
  shipments = loadShipments();
  projects = loadProjects();
  activeProjectId = loadActiveProjectId();
  ensureDefaultProject(false);
  renderAll();
  renderProjectSelector();
  initNav();
  bootstrapFromSupabase();
}

/* ---------- Password gate ---------- */

const GATE_STORAGE_KEY = "specter-unlocked";

function unlockApp() {
  document.getElementById("password-gate").style.display = "none";
  document.getElementById("app").style.display = "";
  initApp();
}

function checkGate() {
  let unlocked = false;
  try { unlocked = localStorage.getItem(GATE_STORAGE_KEY) === "true"; } catch (e) {}

  if (unlocked) {
    unlockApp();
    return;
  }

  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-password");
  const error = document.getElementById("gate-error");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value === DATA.meta.sharedPassword) {
      try { localStorage.setItem(GATE_STORAGE_KEY, "true"); } catch (err) {}
      unlockApp();
    } else {
      error.textContent = "Incorrect password.";
      input.value = "";
      input.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", checkGate);

/* ---------- PWA install support ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // updateViaCache: "none" stops the browser from using its own HTTP
    // cache to decide whether sw.js changed — without it, an installed
    // app can keep comparing against a stale cached copy of sw.js itself
    // and never detect that a new version was published.
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update())
      .catch(() => {});
  });

  // Without this, an installed home-screen app can keep serving a stale
  // cached version indefinitely, since reopening it doesn't force a
  // reload the way visiting a page fresh in a browser tab would.
  //
  // controllerchange also fires the very first time a service worker ever
  // claims an uncontrolled page (a fresh install, not an update) — reloading
  // then would just interrupt a page that was already loading fine, so only
  // reload when a controller is being replaced, not adopted for the first time.
  let refreshedAfterUpdate = false;
  let hadControllerAtLoad = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadControllerAtLoad) {
      hadControllerAtLoad = true;
      return;
    }
    if (refreshedAfterUpdate) return;
    refreshedAfterUpdate = true;
    window.location.reload();
  });
}
