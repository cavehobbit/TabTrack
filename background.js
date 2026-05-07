const STORAGE_KEY = "tabsense_state_v2";
const HEARTBEAT = "tabsense-heartbeat";

const PRODUCTIVE = [
  "github.com",
  "docs.google.com",
  "stackoverflow.com",
  "notion.so",
  "chatgpt.com",
  "replit.com",
  "codepen.io",
  "figma.com"
];

const DISTRACTING = [
  "youtube.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "reddit.com",
  "x.com",
  "netflix.com"
];

let state = { running: null, days: {} };
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

function nextMidnight(ts) {
  const d = new Date(ts);
  d.setHours(24, 0, 0, 0);
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

function ensureDay(key) {
  if (!state.days[key]) {
    state.days[key] = {
      totalMs: 0,
      switches: 0,

      
      byCategory: { productive: 0, neutral: 0, distracting: 0 },
      bySite: {},
      segments: [],
      lastUpdated: Date.now()
    };
  }
  return state.days[key];
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

async function hydrate() {
  if (loaded) return;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const raw = data[STORAGE_KEY] || state;

  state = {
    running: normalizeRunning(raw.running),
    days: {}
  };

  const days = raw.days && typeof raw.days === "object" ? raw.days : {};
  for (const [key, day] of Object.entries(days)) {
    state.days[key] = normalizeDay(day);
  }



  loaded = true;
  await save();
}

async function save() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function addChunk(seg, start, end) {
  const ms = Math.max(0, end - start);
  if (ms <= 0) return;

  let cursor = start;
  while (cursor < end) {
    const key = localDayKey(cursor);
    const boundary = nextMidnight(cursor);
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



function flushProgress(now = Date.now()) {
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
  flushProgress(now);
  state.running = null;
}



function initRunning(tab, now = Date.now()) {
  return {
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
}

async function pauseTracking() {
  await hydrate();
  finalizeRunning();
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
    if (forceTick) {
      flushProgress(now);
    }



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

  state.running = initRunning(tab, now);
  await save();
}




async function syncActiveTab(forceTick = false) {
  await hydrate();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) {
    await startOrSwitch(tab, { forceTick });
  } else {
    await pauseTracking();
  }
}

async function ensureHeartbeat() {
  chrome.alarms.create(HEARTBEAT, { periodInMinutes: 1 });
}

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
  if (tab) await startOrSwitch(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await hydrate();

  if (!state.running || state.running.tabId !== tabId) return;

  if (changeInfo.url && !isTrackable(tab.url)) {
    await pauseTracking();
    return;
  }

  if (changeInfo.url) {
    flushProgress(Date.now());
    state.running.url = tab.url || state.running.url;
    state.running.title = tab.title || state.running.title;
    state.running.domain = domainFromUrl(state.running.url);
    state.running.category = categoryForDomain(state.running.domain);
    await save();
    return;
  }

  if (changeInfo.title) {
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