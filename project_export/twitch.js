const axios = require("axios");
const crypto = require("crypto");
const { log } = require("./logger");
const { sendLivePost } = require("./services/poster");

let appToken = null;
let appTokenExpiresAt = 0;

const TWITCH_OAUTH = "https://id.twitch.tv/oauth2/token";
const HELIX_BASE = "https://api.twitch.tv/helix";

function nowMs() {
  return Date.now();
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function buildHeaders() {
  return {
    "Client-ID": process.env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${appToken}`,
    "Content-Type": "application/json",
  };
}

async function listSubscriptions() {
  await ensureToken();

  const res = await axios.get(`${HELIX_BASE}/eventsub/subscriptions`, {
    headers: buildHeaders(),
  });

  return res.data?.data || [];
}

async function deleteSubscription(id) {
  await ensureToken();

  return axios.delete(`${HELIX_BASE}/eventsub/subscriptions`, {
    headers: buildHeaders(),
    params: { id },
  });
}

function getCallbackUrl() {
  const callbackBase = requireEnv("PUBLIC_URL");
  return `${callbackBase}/twitch`;
}

function isSubUsable(sub) {
  const ok = new Set(["enabled", "webhook_callback_verification_pending"]);
  return ok.has(sub.status);
}

async function getAppToken() {
  const client_id = requireEnv("TWITCH_CLIENT_ID");
  const client_secret = requireEnv("TWITCH_CLIENT_SECRET");

  const res = await axios.post(TWITCH_OAUTH, null, {
    params: { client_id, client_secret, grant_type: "client_credentials" },
  });

  appToken = res.data.access_token;
  const expiresIn = Number(res.data.expires_in || 0);
  appTokenExpiresAt = nowMs() + Math.max(0, (expiresIn - 60) * 1000);

  log("info", "twitch", "Fetched Twitch app token");
  return appToken;
}

async function ensureToken() {
  if (!appToken || nowMs() >= appTokenExpiresAt) {
    await getAppToken();
  }
}

function parseTwitchLogin(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("twitch.tv")) return null;
    const login = u.pathname.split("/").filter(Boolean)[0];
    return login ? login.toLowerCase() : null;
  } catch {
    return null;
  }
}

function normalizeTwitchUrl(login) {
  return `https://www.twitch.tv/${String(login || "").trim().toLowerCase()}`;
}

async function lookupUserIdByLogin(login) {
  await ensureToken();

  const res = await axios.get(`${HELIX_BASE}/users`, {
    headers: buildHeaders(),
    params: { login },
  });

  const user = res.data?.data?.[0];
  return user
    ? { id: user.id, display_name: user.display_name, login: user.login }
    : null;
}

async function getStreamInfo(broadcasterId) {
  await ensureToken();

  const res = await axios.get(`${HELIX_BASE}/streams`, {
    headers: buildHeaders(),
    params: { user_id: broadcasterId },
  });

  const stream = res.data?.data?.[0];
  if (!stream) return null;

  return {
    title: stream.title || "",
    game_name: stream.game_name || "",
    thumbnail_url: stream.thumbnail_url
      ? stream.thumbnail_url.replace("{width}", "1280").replace("{height}", "720")
      : null,
  };
}

async function createSubscription(type, broadcasterId) {
  await ensureToken();

  const callbackBase = requireEnv("PUBLIC_URL");
  const secret = requireEnv("TWITCH_WEBHOOK_SECRET");

  if (secret.length < 10 || secret.length > 100) {
    throw new Error("TWITCH_WEBHOOK_SECRET must be between 10 and 100 characters");
  }

  const callback = `${callbackBase}/twitch`;

  return axios.post(
    `${HELIX_BASE}/eventsub/subscriptions`,
    {
      type,
      version: "1",
      condition: { broadcaster_user_id: broadcasterId },
      transport: { method: "webhook", callback, secret },
    },
    { headers: buildHeaders() }
  );
}

async function ensureSubscriptions(broadcasterId) {
  const callback = getCallbackUrl();

  const wanted = [
    { type: "stream.online", version: "1" },
    { type: "stream.offline", version: "1" },
  ];

  let subs = [];
  try {
    subs = await listSubscriptions();
  } catch (e) {
    log("warn", "twitch", `EventSub list failed: ${e?.response?.data?.message || e?.message || e}`);
    for (const w of wanted) {
      try {
        await createSubscription(w.type, broadcasterId);
        log("info", "twitch", `Created EventSub fallback ${w.type} for ${broadcasterId}`);
      } catch (err) {
        log("error", "twitch", `EventSub fallback failed ${w.type} for ${broadcasterId}: ${err?.response?.data?.message || err?.message || err}`);
      }
    }
    return;
  }

  for (const w of wanted) {
    const matches = subs.filter((s) => {
      const condId = s.condition?.broadcaster_user_id;
      const cb = s.transport?.callback;
      return (
        s.type === w.type &&
        String(s.version) === String(w.version) &&
        String(condId) === String(broadcasterId) &&
        String(cb) === String(callback)
      );
    });

    const hasGood = matches.some(isSubUsable);
    if (hasGood) continue;

    for (const m of matches) {
      try {
        await deleteSubscription(m.id);
      } catch {}
    }

    try {
      await createSubscription(w.type, broadcasterId);
      log("info", "twitch", `Created EventSub ${w.type} for ${broadcasterId}`);
    } catch (err) {
      log("error", "twitch", `Failed creating EventSub ${w.type} for ${broadcasterId}: ${err?.response?.data?.message || err?.message || err}`);
    }
  }
}

function verifyEventSubSignature(req) {
  const secret = process.env.TWITCH_WEBHOOK_SECRET;
  if (!secret || !req.rawBody) return true;

  const msgId = req.header("Twitch-Eventsub-Message-Id") || "";
  const msgTs = req.header("Twitch-Eventsub-Message-Timestamp") || "";
  const theirSig = req.header("Twitch-Eventsub-Message-Signature") || "";

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(msgId + msgTs);
  hmac.update(req.rawBody);

  const ourSig = "sha256=" + hmac.digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(ourSig), Buffer.from(theirSig));
  } catch {
    return false;
  }
}

function initTwitchWebhook(app, client, db) {
  app.post("/twitch", async (req, res) => {
    const messageType = req.header("Twitch-Eventsub-Message-Type");
    const subType = req.body?.subscription?.type;

    if (!verifyEventSubSignature(req)) {
      log("warn", "twitch", "Signature verification failed");
      return res.sendStatus(403);
    }

    if (messageType === "webhook_callback_verification") {
      return res.status(200).send(req.body?.challenge || "");
    }

    if (messageType !== "notification") {
      return res.sendStatus(200);
    }

    const ev = req.body?.event;
    if (!subType || !ev) {
      return res.sendStatus(400);
    }

    res.sendStatus(200);

    setImmediate(async () => {
      try {
        if (subType === "stream.online") {
          const twitchUrl = normalizeTwitchUrl(ev.broadcaster_user_login);

          const rows = db.prepare(`
            SELECT guild_id
            FROM members
            WHERE platform='twitch' AND TRIM(LOWER(url))=TRIM(LOWER(?))
          `).all(twitchUrl);

          const streamInfo = await getStreamInfo(ev.broadcaster_user_id).catch(() => null);
          const title = streamInfo?.title || "";
          const game = streamInfo?.game_name || "";
          const thumbnail =
            streamInfo?.thumbnail_url ||
            `https://static-cdn.jtvnw.net/previews-ttv/live_user_${ev.broadcaster_user_login}-1280x720.jpg`;

          for (const row of rows) {
            const cfg = db.prepare(`
              SELECT *
              FROM guild_config
              WHERE guild_id=?
            `).get(row.guild_id);

            if (!cfg?.announce_channel_id) continue;

            const last = db.prepare(`
              SELECT posted_at
              FROM twitch_posts
              WHERE guild_id=? AND broadcaster_id=?
            `).get(row.guild_id, ev.broadcaster_user_id);

            const cooldown = Number(cfg.cooldown_seconds ?? 600);
            if (last?.posted_at && Date.now() - last.posted_at < cooldown * 1000) {
              continue;
            }

            const filters = db.prepare(`
              SELECT keyword
              FROM filters
              WHERE guild_id=? AND (platform='twitch' OR platform='all')
            `).all(row.guild_id)
              .map((x) => (x.keyword || "").toLowerCase())
              .filter(Boolean);

            if (filters.length > 0) {
              const hay = `${title} ${game} ${ev.broadcaster_user_name}`.toLowerCase();
              if (!filters.some((k) => hay.includes(k))) {
                continue;
              }
            }

            const sent = await sendLivePost(client, row.guild_id, {
              platform: "Twitch",
              platformKey: "twitch",
              name: ev.broadcaster_user_name,
              url: twitchUrl,
              sourceUrl: twitchUrl,
              title,
              game,
              thumbnail,
              externalId: ev.broadcaster_user_id,
            });

            if (sent) {
              db.prepare(`
                INSERT OR REPLACE INTO twitch_posts
                (guild_id, broadcaster_id, message_id, channel_id, posted_at)
                VALUES (?, ?, ?, ?, ?)
              `).run(row.guild_id, ev.broadcaster_user_id, sent.id, sent.channelId, nowMs());
            }
          }
        }

        if (subType === "stream.offline") {
          const twitchUrl = normalizeTwitchUrl(ev.broadcaster_user_login);

          const guilds = db.prepare(`
            SELECT guild_id
            FROM members
            WHERE platform='twitch' AND TRIM(LOWER(url))=TRIM(LOWER(?))
          `).all(twitchUrl);

          for (const g of guilds) {
            const cfg = db.prepare(`
              SELECT auto_cleanup
              FROM guild_config
              WHERE guild_id=?
            `).get(g.guild_id);

            if (!cfg || Number(cfg.auto_cleanup) !== 1) continue;

            const post = db.prepare(`
              SELECT message_id, channel_id
              FROM twitch_posts
              WHERE guild_id=? AND broadcaster_id=?
            `).get(g.guild_id, ev.broadcaster_user_id);

            if (!post) continue;

            const channel = await client.channels.fetch(post.channel_id).catch(() => null);
            if (!channel) continue;

            const message = await channel.messages.fetch(post.message_id).catch(() => null);
            if (message) {
              await message.delete().catch(() => null);
            }

            db.prepare(`
              DELETE FROM twitch_posts
              WHERE guild_id=? AND broadcaster_id=?
            `).run(g.guild_id, ev.broadcaster_user_id);
          }
        }
      } catch (err) {
        log("error", "twitch", `Webhook processing error: ${err?.response?.data?.message || err?.message || err}`);
      }
    });
  });
}

module.exports = {
  getAppToken,
  parseTwitchLogin,
  lookupUserIdByLogin,
  getStreamInfo,
  ensureSubscriptions,
  initTwitchWebhook,
  normalizeTwitchUrl,
};