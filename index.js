const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadContentFromMessage,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const sharp = require("sharp");
const { createCanvas } = require("canvas");

// Function to wrap text
function wrapText(ctx, text, maxWidth) {
  const tokens = text.split(/(\s+)/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const token of tokens) {
    const testLine = currentLine + token;
    const lineWidth = ctx.measureText(testLine).width;

    if (lineWidth > maxWidth && currentLine.trim().length > 0) {
      lines.push(currentLine.trimEnd());
      currentLine = token.trimStart();
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine.trim().length > 0) lines.push(currentLine.trimEnd());
  return lines;
}

function buildLines(ctx, text, maxWidth) {
  const rawLines = text.split("|").map((line) => line.trim());
  const lines = [];

  for (const rawLine of rawLines) {
    if (!rawLine) {
      lines.push("");
      continue;
    }

    const wrapped = wrapText(ctx, rawLine, maxWidth);
    if (wrapped.length === 0) {
      lines.push("");
    } else {
      lines.push(...wrapped);
    }
  }

  return lines;
}

function createNoiseBuffer(width, height, alpha) {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const data = Buffer.alloc(width * height * 4);
  const a = Math.round(clampedAlpha * 255);

  for (let i = 0; i < data.length; i += 4) {
    const value = Math.floor(Math.random() * 256);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = a;
  }

  return data;
}

function fitTextToBox(ctx, text, maxWidth, maxHeight) {
  let fontSize = 112;
  let lines = [];
  let lineHeight = 0;
  let totalHeight = 0;

  while (fontSize >= 36) {
    ctx.font = `${fontSize}px Arial, sans-serif`;
    lines = buildLines(ctx, text, maxWidth);
    lineHeight = Math.round(fontSize * 0.98);
    totalHeight = lines.length * lineHeight;

    if (totalHeight <= maxHeight) {
      return { fontSize, lines, lineHeight, totalHeight };
    }

    fontSize -= 2;
  }

  ctx.font = "36px Arial, sans-serif";
  lines = buildLines(ctx, text, maxWidth);
  lineHeight = Math.round(36 * 0.98);
  totalHeight = lines.length * lineHeight;

  return { fontSize: 36, lines, lineHeight, totalHeight };
}

// Cooldown storage: Map of sender JID to last timestamp
const stickerCooldowns = new Map();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
  });

  // HANDLE CONNECTION & QR
  sock.ev.on("connection.update", (update) => {
    const { connection, qr } = update;

    if (qr) {
      console.log("📲 Scan QR ini pakai WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Bot WhatsApp berhasil terhubung!");
    }

    if (connection === "close") {
      console.log("❌ Koneksi terputus, reconnecting...");
      startBot();
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // HANDLE MESSAGE
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from; // Sender JID (for groups or private)
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text;

    console.log("Received message:", text); // Debug log    console.log('Message type:', Object.keys(msg.message)); // Debug log
    const menuText = [
      "🎉 MENU BOT WA 🎉",
      "",
      "🤖 Perintah Bot:",
      "",
      "✨ !menu",
      "📋 Lihat semua fitur bot",
      "",
      "✨ !stiker",
      "🖼️ Kirim gambar + caption !stiker → jadi stiker",
      "",
      "✨ !brat <teks>",
      "✏️ Ubah teks jadi stiker keren",
    ].join("\n");

    if (text === "!menu") {
      await sock.sendMessage(from, { text: menuText });
      return;
    }
    // Check if message is an image with caption "!sticker"
    if (
      msg.message.imageMessage &&
      msg.message.imageMessage.caption === "!sticker"
    ) {
      // Check cooldown
      if (stickerCooldowns.has(sender)) {
        const lastTime = stickerCooldowns.get(sender);
        if (Date.now() - lastTime < 20000) {
          await sock.sendMessage(from, {
            text: "⏳ Tunggu sebentar, kamu sedang cooldown",
          });
          return;
        }
      }

      try {
        const stream = await downloadContentFromMessage(
          msg.message.imageMessage,
          "image"
        );

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }

        // Resize to 512x512, maintaining aspect ratio, fit cover
        const sticker = await sharp(buffer)
          .resize(512, 512, {
            fit: "cover",
            position: "center",
          })
          .webp()
          .toBuffer();

        await sock.sendMessage(from, {
          sticker,
          packname: "Bot Sticker",
          author: "Bot",
        });
        console.log("Sticker sent successfully");
        // Reset cooldown after successful processing
        stickerCooldowns.set(sender, Date.now());
      } catch (error) {
        console.error("Error creating sticker:", error);
        await sock.sendMessage(from, {
          text: "Gagal membuat stiker. Pastikan gambar valid.",
        });
      }
    } else if (text && (text === "!brat" || text.startsWith("!brat "))) {
      const inputText = text.slice(5).trim();
      if (!inputText) {
        await sock.sendMessage(from, {
          text: "Usage: !brat <text>",
        });
        return;
      }

      try {
        const canvas = createCanvas(512, 512);
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, 512, 512);

        const paddingX = 48;
        const paddingY = 40;
        const maxWidth = 512 - paddingX * 2;
        const maxHeight = 512 - paddingY * 2;

        const { fontSize, lines, lineHeight, totalHeight } = fitTextToBox(
          ctx,
          inputText,
          maxWidth,
          maxHeight
        );

        const font = `${fontSize}px Arial, sans-serif`;

        ctx.fillStyle = "#000000";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = font;

        const startY = paddingY + Math.max(0, (maxHeight - totalHeight) / 2);

        lines.forEach((line, index) => {
          ctx.fillText(line, paddingX, startY + index * lineHeight);
        });

        const baseBuffer = canvas.toBuffer("image/png");
        const noise = createNoiseBuffer(512, 512, 0.8);

        const sticker = await sharp(baseBuffer)
          .composite([
            {
              input: noise,
              raw: { width: 512, height: 512, channels: 4 },
              blend: "overlay",
              opacity: 1,
            },
          ])
          .flatten({ background: "#FFFFFF" })
          .resize(96, 96, { kernel: sharp.kernel.nearest })
          .resize(512, 512, { kernel: sharp.kernel.nearest })
          .blur(2)
          .webp({ quality: 20 })
          .toBuffer();

        await sock.sendMessage(from, {
          sticker,
          packname: "Bot Sticker",
          author: "Bot",
        });
        console.log("Text sticker sent successfully");
      } catch (error) {
        console.error("Error creating text sticker:", error);
        await sock.sendMessage(from, {
          text: "Gagal membuat stiker teks.",
        });
      }
    }
  });
}

startBot();
