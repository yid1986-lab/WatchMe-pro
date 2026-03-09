require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");
const { registerCommands } = require("./commands");
const { mountApi } = require("./api");
const { mountDashboard } = require("./dashboard");
const twitch = require("./twitch");
const youtube = require("./youtube");
const db = require("./db");
const { log } = require("./logger");
const { sendLivePost } = require("./services/poster");

process.on("unhandledRejection", (err) => {
  log("error", "process", `unhandledRejection: ${err?.response?.data?.message || err?.message || err}`);
});

process.on("uncaughtException", (err) => {
  log("error", "process", `uncaughtException: ${err?.response?.data?.message || err?.message || err}`);
});

const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

app.get("/", (req, res) => res.status(200).send("WatchMe OK"));

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

async function postYouTubeLiveToGuild(guildId, row, live) {
  const cfg = db.prepare(`
    SELECT *
    FROM guild_config
    WHERE guild_id=?
  `).get(guildId);

  if (!cfg?.announce_channel_id) return;

  const filters = db.prepare(`
    SELECT keyword
    FROM filters
    WHERE guild_id=? AND (platform='youtube' OR platform='all')
  `).all(guildId)
    .map((x) => (x.keyword || "").toLowerCase())
    .filter(Boolean);

  if (filters.length > 0) {
    const hay = `${live.title} ${live.channelTitle}`.toLowerCase();
    if (!filters.some((k) => hay.includes(k))) return;
  }

  await sendLivePost(client, guildId, {
    platform: "YouTube",
    platformKey: "youtube",
    name: live.channelTitle || "Someone",
    url: live.url,
    sourceUrl: row.url,
    title: live.title || "",
    game: "",
    thumbnail: live.thumbnail || null,
    externalId: row.external_id || null,
  });
}

function startYouTubePolling() {
  if (!process.env.YOUTUBE_API_KEY) {
    log("warn", "youtube", "Polling disabled: missing YOUTUBE_API_KEY");
    return;
  }

  const intervalMs = 180000;
  const lastCheck = new Map();

  const tick = async () => {
    try {
      const rows = db.prepare(`
        SELECT guild_id, url, external_id
        FROM members
        WHERE platform='youtube'
      `).all();

      for (const row of rows) {
        const checkKey = `${row.guild_id}:${row.url}`;
        const last = lastCheck.get(checkKey);
        if (last && Date.now() - last < intervalMs) continue;
        lastCheck.set(checkKey, Date.now());

        const channelId = row.external_id || await youtube.resolveChannelId(row.url);
        if (!channelId) {
          log("warn", "youtube", `Could not resolve channel ID for ${row.url}`);
          continue;
        }

        if (!row.external_id) {
          db.prepare(`
            UPDATE members
            SET external_id=?
            WHERE guild_id=? AND platform='youtube' AND url=?
          `).run(channelId, row.guild_id, row.url);

          db.prepare(`
            UPDATE member_links
            SET external_id=?
            WHERE guild_id=? AND platform='youtube' AND url=? AND external_id IS NULL
          `).run(channelId, row.guild_id, row.url);
        }

        const live = await youtube.findLiveVideoForChannel(channelId).catch(() => null);
        if (!live?.videoId || !live.url) continue;

        const prev = db.prepare(`
          SELECT value
          FROM last_announced
          WHERE guild_id=? AND platform='youtube' AND key=?
        `).get(row.guild_id, channelId);

        if (prev?.value === live.videoId) continue;

        db.prepare(`
          INSERT OR REPLACE INTO last_announced
          (guild_id, platform, key, value, updated_at)
          VALUES (?, 'youtube', ?, ?, ?)
        `).run(row.guild_id, channelId, live.videoId, Date.now());

        await postYouTubeLiveToGuild(row.guild_id, row, live);
        log("info", "youtube", `Posted YouTube live alert for ${live.channelTitle || channelId} in guild ${row.guild_id}`);
      }
    } catch (err) {
      log("error", "youtube", `Polling error: ${err?.response?.data?.message || err?.message || err}`);
    }
  };

  tick().catch(() => null);
  setInterval(tick, intervalMs);
  log("info", "youtube", "YouTube polling started");
}

async function boot() {
  const PORT = process.env.PORT || 3000;

  mountApi(app, client);
  mountDashboard(app);
  twitch.initTwitchWebhook(app, client, db);

  app.listen(PORT, () => log("info", "web", `Web server listening on ${PORT}`));

  if (!process.env.DISCORD_TOKEN) {
    log("error", "discord", "Missing DISCORD_TOKEN");
  } else {
    try {
      await client.login(process.env.DISCORD_TOKEN);
      log("info", "discord", `Logged in as ${client.user.tag}`);
      await registerCommands(client);
      log("info", "discord", "Slash commands registered");
    } catch (err) {
      log("error", "discord", `Login/register failed: ${err?.message || err}`);
    }
  }

  try {
    await twitch.getAppToken();
  } catch (err) {
    log("error", "twitch", `getAppToken failed: ${err?.response?.data?.message || err?.message || err}`);
  }

  startYouTubePolling();
}

boot().catch((err) => {
  log("error", "boot", `Boot error: ${err?.response?.data?.message || err?.message || err}`);
});