function renderDashboardHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WatchMe Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --bg: #0f1115;
      --panel: #171a21;
      --border: #2a2f3a;
      --text: #e7ecf5;
      --muted: #9aa4b2;
      --accent: #6aa9ff;
      --danger: #ff6b6b;
      --ok: #3ddc97;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }
    h1, h2 { margin: 0 0 12px; }
    p { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
    }
    label {
      display: block;
      margin: 10px 0 6px;
      color: var(--muted);
      font-size: 14px;
    }
    input, select, textarea, button {
      width: 100%;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #11151c;
      color: var(--text);
      padding: 10px 12px;
      font: inherit;
    }
    textarea { min-height: 100px; resize: vertical; }
    button {
      cursor: pointer;
      background: #182131;
    }
    button:hover { border-color: var(--accent); }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .row3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    .table th, .table td {
      padding: 8px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
    }
    .muted { color: var(--muted); }
    .ok { color: var(--ok); }
    .danger { color: var(--danger); }
    .pill {
      display: inline-block;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 999px;
      background: #101827;
      border: 1px solid var(--border);
    }
    .spacer { height: 8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>WatchMe Dashboard</h1>
    <p>Choose a guild ID from your bot server list and manage alerts, branding, member pings, and test posts.</p>

    <div class="card">
      <div class="row">
        <div>
          <label>Guild</label>
          <select id="guildSelect"></select>
        </div>
        <div>
          <label>&nbsp;</label>
          <button id="reloadBtn">Reload</button>
        </div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="grid">
      <div class="card">
        <h2>Config</h2>
        <div class="row">
          <div>
            <label>Announcement Channel ID</label>
            <input id="announce_channel_id" />
          </div>
          <div>
            <label>Live Role ID</label>
            <input id="live_role_id" />
          </div>
        </div>
        <div class="row3">
          <div>
            <label>Use Embed</label>
            <select id="use_embed">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>
          <div>
            <label>Auto Cleanup</label>
            <select id="auto_cleanup">
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
          </div>
          <div>
            <label>Mention Mode</label>
            <select id="mention_mode">
              <option value="role">Role</option>
              <option value="member">Member</option>
              <option value="both">Both</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
        <div class="row3">
          <div>
            <label>Cooldown Seconds</label>
            <input id="cooldown_seconds" type="number" />
          </div>
          <div>
            <label>Embed Color</label>
            <input id="embed_color" type="number" />
          </div>
          <div>
            <label>Show Images</label>
            <select id="show_images">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>
        </div>
        <div class="row3">
          <div>
            <label>Show Title</label>
            <select id="show_title">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>
          <div>
            <label>Show Game</label>
            <select id="show_game">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>
          <div>
            <label>Brand Name / Team</label>
            <input id="brand_name" />
          </div>
        </div>
        <label>Brand Logo URL</label>
        <input id="brand_logo_url" />
        <label>Footer Text</label>
        <input id="footer_text" />
        <label>Message Template</label>
        <textarea id="message_template" placeholder="Example: 🔴 {name} is streaming {title} now! {url}"></textarea>
        <div class="spacer"></div>
        <div class="row">
          <button id="saveConfigBtn">Save Config</button>
          <button id="testPostBtn">Send Test Post</button>
        </div>
      </div>

      <div class="card">
        <h2>Add Stream URL</h2>
        <label>Platform</label>
        <select id="new_member_platform">
          <option value="twitch">twitch</option>
          <option value="youtube">youtube</option>
        </select>
        <label>URL</label>
        <input id="new_member_url" />
        <div class="spacer"></div>
        <button id="addMemberBtn">Add URL</button>

        <div class="spacer"></div>
        <h2>Link Discord Member</h2>
        <label>Discord User ID</label>
        <input id="link_discord_user_id" />
        <label>Display Name</label>
        <input id="link_display_name" />
        <label>Platform</label>
        <select id="link_platform">
          <option value="twitch">twitch</option>
          <option value="youtube">youtube</option>
        </select>
        <label>Stream URL</label>
        <input id="link_url" />
        <div class="spacer"></div>
        <button id="addLinkBtn">Add Member Link</button>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="grid">
      <div class="card">
        <h2>Saved URLs</h2>
        <div id="membersBox" class="muted">Loading...</div>
      </div>
      <div class="card">
        <h2>Member Links</h2>
        <div id="linksBox" class="muted">Loading...</div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <h2>Logs</h2>
      <div id="logsBox" class="muted">Loading...</div>
    </div>
  </div>

  <script>
    async function j(url, opts) {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opts,
      });
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!res.ok) throw new Error(data.error || data.message || text || "Request failed");
      return data;
    }

    function gid() {
      return document.getElementById("guildSelect").value;
    }

    function setValue(id, value) {
      const el = document.getElementById(id);
      el.value = value == null ? "" : String(value);
    }

    function esc(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    async function loadGuilds() {
      const rows = await j("/api/guilds");
      const sel = document.getElementById("guildSelect");
      sel.innerHTML = "";

      for (const row of rows) {
        const opt = document.createElement("option");
        opt.value = row.guild_id;
        opt.textContent = row.guild_id;
        sel.appendChild(opt);
      }

      if (!sel.value && rows[0]) sel.value = rows[0].guild_id;
      if (sel.value) await loadAll();
    }

    async function loadConfig() {
      const id = gid();
      if (!id) return;

      let cfg = null;
      try {
        cfg = await j("/api/guilds/" + encodeURIComponent(id) + "/config");
      } catch {
        cfg = { guild_id: id };
      }

      setValue("announce_channel_id", cfg.announce_channel_id);
      setValue("live_role_id", cfg.live_role_id);
      setValue("auto_cleanup", cfg.auto_cleanup ?? 0);
      setValue("cooldown_seconds", cfg.cooldown_seconds ?? 600);
      setValue("use_embed", cfg.use_embed ?? 1);
      setValue("embed_color", cfg.embed_color ?? 5793266);
      setValue("message_template", cfg.message_template);
      setValue("brand_name", cfg.brand_name);
      setValue("brand_logo_url", cfg.brand_logo_url);
      setValue("footer_text", cfg.footer_text);
      setValue("show_images", cfg.show_images ?? 1);
      setValue("show_title", cfg.show_title ?? 1);
      setValue("show_game", cfg.show_game ?? 1);
      setValue("mention_mode", cfg.mention_mode ?? "role");
    }

    async function loadMembers() {
      const rows = await j("/api/guilds/" + encodeURIComponent(gid()) + "/members");
      const box = document.getElementById("membersBox");

      if (!rows.length) {
        box.innerHTML = '<span class="muted">No saved URLs.</span>';
        return;
      }

      box.innerHTML = '<table class="table"><thead><tr><th>Platform</th><th>URL</th><th>Status</th><th></th></tr></thead><tbody>' +
        rows.map(r => (
          '<tr>' +
          '<td><span class="pill">' + esc(r.platform) + '</span></td>' +
          '<td>' + esc(r.url) + '</td>' +
          '<td>' + esc(r.status) + '</td>' +
          '<td><button onclick="removeMember(' + Number(r.id) + ')">Remove</button></td>' +
          '</tr>'
        )).join('') +
        '</tbody></table>';
    }

    async function loadLinks() {
      const rows = await j("/api/guilds/" + encodeURIComponent(gid()) + "/member-links");
      const box = document.getElementById("linksBox");

      if (!rows.length) {
        box.innerHTML = '<span class="muted">No member links.</span>';
        return;
      }

      box.innerHTML = '<table class="table"><thead><tr><th>Name</th><th>User ID</th><th>Platform</th><th>URL</th><th></th></tr></thead><tbody>' +
        rows.map(r => (
          '<tr>' +
          '<td>' + esc(r.display_name || "") + '</td>' +
          '<td>' + esc(r.discord_user_id) + '</td>' +
          '<td><span class="pill">' + esc(r.platform) + '</span></td>' +
          '<td>' + esc(r.url) + '</td>' +
          '<td><button onclick="removeLink(' + Number(r.id) + ')">Remove</button></td>' +
          '</tr>'
        )).join('') +
        '</tbody></table>';
    }

    async function loadLogs() {
      const rows = await j("/api/logs?limit=30");
      const box = document.getElementById("logsBox");

      if (!rows.length) {
        box.innerHTML = '<span class="muted">No logs.</span>';
        return;
      }

      box.innerHTML = '<table class="table"><thead><tr><th>When</th><th>Level</th><th>Scope</th><th>Message</th></tr></thead><tbody>' +
        rows.map(r => (
          '<tr>' +
          '<td>' + new Date(r.created_at).toLocaleString() + '</td>' +
          '<td>' + esc(r.level) + '</td>' +
          '<td>' + esc(r.scope) + '</td>' +
          '<td>' + esc(r.message) + '</td>' +
          '</tr>'
        )).join('') +
        '</tbody></table>';
    }

    async function loadAll() {
      await Promise.all([loadConfig(), loadMembers(), loadLinks(), loadLogs()]);
    }

    async function saveConfig() {
      const id = gid();
      await j("/api/guilds/" + encodeURIComponent(id) + "/config", {
        method: "POST",
        body: JSON.stringify({
          announce_channel_id: document.getElementById("announce_channel_id").value.trim(),
          live_role_id: document.getElementById("live_role_id").value.trim() || null,
          auto_cleanup: Number(document.getElementById("auto_cleanup").value || 0),
          cooldown_seconds: Number(document.getElementById("cooldown_seconds").value || 600),
          use_embed: Number(document.getElementById("use_embed").value || 1),
          embed_color: Number(document.getElementById("embed_color").value || 5793266),
          message_template: document.getElementById("message_template").value.trim() || null,
          brand_name: document.getElementById("brand_name").value.trim() || null,
          brand_logo_url: document.getElementById("brand_logo_url").value.trim() || null,
          footer_text: document.getElementById("footer_text").value.trim() || null,
          show_images: Number(document.getElementById("show_images").value || 1),
          show_title: Number(document.getElementById("show_title").value || 1),
          show_game: Number(document.getElementById("show_game").value || 1),
          mention_mode: document.getElementById("mention_mode").value,
        }),
      });
      alert("Config saved");
      await loadConfig();
    }

    async function testPost() {
      await j("/api/guilds/" + encodeURIComponent(gid()) + "/test-post", { method: "POST" });
      alert("Test post sent");
    }

    async function addMember() {
      await j("/api/guilds/" + encodeURIComponent(gid()) + "/members", {
        method: "POST",
        body: JSON.stringify({
          platform: document.getElementById("new_member_platform").value,
          url: document.getElementById("new_member_url").value.trim(),
        }),
      });
      document.getElementById("new_member_url").value = "";
      await loadMembers();
    }

    async function addLink() {
      await j("/api/guilds/" + encodeURIComponent(gid()) + "/member-links", {
        method: "POST",
        body: JSON.stringify({
          discord_user_id: document.getElementById("link_discord_user_id").value.trim(),
          display_name: document.getElementById("link_display_name").value.trim() || null,
          platform: document.getElementById("link_platform").value,
          url: document.getElementById("link_url").value.trim(),
        }),
      });
      document.getElementById("link_discord_user_id").value = "";
      document.getElementById("link_display_name").value = "";
      document.getElementById("link_url").value = "";
      await loadLinks();
    }

    async function removeMember(id) {
      if (!confirm("Remove this URL?")) return;
      await j("/api/guilds/" + encodeURIComponent(gid()) + "/members/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      await loadMembers();
    }

    async function removeLink(id) {
      if (!confirm("Remove this member link?")) return;
      await j("/api/guilds/" + encodeURIComponent(gid()) + "/member-links/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      await loadLinks();
    }

    document.getElementById("guildSelect").addEventListener("change", loadAll);
    document.getElementById("reloadBtn").addEventListener("click", loadAll);
    document.getElementById("saveConfigBtn").addEventListener("click", saveConfig);
    document.getElementById("testPostBtn").addEventListener("click", testPost);
    document.getElementById("addMemberBtn").addEventListener("click", addMember);
    document.getElementById("addLinkBtn").addEventListener("click", addLink);

    loadGuilds().catch((err) => {
      alert(err.message || String(err));
    });
  </script>
</body>
</html>`;
}

function mountDashboard(app) {
  app.get("/dashboard", (req, res) => {
    res.status(200).send(renderDashboardHtml());
  });
}

module.exports = { mountDashboard };