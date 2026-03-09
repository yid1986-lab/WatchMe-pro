const axios = require("axios");

const YT_BASE = "https://www.googleapis.com/youtube/v3";

const resolveCache = new Map();
const liveCache = new Map();

const RESOLVE_CACHE_MS = 24 * 60 * 60 * 1000;
const LIVE_CACHE_MS = 30 * 1000;

function ytKey() {
  return process.env.YOUTUBE_API_KEY || "";
}

function isQuotaOrRateError(err) {
  const status = err?.response?.status;
  const reason = err?.response?.data?.error?.errors?.[0]?.reason;

  return (
    status === 403 &&
    (reason === "quotaExceeded" ||
      reason === "dailyLimitExceeded" ||
      reason === "userRateLimitExceeded")
  );
}

function safeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  if (/^UC[a-zA-Z0-9_-]{10,}$/.test(raw)) return raw;

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function parseYouTubeChannelIdFromUrl(input) {
  const u = safeUrl(input);
  if (!u || typeof u === "string") return typeof u === "string" ? u : null;

  const host = u.hostname.toLowerCase();
  if (!host.includes("youtube.com") && !host.includes("youtu.be")) return null;

  const parts = u.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("channel");
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];

  return null;
}

function parseYouTubeHandleFromUrl(input) {
  const u = safeUrl(input);
  if (!u || typeof u === "string") return null;

  const host = u.hostname.toLowerCase();
  if (!host.includes("youtube.com")) return null;

  const parts = u.pathname.split("/").filter(Boolean);
  const raw = parts[0] || "";
  if (raw.startsWith("@") && raw.length > 1) return raw.slice(1);

  return null;
}

function parseYouTubeUserFromUrl(input) {
  const u = safeUrl(input);
  if (!u || typeof u === "string") return null;

  const host = u.hostname.toLowerCase();
  if (!host.includes("youtube.com")) return null;

  const parts = u.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("user");
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];

  return null;
}

function parseYouTubeCustomFromUrl(input) {
  const u = safeUrl(input);
  if (!u || typeof u === "string") return null;

  const host = u.hostname.toLowerCase();
  if (!host.includes("youtube.com")) return null;

  const parts = u.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("c");
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];

  return null;
}

async function resolveViaForHandle(handle) {
  if (!handle) return null;

  const r = await axios.get(`${YT_BASE}/channels`, {
    params: {
      key: ytKey(),
      part: "id",
      forHandle: handle,
      maxResults: 1,
    },
  });

  return r.data?.items?.[0]?.id || null;
}

async function resolveViaForUsername(username) {
  if (!username) return null;

  const r = await axios.get(`${YT_BASE}/channels`, {
    params: {
      key: ytKey(),
      part: "id",
      forUsername: username,
      maxResults: 1,
    },
  });

  return r.data?.items?.[0]?.id || null;
}

async function resolveViaSearch(query) {
  if (!query) return null;

  const r = await axios.get(`${YT_BASE}/search`, {
    params: {
      key: ytKey(),
      part: "snippet",
      q: query,
      type: "channel",
      maxResults: 1,
    },
  });

  return r.data?.items?.[0]?.snippet?.channelId || null;
}

async function resolveChannelId(input) {
  if (!ytKey()) return null;

  const direct = parseYouTubeChannelIdFromUrl(input);
  if (direct) return direct;

  const cacheKey = String(input || "").trim();
  const cached = resolveCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.ts < RESOLVE_CACHE_MS) return cached.channelId;

  try {
    const handle = parseYouTubeHandleFromUrl(input);
    if (handle) {
      const id = await resolveViaForHandle(handle);
      if (id) {
        resolveCache.set(cacheKey, { channelId: id, ts: now });
        return id;
      }

      const fallback = await resolveViaSearch(`@${handle}`);
      resolveCache.set(cacheKey, { channelId: fallback || null, ts: now });
      return fallback || null;
    }

    const user = parseYouTubeUserFromUrl(input);
    if (user) {
      const id = await resolveViaForUsername(user);
      if (id) {
        resolveCache.set(cacheKey, { channelId: id, ts: now });
        return id;
      }

      const fallback = await resolveViaSearch(user);
      resolveCache.set(cacheKey, { channelId: fallback || null, ts: now });
      return fallback || null;
    }

    const custom = parseYouTubeCustomFromUrl(input);
    if (custom) {
      const id = await resolveViaSearch(custom);
      resolveCache.set(cacheKey, { channelId: id || null, ts: now });
      return id || null;
    }

    const u = safeUrl(input);
    if (u && typeof u !== "string") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0]) {
        const id = await resolveViaSearch(parts[0]);
        resolveCache.set(cacheKey, { channelId: id || null, ts: now });
        return id || null;
      }
    }

    resolveCache.set(cacheKey, { channelId: null, ts: now });
    return null;
  } catch (err) {
    if (isQuotaOrRateError(err)) return null;
    return null;
  }
}

async function findLiveVideoForChannel(channelId) {
  if (!ytKey() || !channelId) return null;

  const cached = liveCache.get(channelId);
  const now = Date.now();

  if (cached && now - cached.ts < LIVE_CACHE_MS) return cached.live;

  try {
    const r = await axios.get(`${YT_BASE}/search`, {
      params: {
        key: ytKey(),
        part: "snippet",
        channelId,
        eventType: "live",
        type: "video",
        maxResults: 1,
        order: "date",
      },
    });

    const item = r.data?.items?.[0];
    const live = item
      ? {
          videoId: item.id?.videoId || null,
          title: item.snippet?.title || "",
          channelTitle: item.snippet?.channelTitle || "",
          thumbnail:
            item.snippet?.thumbnails?.high?.url ||
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url ||
            null,
          url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : null,
        }
      : null;

    liveCache.set(channelId, { live, ts: now });
    return live;
  } catch (err) {
    if (isQuotaOrRateError(err)) return null;
    return null;
  }
}

module.exports = {
  resolveChannelId,
  findLiveVideoForChannel,
  parseYouTubeChannelIdFromUrl,
  parseYouTubeHandleFromUrl,
};