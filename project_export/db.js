const Database = require("better-sqlite3");

const db = new Database("database.db");

try {
  db.pragma("journal_mode = WAL");
} catch {}

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  announce_channel_id TEXT,
  live_role_id TEXT,
  auto_cleanup INTEGER NOT NULL DEFAULT 0,
  cooldown_seconds INTEGER NOT NULL DEFAULT 600,
  use_embed INTEGER NOT NULL DEFAULT 1,
  embed_color INTEGER NOT NULL DEFAULT 5793266,
  message_template TEXT,
  brand_name TEXT,
  brand_logo_url TEXT,
  footer_text TEXT,
  show_images INTEGER NOT NULL DEFAULT 1,
  show_title INTEGER NOT NULL DEFAULT 1,
  show_game INTEGER NOT NULL DEFAULT 1,
  mention_mode TEXT NOT NULL DEFAULT 'role'
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('twitch','youtube')),
  url TEXT NOT NULL,
  external_id TEXT,
  added_at INTEGER NOT NULL,
  UNIQUE(guild_id, platform, url)
);

CREATE TABLE IF NOT EXISTS member_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('twitch','youtube')),
  url TEXT NOT NULL,
  external_id TEXT,
  display_name TEXT,
  added_at INTEGER NOT NULL,
  UNIQUE(guild_id, platform, url)
);

CREATE TABLE IF NOT EXISTS last_announced (
  guild_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, platform, key)
);

CREATE TABLE IF NOT EXISTS filters (
  guild_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('twitch','youtube','all')),
  keyword TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, platform, keyword)
);

CREATE TABLE IF NOT EXISTS twitch_posts (
  guild_id TEXT NOT NULL,
  broadcaster_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, broadcaster_id)
);

CREATE TABLE IF NOT EXISTS runtime_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

function addColumn(table, colDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
  } catch {}
}

addColumn("guild_config", "live_role_id TEXT");
addColumn("guild_config", "auto_cleanup INTEGER NOT NULL DEFAULT 0");
addColumn("guild_config", "cooldown_seconds INTEGER NOT NULL DEFAULT 600");
addColumn("guild_config", "use_embed INTEGER NOT NULL DEFAULT 1");
addColumn("guild_config", "embed_color INTEGER NOT NULL DEFAULT 5793266");
addColumn("guild_config", "message_template TEXT");
addColumn("guild_config", "brand_name TEXT");
addColumn("guild_config", "brand_logo_url TEXT");
addColumn("guild_config", "footer_text TEXT");
addColumn("guild_config", "show_images INTEGER NOT NULL DEFAULT 1");
addColumn("guild_config", "show_title INTEGER NOT NULL DEFAULT 1");
addColumn("guild_config", "show_game INTEGER NOT NULL DEFAULT 1");
addColumn("guild_config", "mention_mode TEXT NOT NULL DEFAULT 'role'");
addColumn("members", "external_id TEXT");

module.exports = db;