const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const db = require("./db");
const twitch = require("./twitch");
const youtube = require("./youtube");
const { sendTestPost } = require("./services/poster");
const { log } = require("./logger");

const ADMIN_DASH = "watchme_admin";
const CREATOR_DASH = "watchme_creator";

function cfgDefaults(guildId) {
  return {
    guild_id: guildId,
    announce_channel_id: null,
    live_role_id: null,
    auto_cleanup: 0,
    cooldown_seconds: 600,
    use_embed: 1,
    embed_color: 5793266,
    message_template: null,
    brand_name: null,
    brand_logo_url: null,
    footer_text: null,
    show_images: 1,
    show_title: 1,
    show_game: 1,
    mention_mode: "role",
  };
}

function getGuildConfig(guildId) {
  const row = db.prepare(`
    SELECT *
    FROM guild_config
    WHERE guild_id=?
  `).get(guildId);

  return { ...cfgDefaults(guildId), ...(row || {}) };
}

function upsertGuildConfig(guildId, patch = {}) {
  const current = getGuildConfig(guildId);
  const next = { ...current, ...patch };

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
    guildId,
    next.announce_channel_id,
    next.live_role_id,
    Number(next.auto_cleanup) ? 1 : 0,
    Math.max(0, Number(next.cooldown_seconds) || 600),
    Number(next.use_embed) ? 1 : 0,
    Number(next.embed_color) || 5793266,
    next.message_template || null,
    next.brand_name || null,
    next.brand_logo_url || null,
    next.footer_text || null,
    Number(next.show_images) ? 1 : 0,
    Number(next.show_title) ? 1 : 0,
    Number(next.show_game) ? 1 : 0,
    ["role", "member", "both", "none"].includes(String(next.mention_mode))
      ? String(next.mention_mode)
      : "role"
  );

  return getGuildConfig(guildId);
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanLower(value) {
  return cleanText(value).toLowerCase();
}

function isValidYouTubeUrl(url) {
  const s = cleanText(url);
  return s.includes("youtube.com/") || s.includes("youtu.be/") || /^UC[a-zA-Z0-9_-]{10,}$/.test(s);
}

function buildModal(customId, title, inputs) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  for (const input of inputs) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(input.id)
          .setLabel(input.label)
          .setStyle(input.style || TextInputStyle.Short)
          .setRequired(Boolean(input.required))
          .setValue(input.value || "")
          .setPlaceholder(input.placeholder || "")
      )
    );
  }

  return modal;
}

function buildSimpleListEmbed(title, lines, color = 5793266) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines.length ? lines.join("\n").slice(0, 4000) : "Nothing saved.")
    .setTimestamp(new Date());
}

function getCounts(guildId) {
  return {
    members: db.prepare(`SELECT COUNT(*) AS n FROM members WHERE guild_id=?`).get(guildId)?.n || 0,
    links: db.prepare(`SELECT COUNT(*) AS n FROM member_links WHERE guild_id=?`).get(guildId)?.n || 0,
    filters: db.prepare(`SELECT COUNT(*) AS n FROM filters WHERE guild_id=?`).get(guildId)?.n || 0,
  };
}

function buildAdminDashboardEmbed(guildId) {
  const cfg = getGuildConfig(guildId);
  const counts = getCounts(guildId);

  const embed = new EmbedBuilder()
    .setColor(Number(cfg.embed_color ?? 5793266))
    .setTitle("WatchMe Admin Dashboard")
    .setDescription("Server settings, branding, post behavior, roles, cooldown, and test tools.")
    .addFields(
      {
        name: "Announcement Channel",
        value: cfg.announce_channel_id ? `<#${cfg.announce_channel_id}>` : "Not set",
        inline: true,
      },
      {
        name: "Live Role",
        value: cfg.live_role_id ? `<@&${cfg.live_role_id}>` : "None",
        inline: true,
      },
      {
        name: "Mention Mode",
        value: cfg.mention_mode || "role",
        inline: true,
      },
      {
        name: "Embed",
        value: Number(cfg.use_embed) === 1 ? "On" : "Off",
        inline: true,
      },
      {
        name: "Cleanup",
        value: Number(cfg.auto_cleanup) === 1 ? "On" : "Off",
        inline: true,
      },
      {
        name: "Cooldown",
        value: `${Number(cfg.cooldown_seconds ?? 600)}s`,
        inline: true,
      },
      {
        name: "Media",
        value:
          `Images: ${Number(cfg.show_images) === 1 ? "On" : "Off"}\n` +
          `Title: ${Number(cfg.show_title) === 1 ? "On" : "Off"}\n` +
          `Game: ${Number(cfg.show_game) === 1 ? "On" : "Off"}`,
        inline: true,
      },
      {
        name: "Branding",
        value:
          `Name: ${cfg.brand_name || "None"}\n` +
          `Footer: ${cfg.footer_text || "None"}`,
        inline: true,
      },
      {
        name: "Saved",
        value:
          `Creators: ${counts.members}\n` +
          `Links: ${counts.links}\n` +
          `Filters: ${counts.filters}`,
        inline: true,
      }
    )
    .setFooter({ text: "Admin controls" })
    .setTimestamp(new Date());

  if (cfg.brand_logo_url) {
    try {
      embed.setThumbnail(cfg.brand_logo_url);
    } catch {}
  }

  return embed;
}

function buildCreatorDashboardEmbed(guildId) {
  const cfg = getGuildConfig(guildId);

  const members = db.prepare(`
    SELECT platform, url
    FROM members
    WHERE guild_id=?
    ORDER BY platform, url
    LIMIT 5
  `).all(guildId);

  const links = db.prepare(`
    SELECT discord_user_id, display_name, platform
    FROM member_links
    WHERE guild_id=?
    ORDER BY platform, display_name, discord_user_id
    LIMIT 5
  `).all(guildId);

  const filters = db.prepare(`
    SELECT platform, keyword
    FROM filters
    WHERE guild_id=?
    ORDER BY platform, keyword
    LIMIT 5
  `).all(guildId);

  return new EmbedBuilder()
    .setColor(Number(cfg.embed_color ?? 5793266))
    .setTitle("WatchMe Creator Dashboard")
    .setDescription("Manage creators, linked members, and keyword filters.")
    .addFields(
      {
        name: "Creators",
        value: members.length
          ? members.map((r) => `• **${r.platform}** — ${r.url}`).join("\n").slice(0, 1024)
          : "None saved",
        inline: false,
      },
      {
        name: "Member Links",
        value: links.length
          ? links.map((r) => `• ${r.display_name || `<@${r.discord_user_id}>`} — **${r.platform}**`).join("\n").slice(0, 1024)
          : "No member links",
        inline: false,
      },
      {
        name: "Filters",
        value: filters.length
          ? filters.map((r) => `• **${r.platform}** — ${r.keyword}`).join("\n").slice(0, 1024)
          : "No filters",
        inline: false,
      }
    )
    .setFooter({ text: "Creator controls" })
    .setTimestamp(new Date());
}

function buildAdminDashboardRows(guildId) {
  const cfg = getGuildConfig(guildId);

  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${ADMIN_DASH}:channel`)
      .setPlaceholder("Set announcement channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`${ADMIN_DASH}:role`)
      .setPlaceholder("Set live role")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${ADMIN_DASH}:mention`)
      .setPlaceholder(`Mention mode: ${cfg.mention_mode}`)
      .addOptions(
        { label: "Role", value: "role", description: "Ping configured role" },
        { label: "Member", value: "member", description: "Ping linked member only" },
        { label: "Both", value: "both", description: "Ping both member and role" },
        { label: "None", value: "none", description: "No ping" }
      )
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:toggle_embed`)
      .setLabel("Toggle Embed")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:toggle_cleanup`)
      .setLabel("Toggle Cleanup")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:toggle_images`)
      .setLabel("Toggle Images")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:toggle_title`)
      .setLabel("Toggle Title")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:toggle_game`)
      .setLabel("Toggle Game")
      .setStyle(ButtonStyle.Secondary)
  );

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:modal_cooldown`)
      .setLabel("Set Cooldown")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:modal_brand`)
      .setLabel("Branding")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:modal_template`)
      .setLabel("Message Template")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:clear_role`)
      .setLabel("Clear Role")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ADMIN_DASH}:test_post`)
      .setLabel("Test Post")
      .setStyle(ButtonStyle.Success)
  );

  return [row1, row2, row3, row4, row5];
}

function buildCreatorDashboardRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:modal_add_url`)
      .setLabel("Add Creator")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:remove_url_menu`)
      .setLabel("Remove Creator")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:view_creators`)
      .setLabel("View Creators")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:modal_link_member`)
      .setLabel("Link Member")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:remove_link_menu`)
      .setLabel("Remove Link")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:view_links`)
      .setLabel("View Links")
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:modal_add_filter`)
      .setLabel("Add Filter")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:remove_filter_menu`)
      .setLabel("Remove Filter")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:view_filters`)
      .setLabel("View Filters")
      .setStyle(ButtonStyle.Secondary)
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:refresh`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${CREATOR_DASH}:resubscribe`)
      .setLabel("Resubscribe Twitch")
      .setStyle(ButtonStyle.Primary)
  );

  return [row1, row2, row3, row4];
}

async function replyAdminDashboard(interaction) {
  const guildId = interaction.guildId;
  const embed = buildAdminDashboardEmbed(guildId);
  const components = buildAdminDashboardRows(guildId);

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({
      embeds: [embed],
      components,
    });
  }

  return interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
  });
}

async function replyCreatorDashboard(interaction) {
  const guildId = interaction.guildId;
  const embed = buildCreatorDashboardEmbed(guildId);
  const components = buildCreatorDashboardRows();

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({
      embeds: [embed],
      components,
    });
  }

  return interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
  });
}

async function handleAddUrl(interaction) {
  const guildId = interaction.guildId;
  const platform = cleanLower(interaction.fields.getTextInputValue("platform"));
  const urlRaw = cleanText(interaction.fields.getTextInputValue("url"));

  const cfg = getGuildConfig(guildId);
  if (!cfg.announce_channel_id) {
    return interaction.reply({
      content: "Set the announcement channel first in /watchme-admin.",
      ephemeral: true,
    });
  }

  if (platform === "twitch") {
    const login = twitch.parseTwitchLogin(urlRaw);
    if (!login) {
      return interaction.reply({ content: "Invalid Twitch URL.", ephemeral: true });
    }

    const user = await twitch.lookupUserIdByLogin(login);
    if (!user) {
      return interaction.reply({ content: "Twitch user not found.", ephemeral: true });
    }

    const normalized = `https://www.twitch.tv/${String(user.login).toLowerCase()}`;

    try {
      db.prepare(`
        INSERT INTO members (guild_id, platform, url, external_id, added_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(guildId, "twitch", normalized, user.id, Date.now());
    } catch {
      await twitch.ensureSubscriptions(user.id);
      return interaction.reply({
        content: `Already saved. Twitch subscriptions refreshed.\n${normalized}`,
        ephemeral: true,
      });
    }

    await twitch.ensureSubscriptions(user.id);
    log("info", "creator-dashboard", `Added Twitch URL ${normalized} in guild ${guildId}`);
    return interaction.reply({
      content: `Added Twitch URL:\n${normalized}`,
      ephemeral: true,
    });
  }

  if (platform === "youtube") {
    if (!isValidYouTubeUrl(urlRaw)) {
      return interaction.reply({ content: "Invalid YouTube URL.", ephemeral: true });
    }

    let channelId = youtube.parseYouTubeChannelIdFromUrl(urlRaw);
    if (!channelId) {
      channelId = await youtube.resolveChannelId(urlRaw);
    }

    try {
      db.prepare(`
        INSERT INTO members (guild_id, platform, url, external_id, added_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(guildId, "youtube", urlRaw, channelId || null, Date.now());
    } catch {
      if (channelId) {
        db.prepare(`
          UPDATE members
          SET external_id=?
          WHERE guild_id=? AND platform='youtube' AND url=?
        `).run(channelId, guildId, urlRaw);
      }

      return interaction.reply({
        content: `Already saved.${channelId ? ` Channel ID: ${channelId}` : ""}`,
        ephemeral: true,
      });
    }

    log("info", "creator-dashboard", `Added YouTube URL ${urlRaw} in guild ${guildId}`);
    return interaction.reply({
      content: channelId
        ? `Added YouTube URL.\nChannel ID: ${channelId}`
        : "Added YouTube URL, but channel ID could not be resolved right now.",
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: "Platform must be twitch or youtube.",
    ephemeral: true,
  });
}

async function handleLinkMember(interaction) {
  const guildId = interaction.guildId;
  const discordUserId = cleanText(interaction.fields.getTextInputValue("discord_user_id"));
  const displayName = cleanText(interaction.fields.getTextInputValue("display_name")) || null;
  const platform = cleanLower(interaction.fields.getTextInputValue("platform"));
  const urlRaw = cleanText(interaction.fields.getTextInputValue("url"));

  if (!discordUserId || !urlRaw) {
    return interaction.reply({
      content: "Discord user ID and URL are required.",
      ephemeral: true,
    });
  }

  let externalId = null;

  if (platform === "twitch") {
    const login = twitch.parseTwitchLogin(urlRaw);
    if (!login) {
      return interaction.reply({ content: "Invalid Twitch URL.", ephemeral: true });
    }

    const user = await twitch.lookupUserIdByLogin(login);
    if (!user) {
      return interaction.reply({ content: "Twitch user not found.", ephemeral: true });
    }

    externalId = user.id;
  } else if (platform === "youtube") {
    if (!isValidYouTubeUrl(urlRaw)) {
      return interaction.reply({ content: "Invalid YouTube URL.", ephemeral: true });
    }
    externalId = youtube.parseYouTubeChannelIdFromUrl(urlRaw) || await youtube.resolveChannelId(urlRaw);
  } else {
    return interaction.reply({
      content: "Platform must be twitch or youtube.",
      ephemeral: true,
    });
  }

  db.prepare(`
    INSERT INTO member_links (guild_id, discord_user_id, display_name, platform, url, external_id, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, platform, url) DO UPDATE SET
      discord_user_id=excluded.discord_user_id,
      display_name=excluded.display_name,
      external_id=excluded.external_id
  `).run(
    guildId,
    discordUserId,
    displayName,
    platform,
    urlRaw,
    externalId || null,
    Date.now()
  );

  log("info", "creator-dashboard", `Linked member ${discordUserId} -> ${platform}:${urlRaw} in guild ${guildId}`);
  return interaction.reply({
    content: `Linked <@${discordUserId}> to ${platform} URL.`,
    ephemeral: true,
  });
}

function makeRemovalMenu(customId, placeholder, rows, labelFn, valueFn) {
  const opts = rows.slice(0, 25).map((row) => ({
    label: labelFn(row).slice(0, 100),
    value: String(valueFn(row)),
    description: row.platform ? `${row.platform}`.slice(0, 100) : undefined,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(opts)
  );
}

async function openRemoveUrlMenu(interaction) {
  const rows = db.prepare(`
    SELECT id, platform, url
    FROM members
    WHERE guild_id=?
    ORDER BY platform, url
    LIMIT 25
  `).all(interaction.guildId);

  if (!rows.length) {
    return interaction.reply({ content: "No saved creators to remove.", ephemeral: true });
  }

  return interaction.reply({
    content: "Choose a creator to remove:",
    components: [
      makeRemovalMenu(
        `${CREATOR_DASH}:remove_url_select`,
        "Select creator",
        rows,
        (r) => `${r.platform} — ${r.url}`,
        (r) => r.id
      ),
    ],
    ephemeral: true,
  });
}

async function openRemoveLinkMenu(interaction) {
  const rows = db.prepare(`
    SELECT id, platform, url, discord_user_id, display_name
    FROM member_links
    WHERE guild_id=?
    ORDER BY platform, display_name, url
    LIMIT 25
  `).all(interaction.guildId);

  if (!rows.length) {
    return interaction.reply({ content: "No member links to remove.", ephemeral: true });
  }

  return interaction.reply({
    content: "Choose a member link to remove:",
    components: [
      makeRemovalMenu(
        `${CREATOR_DASH}:remove_link_select`,
        "Select member link",
        rows,
        (r) => `${r.display_name || r.discord_user_id} — ${r.platform}`,
        (r) => r.id
      ),
    ],
    ephemeral: true,
  });
}

async function openRemoveFilterMenu(interaction) {
  const rows = db.prepare(`
    SELECT rowid AS id, platform, keyword
    FROM filters
    WHERE guild_id=?
    ORDER BY platform, keyword
    LIMIT 25
  `).all(interaction.guildId);

  if (!rows.length) {
    return interaction.reply({ content: "No filters to remove.", ephemeral: true });
  }

  return interaction.reply({
    content: "Choose a filter to remove:",
    components: [
      makeRemovalMenu(
        `${CREATOR_DASH}:remove_filter_select`,
        "Select filter",
        rows,
        (r) => `${r.platform} — ${r.keyword}`,
        (r) => r.id
      ),
    ],
    ephemeral: true,
  });
}

async function showCreators(interaction) {
  const guildId = interaction.guildId;
  const rows = db.prepare(`
    SELECT platform, url, external_id
    FROM members
    WHERE guild_id=?
    ORDER BY platform, url
  `).all(guildId);

  return interaction.reply({
    embeds: [
      buildSimpleListEmbed(
        "Saved Creators",
        rows.length
          ? rows.map((r) => `• **${r.platform}** — ${r.url}${r.external_id ? " (resolved)" : ""}`)
          : ["No creators saved."],
        getGuildConfig(guildId).embed_color
      ),
    ],
    ephemeral: true,
  });
}

async function showLinks(interaction) {
  const guildId = interaction.guildId;
  const rows = db.prepare(`
    SELECT discord_user_id, display_name, platform, url
    FROM member_links
    WHERE guild_id=?
    ORDER BY platform, display_name, url
  `).all(guildId);

  return interaction.reply({
    embeds: [
      buildSimpleListEmbed(
        "Member Links",
        rows.length
          ? rows.map((r) => `• ${r.display_name || `<@${r.discord_user_id}>`} — **${r.platform}** — ${r.url}`)
          : ["No member links saved."],
        getGuildConfig(guildId).embed_color
      ),
    ],
    ephemeral: true,
  });
}

async function showFilters(interaction) {
  const guildId = interaction.guildId;
  const rows = db.prepare(`
    SELECT platform, keyword
    FROM filters
    WHERE guild_id=?
    ORDER BY platform, keyword
  `).all(guildId);

  return interaction.reply({
    embeds: [
      buildSimpleListEmbed(
        "Filters",
        rows.length
          ? rows.map((r) => `• **${r.platform}** — ${r.keyword}`)
          : ["No filters saved."],
        getGuildConfig(guildId).embed_color
      ),
    ],
    ephemeral: true,
  });
}

async function handleAdminButton(interaction) {
  const guildId = interaction.guildId;
  const action = interaction.customId.split(":")[1];

  if (action === "toggle_embed") {
    const cfg = getGuildConfig(guildId);
    upsertGuildConfig(guildId, { use_embed: Number(cfg.use_embed) === 1 ? 0 : 1 });
    return replyAdminDashboard(interaction);
  }

  if (action === "toggle_cleanup") {
    const cfg = getGuildConfig(guildId);
    upsertGuildConfig(guildId, { auto_cleanup: Number(cfg.auto_cleanup) === 1 ? 0 : 1 });
    return replyAdminDashboard(interaction);
  }

  if (action === "toggle_images") {
    const cfg = getGuildConfig(guildId);
    upsertGuildConfig(guildId, { show_images: Number(cfg.show_images) === 1 ? 0 : 1 });
    return replyAdminDashboard(interaction);
  }

  if (action === "toggle_title") {
    const cfg = getGuildConfig(guildId);
    upsertGuildConfig(guildId, { show_title: Number(cfg.show_title) === 1 ? 0 : 1 });
    return replyAdminDashboard(interaction);
  }

  if (action === "toggle_game") {
    const cfg = getGuildConfig(guildId);
    upsertGuildConfig(guildId, { show_game: Number(cfg.show_game) === 1 ? 0 : 1 });
    return replyAdminDashboard(interaction);
  }

  if (action === "clear_role") {
    upsertGuildConfig(guildId, { live_role_id: null });
    return replyAdminDashboard(interaction);
  }

  if (action === "test_post") {
    await interaction.deferReply({ ephemeral: true });
    const sent = await sendTestPost(interaction.client, guildId);

    if (!sent) {
      return interaction.editReply("Could not send test post. Check the announcement channel and bot permissions.");
    }

    return interaction.editReply(`Test post sent to <#${sent.channelId}>.`);
  }

  if (action === "modal_cooldown") {
    const cfg = getGuildConfig(guildId);
    return interaction.showModal(
      buildModal(`${ADMIN_DASH}:submit_cooldown`, "Set Cooldown", [
        {
          id: "cooldown_seconds",
          label: "Cooldown seconds",
          value: String(cfg.cooldown_seconds ?? 600),
          required: true,
        },
      ])
    );
  }

  if (action === "modal_brand") {
    const cfg = getGuildConfig(guildId);
    return interaction.showModal(
      buildModal(`${ADMIN_DASH}:submit_brand`, "Branding", [
        {
          id: "brand_name",
          label: "Brand / Team Name",
          value: cfg.brand_name || "",
          required: false,
        },
        {
          id: "brand_logo_url",
          label: "Logo URL",
          value: cfg.brand_logo_url || "",
          required: false,
        },
        {
          id: "footer_text",
          label: "Footer Text",
          value: cfg.footer_text || "",
          required: false,
        },
        {
          id: "embed_color",
          label: "Embed Color Number",
          value: String(cfg.embed_color ?? 5793266),
          required: true,
        },
      ])
    );
  }

  if (action === "modal_template") {
    const cfg = getGuildConfig(guildId);
    return interaction.showModal(
      buildModal(`${ADMIN_DASH}:submit_template`, "Message Template", [
        {
          id: "message_template",
          label: "Template",
          style: TextInputStyle.Paragraph,
          value: cfg.message_template || "",
          required: false,
          placeholder: "Use {name} {url} {title} {game} {platform} {team}",
        },
      ])
    );
  }
}

async function handleCreatorButton(interaction) {
  const guildId = interaction.guildId;
  const action = interaction.customId.split(":")[1];

  if (action === "refresh") {
    return replyCreatorDashboard(interaction);
  }

  if (action === "resubscribe") {
    await interaction.deferReply({ ephemeral: true });

    const rows = db.prepare(`
      SELECT DISTINCT external_id
      FROM members
      WHERE guild_id=? AND platform='twitch' AND external_id IS NOT NULL
    `).all(guildId);

    if (!rows.length) {
      return interaction.editReply("No saved Twitch channels with IDs found for this server.");
    }

    let ok = 0;
    for (const row of rows) {
      try {
        await twitch.ensureSubscriptions(row.external_id);
        ok += 1;
      } catch {}
    }

    return interaction.editReply(`Resubscribe complete. Refreshed ${ok}/${rows.length} Twitch channel(s).`);
  }

  if (action === "view_creators") {
    return showCreators(interaction);
  }

  if (action === "view_links") {
    return showLinks(interaction);
  }

  if (action === "view_filters") {
    return showFilters(interaction);
  }

  if (action === "remove_url_menu") {
    return openRemoveUrlMenu(interaction);
  }

  if (action === "remove_link_menu") {
    return openRemoveLinkMenu(interaction);
  }

  if (action === "remove_filter_menu") {
    return openRemoveFilterMenu(interaction);
  }

  if (action === "modal_add_url") {
    return interaction.showModal(
      buildModal(`${CREATOR_DASH}:submit_add_url`, "Add Creator", [
        {
          id: "platform",
          label: "Platform (twitch or youtube)",
          required: true,
          placeholder: "twitch",
        },
        {
          id: "url",
          label: "Stream / Channel URL",
          required: true,
          placeholder: "https://www.twitch.tv/example",
        },
      ])
    );
  }

  if (action === "modal_link_member") {
    return interaction.showModal(
      buildModal(`${CREATOR_DASH}:submit_link_member`, "Link Discord Member", [
        {
          id: "discord_user_id",
          label: "Discord User ID",
          required: true,
        },
        {
          id: "display_name",
          label: "Display Name Override",
          required: false,
        },
        {
          id: "platform",
          label: "Platform (twitch or youtube)",
          required: true,
          placeholder: "twitch",
        },
        {
          id: "url",
          label: "Stream / Channel URL",
          required: true,
        },
      ])
    );
  }

  if (action === "modal_add_filter") {
    return interaction.showModal(
      buildModal(`${CREATOR_DASH}:submit_add_filter`, "Add Filter", [
        {
          id: "platform",
          label: "Platform (twitch, youtube, all)",
          required: true,
          placeholder: "all",
        },
        {
          id: "keyword",
          label: "Keyword",
          required: true,
        },
      ])
    );
  }
}

async function handleAdminSelect(interaction) {
  const guildId = interaction.guildId;
  const action = interaction.customId.split(":")[1];

  if (action === "channel") {
    upsertGuildConfig(guildId, { announce_channel_id: interaction.values[0] });
    return replyAdminDashboard(interaction);
  }

  if (action === "role") {
    upsertGuildConfig(guildId, { live_role_id: interaction.values[0] });
    return replyAdminDashboard(interaction);
  }

  if (action === "mention") {
    upsertGuildConfig(guildId, { mention_mode: interaction.values[0] });
    return replyAdminDashboard(interaction);
  }
}

async function handleCreatorSelect(interaction) {
  const guildId = interaction.guildId;
  const action = interaction.customId.split(":")[1];

  if (action === "remove_url_select") {
    const id = Number(interaction.values[0]);
    const info = db.prepare(`
      DELETE FROM members
      WHERE guild_id=? AND id=?
    `).run(guildId, id);

    return interaction.update({
      content: info.changes ? "Creator removed." : "Creator not found.",
      embeds: [],
      components: [],
    });
  }

  if (action === "remove_link_select") {
    const id = Number(interaction.values[0]);
    const info = db.prepare(`
      DELETE FROM member_links
      WHERE guild_id=? AND id=?
    `).run(guildId, id);

    return interaction.update({
      content: info.changes ? "Member link removed." : "Member link not found.",
      embeds: [],
      components: [],
    });
  }

  if (action === "remove_filter_select") {
    const id = Number(interaction.values[0]);
    const info = db.prepare(`
      DELETE FROM filters
      WHERE rowid=? AND guild_id=?
    `).run(id, guildId);

    return interaction.update({
      content: info.changes ? "Filter removed." : "Filter not found.",
      embeds: [],
      components: [],
    });
  }
}

async function handleAdminModal(interaction) {
  const guildId = interaction.guildId;
  const action = interaction.customId.split(":")[1];

  if (action === "submit_cooldown") {
    const seconds = Math.max(0, Number(interaction.fields.getTextInputValue("cooldown_seconds")) || 0);
    upsertGuildConfig(guildId, { cooldown_seconds: seconds });
    return interaction.reply({ content: `Cooldown set to ${seconds}s.`, ephemeral: true });
  }

  if (action === "submit_brand") {
    const brandName = cleanText(interaction.fields.getTextInputValue("brand_name")) || null;
    const brandLogoUrl = cleanText(interaction.fields.getTextInputValue("brand_logo_url")) || null;
    const footerText = cleanText(interaction.fields.getTextInputValue("footer_text")) || null;
    const embedColor = Number(interaction.fields.getTextInputValue("embed_color")) || 5793266;

    upsertGuildConfig(guildId, {
      brand_name: brandName,
      brand_logo_url: brandLogoUrl,
      footer_text: footerText,
      embed_color: embedColor,
    });

    return interaction.reply({ content: "Branding updated.", ephemeral: true });
  }

  if (action === "submit_template") {
    const template = cleanText(interaction.fields.getTextInputValue("message_template")) || null;
    upsertGuildConfig(guildId, { message_template: template });
    return interaction.reply({ content: "Message template updated.", ephemeral: true });
  }
}

async function handleCreatorModal(interaction) {
  const guildId = interaction.guildId;
  const action = interaction.customId.split(":")[1];

  if (action === "submit_add_url") {
    return handleAddUrl(interaction);
  }

  if (action === "submit_link_member") {
    return handleLinkMember(interaction);
  }

  if (action === "submit_add_filter") {
    const platform = cleanLower(interaction.fields.getTextInputValue("platform") || "all");
    const keyword = cleanLower(interaction.fields.getTextInputValue("keyword"));

    if (!["twitch", "youtube", "all"].includes(platform)) {
      return interaction.reply({
        content: "Platform must be twitch, youtube, or all.",
        ephemeral: true,
      });
    }

    if (!keyword) {
      return interaction.reply({
        content: "Keyword is required.",
        ephemeral: true,
      });
    }

    db.prepare(`
      INSERT OR REPLACE INTO filters (guild_id, platform, keyword, added_at)
      VALUES (?, ?, ?, ?)
    `).run(guildId, platform, keyword, Date.now());

    return interaction.reply({
      content: `Added filter (${platform}): ${keyword}`,
      ephemeral: true,
    });
  }
}

async function registerCommands(client) {
  const commands = [
    new SlashCommandBuilder()
      .setName("watchme-creator")
      .setDescription("Open the WatchMe creator dashboard")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("watchme-admin")
      .setDescription("Open the WatchMe admin dashboard")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("watchme-resubscribe")
      .setDescription("Refresh Twitch EventSub subscriptions for this server")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ].map((c) => c.toJSON());

  await client.application.commands.set(commands);

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const gid = interaction.guildId;
        if (!gid) {
          return interaction.reply({
            content: "This command can only be used in a server.",
            ephemeral: true,
          });
        }

        if (interaction.commandName === "watchme-creator") {
          return replyCreatorDashboard(interaction);
        }

        if (interaction.commandName === "watchme-admin") {
          return replyAdminDashboard(interaction);
        }

        if (interaction.commandName === "watchme-resubscribe") {
          await interaction.deferReply({ ephemeral: true });

          const rows = db.prepare(`
            SELECT DISTINCT external_id
            FROM members
            WHERE guild_id=? AND platform='twitch' AND external_id IS NOT NULL
          `).all(gid);

          if (!rows.length) {
            return interaction.editReply("No saved Twitch channels with IDs found for this server.");
          }

          let ok = 0;
          for (const row of rows) {
            try {
              await twitch.ensureSubscriptions(row.external_id);
              ok += 1;
            } catch {}
          }

          return interaction.editReply(`Resubscribe complete. Refreshed ${ok}/${rows.length} Twitch channel(s).`);
        }
      }

      if (interaction.isButton() && interaction.customId.startsWith(`${ADMIN_DASH}:`)) {
        return handleAdminButton(interaction);
      }

      if (interaction.isButton() && interaction.customId.startsWith(`${CREATOR_DASH}:`)) {
        return handleCreatorButton(interaction);
      }

      if (
        (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) &&
        interaction.customId.startsWith(`${ADMIN_DASH}:`)
      ) {
        return handleAdminSelect(interaction);
      }

      if (
        (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) &&
        interaction.customId.startsWith(`${CREATOR_DASH}:`)
      ) {
        return handleCreatorSelect(interaction);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith(`${ADMIN_DASH}:`)) {
        return handleAdminModal(interaction);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith(`${CREATOR_DASH}:`)) {
        return handleCreatorModal(interaction);
      }
    } catch (err) {
      log("error", "commands", `Interaction error: ${err?.message || err}`);

      const msg = err?.message ? `Error: ${err.message}` : "Unknown error";

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(msg).catch(() => null);
      }

      return interaction.reply({
        content: msg,
        ephemeral: true,
      }).catch(() => null);
    }
  });
}

module.exports = { registerCommands };