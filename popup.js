const STORAGE_KEY = "tabber_state_v4";

let state = {
  running: null,
  days: {},
  ghost: {
    dayKey: "",
    lastMilestoneMin: 0,
    lastFocusAlertAt: 0,
    lastSentAt: 0,
    messages: []
  }
};

let selectedKey = localDayKey();
let compareKey = localDayKey(Date.now() - 86400000);

const els = {
  statusChip: document.getElementById("statusChip"),
  currentTitle: document.getElementById("currentTitle"),
  currentMeta: document.getElementById("currentMeta"),
  liveElapsed: document.getElementById("liveElapsed"),
  statsGrid: document.getElementById("statsGrid"),
  reportSelect: document.getElementById("reportSelect"),
  compareSelect: document.getElementById("compareSelect"),
  reportList: document.getElementById("reportList"),
  timelineBar: document.getElementById("timelineBar"),
  compareGrid: document.getElementById("compareGrid"),
  reportSubtitle: document.getElementById("reportSubtitle"),
  reportCount: document.getElementById("reportCount"),
  exportGrid: document.querySelector(".export-grid"),
  ghostToggle: document.getElementById("ghostToggle"),
  ghostClose: document.getElementById("ghostClose"),
  ghostPanel: document.getElementById("ghostPanel"),
  ghostFeed: document.getElementById("ghostFeed"),
  ghostNote: document.getElementById("ghostNote"),
  cursorGhost: document.getElementById("cursorGhost")
};

function localDayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayStart(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function nextMidnightKey(key) {
  const d = new Date(dayStart(key));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function formatDuration(ms) {
  ms = Math.max(0, ms || 0);
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatSignedDuration(ms) {
  const sign = ms > 0 ? "+" : ms < 0 ? "−" : "";
  return `${sign}${formatDuration(Math.abs(ms))}`;
}

function formatSignedNumber(n) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n)}`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function dayLabel(key) {
  const today = localDayKey();
  const yesterday = localDayKey(Date.now() - 86400000);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";

  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function normalizeDay(day) {
  const safe = day && typeof day === "object" ? day : {};
  return {
    totalMs: Number(safe.totalMs) || 0,
    switches: Number(safe.switches) || 0,
    byCategory: {
      productive: Number(safe.byCategory?.productive) || 0,
      neutral: Number(safe.byCategory?.neutral) || 0,
      distracting: Number(safe.byCategory?.distracting) || 0
    },
    bySite: safe.bySite && typeof safe.bySite === "object" ? safe.bySite : {},
    segments: Array.isArray(safe.segments) ? safe.segments : [],
    lastUpdated: Number(safe.lastUpdated) || Date.now()
  };
}

function normalizeRunning(r) {
  if (!r || typeof r !== "object") return null;

  const startedAt = Number(r.startedAt) || Date.now();
  const flushedAt = Number(r.flushedAt) || startedAt;
  const flushedMs = Number(r.flushedMs) || 0;

  return {
    tabId: Number(r.tabId),
    windowId: Number(r.windowId),
    url: String(r.url || ""),
    title: String(r.title || r.url || ""),
    domain: String(r.domain || ""),
    category: ["productive", "neutral", "distracting"].includes(r.category) ? r.category : "neutral",
    startedAt,
    flushedAt,
    flushedMs
  };
}

function normalizeGhost(g) {
  const safe = g && typeof g === "object" ? g : {};
  return {
    dayKey: String(safe.dayKey || ""),
    lastMilestoneMin: Number(safe.lastMilestoneMin) || 0,
    lastFocusAlertAt: Number(safe.lastFocusAlertAt) || 0,
    lastSentAt: Number(safe.lastSentAt) || 0,
    messages: Array.isArray(safe.messages) ? safe.messages : []
  };
}

function normalizeState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {
    running: normalizeRunning(src.running),
    days: {},
    ghost: normalizeGhost(src.ghost)
  };

  const days = src.days && typeof src.days === "object" ? src.days : {};
  for (const [key, day] of Object.entries(days)) {
    out.days[key] = normalizeDay(day);
  }

  return out;
}

function buildVisibleKeys() {
  const keys = new Set(Object.keys(state.days || {}));
  const today = localDayKey();

  keys.add(today);
  if (selectedKey) keys.add(selectedKey);
  if (compareKey) keys.add(compareKey);

  if (state.running) {
    keys.add(localDayKey(state.running.startedAt));
    keys.add(localDayKey(state.running.flushedAt || state.running.startedAt));
  }

  return [...keys].sort((a, b) => b.localeCompare(a));
}

function mergeSegments(segs) {
  const sorted = clone(segs).sort((a, b) => a.startedAt - b.startedAt);
  const out = [];

  for (const seg of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.domain === seg.domain && prev.category === seg.category) {
      prev.ms += seg.ms;
      prev.endedAt = seg.endedAt;
      prev.live = prev.live || seg.live;
    } else {
      out.push({ ...seg });
    }
  }

  return out;
}

function reportForKey(key) {
  const base = clone(state.days[key] || {
    totalMs: 0,
    switches: 0,
    byCategory: { productive: 0, neutral: 0, distracting: 0 },
    bySite: {},
    segments: [],
    lastUpdated: Date.now()
  });

  const now = Date.now();
  const running = state.running;

  if (running) {
    const liveStart = running.flushedAt || running.startedAt;
    const overlapStart = Math.max(liveStart, dayStart(key));
    const overlapEnd = Math.min(now, nextMidnightKey(key));

    if (overlapEnd > overlapStart) {
      const ms = overlapEnd - overlapStart;

      base.totalMs += ms;
      base.byCategory[running.category] = (base.byCategory[running.category] || 0) + ms;

      if (!base.bySite[running.domain]) {
        base.bySite[running.domain] = {
          domain: running.domain,
          title: running.title,
          url: running.url,
          ms: 0,
          count: 0
        };
      }

      base.bySite[running.domain].ms += ms;
      base.bySite[running.domain].count += 1;

      base.segments.push({
        domain: running.domain,
        title: running.title,
        url: running.url,
        category: running.category,
        startedAt: overlapStart,
        endedAt: overlapEnd,
        ms,
        live: true
      });
    }
  }

  base.segments = mergeSegments(base.segments);
  return base;
}

function summarize(day) {
  const productive = day.byCategory?.productive || 0;
  const neutral = day.byCategory?.neutral || 0;
  const distracting = day.byCategory?.distracting || 0;
  const total = day.totalMs || productive + neutral + distracting;

  const focus = total
    ? Math.round(((productive + neutral * 0.35) / total) * 100)
    : 0;

  const sites = Object.values(day.bySite || {}).sort((a, b) => b.ms - a.ms);
  const topSite = sites[0]?.domain || "—";
  const topTitle = sites[0]?.title || topSite;
  const topMs = sites[0]?.ms || 0;

  return {
    totalMs: total,
    focus,
    switches: day.switches || 0,
    productive,
    neutral,
    distracting,
    topSite,
    topTitle,
    topMs,
    segmentCount: (day.segments || []).length
  };
}

function compareSummary(a, b) {
  return {
    totalMs: a.totalMs - b.totalMs,
    focus: a.focus - b.focus,
    switches: a.switches - b.switches,
    distracting: a.distracting - b.distracting
  };
}

function pickOtherKey(exclude) {
  const keys = buildVisibleKeys();
  return keys.find(k => k !== exclude) || exclude;
}

function ensureSelectionDefaults() {
  const keys = buildVisibleKeys();
  const today = localDayKey();

  if (!keys.includes(selectedKey)) {
    selectedKey = keys.includes(today) ? today : (keys[0] || today);
  }

  if (!keys.includes(compareKey) || compareKey === selectedKey) {
    compareKey = keys.find(k => k !== selectedKey) || selectedKey;
  }
}

function populateSelects() {
  const keys = buildVisibleKeys();
  const options = keys.map(key => {
    const s = summarize(reportForKey(key));
    const label = `${dayLabel(key)} — ${formatDuration(s.totalMs)}`;
    return `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
  }).join("");

  els.reportSelect.innerHTML = options || `<option value="${selectedKey}">${escapeHtml(dayLabel(selectedKey))}</option>`;
  els.compareSelect.innerHTML = options || `<option value="${compareKey}">${escapeHtml(dayLabel(compareKey))}</option>`;

  els.reportSelect.value = selectedKey;
  els.compareSelect.value = compareKey;
}

function renderLive() {
  const running = state.running;

  if (!running) {
    els.statusChip.textContent = "IDLE";
    els.currentTitle.textContent = "Idle";
    els.currentMeta.textContent = "No active tracked tab.";
    els.liveElapsed.textContent = "0s";
    return;
  }

  const elapsed = (running.flushedMs || 0) + Math.max(0, Date.now() - (running.flushedAt || running.startedAt));

  els.statusChip.textContent = "TRACKING";
  els.currentTitle.textContent = running.title || running.domain || "Active tab";
  els.currentMeta.textContent = `${running.domain || "unknown"} · ${running.category || "neutral"}`;
  els.liveElapsed.textContent = formatDuration(elapsed);
}

function renderStats(view) {
  const s = summarize(view);
  const items = [
    ["Total time", formatDuration(s.totalMs), "All time in the selected day."],
    ["Focus score", `${s.focus}%`, "Productive + neutral weighted."],
    ["Switches", String(s.switches), "How many tab changes were counted."],
    ["Distracted", formatDuration(s.distracting), "Time spent in distracting sites."]
  ];

  els.statsGrid.innerHTML = items.map(([label, value, sub]) => `
    <div class="stat">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
      <div class="sub">${escapeHtml(sub)}</div>
    </div>
  `).join("");
}

function renderTimeline(view) {
  const segments = (view.segments || []).slice().sort((a, b) => a.startedAt - b.startedAt);

  if (!segments.length) {
    els.timelineBar.innerHTML = `
      <div class="empty" style="width:100%;">
        No timeline yet. Use the browser normally and segments will appear here.
      </div>
    `;
    return;
  }

  els.timelineBar.innerHTML = segments.map(seg => {
    const cls = seg.category === "productive"
      ? "productive"
      : seg.category === "distracting"
        ? "distracting"
        : "neutral";

    const title = `${seg.title || seg.domain} • ${formatDuration(seg.ms)}${seg.live ? " • LIVE" : ""}`;

    return `
      <div class="segment ${cls}" style="flex:${Math.max(1, seg.ms / 60000)} 1 0%;" title="${escapeHtml(title)}">
        <strong>${escapeHtml(seg.domain || seg.title || "site")}</strong>
        <small>${escapeHtml(formatDuration(seg.ms))}${seg.live ? " • LIVE" : ""}</small>
      </div>
    `;
  }).join("");
}

function renderCompare(selectedView, compareView) {
  const a = summarize(selectedView);
  const b = summarize(compareView);
  const d = compareSummary(a, b);

  const cards = [
    ["Total Δ", formatSignedDuration(d.totalMs), `${dayLabel(selectedKey)} vs ${dayLabel(compareKey)}`],
    ["Focus Δ", `${formatSignedNumber(d.focus)}%`, `Selected minus compare`],
    ["Switches Δ", formatSignedNumber(d.switches), `Selected minus compare`],
    ["Distracted Δ", formatSignedDuration(d.distracting), `Selected minus compare`]
  ];

  els.compareGrid.innerHTML = cards.map(([label, delta, note]) => `
    <div class="diff">
      <div class="label">${escapeHtml(label)}</div>
      <div class="delta">${escapeHtml(delta)}</div>
      <div class="note">${escapeHtml(note)}</div>
    </div>
  `).join("");
}

function renderReportList() {
  const keys = Object.keys(state.days || {}).sort((a, b) => b.localeCompare(a));

  els.reportCount.textContent = `${keys.length} report${keys.length === 1 ? "" : "s"}`;

  if (!keys.length && !state.running) {
    els.reportList.innerHTML = `
      <div class="empty">
        No saved daily reports yet.
        <br />
        Start browsing and this will fill up automatically.
      </div>
    `;
    return;
  }

  const visible = buildVisibleKeys().filter(key => keys.includes(key) || key === localDayKey());

  if (!visible.length) {
    els.reportList.innerHTML = `
      <div class="empty">
        No saved daily reports yet.
      </div>
    `;
    return;
  }

  els.reportList.innerHTML = visible.map(key => {
    const view = reportForKey(key);
    const s = summarize(view);
    const active = key === selectedKey;

    return `
      <div class="item ${active ? "active" : ""}">
        <div class="meta">
          <strong>${escapeHtml(dayLabel(key))}</strong>
          <span>${escapeHtml(formatDuration(s.totalMs))} · ${s.focus}% focus · ${s.switches} switches · top: ${escapeHtml(s.topSite)}</span>
        </div>
        <div class="actions">
          <button class="btn" data-load="${escapeHtml(key)}">Load</button>
          <button class="btn" data-compare="${escapeHtml(key)}">Compare</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderReportSubtitle(view) {
  const s = summarize(view);
  els.reportSubtitle.textContent = `${dayLabel(selectedKey)} · ${formatDuration(s.totalMs)} · ${s.focus}% focus · top: ${s.topTitle}`;
}

function renderGhost() {
  const feed = state.ghost?.messages || [];

  if (!feed.length) {
    els.ghostFeed.innerHTML = `
      <div class="ghost-empty">
        No reminders yet.
        <br />
        Stay focused and I’ll stay quiet.
      </div>
    `;
    els.ghostNote.textContent = "I’ll nudge you when distraction climbs too high.";
    return;
  }

  els.ghostNote.textContent = feed[0]?.text || "Boo. Stay on track.";

  els.ghostFeed.innerHTML = feed.slice(0, 8).map(msg => `
    <div class="ghost-bubble ${msg.type === "milestone" ? "milestone" : ""}">
      <div class="ghost-time">${escapeHtml(formatTime(msg.ts))}</div>
      <div>${escapeHtml(msg.text)}</div>
    </div>
  `).join("");
}

function renderAll() {
  ensureSelectionDefaults();
  populateSelects();

  const selectedView = reportForKey(selectedKey);
  const compareView = reportForKey(compareKey);

  renderLive();
  renderStats(selectedView);
  renderTimeline(selectedView);
  renderCompare(selectedView, compareView);
  renderReportSubtitle(selectedView);
  renderReportList();
  renderGhost();
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function segmentRowsForReport(key, report) {
  return (report.segments || []).map((seg, idx) => [
    key,
    idx + 1,
    new Date(seg.startedAt).toISOString(),
    new Date(seg.endedAt).toISOString(),
    seg.domain,
    seg.title,
    seg.category,
    Math.round(seg.ms / 1000)
  ]);
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSelectedJson() {
  const report = reportForKey(selectedKey);
  const payload = {
    reportKey: selectedKey,
    label: dayLabel(selectedKey),
    generatedAt: new Date().toISOString(),
    summary: summarize(report),
    report
  };
  download(`tabber-${selectedKey}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function exportSelectedCsv() {
  const report = reportForKey(selectedKey);
  const rows = [
    ["reportKey", "segmentIndex", "start", "end", "domain", "title", "category", "seconds"],
    ...segmentRowsForReport(selectedKey, report)
  ];

  const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
  download(`tabber-${selectedKey}.csv`, csv, "text/csv");
}

function exportAllJson() {
  const payload = {
    generatedAt: new Date().toISOString(),
    state
  };
  download(`tabber-all.json`, JSON.stringify(payload, null, 2), "application/json");
}

function exportAllCsv() {
  const keys = Object.keys(state.days || {}).sort((a, b) => b.localeCompare(a));
  const rows = [["reportKey", "segmentIndex", "start", "end", "domain", "title", "category", "seconds"]];

  for (const key of keys) {
    const report = reportForKey(key);
    rows.push(...segmentRowsForReport(key, report));
  }

  const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
  download(`tabber-all.csv`, csv, "text/csv");
}

async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  state = normalizeState(data[STORAGE_KEY]);
  renderAll();
}

function toggleGhost(open) {
  els.ghostPanel.classList.toggle("open", open);
  els.ghostToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

/* Events */
els.reportSelect.addEventListener("change", (e) => {
  selectedKey = e.target.value;
  if (compareKey === selectedKey) compareKey = pickOtherKey(selectedKey);
  renderAll();
});

els.compareSelect.addEventListener("change", (e) => {
  compareKey = e.target.value;
  if (compareKey === selectedKey) compareKey = pickOtherKey(selectedKey);
  renderAll();
});

els.reportList.addEventListener("click", (e) => {
  const loadBtn = e.target.closest("[data-load]");
  const compareBtn = e.target.closest("[data-compare]");

  if (loadBtn) {
    selectedKey = loadBtn.dataset.load;
    if (compareKey === selectedKey) compareKey = pickOtherKey(selectedKey);
    renderAll();
  }

  if (compareBtn) {
    compareKey = compareBtn.dataset.compare;
    if (compareKey === selectedKey) compareKey = pickOtherKey(selectedKey);
    renderAll();
  }
});

els.exportGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-export]");
  if (!btn) return;

  const type = btn.dataset.export;
  if (type === "selected-json") exportSelectedJson();
  if (type === "selected-csv") exportSelectedCsv();
  if (type === "all-json") exportAllJson();
  if (type === "all-csv") exportAllCsv();
});

els.ghostToggle.addEventListener("click", () => {
  const open = !els.ghostPanel.classList.contains("open");
  toggleGhost(open);
});

els.ghostClose.addEventListener("click", () => toggleGhost(false));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    state = normalizeState(changes[STORAGE_KEY].newValue);
    renderAll();
  }
});

/* Cursor-follow ghost */
let mouseX = -9999;
let mouseY = -9999;
let ghostX = -9999;
let ghostY = -9999;
let ghostVisible = false;
let ghostFrame = null;

function moveCursorGhost() {
  if (!ghostVisible) return;

  ghostX += (mouseX - ghostX) * 0.06;
  ghostY += (mouseY - ghostY) * 0.06;

  els.cursorGhost.style.opacity = "1";
  els.cursorGhost.style.transform = `translate(${ghostX + 14}px, ${ghostY + 14}px)`;

  ghostFrame = requestAnimationFrame(moveCursorGhost);
}

function showCursorGhost(x, y) {
  mouseX = x;
  mouseY = y;

  if (!ghostVisible) {
    ghostVisible = true;
    ghostX = x;
    ghostY = y;
    els.cursorGhost.style.opacity = "1";
    cancelAnimationFrame(ghostFrame);
    moveCursorGhost();
  }
}

function hideCursorGhost() {
  ghostVisible = false;
  cancelAnimationFrame(ghostFrame);
  els.cursorGhost.style.opacity = "0";
  els.cursorGhost.style.transform = "translate(-9999px, -9999px)";
}

document.addEventListener("mousemove", (e) => {
  showCursorGhost(e.clientX, e.clientY);
});

document.addEventListener("mouseleave", hideCursorGhost);
window.addEventListener("blur", hideCursorGhost);

/* Init */
loadState();
setInterval(renderAll, 1000);