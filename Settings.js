const fs = require('fs');
const path = require('path');
const {
  loadSettingsSnapshot,
  upsertSettingDoc,
} = require('./database/mongo');

const SETTINGS_PATH = path.join(__dirname, 'setting.json');

let settings = {};
let initialized = false;
let initPromise = null;

function loadLocalSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8') || '{}');
    }
  } catch (error) {
    console.error('Failed to read local setting.json', error);
  }
  return {};
}

function saveLocalSettings() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Failed to write local setting.json', error);
  }
}

async function initSettings() {
  if (initialized) return settings;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const dbSettings = await loadSettingsSnapshot();
    const localSettings = loadLocalSettings();
    settings = Object.keys(dbSettings).length ? dbSettings : localSettings;

    if (!Object.keys(dbSettings).length && Object.keys(localSettings).length) {
      for (const [jid, value] of Object.entries(localSettings)) {
        await upsertSettingDoc(jid, value || {});
      }
    }

    initialized = true;
    saveLocalSettings();
    return settings;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

function ensureJid(jid) {
  if (!settings[jid]) settings[jid] = {};
  return settings[jid];
}

function getSetting(jid, key, defaultValue = false) {
  if (!settings[jid]) return defaultValue;
  return settings[jid][key] !== undefined ? settings[jid][key] : defaultValue;
}

function setSetting(jid, key, value) {
  ensureJid(jid)[key] = value;
  saveLocalSettings();

  upsertSettingDoc(jid, settings[jid]).catch((error) => {
    console.error('Failed to persist setting to MongoDB', error);
  });
}

function getAllSettings() {
  return settings;
}

module.exports = {
  initSettings,
  getSetting,
  setSetting,
  getAllSettings,
};
