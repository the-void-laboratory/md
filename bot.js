require('./setting/config')
const fs = require('fs');
const {
    Telegraf,
    Context,
    Markup
} = require('telegraf')
const {
    message,
    editedMessage,
    channelPost,
    editedChannelPost,
    callbackQuery
} = require("telegraf/filters");
const path = require('path');
const os = require('os')
const yts = require('yt-search');
const { ytdl } = require('./allfunc/scrape-ytdl');
const startpairing = require('./pair');
const { getSessionDoc, loadSessionIds, deleteSessionArtifacts, getSessionFolder, restoreSessionFolderFromMongo } = require('./database/mongo');
const { BOT_TOKEN } = require('./token');
    const adminFilePath = './database/admintele.json';
const bannedPath = './richstore/pairing/banned.json';
// Helper to format runtime duration
const ITEMS_PER_PAGE = 10;
const pagedListPairs = {}; // In-memory cache for each admin
// Track when bot started
const botStartTime = Date.now();
const { 
  default: baileys, proto, jidNormalizedUser, generateWAMessage, 
  generateWAMessageFromContent, getContentType, prepareWAMessageMedia 
} = require("@whiskeysockets/baileys");
const { makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const {
  downloadContentFromMessage, emitGroupParticipantsUpdate, emitGroupUpdate, 
  generateWAMessageContent, makeInMemoryStore, MediaType, areJidsSameUser, 
  WAMessageStatus, downloadAndSaveMediaMessage, AuthenticationState, 
  GroupMetadata, initInMemoryKeyStore, MiscMessageGenerationOptions, 
  useSingleFileAuthState, BufferJSON, WAMessageProto, MessageOptions, 
  WAFlag, WANode, WAMetric, ChatModification, MessageTypeProto, 
  WALocationMessage, WAContextInfo, WAGroupMetadata, ProxyAgent, 
  waChatKey, MimetypeMap, MediaPathMap, WAContactMessage, 
  WAContactsArrayMessage, WAGroupInviteMessage, WATextMessage, 
  WAMessageContent, WAMessage, BaileysError, WA_MESSAGE_STATUS_TYPE, 
  MediariyuInfo, URL_REGEX, WAUrlInfo, WA_DEFAULT_EPHEMERAL, 
  WAMediaUpload, mentionedJid, processTime, Browser, MessageType, 
  Presence, WA_MESSAGE_STUB_TYPES, Mimetype, relayWAMessage, Browsers, 
  GroupSettingChange, DisriyuectReason, WASocket, getStream, WAProto, 
  isBaileys, AnyMessageContent, fetchLatestBaileysVersion, 
  templateMessage, InteractiveMessage, Header 
} = require("@whiskeysockets/baileys");

// Check if adminID.json exists, if not, create it with your ID
if (!fs.existsSync(adminFilePath)) {
  const defaultAdmin = [String(process.env.OWNER_ID || '7828164131')]; // fallback if OWNER_ID is not set
  fs.writeFileSync(adminFilePath, JSON.stringify(defaultAdmin, null, 2));
}
// Handle listpair pagination

const userStore = './richstore/pairing/users.json';

function trackUser(id) {
  const users = JSON.parse(fs.readFileSync(userStore));
  if (!users.includes(id)) {
    users.push(id);
    fs.writeFileSync(userStore, JSON.stringify(users, null, 2));
  }
}
const adminIDs = JSON.parse(fs.readFileSync(adminFilePath, 'utf8'));
const bot = new Telegraf(BOT_TOKEN);
const premium_file = './premium.json';
let premiumUsers = [];

const REQUIRED_JOINS = [
  { username: '@voidtech2', label: 'Channel', url: 'https://t.me/voidtech2' },
  { username: '@thevoidslab', label: 'Channel', url: 'https://t.me/thevoidslab' },
  { username: '@anaspixelzupdates', label: 'Channel', url: 'https://t.me/anaspixelzupdates' },
  { username: '@the_voidchat', label: 'Group', url: 'https://t.me/the_voidchat' },
  { username: '@void_support_01', label: 'Channel', url: 'https://t.me/void_support_01' },
];

async function getJoinStatus(ctx, userId, chatIdentifier) {
  const chat = await ctx.telegram.getChat(chatIdentifier);
  const member = await ctx.telegram.getChatMember(chatIdentifier, userId);

  return {
    ok: !['left', 'kicked'].includes(member.status),
    status: member.status,
    title: chat.title || chat.username || chatIdentifier,
    id: chat.id,
    username: chat.username ? `@${chat.username}` : chatIdentifier,
  };
}

async function checkRequiredJoins(ctx, userId) {
  const results = [];

  for (const item of REQUIRED_JOINS) {
    try {
      const result = await getJoinStatus(ctx, userId, item.username);
      results.push({ ...item, ...result });
    } catch (error) {
      console.error(`Join check failed for ${item.username}:`, error?.response?.description || error.message || error);
      results.push({
        ...item,
        ok: false,
        status: 'error',
        title: item.username,
        id: 'unknown',
        username: item.username,
      });
    }
  }

  return results;
}

function buildJoinButtons() {
  return REQUIRED_JOINS.map((item) => ([{ text: `Join ${item.label}`, url: item.url }]));
}

try {
  if (fs.existsSync(premium_file)) {
    premiumUsers = JSON.parse(fs.readFileSync(premium_file, 'utf-8'));
  } else {
    fs.writeFileSync(premium_file, JSON.stringify([]));
  }
} catch (error) {
  console.error('Failed to load premium users:', error);
}
const userStates = {};
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function getPushName(ctx) {
  return ctx.from.first_name || ctx.from.username || "User";
}
function sendListPairPage(ctx, userID, pageIndex) {
  const pairedDevices = pagedListPairs[userID] || [];
  const totalPages = Math.max(1, Math.ceil(pairedDevices.length / ITEMS_PER_PAGE));

  // Clamp pageIndex to valid range
  pageIndex = Math.min(Math.max(pageIndex, 0), totalPages - 1);

  const start = pageIndex * ITEMS_PER_PAGE;
  const currentPage = pairedDevices.slice(start, start + ITEMS_PER_PAGE);

  const pageText = currentPage.length
    ? currentPage.map((id, i) => `*${start + i + 1}.* \`ID:\` ${id}`).join('\n')
    : "_No paired devices found._";

  const navButtons = [];
  if (pageIndex > 0) navButtons.push({ text: '⬅️ Back', callback_data: `listpair_page_${pageIndex - 1}` });
  if (pageIndex < totalPages - 1) navButtons.push({ text: '➡️ Next', callback_data: `listpair_page_${pageIndex + 1}` });

  const text = `*Paired Bots (Page ${pageIndex + 1}/${totalPages}):*\n\n${pageText}`;

  // ✅ Try editing the existing message, fallback to sending new
  ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: navButtons.length ? [navButtons] : [] }
  }).catch(() => {
    ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: navButtons.length ? [navButtons] : [] }
    });
  });
}
function sendDelPairPage(ctx, userID, pageIndex) {
  const pairedDevices = pagedListPairs[userID] || [];
  const totalPages = Math.max(1, Math.ceil(pairedDevices.length / ITEMS_PER_PAGE));

  // Clamp pageIndex to valid range
  pageIndex = Math.min(Math.max(pageIndex, 0), totalPages - 1);

  const start = pageIndex * ITEMS_PER_PAGE;
  const currentPage = pairedDevices.slice(start, start + ITEMS_PER_PAGE);

  const keyboard = currentPage.map(id => [
    { text: `🗑️ ${id}`, callback_data: `delpair_${id}` }
  ]);

  const navButtons = [];
  if (pageIndex > 0) navButtons.push({ text: '⬅️ Back', callback_data: `delpair_page_${pageIndex - 1}` });
  if (pageIndex < totalPages - 1) navButtons.push({ text: '➡️ Next', callback_data: `delpair_page_${pageIndex + 1}` });

  if (navButtons.length) keyboard.push(navButtons);

  const text = pairedDevices.length
    ? `Delete Paired Devices (Page ${pageIndex + 1}/${totalPages}):\n\nTap a device ID to delete.`
    : "_No paired devices found._";

  ctx.deleteMessage().catch(() => {});
  ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}
function formatRuntime(seconds) {
  const pad = (s) => (s < 10 ? '0' + s : s);
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`;
}
bot.command('runtime', async (ctx) => {
  const uptime = Math.floor((Date.now() - botStartTime) / 1000);
  ctx.reply(` VOIDɪs ᴏɴʟɪɴᴇ ғᴏʀ *${formatRuntime(uptime)}*`, {
    parse_mode: 'Markdown'
  });
});
bot.start((ctx) => {
  const userId = ctx.from.id;
  trackUser(userId); // Track user for broadcast

ctx.reply('ᴄʟɪᴄᴋ ᴛʜᴇ ʙᴜᴛᴛᴏɴ ʙᴇʟᴏᴡ ᴛᴏ sᴛᴀʀᴛ ᴛʜᴇ VOID MD', {
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'sᴛᴀʀᴛ  VOID ᴍᴅ', callback_data: 'start_bot' }
      ]
    ]
  }
});
});
bot.action('start_bot', async (ctx) => {
  const pushname = getPushName(ctx);
  const photoUrl = 'https://files.catbox.moe/xzvd35.jpg';
  const captionText =`
╭━━━━━━━━━━━━━━━╮
*│* 🤖 ʙᴏᴛ ɪɴғᴏ
╰━━━━━━━━━━━━━━━╯
*│* ✦ ɴᴀᴍᴇ    : VOID MD
*│* ✦ ᴅᴇᴠ     : 𓄂𓆩 𝙇𝙊𝙍𝘿 𝙈𝙍.���� 𓆪 | 𝘿𝙀𝙑 ⍣⃝
*│* ✦ ᴠᴇʀsɪᴏɴ : 2.0.0
*│* ✦ sᴛᴀᴛᴜs  : ᴏɴʟɪɴᴇ ✅
*│* ✦ ᴘʟᴀᴛғᴏʀᴍ: ᴛᴇʟᴇɢʀᴀᴍ
*│* ✦ ᴘʀᴇғɪx  : /
│
 
╰━━━━━━━━━━━━━━━╯

╭━━━━〘 ⚔ 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 ⚔ 〙━━━━╮
*│*  ✧ /connect   ─ Pair device
*│*  ✧ /delpair   ─ Remove pair
*│*  ✧ /listpair  ─ View pairs
╰━━━━━━━━━━━━━━━━━━━━━━━━╯



**ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𓄂𓆩 𝙇𝙊𝙍𝘿 𝙈𝙍.���� 𓆪 | 𝘿𝙀𝙑 ⍣⃝**`;
    
  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.url('ɢʀᴏᴜᴘ', 'https://t.me/the_voidchat'),
      Markup.button.url('ᴄʜᴀɴɴᴇʟ', 'https://t.me/voidtech2')
      
    ]
  ]);

  try {
    await ctx.sendChatAction('upload_photo');
    await ctx.replyWithPhoto(photoUrl, {
      caption: captionText,
      parse_mode: 'HTML',
      ...buttons
    });
  } catch (err) {
    console.error('Image failed to load, sending fallback text:', err);
    await ctx.reply(`${captionText}`, {
      parse_mode: 'HTML',
      ...buttons
    });
  }
});
bot.command('connect', async (ctx) => {
  try {
    const userId = ctx.from.id;

    const joinResults = await checkRequiredJoins(ctx, userId);
    let joinedAllChannels = joinResults.every((item) => item.ok);

    if (!joinedAllChannels) {
      const failedList = joinResults
        .filter((item) => !item.ok)
        .map((item) => `${item.username} (${item.title}) - ${item.status}${item.id !== 'unknown' ? `, id: ${item.id}` : ''}`)
        .join('\n');

      console.log('Join gate blocked user', {
        userId,
        failedList,
      });

      return ctx.reply(
        `Join all required Telegram channels/groups before pairing.\n\n${joinResults
          .map((item) => `- ${item.label}: ${item.title}\n  Link: ${item.url}\n  ID: ${item.id}\n  Status: ${item.status}`)
          .join('\n\n')}`,
        {
          reply_markup: {
            inline_keyboard: [
              ...buildJoinButtons(),
              [{ text: 'ᴄᴏɴғɪʀᴍ', callback_data: 'check_join' }]
            ]
          }
        }
      );
    }

    const text = ctx.message.text.split(' ')[1];
    if (!text) {
      return ctx.reply('To proceed plz enter a phone number in the format: /connect 234xxxxxxxx', { parse_mode: 'Markdown' });
    }

    if (/[a-z]/i.test(text)) {
      return ctx.reply('Please enter a valid phone number.');
    }

    if (!/^\d{7,15}(\|\d{1,10})?$/.test(text)) {
      return ctx.reply('Enter number in this format: 234xxxxxx(numbers only, no symbols or letters❌)', { parse_mode: 'Markdown' });
    }

    if (text.startsWith('0')) {
      return ctx.reply('Please use a different number format.');
    }

    const target = text.split("|")[0];
    const Xreturn = ctx.message.reply_to_message
      ? ctx.message.reply_to_message.from.id
      : target.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

    if (!Xreturn) {
      return ctx.reply("This number is not registered on WhatsApp");
    }

    const existingSession = await getSessionDoc(Xreturn).catch(() => null);
    if (existingSession && existingSession.status !== 'deleted') {
      return ctx.reply('This WhatsApp account is already paired. Use the dashboard to manage the existing session.');
    }

    const countryCode = text.slice(0, 3);
    const prefixxx = text.slice(0, 1);
    if (["252", "201", ".", "0"].includes(countryCode) || prefixxx === "0") {
      return ctx.reply("Sorry, numbers with this country code or prefix are not supported.");
    }
    
const pairedUsersFromJson = await loadSessionIds({ status: 'active' });
if (pairedUsersFromJson.length >= 70) {
  return ctx.reply(`**Pairing Limit Reached Contact The owner to create more servers 📡**`);
}
    const startpairing = require('./pair.js');
    await startpairing(Xreturn);
    await sleep(4000);

    const cuObj = await getSessionDoc(Xreturn).catch(() => null);

    ctx.reply(
      ` 
╭━━━━━━━━━━━━━━━━━━━━╮
*│* VOID ʀᴇǫᴜᴇsᴛ
╰━━━━━━━━━━━━━━━━━━━━╯
*│*  ✦ sᴛᴀᴛᴜs    : ᴘᴇɴᴅɪɴɢ ⏳
*│*  ✦ ɴᴜᴍʙᴇʀ    : ${target}
*│*  ✦ ᴄᴏᴅᴇ      : ${cuObj?.pairingCode || ''}
*│*  ✦ ᴇxᴘɪʀᴇs   : 𝟸 ᴍɪɴᴜᴛᴇs
╰━━━━━━━━━━━━━━━━━━━━╯

**ᴘᴏᴡᴇʀᴇᴅ ʙʏ LORD VOID**`,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ᴄʜᴀɴɴᴇʟ', url: 'https://t.me/thevoidslab' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Error in pair command:', error);
    ctx.reply('An error occurred while processing your request.');
  }
});
bot.action('check_join', async (ctx) => {
  const userId = ctx.from.id;
  const joinResults = await checkRequiredJoins(ctx, userId);
  const joinedAllChannels = joinResults.every((item) => item.ok);

  if (joinedAllChannels) {
    ctx.reply('You’ve successfully joined our channel 🎉.');
  } else {
    const failedList = joinResults
      .filter((item) => !item.ok)
      .map((item) => `${item.username} (${item.title}) - ${item.status}${item.id !== 'unknown' ? `, id: ${item.id}` : ''}`)
      .join('\n');

    console.log('Check join failed', {
      userId,
      failedList,
    });

    ctx.answerCbQuery(`You haven't joined yet. Missing:\n${failedList || 'Unknown channel status'}`, { show_alert: true });
  }
});
bot.command('listpair', async (ctx) => {
  const userID = ctx.from.id.toString();

  if (!adminIDs.includes(userID)) {
    return ctx.reply(`Unauthorized access.This command is restricted.`);
  }

  const pairedDevices = await loadSessionIds({ status: 'active' });

  if (pairedDevices.length === 0) return ctx.reply('No paired devices found.');

  pagedListPairs[userID] = pairedDevices;
  sendListPairPage(ctx, userID, 0);
});
bot.command('deluser', async (ctx) => {
  const userID = ctx.from.id.toString();

  if (!adminIDs.includes(userID)) {
    return ctx.reply(`Unauthorized access.This command is restricted.`);
  }

  const pairedDevices = await loadSessionIds({ status: 'active' });

  if (pairedDevices.length === 0) return ctx.reply('No paired devices found.');

  pagedListPairs[userID] = pairedDevices;
  sendDelPairPage(ctx, userID, 0);
});
bot.command('broadcast', async (ctx) => {
  const senderId = ctx.from.id;
  const message = ctx.message.text.split(' ').slice(1).join(' ');

  if (!adminIDs.includes(senderId.toString())) {
    return ctx.reply('Unauthorized access.This command is restricted.');
  }

  if (!message) {
    return ctx.reply('Please provide a message to broadcast.\nUsage: /broadcast Hello users!');
  }

  const users = JSON.parse(fs.readFileSync('./richstore/pairing/users.json'));

  let success = 0;
  let failed = 0;

  for (const userId of users) {
    try {
      await ctx.telegram.sendMessage(userId, `Broadcast Message: \n\n${message}`, {
        parse_mode: 'Markdown'
      });
      success++;
    } catch {
      failed++;
    }
  }

  ctx.reply(`Broadcast complete.\n\nSuccess: ${success}\nFailed: ${failed}`);
});

bot.command('xreport', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    return ctx.reply('Usage: /xreport 234xxxxxxxx');
  }

  const targetNumber = args[0].replace(/\D/g, '');
  if (!targetNumber) {
    return ctx.reply('Invalid number. Use digits only.');
  }

  const targetJid = jidNormalizedUser(`${targetNumber}@s.whatsapp.net`);
  const sessionIds = await loadSessionIds({ status: 'active' });
  const sessions = sessionIds.map((sessionId) => getSessionFolder(sessionId));

  if (sessions.length === 0) {
    return ctx.reply('No active WhatsApp sessions to perform report.');
  }

  ctx.reply(
    `🚨 Starting *mass-report* on +${targetNumber} using ${sessions.length} paired bots...`,
    { parse_mode: 'Markdown' }
  );

  for (const sessionPath of sessions) {
    try {
      const sessionId = path.basename(sessionPath);
      await restoreSessionFolderFromMongo(sessionId, sessionPath).catch(() => {});
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      const rich = makeWASocket({ auth: state });
      rich.ev.on('creds.update', saveCreds);

      for (let i = 0; i < 30; i++) {
        try {
          await rich.ws.sendNode({
            tag: 'iq',
            attrs: { to: 's.whatsapp.net', type: 'set', xmlns: 'w:report' },
            content: [
              {
                tag: 'report',
                attrs: { to: targetJid, type: 'spam', id: rich.generateMessageTag() },
                content: []
              }
            ]
          });
          console.log(`✅ Report ${i + 1} sent from ${path.basename(sessionPath)}`);
          await sleep(2000);
        } catch (err) {
          console.error(`❌ Report attempt ${i + 1} failed for ${path.basename(sessionPath)}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`❌ Error with session ${path.basename(sessionPath)}:`, err.message);
    }
  }

  ctx.reply(
    `✅ Finished sending reports on *${targetNumber}*`,
    { parse_mode: 'Markdown' }
  );
});
bot.command('delpair', async (ctx) => {
  const text = ctx.message.text.trim();
  const args = text.split(' ').slice(1);

  if (args.length === 0) {
    return ctx.reply('To proceed plz enter a phone number in the format: /delpair 234xxxxxxxx', { parse_mode: 'Markdown' });
  }

  const inputNumber = args[0].replace(/\D/g, ''); // Remove non-numeric characters
  const jidSuffix = `${inputNumber}@s.whatsapp.net`;

  const pairedDevices = await loadSessionIds({ status: 'active' });
  const matched = pairedDevices.find(name => String(name).endsWith(jidSuffix));

  if (!matched) {
    return ctx.reply(`No paired device found for number ${inputNumber}`, { parse_mode: 'Markdown' });
  }

  await deleteSessionArtifacts(matched).catch(() => {});
  fs.rmSync(getSessionFolder(matched), { recursive: true, force: true });

  ctx.reply(
    `╔══════════════════════╗
║ 🤖 VOID
╚══════════════════════╝

✅ ᴘᴀɪʀᴇᴅ ᴜꜱᴇʀ ʀᴇᴍᴏᴠᴇᴅ
────────────────────────
📱 ᴘʜᴏɴᴇ : \`${inputNumber}\`
🆔 ɪᴅ    : \`${matched}\`
────────────────────────
**ᴘᴏᴡᴇʀᴇᴅ ʙʏ LORD VOID`,
    { parse_mode: 'Markdown' }
  );
});
bot.on('textffft', async (ctx) => {
    const userId = ctx.from.id;

    if (userStates[userId] === 'waiting_for_song') {
        const text = ctx.message.text;

        try {
            ctx.reply('🔒 looking for...');
            const search = await yts(text);
            const telaso = search.all[0].url;
            const response = await ytdl(telaso);
            const puki = response.data.mp3;

            await ctx.replyWithAudio({ url: puki }, {
                caption: `Title: ${search.all[0].title}\nDuration: ${search.all[0].timestamp}`,
            });
            ctx.reply('🔓 Selesai!');
        } catch (error) {
            console.error(error);
            ctx.reply('An error occurred while downloading the song, please try again later.');
        }

        delete userStates[userId];
    }
});

bot.launch()
    .then(() => console.log('The bot is running successfully'))
    .catch(err => console.error('Error while running bot:', err));

module.exports = bot;
