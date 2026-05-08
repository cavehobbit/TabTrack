const STORAGE_KEY = "tabber_state_v4";
const HEARTBEAT = "tabber-heartbeat";

const PRODUCTIVE = [
  "github.com",
  "docs.google.com",
  "drive.google.com",
  "calendar.google.com",
  "mail.google.com",
  "stackoverflow.com",
  "developer.mozilla.org",
  "wikipedia.org",
  "notion.so",
  "chatgpt.com",
  "replit.com",
  "codepen.io",
  "figma.com",
  "leetcode.com",
  "freecodecamp.org",
  "coursera.org",
  "khanacademy.org"
];

const DISTRACTING = [
  "youtube.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "reddit.com",
  "x.com",
  "netflix.com",
  "twitch.tv",
  "discord.com",
  "snapchat.com",
  "pinterest.com",
  "threads.net",
  "9gag.com",
  "imgur.com"
];

const DISTRACTION_THRESHOLDS_MIN = [10, 20, 30, 45, 60, 90];
const REMINDER_COOLDOWN_MS = 12 * 60 * 1000;

const GHOST_ICON = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="white"/>
  <path d="M64 14c-23.2 0-42 18.8-42 42v58l11-8 11 8 10-8 10 8 10-8 11 8 11-8 10 8V56c0-23.2-18.8-42-42-42z" fill="black"/>
  <circle cx="50" cy="58" r="6" fill="white"/>
  <circle cx="78" cy="58" r="6" fill="white"/>
  <path d="M48 79c6 7 26 7 32 0" stroke="white" stroke-width="6" fill="none" stroke-linecap="round"/>
</svg>
`)}`;

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

let loaded = false;

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

function nextMidnightFromKey(key) {
  const d = new Date(dayStart(key));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

function isTrackable(url) {
  return /^https?:\/\//i.test(url || "");
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function categoryForDomain(domain) {
  if (PRODUCTIVE.some(x => domain.includes(x))) return "productive";
  if (DISTRACTING.some(x => domain.includes(x))) return "distracting";
  return "neutral";
}

function emptyDay() {
  return {
    totalMs: 0,
    switches: 0,
    byCategory: { productive: 0, neutral: 0, distracting: 0 },
    bySite: {},
    segments: [],
    lastUpdated: Date.now()
  };
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
    domain: String(r.domain || domainFromUrl(r.url || "")),
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
    messages: Array.isArray(safe.messages) ? safe.messages.slice(0, 20) : []
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

async function hydrate() {
  if (loaded) return;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  state = normalizeState(data[STORAGE_KEY]);
  loaded = true;
  await save();
}

async function save() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function ensureDay(key) {
  if (!state.days[key]) state.days[key] = emptyDay();
  return state.days[key];
}

function addChunk(seg, start, end) {
  const ms = Math.max(0, end - start);
  if (ms <= 0) return;

  let cursor = start;
  while (cursor < end) {
    const key = localDayKey(cursor);
    const boundary = nextMidnightFromKey(key);
    const chunkEnd = Math.min(end, boundary);
    const chunkMs = chunkEnd - cursor;
    const day = ensureDay(key);

    day.totalMs += chunkMs;
    day.byCategory[seg.category] += chunkMs;

    if (!day.bySite[seg.domain]) {
      day.bySite[seg.domain] = {
        domain: seg.domain,
        title: seg.title,
        url: seg.url,
        ms: 0,
        count: 0
      };
    }

    day.bySite[seg.domain].ms += chunkMs;
    day.bySite[seg.domain].count += 1;

    day.segments.push({
      domain: seg.domain,
      title: seg.title,
      url: seg.url,
      category: seg.category,
      startedAt: cursor,
      endedAt: chunkEnd,
      ms: chunkMs
    });

    if (day.segments.length > 500) day.segments.shift();
    day.lastUpdated = Date.now();

    cursor = chunkEnd;
  }
}

function flushRunning(now = Date.now()) {
  if (!state.running) return 0;

  const start = state.running.flushedAt || state.running.startedAt || now;
  const ms = Math.max(0, now - start);
  if (ms <= 0) return 0;

  addChunk(state.running, start, now);
  state.running.flushedMs = (state.running.flushedMs || 0) + ms;
  state.running.flushedAt = now;
  return ms;
}

function finalizeRunning(now = Date.now()) {
  if (!state.running) return;
  flushRunning(now);
  state.running = null;
}

function focusScore(day) {
  const p = day?.byCategory?.productive || 0;
  const n = day?.byCategory?.neutral || 0;
  const d = day?.byCategory?.distracting || 0;
  const t = p + n + d;
  return t ? Math.round(((p + n * 0.35) / t) * 100) : 0;
}

function pushGhostMessage(text, type = "focus") {
  state.ghost.messages.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    text,
    type
  });
  state.ghost.messages = state.ghost.messages.slice(0, 20);
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function liveSnapshot(key, now = Date.now()) {
  const base = normalizeDay(state.days[key] || emptyDay());

  if (state.running) {
    const liveStart = state.running.flushedAt || state.running.startedAt;
    const overlapStart = Math.max(liveStart, dayStart(key));
    const overlapEnd = Math.min(now, nextMidnightFromKey(key));

    if (overlapEnd > overlapStart) {
      const ms = overlapEnd - overlapStart;
      base.totalMs += ms;
      base.byCategory[state.running.category] += ms;

      if (!base.bySite[state.running.domain]) {
        base.bySite[state.running.domain] = {
          domain: state.running.domain,
          title: state.running.title,
          url: state.running.url,
          ms: 0,
          count: 0
        };
      }

      base.bySite[state.running.domain].ms += ms;
      base.bySite[state.running.domain].count += 1;

      base.segments.push({
        domain: state.running.domain,
        title: state.running.title,
        url: state.running.url,
        category: state.running.category,
        startedAt: overlapStart,
        endedAt: overlapEnd,
        ms,
        live: true
      });
    }
  }

  base.segments = base.segments.sort((a, b) => a.startedAt - b.startedAt);
  return base;
}

function resetGhostDayIfNeeded(today) {
  if (state.ghost.dayKey !== today) {
    state.ghost.dayKey = today;
    state.ghost.lastMilestoneMin = 0;
    state.ghost.lastFocusAlertAt = 0;
  }
}

async function maybeNudge(now = Date.now()) {
  const today = localDayKey(now);
  resetGhostDayIfNeeded(today);

  const snap = liveSnapshot(today, now);
  const distractingMin = Math.floor((snap.byCategory.distracting || 0) / 60000);
  const totalMin = Math.floor((snap.totalMs || 0) / 60000);
  const focus = focusScore(snap);

  let message = null;
  let type = "milestone";

  const nextMilestone = DISTRACTION_THRESHOLDS_MIN.find(
    t => t > state.ghost.lastMilestoneMin && distractingMin >= t
  );

  if (nextMilestone) {
    state.ghost.lastMilestoneMin = nextMilestone;
    message = randomFrom([
      `Boo. You've crossed ${nextMilestone} minutes of distraction today. Try one clean focus block.`,
      `Ghost check: ${nextMilestone} minutes distracted. Close the noisy tab and return to one task.`,
      `Spooky reminder: distraction is stacking up. Time to pick a single browser tab and commit.`
    ]);
  } else if (
    totalMin >= 20 &&
    focus < 45 &&
    now - state.ghost.lastFocusAlertAt > REMINDER_COOLDOWN_MS
  ) {
    state.ghost.lastFocusAlertAt = now;
    type = "focus";
    message = randomFrom([
      `Ghost says your focus score is slipping. Lock onto one tab for 10 minutes.`,
      `Boo... your browsing is getting scattered. Cut the switches and stay on one goal.`,
      `Reminder from the ghost: the distraction ratio is high. Pick the important tab now.`
    ]);
  }

  if (!message) return;

  state.ghost.lastSentAt = now;
  pushGhostMessage(message, type);
  await save();

  try {
    await chrome.notifications.create(`tabber-ghost-${now}`, {
      type: "basic",
      iconUrl: GHOST_ICON,
      title: "Tabber Ghost",
      message,
      priority: 2
    });
  } catch (e) {
    console.warn("Notification failed:", e);
  }
}

async function pauseTracking() {
  await hydrate();
  finalizeRunning();
  await maybeNudge();
  await save();
}

async function startOrSwitch(tab, { forceTick = false } = {}) {
  await hydrate();

  if (!tab || !isTrackable(tab.url)) {
    await pauseTracking();
    return;
  }

  const now = Date.now();
  const next = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || tab.url,
    domain: domainFromUrl(tab.url),
    category: categoryForDomain(domainFromUrl(tab.url)),
    startedAt: now,
    flushedAt: now,
    flushedMs: 0
  };

  if (state.running && state.running.tabId === next.tabId) {
    if (forceTick) flushRunning(now);

    state.running.url = next.url;
    state.running.title = next.title;
    state.running.domain = next.domain;
    state.running.category = next.category;
    state.running.windowId = next.windowId;

    await save();
    return;
  }

  if (state.running) {
    finalizeRunning(now);
    ensureDay(localDayKey(now)).switches += 1;
  }

  state.running = next;
  await save();
}

async function syncActiveTab(forceTick = false) {
  await hydrate();

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) {
    await startOrSwitch(tab, { forceTick });
    await maybeNudge();
  } else {
    await pauseTracking();
  }
}

async function ensureHeartbeat() {
  chrome.alarms.create(HEARTBEAT, { periodInMinutes: 1 });
}

async function openDashboard() {
  const url = chrome.runtime.getURL("popup.html");
  const tabs = await chrome.tabs.query({ url }).catch(() => []);

  if (tabs && tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.action.onClicked.addListener(openDashboard);

chrome.idle.setDetectionInterval(15);

chrome.runtime.onInstalled.addListener(async () => {
  await hydrate();
  await ensureHeartbeat();
  state.running = null;
  await save();
  await syncActiveTab();
});

chrome.runtime.onStartup.addListener(async () => {
  await hydrate();
  await ensureHeartbeat();
  state.running = null;
  await save();
  await syncActiveTab();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEARTBEAT) {
    await syncActiveTab(true);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) {
    await startOrSwitch(tab);
    await maybeNudge();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await hydrate();

  if (changeInfo.url) {
    if (state.running && state.running.tabId === tabId) {
      flushRunning(Date.now());
      state.running.url = tab.url || state.running.url;
      state.running.title = tab.title || state.running.title;
      state.running.domain = domainFromUrl(state.running.url);
      state.running.category = categoryForDomain(state.running.domain);
      await save();
      await maybeNudge();
      return;
    }

    if (!state.running && tab.active && isTrackable(tab.url)) {
      await startOrSwitch(tab);
      await maybeNudge();
      return;
    }
  }

  if (state.running && state.running.tabId === tabId && changeInfo.title) {
    state.running.title = tab.title || state.running.title;
    await save();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await hydrate();
  if (state.running && state.running.tabId === tabId) {
    await syncActiveTab();
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await pauseTracking();
    return;
  }
  await syncActiveTab();
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === "active") {
    await syncActiveTab();
  } else {
    await pauseTracking();
  }
});