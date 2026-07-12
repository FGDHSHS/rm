// bot.js - الكود الكامل مع التوكن
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { LowSync, JSONFileSync } = require('lowdb');
const path = require('path');

// ==========================================
// 1. قاعدة البيانات
// ==========================================
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFileSync(dbFile);
const db = new LowSync(adapter);

db.read();
if (!db.data) {
  db.data = { users: {} };
  db.write();
}

function getUser(userId) {
  const id = String(userId);
  if (!db.data.users[id]) {
    db.data.users[id] = {
      points: 7,
      isActive: false,
      referredBy: null,
      referredUsers: [],
    };
    db.write();
  }
  return db.data.users[id];
}

function saveUser(userId, data) {
  db.data.users[String(userId)] = data;
  db.write();
}

// ==========================================
// 2. البوت
// ==========================================
const BOT_TOKEN = '7801607857:AAGMzMe7ioctkDQJxxAVydtsUzf0ZXtiBxI';
const bot = new Telegraf(BOT_TOKEN);

// ==========================================
// 3. الذكاء الاصطناعي
// ==========================================
const AI_BASE_URL = 'https://dsfsdjfc-ddd.hf.space';
const AI_API_KEY = 'my_secret_key_123';

async function sendToAI(message) {
  try {
    const response = await axios.post(
      `${AI_BASE_URL}/chat`,
      { message },
      {
        headers: { 'Content-Type': 'application/json', 'X-API-Key': AI_API_KEY },
        timeout: 30000,
      }
    );
    return response.data.reply || '';
  } catch (error) {
    console.error('AI error:', error.message);
    return null;
  }
}

async function resetAI() {
  try {
    await axios.post(`${AI_BASE_URL}/reset`, null, {
      headers: { 'X-API-Key': AI_API_KEY },
    });
  } catch (e) {}
}

// ==========================================
// 4. الإحالات
// ==========================================
function getReferralLink(userId) {
  return `https://t.me/kr_x20bot?start=ref_${userId}`;
}

// ==========================================
// 5. الأوامر والأزرار
// ==========================================
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const payload = ctx.startPayload;

  // معالجة الإحالة
  if (payload && payload.startsWith('ref_')) {
    const referrerId = payload.replace('ref_', '');
    if (referrerId !== String(userId)) {
      const isNewUser = !db.data.users[String(userId)];
      if (isNewUser) {
        const referrerData = getUser(referrerId);
        if (referrerData && !referrerData.referredUsers.includes(String(userId))) {
          referrerData.points += 1;
          referrerData.referredUsers.push(String(userId));
          saveUser(referrerId, referrerData);
          try {
            await bot.telegram.sendMessage(
              referrerId,
              '🎉 لقد دخل مستخدم جديد عبر رابطك، وتمت إضافة نقطة واحدة إلى رصيدك.'
            );
          } catch (e) {}
          try {
            await ctx.reply('✅ تم تسجيلك عبر رابط صديقك، وقد حصل صديقك على نقطة مكافأة.');
          } catch (e) {}
        }
        const newUser = getUser(userId);
        newUser.referredBy = referrerId;
        saveUser(userId, newUser);
      }
    }
  }

  const userData = getUser(userId);
  await ctx.reply(
    `👋 مرحباً بك في البوت!\nيمكنك التحدث مع الذكاء الاصطناعي بعد الضغط على الزر أدناه.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🗣️ التحدث مع الذكاء الاصطناعي', 'activate_chat')],
    ])
  );
});

bot.action('activate_chat', async (ctx) => {
  const userId = ctx.from.id;
  const userData = getUser(userId);
  userData.isActive = true;
  saveUser(userId, userData);

  await ctx.answerCbQuery('✅ تم التفعيل!');
  await ctx.editMessageText(
    `✅ تم تفعيل وضع المحادثة مع الذكاء الاصطناعي.\nأرسل أي رسالة للبدء.`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(`⭐ النقاط: ${userData.points}`, 'show_points'),
        Markup.button.callback('💰 جمع نقاط', 'collect_points'),
      ],
    ])
  );
});

bot.action('show_points', async (ctx) => {
  const userId = ctx.from.id;
  const userData = getUser(userId);
  await ctx.answerCbQuery(`رصيدك الحالي: ${userData.points} نقطة`, true);
});

bot.action('collect_points', async (ctx) => {
  const userId = ctx.from.id;
  const link = getReferralLink(userId);
  await ctx.answerCbQuery('تم إنشاء رابط الإحالة!');
  await ctx.reply(
    `🔗 شارك هذا الرابط مع أصدقائك:\n${link}\n\nعندما يدخل شخص جديد عبر رابطك ويستخدم البوت لأول مرة، ستحصل على نقطة واحدة.`,
    { disable_web_page_preview: true }
  );
});

// ==========================================
// 6. معالجة الرسائل
// ==========================================
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userData = getUser(userId);

  if (!userData.isActive) {
    await ctx.reply(
      '⚠️ يرجى الضغط على زر "التحدث مع الذكاء الاصطناعي" أولاً.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🗣️ التحدث مع الذكاء الاصطناعي', 'activate_chat')],
      ])
    );
    return;
  }

  if (userData.points <= 0) {
    await ctx.reply(
      '⚠️ رصيد النقاط لديك 0، لا يمكنك إرسال رسائل.\nاستخدم زر "جمع نقاط" للحصول على نقاط جديدة.',
      Markup.inlineKeyboard([
        [Markup.button.callback('💰 جمع نقاط', 'collect_points')],
      ])
    );
    return;
  }

  userData.points -= 1;
  saveUser(userId, userData);

  await ctx.sendChatAction('typing');
  const aiReply = await sendToAI(ctx.message.text);

  if (aiReply === null) {
    userData.points += 1;
    saveUser(userId, userData);
    await ctx.reply('❌ حدث خطأ في الاتصال بالذكاء الاصطناعي، حاول مجدداً.');
    return;
  }

  await ctx.reply(
    aiReply,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(`⭐ النقاط: ${userData.points}`, 'show_points'),
        Markup.button.callback('💰 جمع نقاط', 'collect_points'),
      ],
    ])
  );
});

// ==========================================
// 7. التشغيل
// ==========================================
resetAI().catch(() => {});
bot.launch().then(() => {
  console.log('✅ البوت يعمل...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
