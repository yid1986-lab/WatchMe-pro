const { EmbedBuilder } = require("discord.js");
const db = require("../db");
const { log } = require("../logger");

function applyTemplate(template, vars) {
  if (!template) return null;

  return String(template)
    .replace(/\{name\}/g, vars.name || "")
    .replace(/\{url\}/g, vars.url || "")
    .replace(/\{title\}/g, vars.title || "")
    .replace(/\{game\}/g, vars.game || "")
    .replace(/\{platform\}/g, vars.platform || "")
    .replace(/\{team\}/g, vars.team || "");
}

function normalizeImage(url) {
  if (!url) return null;
  const s = String(url).trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

function getLinkedMember(guildId, platform, url, externalId) {
  return db.prepare(`
    SELECT discord_user_id, display_name
    FROM member_links
    WHERE guild_id=?
      AND platform=?
      AND (
        TRIM(LOWER(url))=TRIM(LOWER(?))
        OR (external_id IS NOT NULL AND external_id=?)
      )
    LIMIT 1
  `).get(guildId, platform, url || "", externalId || null);
}

function getMentionText(cfg, linkedMember) {
  const mode = String(cfg?.mention_mode || "role").toLowerCase();
  const roleMention = cfg?.live_role_id ? `<@&${cfg.live_role_id}>` : null;
  const memberMention = linkedMember?.discord_user_id ? `<@${linkedMember.discord_user_id}>` : null;

  if (mode === "member") return memberMention || null;
  if (mode === "both") return [memberMention, roleMention].filter(Boolean).join(" ") || null;
  if (mode === "none") return null;
  return roleMention || null;
}

function getAllowedMentions(cfg, linkedMember) {
  const mode = String(cfg?.mention_mode || "role").toLowerCase();
  const out = { parse: [] };

  if ((mode === "role" || mode === "both") && cfg?.live_role_id) {
    out.roles = [cfg.live_role_id];
  }

  if ((mode === "member" || mode === "both") && linkedMember?.discord_user_id) {
    out.users = [linkedMember.discord_user_id];
  }

  return out;
}

function buildBody(cfg, data, linkedMember) {
  const displayName = linkedMember?.display_name || data.name || "Someone";

  return (
    applyTemplate(cfg?.message_template, {
      name: displayName,
      url: data.url,
      title: data.title,
      game: data.game,
      platform: data.platform,
      team: cfg?.brand_name || "",
    }) || `🔴 **${displayName} is LIVE on ${data.platform}!**\n${data.url}`
  );
}

async function sendLivePost(client, guildId, data) {
  const cfg = db.prepare(`
    SELECT *
    FROM guild_config
    WHERE guild_id=?
  `).get(guildId);

  if (!cfg?.announce_channel_id) return null;

  const channel = await client.channels.fetch(cfg.announce_channel_id).catch(() => null);
  if (!channel) return null;

  const linkedMember = getLinkedMember(
    guildId,
    data.platformKey,
    data.sourceUrl || data.url,
    data.externalId
  );

  const mention = getMentionText(cfg, linkedMember);
  const allowedMentions = getAllowedMentions(cfg, linkedMember);
  const body = buildBody(cfg, data, linkedMember);

  if (Number(cfg.use_embed ?? 1) !== 1) {
    return channel.send({
      content: [mention, body].filter(Boolean).join("\n"),
      allowedMentions,
    }).catch((err) => {
      log("error", "poster", `Text post failed: ${err?.message || err}`);
      return null;
    });
  }

  const embed = new EmbedBuilder()
    .setColor(Number(cfg.embed_color ?? 5793266))
    .setTitle(`${linkedMember?.display_name || data.name || "Someone"} is LIVE on ${data.platform}`)
    .setURL(data.url)
    .setDescription(body)
    .setTimestamp(new Date());

  if (Number(cfg.show_title ?? 1) === 1 && data.title) {
    embed.addFields({ name: "Title", value: String(data.title).slice(0, 1024) });
  }

  if (Number(cfg.show_game ?? 1) === 1 && data.game) {
    embed.addFields({
      name: data.platformKey === "youtube" ? "Category" : "Game",
      value: String(data.game).slice(0, 1024),
    });
  }

  if (cfg.brand_name) {
    embed.setAuthor({
      name: String(cfg.brand_name).slice(0, 256),
      iconURL: normalizeImage(cfg.brand_logo_url) || undefined,
    });
  } else if (normalizeImage(cfg.brand_logo_url)) {
    embed.setThumbnail(cfg.brand_logo_url);
  }

  if (cfg.footer_text) {
    embed.setFooter({ text: String(cfg.footer_text).slice(0, 2048) });
  }

  if (Number(cfg.show_images ?? 1) === 1 && normalizeImage(data.thumbnail)) {
    embed.setImage(data.thumbnail);
  }

  return channel.send({
    content: mention || null,
    embeds: [embed],
    allowedMentions,
  }).catch((err) => {
    log("error", "poster", `Embed post failed: ${err?.message || err}`);
    return null;
  });
}

async function sendTestPost(client, guildId) {
  return sendLivePost(client, guildId, {
    platform: "Twitch",
    platformKey: "twitch",
    name: "Dan Carpenter",
    url: "https://www.twitch.tv/watchme_test",
    sourceUrl: "https://www.twitch.tv/watchme_test",
    title: "WatchMe dashboard test post",
    game: "Just Chatting",
    thumbnail: "https://static-cdn.jtvnw.net/previews-ttv/live_user_watchme_test-1280x720.jpg",
    externalId: "test-user",
  });
}

module.exports = {
  applyTemplate,
  sendLivePost,
  sendTestPost,
};
