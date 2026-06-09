require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { BufferJSON } = require('@whiskeysockets/baileys');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || undefined;

let connectPromise = null;

const SettingSchema = new mongoose.Schema(
  {
    jid: { type: String, required: true, unique: true, index: true },
    data: { type: String, default: '{}' },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

const SessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    jid: { type: String, default: '' },
    number: { type: String, default: '' },
    status: { type: String, default: 'active', index: true },
    pairingCode: { type: String, default: '' },
    pairingAt: { type: Date },
    lastConnectedAt: { type: Date },
    lastDisconnect: { type: String, default: '' },
    deleteReason: { type: String, default: '' },
    credsUpdatedAt: { type: Date },
    updatedAt: { type: Date, default: Date.now },
    deletedAt: { type: Date },
  },
  { versionKey: false }
);

const SessionFileSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    filePath: { type: String, required: true },
    contentBase64: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
SessionFileSchema.index({ sessionId: 1, filePath: 1 }, { unique: true });

const ReminderSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    chatJid: { type: String, required: true, index: true },
    message: { type: String, required: true },
    runAt: { type: Date, required: true, index: true },
    tagAll: { type: Boolean, default: false },
    status: { type: String, default: 'pending', index: true },
    createdAt: { type: Date, default: Date.now },
    sentAt: { type: Date },
  },
  { versionKey: false }
);

const WebSessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    userAgent: { type: String, default: '' },
  },
  { versionKey: false }
);

const Setting = mongoose.models.VoidSetting || mongoose.model('VoidSetting', SettingSchema);
const Session = mongoose.models.VoidSession || mongoose.model('VoidSession', SessionSchema);
const SessionFile = mongoose.models.VoidSessionFile || mongoose.model('VoidSessionFile', SessionFileSchema);
const Reminder = mongoose.models.VoidReminder || mongoose.model('VoidReminder', ReminderSchema);
const WebSession = mongoose.models.VoidWebSession || mongoose.model('VoidWebSession', WebSessionSchema);

function serialize(value) {
  return JSON.stringify(value, BufferJSON.replacer);
}

function deserialize(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value, BufferJSON.reviver);
  } catch {
    return fallback;
  }
}

async function connectMongo() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectPromise) return connectPromise;

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is missing. Set it to your MongoDB Atlas connection string.');
  }

  connectPromise = mongoose.connect(MONGODB_URI, {
    dbName: MONGODB_DB,
    autoIndex: true,
    serverSelectionTimeoutMS: 15000,
  });

  try {
    await connectPromise;
    return mongoose.connection;
  } finally {
    connectPromise = null;
  }
}

async function ensureConnected() {
  await connectMongo();
}

async function loadSettingsSnapshot() {
  await ensureConnected();
  const docs = await Setting.find().lean();
  const snapshot = {};
  for (const doc of docs) {
    snapshot[doc.jid] = deserialize(doc.data, {});
  }
  return snapshot;
}

async function upsertSettingDoc(jid, data) {
  await ensureConnected();
  await Setting.updateOne(
    { jid },
    { $set: { data: serialize(data), updatedAt: new Date() } },
    { upsert: true }
  );
  return data;
}

async function getSettingDoc(jid) {
  await ensureConnected();
  const doc = await Setting.findOne({ jid }).lean();
  return deserialize(doc?.data, {});
}

async function deleteSettingDoc(jid) {
  await ensureConnected();
  await Setting.deleteOne({ jid });
}

async function loadSessionIds({ status = 'active' } = {}) {
  await ensureConnected();
  const query = status ? { status } : {};
  const docs = await Session.find(query).sort({ updatedAt: -1 }).lean();
  return docs.map((doc) => doc.sessionId);
}

async function getSessionDoc(sessionId) {
  await ensureConnected();
  return Session.findOne({ sessionId }).lean();
}

async function upsertSessionMeta(sessionId, patch = {}) {
  await ensureConnected();
  const set = { ...patch, updatedAt: new Date() };
  const insertSet = { createdAt: new Date() };
  if (!Object.prototype.hasOwnProperty.call(patch, 'status')) {
    insertSet.status = 'active';
  }
  await Session.updateOne(
    { sessionId },
    { $set: set, $setOnInsert: insertSet },
    { upsert: true }
  );
}

async function touchSession(sessionId, patch = {}) {
  await upsertSessionMeta(sessionId, patch);
}

async function setSessionCreds(sessionId, creds) {
  await upsertSessionMeta(sessionId, {
    creds: serialize(creds),
    credsUpdatedAt: new Date(),
    status: 'active',
  });
}

async function getSessionCreds(sessionId) {
  await ensureConnected();
  const doc = await Session.findOne({ sessionId }).lean();
  return deserialize(doc?.creds, null);
}

async function setSessionFile(sessionId, filePath, buffer) {
  await ensureConnected();
  await SessionFile.updateOne(
    { sessionId, filePath },
    {
      $set: {
        contentBase64: Buffer.from(buffer).toString('base64'),
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

async function syncSessionFolderToMongo(sessionId, folderPath) {
  await ensureConnected();
  const files = [];

  const walk = (dir, base = dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, base);
      } else {
        files.push({
          filePath: path.relative(base, fullPath).replace(/\\/g, '/'),
          buffer: fs.readFileSync(fullPath),
        });
      }
    }
  };

  walk(folderPath);

  const seen = [];
  for (const file of files) {
    seen.push(file.filePath);
    await setSessionFile(sessionId, file.filePath, file.buffer);
  }

  await SessionFile.deleteMany({
    sessionId,
    filePath: { $nin: seen.length ? seen : ['__none__'] },
  });

  await touchSession(sessionId, { status: 'active' });
}

async function restoreSessionFolderFromMongo(sessionId, folderPath) {
  await ensureConnected();
  const docs = await SessionFile.find({ sessionId }).lean();
  if (!docs.length) return false;

  fs.mkdirSync(folderPath, { recursive: true });
  for (const doc of docs) {
    const target = path.join(folderPath, doc.filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(doc.contentBase64 || '', 'base64'));
  }
  return true;
}

async function deleteSessionArtifacts(sessionId, reason = '') {
  await ensureConnected();
  await Promise.all([
    Session.deleteOne({ sessionId }),
    SessionFile.deleteMany({ sessionId }),
    Reminder.deleteMany({ sessionId }),
  ]);
  if (reason) return;
}

async function markSessionDisconnected(sessionId, reason = '') {
  await ensureConnected();
  await Session.updateOne(
    { sessionId },
    {
      $set: {
        status: 'disconnected',
        lastDisconnect: reason,
        updatedAt: new Date(),
      },
    }
  );
}

async function markSessionLoggedOut(sessionId, reason = 'logged_out') {
  await ensureConnected();
  await Session.updateOne(
    { sessionId },
    {
      $set: {
        status: 'deleted',
        deleteReason: reason,
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
  await deleteSessionArtifacts(sessionId, reason);
}

async function upsertReminder(reminder) {
  await ensureConnected();
  return Reminder.create({
    sessionId: reminder.sessionId,
    chatJid: reminder.chatJid,
    message: reminder.message,
    runAt: reminder.runAt,
    tagAll: Boolean(reminder.tagAll),
    status: reminder.status || 'pending',
    createdAt: reminder.createdAt || new Date(),
  });
}

async function listPendingReminders(sessionId) {
  await ensureConnected();
  return Reminder.find({
    sessionId,
    status: 'pending',
  }).sort({ runAt: 1 }).lean();
}

async function markReminderSent(reminderId) {
  await ensureConnected();
  await Reminder.updateOne(
    { _id: reminderId },
    { $set: { status: 'sent', sentAt: new Date() } }
  );
}

async function removeReminder(reminderId) {
  await ensureConnected();
  await Reminder.deleteOne({ _id: reminderId });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createWebSession(token, { expiresAt, userAgent = '' } = {}) {
  await ensureConnected();
  const tokenHash = hashToken(token);
  await WebSession.updateOne(
    { tokenHash },
    {
      $set: {
        lastUsedAt: new Date(),
        expiresAt: expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
  return tokenHash;
}

async function validateWebSession(token) {
  await ensureConnected();
  const tokenHash = hashToken(token);
  const doc = await WebSession.findOne({ tokenHash }).lean();
  if (!doc) return false;
  if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
    await WebSession.deleteOne({ tokenHash });
    return false;
  }
  await WebSession.updateOne({ tokenHash }, { $set: { lastUsedAt: new Date() } });
  return true;
}

async function destroyWebSession(token) {
  await ensureConnected();
  await WebSession.deleteOne({ tokenHash: hashToken(token) });
}

function getSessionFolder(sessionId) {
  return path.join(__dirname, '..', 'richstore', 'pairing', sessionId);
}

module.exports = {
  connectMongo,
  loadSettingsSnapshot,
  upsertSettingDoc,
  getSettingDoc,
  deleteSettingDoc,
  loadSessionIds,
  getSessionDoc,
  upsertSessionMeta,
  touchSession,
  setSessionCreds,
  getSessionCreds,
  setSessionFile,
  syncSessionFolderToMongo,
  restoreSessionFolderFromMongo,
  deleteSessionArtifacts,
  markSessionDisconnected,
  markSessionLoggedOut,
  upsertReminder,
  listPendingReminders,
  markReminderSent,
  removeReminder,
  createWebSession,
  validateWebSession,
  destroyWebSession,
  getSessionFolder,
  serialize,
  deserialize,
};
