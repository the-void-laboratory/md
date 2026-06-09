// ====== Flexible Command Handler for Your MD Bot ======

const body = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
if (!body) return; // no message

// Detect prefix automatically
const prefix = body[0]; // first character (., !, /, #, etc.)
const commandBody = body.slice(1).trim(); // remove prefix
const args = commandBody.split(" ");
const cmd = args[0].toLowerCase(); // first word after prefix

switch(cmd) {

    // ▫️ Secret Ghoul Command
    case "ghoul": {
        try {
            const imageUrl = "https://files.catbox.moe/6njl3p.jpg"; // your VOID/scary image
            const text = `
╔═══『 ☠️ G H O U L   A W A K E N S ☠️ 』═══╗
┃
┃  🩸 𝙑𝙊𝙄𝘿 𝙁𝙀𝙀𝘿𝙎 𝙊𝙉 𝙔𝙊𝙐
┃
┃  ⛧ 𝙔𝙊𝙐 𝘼𝙍𝙀 𝙉𝙊𝙒 𝙋𝙊𝙎𝙎𝙀𝙎𝙎𝙀𝘿 ⛧
┃  ⛧ 𝘽𝙔 𝘼 𝙋𝙊𝙒𝙀𝙍 𝙔𝙊𝙐 𝙆𝙉𝙊𝙒 𝙉𝙊𝙏𝙃𝙄𝙉𝙂 𝘼𝘽𝙊𝙐𝙏 ⛧
┃
┃  👁‍🗨 𝙏𝙃𝙀 𝙃𝙐𝙉𝙂𝙀𝙍 𝘽𝙀𝙂𝙄𝙉𝙎...
┃  🩸 𝙀𝙎𝘾𝘼𝙋𝙀 𝙄𝙎 𝙄𝙈𝙋𝙊𝙎𝙎𝙄𝘽𝙇𝙀
┃
╚═══════════════════════════════╝
`;
            // send image 5 times instantly
            for (let i = 0; i < 5; i++) {
                await rich.sendMessage(from, { image: { url: imageUrl }, caption: text }, { quoted: m });
            }
        } catch (e) {
            console.error(e);
            await rich.sendMessage(from, { text: "⚠️ Ghoul power failed..." }, { quoted: m });
        }
    }
    break;

    // ▫️ Add more commands here
}