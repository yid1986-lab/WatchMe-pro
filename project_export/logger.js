const db = require("./db");

function log(level, scope, message) {
  const row = {
    level: String(level || "info").toLowerCase(),
    scope: String(scope || "app"),
    message: String(message || ""),
    created_at: Date.now(),
  };

  try {
    db.prepare(`
      INSERT INTO runtime_logs (level, scope, message, created_at)
      VALUES (?, ?, ?, ?)
    `).run(row.level, row.scope, row.message, row.created_at);
  } catch {}

  const line = `[${row.scope}] ${row.message}`;
  if (row.level === "error") console.error(line);
  else if (row.level === "warn") console.warn(line);
  else console.log(line);
}

module.exports = { log };