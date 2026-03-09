const express = require("express");
const db = require("./db");
const twitch = require("./twitch");
const youtube = require("./youtube");
const { log } = require("./logger");
const { sendTestPost } = require("./services/poster");

function normalizePlatform(platform) {
  return String(platform || "").trim().toLowerCase();
}

function isValidYouTubeUrl(url) {
  const s = String(url || "").trim();
  return s.includes("youtube.com/") || s.includes("youtu.be/") || /^UC[a-zA-Z0-9_-]{10,}$/.test(s);
}

function cleanUrl(s) {
  return String(s || "").trim();
}

function parseIntSafe(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mountApi(app, client) {
  const router = express.Router();

  router.get("/health", async (req, res) => {
    let discord = false;
    try {
      discord = Boolean(client?.isReady?.() || client?.user);
    } catch {}

    const counts = {
      guilds: db.prepare("SELECT COUNT(*) AS n FROM guild_config").get()?.n || 0,
      members: db.prepare("SELECT COUNT(*) AS n FROM members").get()?.n || 0,
      member_links: db.prepare("SELECT COUNT(*) AS n FROM member_links").get()?.n || 0,
      filters: db.prepare("SELECT COUNT(*) AS n FROM filters").get()?.n || 0,
      twitch_posts: db.prepare("SELECT COUNT(*) AS n FROM twitch_posts").get()?.n || 0,
    };

    return res.json({
      ok: true,
      discord,
      youtubeEnabled: Boolean(process.env.YOUTUBE_API_KEY),
      twitchConfigured: Boolean(
        process.env.TWITCH_CLIENT_ID &&
        process.env.TWITCH_CLIENT_SECRET &&
        process.env.TWITCH_WEBHOOK_SECRET &&
        process.env.PUBLIC_URL
      ),
      counts,
      now: Date.now(),
    });
  });

  router.get("/guilds", (req, res) => {
    const rows = db.prepare(`
      SELECT guild_id, announce_channel_id, live_role_id, auto_cleanup, cooldown_seconds,
             use_embed, embed_color, message_template, brand_name, brand_logo_url,
             footer_text, show_images, show_title, show_game, mention_mode
      FROM guild_config
      ORDER BY guild_id
    `).all();

    res.json(rows);
  });

  router.get("/guilds/:guildId/config", (req, res) => {
    const row = db.prepare(`
      SELECT guild_id, announce_channel_id, live_role_id, auto_cleanup, cooldown_seconds,
             use_embed, embed_color, message_template, brand_name, brand_logo_url,
             footer_text, show_images, show_title, show_game, mention_mode
      FROM guild_config
      WHERE guild_id=?
    `).get(req.params.guildId);

    if (!row) {
      return res.status(404).json({ error: "Guild config not found" });
    }

    res.json(row);
  });

  router.post("/guilds/:guildId/config", (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};

    const announce_channel_id = cleanUrl(body.announce_channel_id);
    const live_role_id = cleanUrl(body.live_role_id) || null;
    const auto_cleanup = parseIntSafe(body.auto_cleanup, 0) ? 1 : 0;
    const cooldown_seconds = Math.max(0, parseIntSafe(body.cooldown_seconds, 600));
    const use_embed = parseIntSafe(body.use_embed, 1) ? 1 : 0;
    const embed_color = parseIntSafe(body.embed_color, 5793266);
    const message_template = String(body.message_template || "").trim() || null;
    const brand_name = String(body.brand_name || "").trim() || null;
    const brand_logo_url = String(body.brand_logo_url || "").trim() || null;
    const footer_text = String(body.footer_text || "").trim() || null;
    const show_images = parseIntSafe(body.show_images, 1) ? 1 : 0;
    const show_title = parseIntSafe(body.show_title, 1) ? 1 : 0;
    const show_game = parseIntSafe(body.show_game, 1) ? 1 : 0;
    const mention_mode = ["role", "member", "both", "none"].includes(body.mention_mode)
      ? body.mention_mode
      : "role";

    if (!announce_channel_id) {
      return res.status(400).json({ error: "announce_channel_id required" });
    }

    db.prepare(`
      INSERT INTO guild_config (
        guild_id, announce_channel_id, live_role_id, auto_cleanup, cooldown_seconds,
        use_embed, embed_color, message_template, brand_name, brand_logo_url,
        footer_text, show_images, show_title, show_game, mention_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        announce_channel_id=excluded.announce_channel_id,
        live_role_id=excluded.live_role_id,
        auto_cleanup=excluded.auto_cleanup,
        cooldown_seconds=excluded.cooldown_seconds,
        use_embed=excluded.use_embed,
        embed_color=excluded.embed_color,
        message_template=excluded.message_template,
        brand_name=excluded.brand_name,
        brand_logo_url=excluded.brand_logo_url,
        footer_text=excluded.footer_text,
        show_images=excluded.show_images,
        show_title=excluded.show_title,
        show_game=excluded.show_game,
        mention_mode=excluded.mention_mode
    `).run(
      gid,
      announce_channel_id,
      live_role_id,
      auto_cleanup,
      cooldown_seconds,
      use_embed,
      embed_color,
      message_template,
      brand_name,
      brand_logo_url,
      footer_text,
      show_images,
      show_title,
      show_game,
      mention_mode
    );

    log("info", "api", `Saved config for guild ${gid}`);
    res.json({ ok: true });
  });

  router.post("/guilds/:guildId/test-post", async (req, res) => {
    const gid = req.params.guildId;
    const sent = await sendTestPost(client, gid);

    if (!sent) {
      return res.status(400).json({ error: "Could not send test post. Check guild config and channel permissions." });
    }

    log("info", "api", `Sent test post for guild ${gid}`);
    res.json({ ok: true, message_id: sent.id, channel_id: sent.channelId });
  });

  router.get("/guilds/:guildId/members", (req, res) => {
    const rows = db.prepare(`
      SELECT id, guild_id, platform, url, external_id, added_at
      FROM members
      WHERE guild_id=?
      ORDER BY platform, url
    `).all(req.params.guildId);

    res.json(rows.map((r) => ({
      ...r,
      status: r.external_id ? "resolved" : "pending",
    })));
  });

  router.post("/guilds/:guildId/members", async (req, res) => {
    const gid = req.params.guildId;
    const platform = normalizePlatform(req.body?.platform);
    const urlRaw = cleanUrl(req.body?.url);

    const cfg = db.prepare(`
      SELECT announce_channel_id
      FROM guild_config
      WHERE guild_id=?
    `).get(gid);

    if (!cfg?.announce_channel_id) {
      return res.status(400).json({ error: "Set announce channel first" });
    }

    if (platform === "twitch") {
      const login = twitch.parseTwitchLogin(urlRaw);
      if (!login) {
        return res.status(400).json({ error: "Invalid Twitch URL" });
      }

      const user = await twitch.lookupUserIdByLogin(login);
      if (!user) {
        return res.status(404).json({ error: "Twitch user not found" });
      }

      const normalized = `https://www.twitch.tv/${String(user.login).toLowerCase()}`;

      try {
        db.prepare(`
          INSERT INTO members (guild_id, platform, url, external_id, added_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(gid, "twitch", normalized, user.id, Date.now());
      } catch {
        await twitch.ensureSubscriptions(user.id);
        return res.json({ ok: true, message: "Already saved", url: normalized, external_id: user.id });
      }

      await twitch.ensureSubscriptions(user.id);
      log("info", "api", `Added Twitch member ${normalized} to guild ${gid}`);
      return res.json({ ok: true, url: normalized, external_id: user.id });
    }

    if (platform === "youtube") {
      if (!isValidYouTubeUrl(urlRaw)) {
        return res.status(400).json({ error: "Invalid YouTube URL" });
      }

      let channelId = youtube.parseYouTubeChannelIdFromUrl(urlRaw);
      if (!channelId) {
        channelId = await youtube.resolveChannelId(urlRaw);
      }

      try {
        db.prepare(`
          INSERT INTO members (guild_id, platform, url, external_id, added_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(gid, "youtube", urlRaw, channelId || null, Date.now());
      } catch {
        if (channelId) {
          db.prepare(`
            UPDATE members
            SET external_id=?
            WHERE guild_id=? AND platform='youtube' AND url=?
          `).run(channelId, gid, urlRaw);
        }

        return res.json({
          ok: true,
          message: "Already saved",
          url: urlRaw,
          external_id: channelId || null,
        });
      }

      log("info", "api", `Added YouTube member ${urlRaw} to guild ${gid}`);
      return res.json({ ok: true, url: urlRaw, external_id: channelId || null });
    }

    return res.status(400).json({ error: "Unknown platform" });
  });

  router.delete("/guilds/:guildId/members/:id", (req, res) => {
    const info = db.prepare(`
      DELETE FROM members
      WHERE guild_id=? AND id=?
    `).run(req.params.guildId, req.params.id);

    log("info", "api", `Deleted member ${req.params.id} from guild ${req.params.guildId}`);
    res.json({ ok: true, deleted: info.changes });
  });

  router.get("/guilds/:guildId/member-links", (req, res) => {
    const rows = db.prepare(`
      SELECT id, guild_id, discord_user_id, display_name, platform, url, external_id, added_at
      FROM member_links
      WHERE guild_id=?
      ORDER BY platform, display_name, url
    `).all(req.params.guildId);

    res.json(rows);
  });

  router.post("/guilds/:guildId/member-links", async (req, res) => {
    const gid = req.params.guildId;
    const discord_user_id = cleanUrl(req.body?.discord_user_id);
    const display_name = String(req.body?.display_name || "").trim() || null;
    const platform = normalizePlatform(req.body?.platform);
    const urlRaw = cleanUrl(req.body?.url);

    if (!discord_user_id) {
      return res.status(400).json({ error: "discord_user_id required" });
    }

    if (!urlRaw) {
      return res.status(400).json({ error: "url required" });
    }

    let external_id = null;

    if (platform === "twitch") {
      const login = twitch.parseTwitchLogin(urlRaw);
      if (!login) return res.status(400).json({ error: "Invalid Twitch URL" });

      const user = await twitch.lookupUserIdByLogin(login);
      if (!user) return res.status(404).json({ error: "Twitch user not found" });

      external_id = user.id;
    } else if (platform === "youtube") {
      if (!isValidYouTubeUrl(urlRaw)) return res.status(400).json({ error: "Invalid YouTube URL" });
      external_id = youtube.parseYouTubeChannelIdFromUrl(urlRaw) || await youtube.resolveChannelId(urlRaw);
    } else {
      return res.status(400).json({ error: "Unknown platform" });
    }

    db.prepare(`
      INSERT INTO member_links (guild_id, discord_user_id, display_name, platform, url, external_id, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, platform, url) DO UPDATE SET
        discord_user_id=excluded.discord_user_id,
        display_name=excluded.display_name,
        external_id=excluded.external_id
    `).run(
      gid,
      discord_user_id,
      display_name,
      platform,
      urlRaw,
      external_id || null,
      Date.now()
    );

    log("info", "api", `Added member link ${platform}:${urlRaw} -> ${discord_user_id} for guild ${gid}`);
    res.json({ ok: true, external_id: external_id || null });
  });

  router.delete("/guilds/:guildId/member-links/:id", (req, res) => {
    const info = db.prepare(`
      DELETE FROM member_links
      WHERE guild_id=? AND id=?
    `).run(req.params.guildId, req.params.id);

    log("info", "api", `Deleted member link ${req.params.id} from guild ${req.params.guildId}`);
    res.json({ ok: true, deleted: info.changes });
  });

  router.get("/guilds/:guildId/filters", (req, res) => {
    const rows = db.prepare(`
      SELECT guild_id, platform, keyword, added_at
      FROM filters
      WHERE guild_id=?
      ORDER BY platform, keyword
    `).all(req.params.guildId);

    res.json(rows);
  });

  router.post("/guilds/:guildId/filters", (req, res) => {
    const gid = req.params.guildId;
    const platform = normalizePlatform(req.body?.platform || "all");
    const keyword = String(req.body?.keyword || "").trim().toLowerCase();

    if (!keyword) {
      return res.status(400).json({ error: "keyword required" });
    }

    db.prepare(`
      INSERT OR REPLACE INTO filters (guild_id, platform, keyword, added_at)
      VALUES (?, ?, ?, ?)
    `).run(gid, platform, keyword, Date.now());

    log("info", "api", `Added filter ${platform}:${keyword} for guild ${gid}`);
    res.json({ ok: true });
  });

  router.delete("/guilds/:guildId/filters", (req, res) => {
    const gid = req.params.guildId;
    const platform = normalizePlatform(req.body?.platform || "all");
    const keyword = String(req.body?.keyword || "").trim().toLowerCase();

    const info = db.prepare(`
      DELETE FROM filters
      WHERE guild_id=? AND platform=? AND keyword=?
    `).run(gid, platform, keyword);

    log("info", "api", `Deleted filter ${platform}:${keyword} for guild ${gid}`);
    res.json({ ok: true, deleted: info.changes });
  });

  router.post("/guilds/:guildId/resubscribe", async (req, res) => {
    const gid = req.params.guildId;

    const rows = db.prepare(`
      SELECT DISTINCT external_id
      FROM members
      WHERE guild_id=? AND platform='twitch' AND external_id IS NOT NULL
    `).all(gid);

    let ok = 0;
    for (const row of rows) {
      try {
        await twitch.ensureSubscriptions(row.external_id);
        ok += 1;
      } catch {}
    }

    log("info", "api", `Resubscribed ${ok}/${rows.length} Twitch IDs for guild ${gid}`);
    res.json({ ok: true, refreshed: ok, total: rows.length });
  });

  router.get("/guilds/:guildId/twitch-posts", (req, res) => {
    const rows = db.prepare(`
      SELECT guild_id, broadcaster_id, message_id, channel_id, posted_at
      FROM twitch_posts
      WHERE guild_id=?
      ORDER BY posted_at DESC
    `).all(req.params.guildId);

    res.json(rows);
  });

  router.get("/logs", (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const rows = db.prepare(`
      SELECT id, level, scope, message, created_at
      FROM runtime_logs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);

    res.json(rows);
  });

  app.use("/api", router);
}

module.exports = { mountApi };