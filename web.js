const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { startupPassword } = require('./token');
const { getSetting, setSetting, initSettings } = require('./Settings');
const {
  createWebSession,
  validateWebSession,
  destroyWebSession,
  loadSessionIds,
  getSessionDoc,
  getSessionFolder,
  deleteSessionArtifacts,
  upsertReminder,
} = require('./database/mongo');

const PORT = Number(process.env.PORT || 3000);
const PAIR_DIR = path.join(__dirname, 'richstore', 'pairing');
const SETTINGS_PATH = path.join(__dirname, 'setting.json');
const COOKIE_NAME = 'void_dashboard';
const OWNER_COOKIE_NAME = 'void_owner_dashboard';
const OWNER_WEB_PASSWORD = process.env.OWNER_WEB_PASSWORD || process.env.OWNER_PASSWORD || '';
let pairCache = [];
const sessions = new Set();
const ownerSessions = new Set();
const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/commands', label: 'Command Management' },
  { href: '/groups', label: 'Groups' },
  { href: '/business', label: 'Business' },
  { href: '/chats', label: 'Chats' },
  { href: '/pairing', label: 'Pairing' }
];

const CONTROL_CATALOG = [
  { page: 'commands', section: 'System', key: 'mode', label: 'Bot Mode', kind: 'mode', scope: 'bot', description: 'Switch between public and self mode.' },
  { page: 'commands', section: 'Groups', key: 'welcome', label: 'Welcome', kind: 'toggle', scope: 'chat', description: 'Join and leave notices for a group.' },
  { page: 'commands', section: 'Groups', key: 'autoReact', label: 'Auto React', kind: 'toggle', scope: 'chat', description: 'React to messages in a group.' },
  { page: 'commands', section: 'Groups', key: 'autoTyping', label: 'Auto Typing', kind: 'toggle', scope: 'chat', description: 'Show typing state in a group.' },
  { page: 'commands', section: 'Groups', key: 'autoRecording', label: 'Auto Recording', kind: 'toggle', scope: 'chat', description: 'Show recording state in a group.' },
  { page: 'commands', section: 'Groups', key: 'autoRecordType', label: 'Auto Record Type', kind: 'toggle', scope: 'chat', description: 'Show typed audio state in a group.' },
  { page: 'commands', section: 'Groups', key: 'antilink', label: 'Anti Link', kind: 'toggle', scope: 'chat', description: 'Block WhatsApp invite links in a group.' },
  { page: 'commands', section: 'Business', key: 'feature.autoreply', label: 'Auto Reply', kind: 'toggle', scope: 'chat', description: 'Reply automatically to matched text.' },
  { page: 'commands', section: 'Business', key: 'feature.antispam', label: 'Anti Spam', kind: 'toggle', scope: 'chat', description: 'Remove spammy users in a chat.' },
  { page: 'commands', section: 'Business', key: 'feature.antibadword', label: 'Anti Bad Word', kind: 'toggle', scope: 'chat', description: 'Delete bad-word messages.' },
  { page: 'commands', section: 'Business', key: 'feature.antibot', label: 'Anti Bot', kind: 'toggle', scope: 'chat', description: 'Block bot-like accounts in a chat.' },
  { page: 'commands', section: 'Business', key: 'autobio', label: 'Auto Bio', kind: 'toggle', scope: 'user', description: 'Keep the profile bio updated.' },
  { page: 'commands', section: 'Business', key: 'autoread', label: 'Auto Read', kind: 'toggle', scope: 'user', description: 'Auto mark messages as read.' },
  { page: 'commands', section: 'Business', key: 'autoViewStatus', label: 'Auto View Status', kind: 'toggle', scope: 'user', description: 'Auto view WhatsApp status updates.' },
  { page: 'groups', section: 'Group Controls', key: 'welcome', label: 'Welcome', kind: 'toggle', scope: 'chat', description: 'Join and leave notices for a group.' },
  { page: 'groups', section: 'Group Controls', key: 'autoReact', label: 'Auto React', kind: 'toggle', scope: 'chat', description: 'React to messages in a group.' },
  { page: 'groups', section: 'Group Controls', key: 'autoTyping', label: 'Auto Typing', kind: 'toggle', scope: 'chat', description: 'Show typing state in a group.' },
  { page: 'groups', section: 'Group Controls', key: 'autoRecording', label: 'Auto Recording', kind: 'toggle', scope: 'chat', description: 'Show recording state in a group.' },
  { page: 'groups', section: 'Group Controls', key: 'autoRecordType', label: 'Auto Record Type', kind: 'toggle', scope: 'chat', description: 'Show typed audio state in a group.' },
  { page: 'groups', section: 'Group Controls', key: 'antilink', label: 'Anti Link', kind: 'toggle', scope: 'chat', description: 'Block WhatsApp invite links in a group.' },
  { page: 'business', section: 'Chat Automation', key: 'feature.autoreply', label: 'Auto Reply', kind: 'toggle', scope: 'chat', description: 'Reply automatically to matched text.' },
  { page: 'business', section: 'Chat Automation', key: 'feature.antispam', label: 'Anti Spam', kind: 'toggle', scope: 'chat', description: 'Remove spammy users in a chat.' },
  { page: 'business', section: 'Chat Automation', key: 'feature.antibadword', label: 'Anti Bad Word', kind: 'toggle', scope: 'chat', description: 'Delete bad-word messages.' },
  { page: 'business', section: 'Chat Automation', key: 'feature.antibot', label: 'Anti Bot', kind: 'toggle', scope: 'chat', description: 'Block bot-like accounts in a chat.' },
  { page: 'business', section: 'Personal Automation', key: 'autobio', label: 'Auto Bio', kind: 'toggle', scope: 'user', description: 'Keep the profile bio updated.' },
  { page: 'business', section: 'Personal Automation', key: 'autoread', label: 'Auto Read', kind: 'toggle', scope: 'user', description: 'Auto mark messages as read.' },
  { page: 'business', section: 'Personal Automation', key: 'autoViewStatus', label: 'Auto View Status', kind: 'toggle', scope: 'user', description: 'Auto view WhatsApp status updates.' }
];

const COMMAND_GUIDES = {
  groups: [
    { name: 'welcome', usage: 'welcome on/off', note: 'Toggle welcome and leave notices for a group.' },
    { name: 'antilink', usage: 'antilink on/off', note: 'Block WhatsApp invite links.' },
    { name: 'gc-reminder', usage: 'gc-reminder 60 Reminder text', note: 'Schedule a group reminder and ping the whole room.' },
    { name: 'mute', usage: 'mute', note: 'Put the group into announcement mode.' },
    { name: 'unmute', usage: 'unmute', note: 'Return the group to normal chat mode.' },
    { name: 'promote', usage: 'promote @user', note: 'Promote a member to admin.' },
    { name: 'demote', usage: 'demote @user', note: 'Demote an admin.' },
    { name: 'grouplink', usage: 'grouplink', note: 'Print the invite link for the current group.' },
    { name: 'creategroup', usage: 'creategroup My Group', note: 'Create a new group.' },
    { name: 'kick', usage: 'kick @user', note: 'Remove a member from the group.' },
    { name: 'add', usage: 'add 234xxxxxxxx', note: 'Add a user to the group.' }
  ],
  business: [
    { name: 'autoreply', usage: 'autoreply on/off', note: 'Enable or disable auto replies in a chat.' },
    { name: 'antispam', usage: 'antispam on/off', note: 'Remove spammy behavior from a chat.' },
    { name: 'antibadword', usage: 'antibadword on/off', note: 'Delete messages that contain bad words.' },
    { name: 'antibot', usage: 'antibot on/off', note: 'Block bot-like accounts in a chat.' },
    { name: 'autobio', usage: 'autobio on/off', note: 'Keep the profile bio updated.' },
    { name: 'autoread', usage: 'autoread on/off', note: 'Mark messages as read automatically.' },
    { name: 'autoViewStatus', usage: 'autoViewStatus on/off', note: 'View statuses automatically.' }
  ],
  chats: [
    { name: 'runtime', usage: 'runtime', note: 'Show bot uptime.' },
    { name: 'ping', usage: 'ping', note: 'Check bot response speed.' },
    { name: 'afk', usage: 'afk reason', note: 'Mark yourself away from keyboard.' }
  ]
};

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function readSettingsSnapshot() {
  return readJsonSafe(SETTINGS_PATH, {});
}

function listPairs() {
  return pairCache.map((sessionId) => ({
    name: sessionId,
    path: getSessionFolder(sessionId),
  }));
}

async function refreshPairCache() {
  pairCache = await loadSessionIds({ status: 'active' }).catch(() => []);
  return pairCache;
}

initSettings()
  .then(() => refreshPairCache())
  .catch((error) => {
    console.error('MongoDB initialization failed for dashboard:', error.message);
  });

function getTargetMeta(settings = {}) {
  const meta = settings.__meta || {};
  return {
    name: meta.name || '',
    kind: meta.kind || '',
  };
}

function listTargets() {
  const snapshot = readSettingsSnapshot();
  return Object.entries(snapshot)
    .filter(([jid]) => jid !== 'bot')
    .map(([jid, settings]) => {
      const meta = getTargetMeta(settings);
      const kind = meta.kind || (jid.endsWith('@g.us') ? 'group' : 'chat');
      const keys = Object.keys(settings || {}).filter((key) => key !== '__meta');
      const active = keys.filter((key) => Boolean(settings[key])).length;
      return {
        jid,
        kind,
        name: meta.name || jid,
        keyCount: keys.length,
        activeCount: active,
        settings,
      };
    })
    .sort((a, b) => (a.name || a.jid).localeCompare(b.name || b.jid));
}

function getTargetKind(target) {
  if (target === 'bot') return 'bot';
  if (String(target).endsWith('@g.us')) return 'group';
  return 'chat';
}

function controlValue(target, key) {
  if (key === 'mode') return getSetting('bot', 'mode', 'public');
  return getSetting(target, key, false);
}

function buildState(target) {
  const state = {};
  CONTROL_CATALOG.filter((item) => item.page === 'commands').forEach((item) => {
    state[item.key] = controlValue(target, item.key);
  });

  const controls = CONTROL_CATALOG.filter((item) => item.page !== 'commands');
  controls.forEach((item) => {
    state[item.key] = controlValue(target, item.key);
  });

  const pairs = listPairs();
  const targets = listTargets();
  const activeCount = Object.values(state).filter((value) => Boolean(value)).length;

  return {
    target,
    targetKind: getTargetKind(target),
    settings: state,
    summary: {
      totalKeys: Object.keys(state).length,
      activeCount,
      mode: controlValue('bot', 'mode')
    },
    pairs,
    targets,
    groups: targets.filter((entry) => entry.kind === 'group'),
    chats: targets.filter((entry) => entry.kind === 'chat')
  };
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index === -1) return acc;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) acc[name] = decodeURIComponent(value);
    return acc;
  }, {});
}

async function isAuthed(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  if (sessions.has(token)) return true;
  const ok = await validateWebSession(token).catch(() => false);
  if (ok) sessions.add(token);
  return ok;
}

async function isOwnerAuthed(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[OWNER_COOKIE_NAME];
  if (!token || !token.startsWith('owner-')) return false;
  if (ownerSessions.has(token)) return true;
  const ok = await validateWebSession(token).catch(() => false);
  if (ok) ownerSessions.add(token);
  return ok;
}

async function isDashboardAuthed(req) {
  return (await isAuthed(req)) || (await isOwnerAuthed(req));
}

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function navMarkup(active) {
  return NAV.map((item) => {
    const cls = item.href === active ? 'nav-link active' : 'nav-link';
    return `<a class="${cls}" href="${item.href}">${escapeHtml(item.label)}</a>`;
  }).join('');
}

function controlCard(item) {
  const scopeLabel = item.scope === 'bot' ? 'Bot' : item.scope === 'user' ? 'User' : 'Chat';
  if (item.kind === 'mode') {
    return `
      <div class="control-card" data-control-key="${escapeHtml(item.key)}" data-control-kind="mode" data-control-scope="${escapeHtml(item.scope)}">
        <div>
          <div class="control-title">${escapeHtml(item.label)}</div>
          <div class="control-meta">${escapeHtml(item.description)} Scope: ${scopeLabel}.</div>
        </div>
        <select class="control-select" aria-label="${escapeHtml(item.label)}">
          <option value="public">public</option>
          <option value="self">self</option>
        </select>
      </div>`;
  }

  return `
    <div class="control-card" data-control-key="${escapeHtml(item.key)}" data-control-kind="toggle" data-control-scope="${escapeHtml(item.scope)}">
      <div>
        <div class="control-title">${escapeHtml(item.label)}</div>
        <div class="control-meta">${escapeHtml(item.description)} Scope: ${scopeLabel}.</div>
      </div>
      <label class="switch">
        <input type="checkbox" class="control-toggle" />
        <span class="switch-label">Off</span>
      </label>
    </div>`;
}

function guideCard(item) {
  return `
    <div class="guide-card">
      <div class="guide-name">${escapeHtml(item.name)}</div>
      <div class="guide-usage">${escapeHtml(item.usage)}</div>
      <div class="guide-note">${escapeHtml(item.note)}</div>
    </div>`;
}

function targetCard(item, openHref) {
  return `
    <div class="target-card">
      <div>
        <div class="target-title">${escapeHtml(item.name || item.jid)}</div>
        <div class="target-meta">${escapeHtml(item.jid)}<br />${item.kind.toUpperCase()} | ${item.keyCount} settings | ${item.activeCount} active</div>
      </div>
      <div class="row-actions">
        <a class="ghost-btn" href="${openHref}?target=${encodeURIComponent(item.jid)}">Open</a>
      </div>
    </div>`;
}

function pageShell({ active, title, subtitle, body, boot = {}, script = '' }) {
  const nav = navMarkup(active);
  const topbarActions = boot.owner
    ? `<a class="ghost-btn" href="/">Regular Dashboard</a><button class="ghost-btn danger-btn" id="logoutBtn" type="button">Logout</button>`
    : `<a class="ghost-btn" href="/commands">Commands</a><a class="ghost-btn" href="/pairing">Pairing</a><button class="ghost-btn danger-btn" id="logoutBtn" type="button">Logout</button>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | VOID MD</title>
  <style>
    :root {
      --bg: #07111d;
      --bg2: #0e1b2f;
      --panel: rgba(12, 19, 32, 0.84);
      --panel-border: rgba(255,255,255,.08);
      --text: #eff5ff;
      --muted: #9fb0cf;
      --accent: #77e0c1;
      --accent-2: #ffd166;
      --danger: #ff7b7b;
      --shadow: 0 28px 90px rgba(0,0,0,.36);
      --radius: 22px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(119, 224, 193, .16), transparent 28%),
        radial-gradient(circle at top right, rgba(255, 209, 102, .12), transparent 30%),
        linear-gradient(160deg, var(--bg), var(--bg2) 58%, #07111d);
    }
    a { color: inherit; text-decoration: none; }
    .app {
      display: grid;
      grid-template-columns: 272px 1fr;
      min-height: 100vh;
    }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 24px 18px;
      border-right: 1px solid rgba(255,255,255,.06);
      background: rgba(5, 9, 16, .26);
      backdrop-filter: blur(16px);
    }
    .brand {
      display: grid;
      gap: 6px;
      padding: 12px 12px 20px;
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: .28em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 800;
    }
    .brand-title {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 28px;
      line-height: 1;
    }
    .brand-subtitle {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }
    .nav {
      display: grid;
      gap: 8px;
      margin-top: 18px;
    }
    .nav-link {
      padding: 12px 14px;
      border-radius: 16px;
      color: var(--muted);
      border: 1px solid transparent;
      background: rgba(255,255,255,.02);
      transition: .15s ease;
    }
    .nav-link:hover {
      color: var(--text);
      border-color: rgba(255,255,255,.08);
      background: rgba(255,255,255,.05);
    }
    .nav-link.active {
      color: #05111b;
      background: linear-gradient(135deg, var(--accent), #8ad9ff);
      border-color: transparent;
      font-weight: 800;
    }
    .sidebar-foot {
      margin-top: 22px;
      padding: 14px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.04);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }
    .main {
      padding: 24px;
      width: min(1400px, 100%);
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
    }
    .page-title {
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(2rem, 4vw, 3.6rem);
      margin: 0;
      line-height: .98;
    }
    .page-subtitle {
      color: var(--muted);
      margin-top: 10px;
      max-width: 72ch;
      line-height: 1.7;
    }
    .topbar-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      box-shadow: var(--shadow);
      border-radius: var(--radius);
      backdrop-filter: blur(18px);
    }
    .hero {
      padding: 24px;
      display: grid;
      gap: 18px;
    }
    .grid-4 {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }
    .stat {
      padding: 18px;
    }
    .stat-label {
      color: var(--muted);
      font-size: 13px;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: 900;
      margin-top: 8px;
    }
    .stat-note {
      color: var(--muted);
      font-size: 12px;
      margin-top: 6px;
    }
    .page-grid {
      margin-top: 18px;
      display: grid;
      grid-template-columns: 1.2fr .8fr;
      gap: 18px;
    }
    .section {
      padding: 20px;
      display: grid;
      gap: 14px;
    }
    .section-title {
      font-size: 20px;
      font-family: Georgia, "Times New Roman", serif;
      margin: 0;
    }
    .section-desc {
      color: var(--muted);
      line-height: 1.7;
      margin: 0;
      font-size: 14px;
    }
    .toolbar {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .field, .ghost-btn, .primary-btn, select, input {
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.04);
      color: var(--text);
      font: inherit;
      padding: 13px 15px;
      outline: none;
    }
    .field:focus, select:focus, input:focus {
      border-color: rgba(119, 224, 193, .55);
      box-shadow: 0 0 0 4px rgba(119, 224, 193, .08);
    }
    .primary-btn {
      background: linear-gradient(135deg, var(--accent), #8ad9ff);
      color: #05111b;
      font-weight: 900;
      border: 0;
      cursor: pointer;
    }
    .ghost-btn {
      width: auto;
      color: var(--text);
      background: rgba(255,255,255,.06);
    }
    .danger-btn {
      background: rgba(255, 123, 123, .14);
      color: #ffd7d7;
      border: 1px solid rgba(255, 123, 123, .18);
    }
    .control-group {
      display: grid;
      gap: 12px;
    }
    .control-card, .guide-card, .target-card, .pair-card {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: center;
      padding: 15px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.04);
    }
    .control-title, .target-title, .guide-name {
      font-weight: 900;
      font-size: 15px;
    }
    .control-meta, .target-meta, .guide-usage, .guide-note {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
      margin-top: 4px;
      word-break: break-word;
    }
    .switch {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 14px;
    }
    .switch input {
      width: 18px;
      height: 18px;
      margin: 0;
      accent-color: var(--accent);
      padding: 0;
    }
    .section-columns {
      display: grid;
      gap: 14px;
    }
    .chips {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(119, 224, 193, .12);
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
    }
    .list {
      display: grid;
      gap: 10px;
    }
    .muted-box {
      padding: 16px;
      border-radius: 16px;
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.06);
      color: var(--muted);
      line-height: 1.7;
      font-size: 14px;
    }
    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      min-width: 220px;
      padding: 14px 16px;
      border-radius: 14px;
      background: rgba(7, 12, 21, .95);
      border: 1px solid rgba(255,255,255,.1);
      box-shadow: var(--shadow);
      transform: translateY(16px);
      opacity: 0;
      pointer-events: none;
      transition: .2s ease;
      z-index: 30;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .page-shell { display: grid; gap: 18px; }
    .pair-head {
      display: grid;
      gap: 10px;
    }
    .pair-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .pair-action {
      display: grid;
      gap: 12px;
    }
    .pair-list {
      display: grid;
      gap: 10px;
      max-height: 500px;
      overflow: auto;
      padding-right: 4px;
    }
    .pairs-shell {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .cards-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    @media (max-width: 1180px) {
      .app { grid-template-columns: 1fr; }
      .sidebar {
        position: relative;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid rgba(255,255,255,.06);
      }
      .page-grid, .pairs-shell, .grid-4, .cards-3, .pair-stats { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <div class="eyebrow">VOID MD</div>
        <div class="brand-title">Control Deck</div>
        <div class="brand-subtitle">Organized pages for pairing, groups, business automations, chat views, and command management.</div>
      </div>
      <nav class="nav">${nav}</nav>
      <div class="sidebar-foot">
        Same pairing files. Same settings store. The dashboard just organizes what the bot already knows.
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <h1 class="page-title">${escapeHtml(title)}</h1>
          <div class="page-subtitle">${escapeHtml(subtitle)}</div>
        </div>
        <div class="topbar-actions">${topbarActions}</div>
      </div>
      ${body}
    </main>
  </div>
  <div class="toast" id="toast"></div>
  <script>
    window.__BOOT = ${JSON.stringify(boot)};

    const Dashboard = (() => {
      const toast = document.getElementById('toast');

      function showToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
      }

      async function request(url, options = {}) {
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json' },
          ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Request failed');
        return data;
      }

      function getTargetInput() {
        return document.querySelector('[data-target-input]');
      }

      function getTarget() {
        const input = getTargetInput();
        if (input && input.value.trim()) return input.value.trim();
        return (window.__BOOT && window.__BOOT.defaultTarget) || 'bot';
      }

      function setSummary(data) {
        const map = {
          summaryKeys: data.summary.totalKeys,
          summaryActive: data.summary.activeCount,
          summaryMode: data.summary.mode,
          summaryPairs: data.pairs.length,
          summaryGroups: data.groups.length,
          summaryChats: data.chats.length
        };
        Object.keys(map).forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.textContent = String(map[id]);
        });
      }

      function applyControlState(data) {
        document.querySelectorAll('[data-control-key]').forEach((card) => {
          const key = card.getAttribute('data-control-key');
          const kind = card.getAttribute('data-control-kind');
          const value = data.settings[key];
          if (kind === 'mode') {
            const select = card.querySelector('select');
            if (select) select.value = value === 'self' ? 'self' : 'public';
          } else {
            const input = card.querySelector('input[type="checkbox"]');
            const label = card.querySelector('.switch-label');
            if (input) input.checked = Boolean(value);
            if (label) label.textContent = Boolean(value) ? 'On' : 'Off';
          }
        });
      }

      function bindControls() {
        document.querySelectorAll('[data-control-key]').forEach((card) => {
          const key = card.getAttribute('data-control-key');
          const kind = card.getAttribute('data-control-kind');
          const scope = card.getAttribute('data-control-scope') || 'chat';
          const targetResolver = () => (kind === 'mode' ? 'bot' : getTarget());
          if (kind === 'mode') {
            const select = card.querySelector('select');
            if (!select || select.dataset.bound === '1') return;
            select.dataset.bound = '1';
            select.addEventListener('change', async () => {
              await request('/api/setting', {
                method: 'POST',
                body: JSON.stringify({
                  target: 'bot',
                  key,
                  value: select.value
                })
              });
              showToast('Saved ' + key);
              await loadState();
            });
          } else {
            const input = card.querySelector('input[type="checkbox"]');
            if (!input || input.dataset.bound === '1') return;
            input.dataset.bound = '1';
            input.addEventListener('change', async () => {
              await request('/api/setting', {
                method: 'POST',
                body: JSON.stringify({
                  target: targetResolver(),
                  key,
                  value: input.checked
                })
              });
              showToast('Saved ' + key + ' for ' + scope + ' target');
              const label = card.querySelector('.switch-label');
              if (label) label.textContent = input.checked ? 'On' : 'Off';
              await loadState();
            });
          }
        });
      }

      async function loadState() {
        const target = getTarget();
        const data = await request('/api/state?target=' + encodeURIComponent(target));
        setSummary(data);
        applyControlState(data);
        bindControls();
        return data;
      }

      async function logout() {
        const endpoint = window.__BOOT && window.__BOOT.owner ? '/api/owner/logout' : '/api/logout';
        await request(endpoint, { method: 'POST' });
        window.location.reload();
      }

      function bindLogout() {
        const btn = document.getElementById('logoutBtn');
        if (btn) btn.addEventListener('click', logout);
      }

      function bindTargetReload() {
        const btn = document.querySelector('[data-target-reload]');
        if (btn) btn.addEventListener('click', loadState);
        const input = getTargetInput();
        if (input) {
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') loadState();
          });
        }
      }

      async function postPair(number) {
        return request('/api/pair', {
          method: 'POST',
          body: JSON.stringify({ number })
        });
      }

      async function getPairStatus(target) {
        return request('/api/pair/status?target=' + encodeURIComponent(target));
      }

      async function createReminder(payload) {
        return request('/api/reminder', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      async function removePair(target) {
        return request('/api/pairing/remove', {
          method: 'POST',
          body: JSON.stringify({ target })
        });
      }

      function renderTargets(list, containerId, openHref) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!list.length) {
          container.innerHTML = '<div class="muted-box">No targets found in the settings store yet.</div>';
          return;
        }
        container.innerHTML = list.map((item) => {
          return '<div class="target-card">' +
            '<div>' +
              '<div class="target-title">' + (item.name || item.jid) + '</div>' +
              '<div class="target-meta">' + item.jid + '<br />' + item.kind.toUpperCase() + ' | ' + item.keyCount + ' settings | ' + item.activeCount + ' active</div>' +
            '</div>' +
            '<div class="row-actions">' +
              '<a class="ghost-btn" href="' + openHref + '?target=' + encodeURIComponent(item.jid) + '">Open</a>' +
            '</div>' +
          '</div>';
        }).join('');
      }

      function renderPairs(list) {
        const container = document.getElementById('pairList');
        if (!container) return;
        if (!list.length) {
          container.innerHTML = '<div class="muted-box">No paired sessions have been created yet.</div>';
          return;
        }
        container.innerHTML = list.map((item) => {
          return '<div class="pair-card">' +
            '<div>' +
              '<div class="target-title">' + item.name + '</div>' +
              '<div class="target-meta">' + item.path + '</div>' +
            '</div>' +
            '<button class="ghost-btn danger-btn" type="button" data-remove-pair="' + item.name + '">Remove</button>' +
          '</div>';
        }).join('');
        container.querySelectorAll('[data-remove-pair]').forEach((button) => {
          if (button.dataset.bound === '1') return;
          button.dataset.bound = '1';
          button.addEventListener('click', async () => {
            const target = button.getAttribute('data-remove-pair');
            if (!window.confirm('Remove this paired session?')) return;
            await removePair(target);
            showToast('Pair removed');
            await loadState();
            if (typeof window.refreshPairsPage === 'function') window.refreshPairsPage();
          });
        });
      }

      bindLogout();
      bindTargetReload();

      return {
        showToast,
        request,
        loadState,
        postPair,
        removePair,
        renderTargets,
        renderPairs,
        getPairStatus,
        createReminder,
        bindControls,
        applyControlState
      };
    })();

    window.Dashboard = Dashboard;
    ${script}
  </script>
</body>
</html>`;
}

function loginPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VOID MD Dashboard</title>
  <style>
    :root {
      --bg: #07111d;
      --bg2: #0e1b2f;
      --panel: rgba(12, 19, 32, 0.86);
      --panel-border: rgba(255,255,255,.08);
      --text: #eff5ff;
      --muted: #9fb0cf;
      --accent: #77e0c1;
      --shadow: 0 28px 90px rgba(0,0,0,.36);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: var(--text);
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(119, 224, 193, .16), transparent 28%),
        radial-gradient(circle at top right, rgba(255, 209, 102, .12), transparent 30%),
        linear-gradient(160deg, var(--bg), var(--bg2) 58%, #07111d);
      padding: 24px;
    }
    .panel {
      width: min(460px, 100%);
      padding: 28px;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      box-shadow: var(--shadow);
      border-radius: 24px;
      backdrop-filter: blur(18px);
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: .28em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 800;
      margin-bottom: 14px;
    }
    h1 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 44px;
      line-height: .95;
      margin: 0 0 12px 0;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.7;
    }
    label {
      display: block;
      margin: 18px 0 8px;
      color: var(--muted);
      font-size: 13px;
    }
    input, button {
      width: 100%;
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.04);
      color: var(--text);
      font: inherit;
    }
    input:focus {
      outline: none;
      border-color: rgba(119, 224, 193, .55);
      box-shadow: 0 0 0 4px rgba(119, 224, 193, .08);
    }
    button {
      margin-top: 14px;
      border: 0;
      background: linear-gradient(135deg, var(--accent), #8ad9ff);
      color: #05111b;
      font-weight: 900;
      cursor: pointer;
    }
    .small {
      margin-top: 12px;
      color: var(--muted);
      font-size: 13px;
      min-height: 20px;
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="eyebrow">VOID MD</div>
    <h1>Dashboard access</h1>
    <p>Use the startup password to open the dashboard that is already wired to the bot's pairing and settings store.</p>
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" placeholder="Enter startup password" />
    <button id="loginBtn" type="button">Unlock dashboard</button>
    <div class="small" id="loginMsg"></div>
  </div>
  <script>
    const loginBtn = document.getElementById('loginBtn');
    const loginMsg = document.getElementById('loginMsg');
    const password = document.getElementById('password');

    async function login() {
      loginBtn.disabled = true;
      loginMsg.textContent = 'Checking access...';
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password.value })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Login failed');
        window.location.reload();
      } catch (err) {
        loginMsg.textContent = err.message;
        loginBtn.disabled = false;
      }
    }

    loginBtn.addEventListener('click', login);
    password.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') login();
    });
  </script>
</body>
</html>`;
}

function ownerLoginPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VOID MD Owner Access</title>
  <style>
    :root {
      --bg: #05090f;
      --bg2: #0b1525;
      --panel: rgba(10, 16, 28, 0.9);
      --panel-border: rgba(255,255,255,.08);
      --text: #f0f6ff;
      --muted: #9fb0cf;
      --accent: #ffd166;
      --accent2: #77e0c1;
      --shadow: 0 28px 90px rgba(0,0,0,.42);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: var(--text);
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(255, 209, 102, .16), transparent 28%),
        radial-gradient(circle at top right, rgba(119, 224, 193, .12), transparent 30%),
        linear-gradient(160deg, var(--bg), var(--bg2) 58%, #05090f);
      padding: 24px;
    }
    .panel {
      width: min(520px, 100%);
      padding: 28px;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      box-shadow: var(--shadow);
      border-radius: 24px;
      backdrop-filter: blur(18px);
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: .32em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 800;
      margin-bottom: 14px;
    }
    h1 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 46px;
      line-height: .95;
      margin: 0 0 12px 0;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.7;
    }
    label {
      display: block;
      margin: 18px 0 8px;
      color: var(--muted);
      font-size: 13px;
    }
    input, button {
      width: 100%;
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.04);
      color: var(--text);
      font: inherit;
    }
    input:focus {
      outline: none;
      border-color: rgba(255, 209, 102, .55);
      box-shadow: 0 0 0 4px rgba(255, 209, 102, .08);
    }
    button {
      margin-top: 14px;
      border: 0;
      background: linear-gradient(135deg, var(--accent), #8ad9ff);
      color: #05111b;
      font-weight: 900;
      cursor: pointer;
    }
    .small {
      margin-top: 12px;
      color: var(--muted);
      font-size: 13px;
      min-height: 20px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      margin-bottom: 16px;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(255, 209, 102, .12);
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="badge">Owner only</div>
    <div class="eyebrow">VOID MD</div>
    <h1>Owner access</h1>
    <p>This area is separate from regular dashboard login and is protected by the owner password.</p>
    <label for="ownerPassword">Owner password</label>
    <input id="ownerPassword" type="password" autocomplete="current-password" placeholder="Enter owner password" />
    <button id="ownerLoginBtn" type="button">Unlock owner dashboard</button>
    <div class="small" id="ownerLoginMsg"></div>
  </div>
  <script>
    const ownerLoginBtn = document.getElementById('ownerLoginBtn');
    const ownerLoginMsg = document.getElementById('ownerLoginMsg');
    const ownerPassword = document.getElementById('ownerPassword');

    async function loginOwner() {
      ownerLoginBtn.disabled = true;
      ownerLoginMsg.textContent = 'Checking owner access...';
      try {
        const res = await fetch('/api/owner/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: ownerPassword.value })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Owner login failed');
        window.location.href = '/owner';
      } catch (err) {
        ownerLoginMsg.textContent = err.message;
        ownerLoginBtn.disabled = false;
      }
    }

    ownerLoginBtn.addEventListener('click', loginOwner);
    ownerPassword.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loginOwner();
    });
  </script>
</body>
</html>`;
}

function ownerStats() {
  const targets = listTargets();
  const groups = targets.filter((entry) => entry.kind === 'group');
  const chats = targets.filter((entry) => entry.kind === 'chat');
  const pairs = listPairs();
  const settings = readSettingsSnapshot();
  const banned = Object.entries(settings)
    .filter(([jid, value]) => jid !== 'bot' && value && value.banned)
    .map(([jid]) => jid);
  return {
    activeChats: chats.length,
    bannedUsers: banned.length,
    pairedSessions: pairs.length,
    activeGroups: groups.length,
    banned,
    pairs,
    groups,
    chats,
  };
}

function ownerDashboardPage() {
  const stats = ownerStats();
  return pageShell({
    active: '/',
    title: 'Owner Dashboard',
    subtitle: 'VOID MD owner controls, stats, and session management in one private workspace.',
    boot: { owner: true },
    body: `
      <div class="page-shell">
        <div class="panel hero">
          <div class="chips">
            <span class="chip">${stats.activeChats} active chats</span>
            <span class="chip">${stats.bannedUsers} banned users</span>
            <span class="chip">${stats.pairedSessions} paired sessions</span>
            <span class="chip">Owner only</span>
          </div>
          <div class="muted-box">
            This dashboard is locked behind its own password and cookie. Regular dashboard users cannot access this page.
          </div>
        </div>

        <div class="panel section">
          <h2 class="section-title">Target</h2>
          <p class="section-desc">Use this to point the owner controls at a bot, user, chat, or group target.</p>
          <div class="toolbar">
            <input class="field" data-target-input value="bot" placeholder="bot or JID" />
            <button class="primary-btn" type="button" data-target-reload>Load target</button>
          </div>
        </div>

        <div class="grid-4">
          <div class="panel stat">
            <div class="stat-label">Active chats</div>
            <div class="stat-value" id="ownerActiveChats">${stats.activeChats}</div>
            <div class="stat-note">Chats currently tracked in the settings store</div>
          </div>
          <div class="panel stat">
            <div class="stat-label">Banned users</div>
            <div class="stat-value" id="ownerBannedUsers">${stats.bannedUsers}</div>
            <div class="stat-note">Loaded from the existing ban list</div>
          </div>
          <div class="panel stat">
            <div class="stat-label">Paired sessions</div>
            <div class="stat-value" id="ownerPairedSessions">${stats.pairedSessions}</div>
            <div class="stat-note">Synced from MongoDB Atlas</div>
          </div>
          <div class="panel stat">
            <div class="stat-label">Tracked groups</div>
            <div class="stat-value" id="ownerActiveGroups">${stats.activeGroups}</div>
            <div class="stat-note">Group targets with stored metadata</div>
          </div>
        </div>

        <div class="page-grid">
          <div class="section-columns">
            <div class="panel section">
              <h2 class="section-title">Owner Settings</h2>
              <p class="section-desc">These owner-only controls already exist in the bot as stored settings, presented here in a cleaner web form.</p>
              <div class="control-group">
                ${CONTROL_CATALOG.filter((item) => item.page === 'business' || item.key === 'mode').map(controlCard).join('')}
              </div>
            </div>

            <div class="panel section">
              <h2 class="section-title">User Security</h2>
              <p class="section-desc">Ban and unban use the same existing settings the bot reads, so the dashboard stays in sync.</p>
              <div class="toolbar">
                <input class="field" id="ownerTarget" placeholder="234xxxxxxxx@s.whatsapp.net" />
                <button class="primary-btn" type="button" id="banBtn">Ban user</button>
                <button class="ghost-btn" type="button" id="unbanBtn">Unban user</button>
              </div>
              <div class="muted-box" id="ownerActionStatus">Ready.</div>
            </div>

            <div class="panel section">
              <h2 class="section-title">Owner Commands</h2>
              <p class="section-desc">Command reference for owner-level actions already available in the bot.</p>
              <div class="list">
                ${[
                  { name: 'ban', usage: 'ban @user', note: 'Mark a user as banned.' },
                  { name: 'unban', usage: 'unban @user', note: 'Clear a ban.' },
                  { name: 'resetlink', usage: 'resetlink', note: 'Revoke the current group invite link.' },
                  { name: 'mute', usage: 'mute', note: 'Close a group to members.' },
                  { name: 'unmute', usage: 'unmute', note: 'Open the group back up.' },
                  { name: 'kickall', usage: 'kickall', note: 'Remove non-admin members.' },
                  { name: 'kickadmins', usage: 'kickadmins', note: 'Remove admins except the bot and owner.' },
                  { name: 'tagall', usage: 'tagall message', note: 'Mention every member.' },
                  { name: 'hidetag', usage: 'hidetag message', note: 'Send a hidden mention.' },
                  { name: 'promote', usage: 'promote @user', note: 'Promote a member.' },
                  { name: 'demote', usage: 'demote @user', note: 'Demote a member.' }
                ].map(guideCard).join('')}
              </div>
            </div>
          </div>
          <div class="section panel">
            <h2 class="section-title">Paired Sessions</h2>
            <p class="section-desc">These are the current WhatsApp sessions visible to the owner at a glance.</p>
            <div id="ownerPairs" class="pair-list"></div>
          </div>
        </div>
      </div>
    `,
    script: `
      (async () => {
        await Dashboard.loadState();
        const stats = await Dashboard.request('/api/owner/state');
        const statMap = {
          ownerActiveChats: stats.activeChats,
          ownerBannedUsers: stats.bannedUsers,
          ownerPairedSessions: stats.pairedSessions,
          ownerActiveGroups: stats.activeGroups
        };
        Object.entries(statMap).forEach(([id, value]) => {
          const el = document.getElementById(id);
          if (el) el.textContent = String(value);
        });
        const pairContainer = document.getElementById('ownerPairs');
        if (pairContainer) {
          if (!stats.pairs.length) {
            pairContainer.innerHTML = '<div class="muted-box">No paired sessions yet.</div>';
          } else {
            pairContainer.innerHTML = stats.pairs.map((item) => '<div class="pair-card"><div><div class="target-title">' + item.name + '</div><div class="target-meta">' + item.path + '</div></div><button class="ghost-btn danger-btn" type="button" data-owner-remove-pair="' + item.name + '">Remove</button></div>').join('');
            pairContainer.querySelectorAll('[data-owner-remove-pair]').forEach((button) => {
              if (button.dataset.bound === '1') return;
              button.dataset.bound = '1';
              button.addEventListener('click', async () => {
                const target = button.getAttribute('data-owner-remove-pair');
                if (!window.confirm('Remove this paired session?')) return;
                await Dashboard.removePair(target);
                Dashboard.showToast('Session removed');
                window.location.reload();
              });
            });
          }
        }

        const status = document.getElementById('ownerActionStatus');
        const targetInput = document.getElementById('ownerTarget');
        const banBtn = document.getElementById('banBtn');
        const unbanBtn = document.getElementById('unbanBtn');

        async function updateBan(value) {
          const target = (targetInput.value || '').trim();
          if (!target) {
            status.textContent = 'Enter a user JID or number first.';
            return;
          }
          status.textContent = value ? 'Banning user...' : 'Unbanning user...';
          await Dashboard.request('/api/setting', {
            method: 'POST',
            body: JSON.stringify({
              target: target.includes('@') ? target : target.replace(/\\D/g, '') + '@s.whatsapp.net',
              key: 'banned',
              value
            })
          });
          status.textContent = value ? 'User banned.' : 'User unbanned.';
          Dashboard.showToast(value ? 'User banned' : 'User unbanned');
        }

        if (banBtn && !banBtn.dataset.bound) {
          banBtn.dataset.bound = '1';
          banBtn.addEventListener('click', () => updateBan(true).catch((err) => status.textContent = err.message));
        }
        if (unbanBtn && !unbanBtn.dataset.bound) {
          unbanBtn.dataset.bound = '1';
          unbanBtn.addEventListener('click', () => updateBan(false).catch((err) => status.textContent = err.message));
        }
      })();
    `
  });
}

function homePage() {
  const targets = listTargets();
  const pairs = listPairs();
  const groups = targets.filter((entry) => entry.kind === 'group');
  const chats = targets.filter((entry) => entry.kind === 'chat');
  return pageShell({
    active: '/',
    title: 'Overview',
    subtitle: 'A clean starting point for the dashboard. Jump into pairing, command management, group tools, business automations, or chat views from here.',
    boot: { defaultTarget: 'bot' },
    body: `
      <div class="page-shell">
        <div class="panel hero">
          <div class="chips">
            <span class="chip">${pairs.length} paired sessions</span>
            <span class="chip">${groups.length} groups tracked</span>
            <span class="chip">${chats.length} chats tracked</span>
            <span class="chip">Shared settings store</span>
          </div>
          <div class="muted-box">
            This dashboard is split into dedicated pages so each task has a clear home. Pairing lives on its own page, group tools stay with groups, business automations stay with business, and chats have their own view for browsing targets.
          </div>
        </div>

        <div class="grid-4">
          <div class="panel stat">
            <div class="stat-label">Paired sessions</div>
            <div class="stat-value">${pairs.length}</div>
            <div class="stat-note">Stored under <code>richstore/pairing</code></div>
          </div>
          <div class="panel stat">
            <div class="stat-label">Group targets</div>
            <div class="stat-value">${groups.length}</div>
            <div class="stat-note">Pulled from <code>setting.json</code></div>
          </div>
          <div class="panel stat">
            <div class="stat-label">Chat targets</div>
            <div class="stat-value">${chats.length}</div>
            <div class="stat-note">User and chat level settings</div>
          </div>
          <div class="panel stat">
            <div class="stat-label">Active mode</div>
            <div class="stat-value">${escapeHtml(getSetting('bot', 'mode', 'public'))}</div>
            <div class="stat-note">Bot-wide mode from existing storage</div>
          </div>
        </div>

        <div class="cards-3">
          <a class="panel section" href="/commands">
            <div class="section-title">Command Management</div>
            <div class="section-desc">Organized switches and command references, grouped by purpose.</div>
          </a>
          <a class="panel section" href="/groups">
            <div class="section-title">Groups</div>
            <div class="section-desc">Group-related controls, group command references, and tracked group targets.</div>
          </a>
          <a class="panel section" href="/business">
            <div class="section-title">Business</div>
            <div class="section-desc">Auto reply and automation settings for business-style chats.</div>
          </a>
          <a class="panel section" href="/chats">
            <div class="section-title">Chats</div>
            <div class="section-desc">Browse stored chat and user targets from the settings file.</div>
          </a>
          <a class="panel section" href="/pairing">
            <div class="section-title">Pairing</div>
            <div class="section-desc">Generate codes and manage paired sessions on a standalone page.</div>
          </a>
        </div>
      </div>
    `
  });
}

function commandPage(activeTarget) {
  const sections = ['System', 'Groups', 'Business'];
  const grouped = sections.map((section) => {
    const cards = CONTROL_CATALOG.filter((item) => item.page === 'commands' && item.section === section).map(controlCard).join('');
    return `
      <div class="section panel">
        <h2 class="section-title">${escapeHtml(section)}</h2>
        <p class="section-desc">Controls grouped under ${escapeHtml(section.toLowerCase())}.</p>
        <div class="control-group">${cards}</div>
      </div>`;
  }).join('');

  return pageShell({
    active: '/commands',
    title: 'Command Management',
    subtitle: 'This page is the central command console. The controls are grouped so they are easier to scan, and the target can be changed without touching the underlying bot logic.',
    boot: { defaultTarget: activeTarget || 'bot' },
    body: `
      <div class="page-shell">
        <div class="panel section">
          <h2 class="section-title">Target</h2>
          <p class="section-desc">Use a bot JID, chat JID, or group JID. Bot mode always uses <code>bot</code>.</p>
          <div class="toolbar">
            <input class="field" data-target-input value="${escapeHtml(activeTarget || 'bot')}" placeholder="bot or JID" />
            <button class="primary-btn" type="button" data-target-reload>Load target</button>
          </div>
        </div>

        <div class="grid-4">
          <div class="panel stat"><div class="stat-label">Settings keys</div><div class="stat-value" id="summaryKeys">0</div></div>
          <div class="panel stat"><div class="stat-label">Active flags</div><div class="stat-value" id="summaryActive">0</div></div>
          <div class="panel stat"><div class="stat-label">Pairs</div><div class="stat-value" id="summaryPairs">0</div></div>
          <div class="panel stat"><div class="stat-label">Mode</div><div class="stat-value" id="summaryMode">public</div></div>
        </div>

        <div class="page-grid">
          <div class="section-columns">${grouped}</div>
          <div class="section panel">
            <h2 class="section-title">Command Reference</h2>
            <p class="section-desc">These are the existing bot commands grouped by purpose. They are shown here for quick navigation and clarity.</p>
            <div class="list">${COMMAND_GUIDES.groups.concat(COMMAND_GUIDES.business, COMMAND_GUIDES.chats).map(guideCard).join('')}</div>
          </div>
        </div>
      </div>
    `,
    script: `
      (async () => {
        await Dashboard.loadState();
      })();
    `
  });
}

function groupsPage(activeTarget) {
  const cards = CONTROL_CATALOG.filter((item) => item.page === 'groups').map(controlCard).join('');
  const guides = COMMAND_GUIDES.groups.map(guideCard).join('');
  return pageShell({
    active: '/groups',
    title: 'Groups',
    subtitle: 'Group tools live here. The page keeps group controls separate from business automation, while still letting you inspect the group targets already stored in the settings file.',
    boot: { defaultTarget: activeTarget || 'bot' },
    body: `
      <div class="page-shell">
        <div class="panel section">
          <h2 class="section-title">Selected group</h2>
          <p class="section-desc">Paste a group JID or choose one from the list on the right. Group controls only make sense against a group target.</p>
          <div class="toolbar">
            <input class="field" data-target-input value="${escapeHtml(activeTarget || 'bot')}" placeholder="group JID like 1203...@g.us" />
            <button class="primary-btn" type="button" data-target-reload>Load group</button>
          </div>
        </div>

        <div class="grid-4">
          <div class="panel stat"><div class="stat-label">Tracked groups</div><div class="stat-value" id="summaryGroups">0</div></div>
          <div class="panel stat"><div class="stat-label">Stored keys</div><div class="stat-value" id="summaryKeys">0</div></div>
          <div class="panel stat"><div class="stat-label">Active flags</div><div class="stat-value" id="summaryActive">0</div></div>
          <div class="panel stat"><div class="stat-label">Pairs</div><div class="stat-value" id="summaryPairs">0</div></div>
        </div>

        <div class="page-grid">
          <div class="section-columns">
            <div class="panel section">
              <h2 class="section-title">Group Controls</h2>
              <p class="section-desc">The controls that belong under the groups section are kept together here.</p>
              <div class="control-group">${cards}</div>
            </div>
            <div class="panel section">
              <h2 class="section-title">Group Commands</h2>
              <p class="section-desc">Existing group commands from the bot, shown as a reference instead of dumping everything into one list.</p>
              <div class="list">${guides}</div>
            </div>
          </div>
          <div class="section panel">
            <h2 class="section-title">Tracked Groups</h2>
            <p class="section-desc">These are the group JIDs already present in the settings store. Open one to manage it directly.</p>
            <div id="targetList" class="list"></div>
          </div>
        </div>
      </div>
    `,
    script: `
      (async () => {
        const data = await Dashboard.loadState();
        Dashboard.renderTargets(data.groups, 'targetList', '/groups/view');
      })();
    `
  });
}

function businessPage(activeTarget) {
  const cards = CONTROL_CATALOG.filter((item) => item.page === 'business').map(controlCard).join('');
  const guides = COMMAND_GUIDES.business.map(guideCard).join('');
  return pageShell({
    active: '/business',
    title: 'Business',
    subtitle: 'Business automation is kept separate from group operations so auto-reply and moderation tools are easier to find.',
    boot: { defaultTarget: activeTarget || 'bot' },
    body: `
      <div class="page-shell">
        <div class="panel section">
          <h2 class="section-title">Target</h2>
          <p class="section-desc">Use a user JID, chat JID, or a group JID if you are adjusting chat-level automation for that room.</p>
          <div class="toolbar">
            <input class="field" data-target-input value="${escapeHtml(activeTarget || 'bot')}" placeholder="chat or user JID" />
            <button class="primary-btn" type="button" data-target-reload>Load target</button>
          </div>
        </div>

        <div class="grid-4">
          <div class="panel stat"><div class="stat-label">Tracked chats</div><div class="stat-value" id="summaryChats">0</div></div>
          <div class="panel stat"><div class="stat-label">Stored keys</div><div class="stat-value" id="summaryKeys">0</div></div>
          <div class="panel stat"><div class="stat-label">Active flags</div><div class="stat-value" id="summaryActive">0</div></div>
          <div class="panel stat"><div class="stat-label">Mode</div><div class="stat-value" id="summaryMode">public</div></div>
        </div>

        <div class="page-grid">
          <div class="section-columns">
            <div class="panel section">
              <h2 class="section-title">Chat Automation</h2>
              <p class="section-desc">Auto-reply, anti-spam, anti-bad-word, and anti-bot controls.</p>
              <div class="control-group">${cards.filter((_, index) => index < 4).join('')}</div>
            </div>
            <div class="panel section">
              <h2 class="section-title">Personal Automation</h2>
              <p class="section-desc">User-level behavior like bio, read receipts, and status viewing.</p>
              <div class="control-group">${cards.filter((_, index) => index >= 4).join('')}</div>
            </div>
            <div class="panel section">
              <h2 class="section-title">Business Commands</h2>
              <p class="section-desc">The existing business-related commands are grouped here so they are not mixed into the group tools page.</p>
              <div class="list">${guides}</div>
            </div>
          </div>
          <div class="section panel">
            <h2 class="section-title">Tracked Chats</h2>
            <p class="section-desc">Targets that are not groups are shown here. Pick one to inspect its business settings.</p>
            <div id="targetList" class="list"></div>
          </div>
        </div>
      </div>
    `,
    script: `
      (async () => {
        const data = await Dashboard.loadState();
        Dashboard.renderTargets(data.chats, 'targetList', '/commands');
      })();
    `
  });
}

function chatsPage() {
  return pageShell({
    active: '/chats',
    title: 'Chats',
    subtitle: 'This page is for browsing the chat and user targets already stored by the dashboard. It does not mix command controls into the view, so the layout stays easy to scan.',
    boot: { defaultTarget: 'bot' },
    body: `
      <div class="page-shell">
        <div class="panel hero">
          <div class="chips">
            <span class="chip">Chat targets from settings.json</span>
            <span class="chip">Use the Open button to jump to commands</span>
            <span class="chip">Separate from groups</span>
          </div>
          <div class="muted-box">
            The bot does not keep a separate database of chat views, so this page shows the actual chat and user targets already present in the settings store. That keeps the page honest and still useful.
          </div>
        </div>

        <div class="cards-3">
          <div class="panel stat">
            <div class="stat-label">Tracked chats</div>
            <div class="stat-value" id="summaryChats">0</div>
            <div class="stat-note">Non-group targets in the settings store</div>
          </div>
          <div class="panel stat">
            <div class="stat-label">Tracked groups</div>
            <div class="stat-value" id="summaryGroups">0</div>
            <div class="stat-note">Group targets live on the Groups page</div>
          </div>
          <div class="panel stat">
            <div class="stat-label">Paired sessions</div>
            <div class="stat-value" id="summaryPairs">0</div>
            <div class="stat-note">Sessions stored under richstore/pairing</div>
          </div>
        </div>

        <div class="panel section">
          <h2 class="section-title">Chat Targets</h2>
          <p class="section-desc">These are the existing non-group JIDs found in the settings file. They are the best source of truth the dashboard has for a chat view.</p>
          <div id="targetList" class="list"></div>
        </div>
      </div>
    `,
    script: `
      (async () => {
        const data = await Dashboard.loadState();
        Dashboard.renderTargets(data.chats, 'targetList', '/chats/view');
      })();
    `
  });
}

function groupDetailPage(activeTarget) {
  const target = activeTarget || 'bot';
  const cards = CONTROL_CATALOG.filter((item) => item.page === 'groups').map(controlCard).join('');
  const guides = COMMAND_GUIDES.groups.map(guideCard).join('');
  return pageShell({
    active: '/groups',
    title: 'Group Detail',
    subtitle: 'This page is for one group at a time. You can manage the group-specific controls here and schedule gc-reminders without leaving the dashboard.',
    boot: { defaultTarget: target },
    body: `
      <div class="page-shell">
        <div class="panel section">
          <h2 class="section-title">Selected group</h2>
          <p class="section-desc">Open a group from the Groups page, or paste a group JID here to manage that exact group.</p>
          <div class="toolbar">
            <input class="field" data-target-input value="${escapeHtml(target)}" placeholder="1203...@g.us" />
            <button class="primary-btn" type="button" data-target-reload>Load group</button>
          </div>
        </div>

        <div class="grid-4">
          <div class="panel stat"><div class="stat-label">Group name</div><div class="stat-value" id="summaryName">-</div></div>
          <div class="panel stat"><div class="stat-label">Group JID</div><div class="stat-value" id="summaryJid">-</div></div>
          <div class="panel stat"><div class="stat-label">Settings</div><div class="stat-value" id="summaryKeys">0</div></div>
          <div class="panel stat"><div class="stat-label">Active flags</div><div class="stat-value" id="summaryActive">0</div></div>
        </div>

        <div class="page-grid">
          <div class="section-columns">
            <div class="panel section">
              <h2 class="section-title">Group Controls</h2>
              <p class="section-desc">These are the existing group controls exposed as a cleaner web form.</p>
              <div class="control-group">${cards}</div>
            </div>
            <div class="panel section">
              <h2 class="section-title">gc-reminder</h2>
              <p class="section-desc">Schedule a reminder for this group. If tag all is enabled, the bot will mention every member when it sends the message.</p>
              <div class="toolbar">
                <input class="field" id="gcReminderDate" type="date" />
                <input class="field" id="gcReminderTime" type="time" />
              </div>
              <textarea class="field" id="gcReminderMessage" rows="4" placeholder="Reminder text"></textarea>
              <label class="switch"><input id="gcReminderTagAll" type="checkbox" checked /> <span class="switch-label">Tag all members</span></label>
              <button class="primary-btn" type="button" id="gcReminderBtn">Schedule reminder</button>
              <div class="muted-box" id="gcReminderStatus">This uses the existing Mongo reminder queue and the current bot session.</div>
            </div>
            <div class="panel section">
              <h2 class="section-title">Group Commands</h2>
              <p class="section-desc">Command references for this group, grouped so they stay easy to scan.</p>
              <div class="list">${guides}</div>
            </div>
          </div>
          <div class="section panel">
            <h2 class="section-title">Tracked Groups</h2>
            <p class="section-desc">Only the name and ID are shown here to keep the list clean.</p>
            <div id="targetList" class="list"></div>
          </div>
        </div>
      </div>
    `,
    script: `
      (async () => {
        const input = document.querySelector('[data-target-input]');
        const target = (input && input.value.trim()) || '${escapeHtml(target)}';
        const data = await Dashboard.loadState();
        const group = (data.targets || []).find((entry) => entry.jid === target) || { name: target, jid: target, keyCount: 0, activeCount: 0 };
        const nameEl = document.getElementById('summaryName');
        const jidEl = document.getElementById('summaryJid');
        if (nameEl) nameEl.textContent = group.name || group.jid || target;
        if (jidEl) jidEl.textContent = group.jid || target;
        Dashboard.renderTargets(data.groups, 'targetList', '/groups/view');

        const btn = document.getElementById('gcReminderBtn');
        const status = document.getElementById('gcReminderStatus');
        if (btn && !btn.dataset.bound) {
          btn.dataset.bound = '1';
          btn.addEventListener('click', async () => {
            const date = document.getElementById('gcReminderDate').value;
            const time = document.getElementById('gcReminderTime').value;
            const message = document.getElementById('gcReminderMessage').value.trim();
            const tagAll = document.getElementById('gcReminderTagAll').checked;
            if (!date || !time || !message) {
              status.textContent = 'Pick a date, time, and message first.';
              return;
            }
            const runAt = new Date(date + 'T' + time).toISOString();
            btn.disabled = true;
            status.textContent = 'Saving reminder...';
            try {
              await Dashboard.createReminder({ target: (document.querySelector('[data-target-input]')?.value || '${escapeHtml(target)}').trim(), runAt, message, tagAll });
              status.textContent = 'Reminder saved. The bot will deliver it at the scheduled time.';
              Dashboard.showToast('Reminder scheduled');
            } catch (err) {
              status.textContent = err.message;
            } finally {
              btn.disabled = false;
            }
          });
        }
      })();
    `
  });
}

function chatDetailPage(activeTarget) {
  const target = activeTarget || 'bot';
  const cards = CONTROL_CATALOG.filter((item) => item.page === 'business').map(controlCard).join('');
  const guides = COMMAND_GUIDES.chats.map(guideCard).join('');
  return pageShell({
    active: '/chats',
    title: 'Chat Detail',
    subtitle: 'A single chat or user can be opened here so the business automation controls stay focused and easy to manage.',
    boot: { defaultTarget: target },
    body: `
      <div class="page-shell">
        <div class="panel section">
          <h2 class="section-title">Selected chat</h2>
          <p class="section-desc">Paste a chat or user JID here, or open one from the Chats page.</p>
          <div class="toolbar">
            <input class="field" data-target-input value="${escapeHtml(target)}" placeholder="user or chat JID" />
            <button class="primary-btn" type="button" data-target-reload>Load chat</button>
          </div>
        </div>

        <div class="grid-4">
          <div class="panel stat"><div class="stat-label">Chat name</div><div class="stat-value" id="summaryName">-</div></div>
          <div class="panel stat"><div class="stat-label">Chat JID</div><div class="stat-value" id="summaryJid">-</div></div>
          <div class="panel stat"><div class="stat-label">Settings</div><div class="stat-value" id="summaryKeys">0</div></div>
          <div class="panel stat"><div class="stat-label">Active flags</div><div class="stat-value" id="summaryActive">0</div></div>
        </div>

        <div class="page-grid">
          <div class="section-columns">
            <div class="panel section">
              <h2 class="section-title">Business Controls</h2>
              <p class="section-desc">These are the existing business controls presented as form elements instead of a plain command dump.</p>
              <div class="control-group">${cards}</div>
            </div>
            <div class="panel section">
              <h2 class="section-title">Command Reference</h2>
              <p class="section-desc">The chat-related commands already in the bot are listed here for quick reference.</p>
              <div class="list">${guides}</div>
            </div>
          </div>
          <div class="section panel">
            <h2 class="section-title">Tracked Chats</h2>
            <p class="section-desc">Only the name and ID are shown here to keep the list clean and focused.</p>
            <div id="targetList" class="list"></div>
          </div>
        </div>
      </div>
    `,
    script: `
      (async () => {
        const input = document.querySelector('[data-target-input]');
        const target = (input && input.value.trim()) || '${escapeHtml(target)}';
        const data = await Dashboard.loadState();
        const chat = (data.targets || []).find((entry) => entry.jid === target) || { name: target, jid: target, keyCount: 0, activeCount: 0 };
        const nameEl = document.getElementById('summaryName');
        const jidEl = document.getElementById('summaryJid');
        if (nameEl) nameEl.textContent = chat.name || chat.jid || target;
        if (jidEl) jidEl.textContent = chat.jid || target;
        Dashboard.renderTargets(data.chats, 'targetList', '/chats/view');
      })();
    `
  });
}

function pairingPage(activeTarget) {
  return pageShell({
    active: '/pairing',
    title: 'Pairing',
    subtitle: 'Pairing is kept on its own page so the flow stays focused. Generate codes here, then manage the sessions below without touching the command pages.',
    boot: { defaultTarget: activeTarget || 'bot' },
    body: `
      <div class="page-shell">
        <div class="pairs-shell">
          <div class="panel section">
            <div class="pair-head">
              <h2 class="section-title">Generate Pairing Code</h2>
              <p class="section-desc">Enter a WhatsApp number in international format and the dashboard will call the same pairing routine the bot already uses.</p>
              <div class="pair-action">
                <input class="field" id="pairNumber" placeholder="234xxxxxxxx" />
                <button class="primary-btn" id="pairBtn" type="button">Generate code</button>
              </div>
              <div class="muted-box">
                Latest code: <span id="pairCode">Not generated yet</span><br />
                Status: <span id="pairStatus">Waiting for input</span>
              </div>
            </div>
          </div>
          <div class="panel section">
            <h2 class="section-title">Pairing Summary</h2>
            <div class="pair-stats">
              <div class="panel stat">
                <div class="stat-label">Paired sessions</div>
                <div class="stat-value" id="summaryPairs">0</div>
              </div>
              <div class="panel stat">
                <div class="stat-label">Tracked groups</div>
                <div class="stat-value" id="summaryGroups">0</div>
              </div>
              <div class="panel stat">
                <div class="stat-label">Tracked chats</div>
                <div class="stat-value" id="summaryChats">0</div>
              </div>
            </div>
            <div class="muted-box">
              This page works directly with the existing <code>richstore/pairing</code> folder. Removing a session here removes the same folder the bot uses.
            </div>
          </div>
        </div>

        <div class="panel section">
          <h2 class="section-title">Pairing Status</h2>
          <p class="section-desc">Live status updates are shown here while the bot is preparing or confirming the session.</p>
          <div class="grid-4">
            <div class="panel stat"><div class="stat-label">Status</div><div class="stat-value" id="pairState">Idle</div></div>
            <div class="panel stat"><div class="stat-label">Code</div><div class="stat-value" id="pairStateCode">-</div></div>
            <div class="panel stat"><div class="stat-label">Target</div><div class="stat-value" id="pairStateTarget">-</div></div>
            <div class="panel stat"><div class="stat-label">Last connected</div><div class="stat-value" id="pairStateTime">-</div></div>
          </div>
          <div class="muted-box" id="pairStateNote">Waiting for a pairing request.</div>
        </div>

        <div class="panel section">
          <h2 class="section-title">Paired Sessions</h2>
          <p class="section-desc">All paired device folders are listed here. Each remove button deletes the corresponding session directory.</p>
          <div id="pairList" class="pair-list"></div>
        </div>
      </div>
    `,
    script: `
      async function refreshPairsPage() {
        const data = await Dashboard.loadState();
        Dashboard.renderPairs(data.pairs);
      }
      window.refreshPairsPage = refreshPairsPage;
      let pairPollTimer = null;
      async function updatePairStatus(target) {
        if (!target) return;
        const status = await Dashboard.getPairStatus(target);
        const pairState = document.getElementById('pairState');
        const pairStateCode = document.getElementById('pairStateCode');
        const pairStateTarget = document.getElementById('pairStateTarget');
        const pairStateTime = document.getElementById('pairStateTime');
        const pairStateNote = document.getElementById('pairStateNote');
        if (pairState) pairState.textContent = status.status || 'unknown';
        if (pairStateCode) pairStateCode.textContent = status.pairingCode || '-';
        if (pairStateTarget) pairStateTarget.textContent = status.target || target;
        if (pairStateTime) pairStateTime.textContent = status.lastConnectedAt ? new Date(status.lastConnectedAt).toLocaleString() : '-';
        if (pairStateNote) {
          pairStateNote.textContent =
            status.status === 'active'
              ? 'Pairing is complete and the session is live on the website and in MongoDB Atlas.'
              : status.status === 'pairing'
                ? 'Pairing code generated. Finish linking in WhatsApp.'
                : status.status === 'disconnected'
                  ? 'The session disconnected and may need to be re-paired.'
                  : 'Waiting for the next update.';
        }
        return status;
      }
      const pairBtn = document.getElementById('pairBtn');
      const pairNumber = document.getElementById('pairNumber');
      const pairCode = document.getElementById('pairCode');
      const pairStatus = document.getElementById('pairStatus');
      if (pairBtn && !pairBtn.dataset.bound) {
        pairBtn.dataset.bound = '1';
        pairBtn.addEventListener('click', async () => {
          pairBtn.disabled = true;
          pairStatus.textContent = 'Requesting pairing code...';
          try {
            const data = await Dashboard.postPair(pairNumber.value);
            pairCode.textContent = data.code || 'No code returned';
            pairStatus.textContent = data.alreadyPaired ? 'This account is already paired.' : 'Pairing request sent';
            Dashboard.showToast('Pairing code generated');
            await refreshPairsPage();
            if (pairPollTimer) clearInterval(pairPollTimer);
            if (data.target) {
              await updatePairStatus(data.target).catch((err) => pairStatus.textContent = err.message);
              let tries = 0;
              pairPollTimer = setInterval(async () => {
                tries += 1;
                try {
                  const state = await updatePairStatus(data.target);
                  if (state.status === 'active') {
                    pairStatus.textContent = 'Pairing confirmed on the website.';
                    pairCode.textContent = state.pairingCode || pairCode.textContent;
                    Dashboard.showToast('Pairing confirmed');
                    clearInterval(pairPollTimer);
                    pairPollTimer = null;
                  }
                  if (tries >= 20) {
                    clearInterval(pairPollTimer);
                    pairPollTimer = null;
                  }
                } catch (err) {
                  pairStatus.textContent = err.message;
                  clearInterval(pairPollTimer);
                  pairPollTimer = null;
                }
              }, 3000);
            }
          } catch (err) {
            pairStatus.textContent = err.message;
          } finally {
            pairBtn.disabled = false;
          }
        });
      }
      (async () => {
        await refreshPairsPage();
      })();
    `
  });
}

function renderPage(url) {
  const target = url.searchParams.get('target') || 'bot';
  const pathname = String(url.pathname || '/').replace(/\/+$/, '') || '/';
  if (pathname === '/') return homePage();
  if (pathname === '/commands' || pathname.startsWith('/commands/')) return commandPage(target);
  if (pathname === '/groups/view' || pathname.startsWith('/groups/view/')) return groupDetailPage(target);
  if (pathname === '/groups' || pathname.startsWith('/groups/')) return groupsPage(target);
  if (pathname === '/chats/view' || pathname.startsWith('/chats/view/')) return chatDetailPage(target);
  if (pathname === '/business' || pathname.startsWith('/business/')) return businessPage(target);
  if (pathname === '/chats' || pathname.startsWith('/chats/')) return chatsPage();
  if (pathname === '/pairing' || pathname.startsWith('/pairing/')) return pairingPage(target);
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/owner/owner') {
      res.writeHead(302, {
        Location: '/owner',
        'Cache-Control': 'no-store',
      });
      return res.end();
    }

    if (req.method === 'GET' && (url.pathname === '/owner' || url.pathname === '/owner/login')) {
      if (await isOwnerAuthed(req)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(ownerDashboardPage());
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(ownerLoginPage());
    }

    if (req.method === 'POST' && url.pathname === '/api/owner/login') {
      if (!OWNER_WEB_PASSWORD) {
        return sendJson(res, 500, { error: 'Owner password is not configured' });
      }
      const body = await readBody(req);
      if (body.password !== OWNER_WEB_PASSWORD) {
        return sendJson(res, 401, { error: 'Incorrect owner password' });
      }
      const token = `owner-${crypto.randomBytes(24).toString('hex')}`;
      ownerSessions.add(token);
      await createWebSession(token, {
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers['user-agent'] || '',
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${OWNER_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'POST' && url.pathname === '/api/owner/logout') {
      const cookies = parseCookies(req.headers.cookie || '');
      if (cookies[OWNER_COOKIE_NAME]) {
        ownerSessions.delete(cookies[OWNER_COOKIE_NAME]);
        await destroyWebSession(cookies[OWNER_COOKIE_NAME]).catch(() => {});
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${OWNER_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'GET' && url.pathname === '/api/owner/state') {
      if (!(await isOwnerAuthed(req))) return sendJson(res, 401, { error: 'Unauthorized' });
      return sendJson(res, 200, ownerStats());
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readBody(req);
      if (body.password !== startupPassword) {
        return sendJson(res, 401, { error: 'Incorrect password' });
      }
      const token = crypto.randomBytes(24).toString('hex');
      sessions.add(token);
      await createWebSession(token, {
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers['user-agent'] || '',
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const cookies = parseCookies(req.headers.cookie || '');
      if (cookies[COOKIE_NAME]) {
        sessions.delete(cookies[COOKIE_NAME]);
        await destroyWebSession(cookies[COOKIE_NAME]).catch(() => {});
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      if (!(await isDashboardAuthed(req))) return sendJson(res, 401, { error: 'Unauthorized' });
      const target = url.searchParams.get('target') || 'bot';
      return sendJson(res, 200, buildState(target));
    }

    if (req.method === 'GET' && url.pathname === '/api/targets') {
      if (!(await isDashboardAuthed(req))) return sendJson(res, 401, { error: 'Unauthorized' });
      const targets = listTargets();
      return sendJson(res, 200, {
        groups: targets.filter((entry) => entry.kind === 'group'),
        chats: targets.filter((entry) => entry.kind === 'chat'),
        pairs: listPairs()
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/pair/status') {
      if (!(await isDashboardAuthed(req))) return sendJson(res, 401, { error: 'Unauthorized' });
      const target = url.searchParams.get('target');
      if (!target) return sendJson(res, 400, { error: 'Missing target' });
      const session = await getSessionDoc(target).catch(() => null);
      return sendJson(res, 200, {
        target,
        status: session?.status || 'missing',
        pairingCode: session?.pairingCode || '',
        lastConnectedAt: session?.lastConnectedAt || null,
      });
    }

    if (!(await isAuthed(req))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(loginPage());
    }

    if (req.method === 'POST' && url.pathname === '/api/pair') {
      if (!(await isDashboardAuthed(req))) return sendJson(res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const number = String(body.number || '').replace(/\D/g, '');
      if (!number) return sendJson(res, 400, { error: 'Enter a valid number' });
      const target = `${number}@s.whatsapp.net`;
      const existingSession = await getSessionDoc(target).catch(() => null);
      if (existingSession && existingSession.status !== 'deleted') {
        await refreshPairCache();
        return sendJson(res, 200, {
          ok: true,
          alreadyPaired: true,
          status: existingSession.status,
          code: existingSession.pairingCode || '',
          target,
        });
      }
      const startpairing = require('./pair');
      await startpairing(target);
      await new Promise((resolve) => setTimeout(resolve, 4500));
      await refreshPairCache();
      const pairingState = await getSessionDoc(target).catch(() => null);
      return sendJson(res, 200, {
        ok: true,
        code: pairingState?.pairingCode || '',
        status: pairingState?.status || 'pairing',
        target,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/pairing/remove') {
      if (!(await isDashboardAuthed(req))) return sendJson(res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const target = String(body.target || '').trim();
      if (!target) return sendJson(res, 400, { error: 'Missing target' });
      await deleteSessionArtifacts(target).catch(() => {});
      const localPath = getSessionFolder(target);
      fs.rmSync(localPath, { recursive: true, force: true });
      await refreshPairCache();
      return sendJson(res, 200, { ok: true, removed: target });
    }

    if (req.method === 'POST' && url.pathname === '/api/reminder') {
      if (!(await isDashboardAuthed(req))) return sendJson(res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const target = String(body.target || '').trim();
      const message = String(body.message || '').trim();
      const runAt = new Date(body.runAt);
      const tagAll = Boolean(body.tagAll);
      if (!target) return sendJson(res, 400, { error: 'Missing target' });
      if (!message) return sendJson(res, 400, { error: 'Missing reminder message' });
      if (Number.isNaN(runAt.getTime())) return sendJson(res, 400, { error: 'Invalid reminder time' });
      const activeSessions = await loadSessionIds({ status: 'active' }).catch(() => []);
      const sessionId = activeSessions[0];
      if (!sessionId) return sendJson(res, 400, { error: 'No active WhatsApp session found' });
      await upsertReminder({
        sessionId,
        chatJid: target,
        message,
        runAt,
        tagAll,
      });
      return sendJson(res, 200, { ok: true, target, runAt: runAt.toISOString(), tagAll });
    }

    if (req.method === 'POST' && url.pathname === '/api/setting') {
      if (!(await isDashboardAuthed(req))) return sendJson(res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const key = String(body.key || '').trim();
      const target = String(body.target || '').trim() || 'bot';
      if (!key) return sendJson(res, 400, { error: 'Missing setting key' });
      const matched = CONTROL_CATALOG.find((item) => item.key === key);
      if (!matched) return sendJson(res, 400, { error: 'Unknown setting key' });
      const value = matched.kind === 'mode' ? String(body.value || 'public') : Boolean(body.value);
      setSetting(target, key, value);
      return sendJson(res, 200, { ok: true, target, key, value });
    }

    if (req.method === 'GET') {
      const page = renderPage(url);
      if (page) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(page);
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`[web] VOID MD dashboard running on http://localhost:${PORT}`);
});
