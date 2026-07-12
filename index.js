require('dotenv').config(); // اختياري، يمكنك حذف هذا السطر إذا لم تستخدم .env
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Database = require('better-sqlite3');

// ---------- الإعدادات ----------
const BOT_TOKEN = '7801607857:AAGMzMe7ioctkDQJxxAVydtsUzf0ZXtiBxI'; // استخدم التوكن الخاص بك
const AI_BASE_URL = 'https://dsfsdjfc-ddd.hf.space';
const AI_API_KEY = 'my_secret_key_123';

// ---------- قاعدة البيانات ----------
const db = new Database('bot_data.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    points INTEGER DEFAULT 0,
    referred_by INTEGER DEFAULT NULL,
    chat_active INTEGER DEFAULT 0,
    control_msg_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// دوال مساعدة للتعامل مع قاعدة البيانات
function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

function createUser(userId, referredBy = null) {
  const stmt = db.prepare(`
    INSERT INTO users (user_id, points, referred_by, chat_active)
    VALUES (?, 7, ?, 0)
  `);
  stmt.run(userId, referredBy);
  return getUser(userId);
}

function updatePoints(userId, delta) {
  const stmt = db.prepare('UPDATE users SET points = points + ? WHERE user_id = ?');
  stmt.run(delta, userId);
}

function setChatActive(userId, active) {
  const stmt = db.prepare('UPDATE users SET chat_active = ? WHERE user_id = ?');
  stmt.run(active ? 1 : 0, userId);
}

function setControlMsgId(userId, msgId) {
  const stmt = db.prepare('UPDATE users SET control_msg_id = ? WHERE user_id = ?');
  stmt.run(msgId, userId);
}

function getControlMsgId(userId) {
  const row = db.prepare('SELECT control_msg_id FROM users WHERE user_id = ?').get(userId);
  return row ? row.control_msg_id : null;
}

function isFirstStart(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM users WHERE user_id = ?').get(userId).count === 0;
}

// ---------- الاتصال بالذكاء الاصطناعي ----------
async function resetAI() {
  try {
    await axios.post(`${AI_BASE_URL}/reset`, {}, { headers: { 'X-API-Key': AI_API_KEY } });
  } catch (e) {
    console.error('AI reset failed:', e.message);
  }
}

async function sendToAI(message) {
  try {
    const response = await axios.post(
      `${AI_BASE_URL}/chat`,
      { message },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': AI_API_KEY,
        },
        timeout: 30000,
      }
    );
    return response.data.reply || '⚠️ لم أستطع فهم الرد.';
  } catch (e) {
    console.error('AI error:', e.message);
    return '❌ حدث خطأ في الاتصال بالذكاء الاصطناعي، حاول مرة أخرى.';
  }
}

// ---------- إنشاء البوت ----------
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let botUsername = '';

// جلب اسم البوت لاستخدامه في روابط الإحالة
bot.getMe().then((me) => {
  botUsername = me.username;
  console.log(`✅ البوت يعمل باسم: @${botUsername}`);
}).catch((e) => {
  console.error('❌ فشل جلب اسم البوت:', e.message);
  botUsername = 'kr_x20bot'; // القيمة الاحتياطية من طلبك
});

// تهيئة الذكاء الاصطناعي
(async () => {
  await resetAI();
  await sendToAI('شخصية خيالية تدعى 😈');
  console.log('🤖 تم تعيين شخصية الذكاء الاصطناعي.');
})();

// ---------- معالج الأوامر ----------

// 1. أمر /start مع دعم الإحالة
bot.onText(/\/start(?:\s+ref_(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const refId = match[1] ? parseInt(match[1]) : null;

  let user = getUser(userId);
  const isNew = !user;

  if (isNew) {
    // معالجة الإحالة
    let referrerId = null;
    if (refId && refId !== userId) {
      const referrer = getUser(refId);
      if (referrer) {
        referrerId = refId;
        // إضافة نقطة للمُحيل
        updatePoints(refId, 1);
        // إشعار المُحيل
        bot.sendMessage(refId, `🎉 لقد دخل مستخدم جديد عبر رابطك، وتمت إضافة نقطة واحدة إلى رصيدك.`);
        // إشعار المستخدم الجديد
        bot.sendMessage(chatId, `تم تسجيلك عبر رابط صديقك، وقد حصل صديقك على نقطة مكافأة.`);
      }
    }
    // إنشاء المستخدم بـ 7 نقاط
    user = createUser(userId, referrerId);
  } else {
    bot.sendMessage(chatId, `👋 أهلاً بك مجدداً! نقاطك: ${user.points}`);
  }

  // زر بدء المحادثة
  const startKeyboard = {
    inline_keyboard: [
      [{ text: '🗣 التحدث مع الذكاء الاصطناعي', callback_data: 'start_chat' }]
    ]
  };
  bot.sendMessage(chatId, '👇 اضغط على الزر لبدء المحادثة مع الذكاء الاصطناعي.', {
    reply_markup: startKeyboard,
  });
});

// 2. معالجة الأزرار (Callback Queries)
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const msgId = callbackQuery.message.message_id;

  await bot.answerCallbackQuery(callbackQuery.id); // لإزالة الانتظار

  const user = getUser(userId);
  if (!user) {
    bot.sendMessage(chatId, '⚠️ يرجى استخدام /start أولاً.');
    return;
  }

  if (data === 'start_chat') {
    // تفعيل المحادثة
    setChatActive(userId, true);

    const points = user.points;
    const controlKeyboard = {
      inline_keyboard: [
        [
          { text: `⭐ النقاط: ${points}`, callback_data: 'show_points' },
          { text: '💰 جمع نقاط', callback_data: 'collect_points' }
        ]
      ]
    };

    const sentMsg = await bot.sendMessage(chatId, '✅ تم تفعيل المحادثة. يمكنك الآن إرسال رسائلك.', {
      reply_markup: controlKeyboard,
    });

    setControlMsgId(userId, sentMsg.message_id);
    // حذف زر البداية السابق (اختياري)
    bot.deleteMessage(chatId, msgId).catch(() => {});

  } else if (data === 'collect_points') {
    // رابط الإحالة
    const refLink = `https://t.me/${botUsername || 'kr_x20bot'}?start=ref_${userId}`;
    bot.sendMessage(chatId, `🔗 شارك هذا الرابط مع أصدقائك:\n${refLink}\n\nكل مستخدم جديد يسجل عبر رابطك يمنحك نقطة إضافية.`);

  } else if (data === 'show_points') {
    const current = getUser(userId).points;
    bot.answerCallbackQuery(callbackQuery.id, { text: `نقاطك الحالية: ${current}`, show_alert: true });
  }
});

// 3. معالجة الرسائل النصية (عند تفعيل المحادثة)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  // تجاهل الأوامر والرسائل غير النصية
  if (!text || text.startsWith('/')) return;

  const user = getUser(userId);
  if (!user) {
    bot.sendMessage(chatId, '⚠️ يرجى استخدام /start أولاً.');
    return;
  }

  // هل المحادثة مفعلة؟
  if (!user.chat_active) {
    bot.sendMessage(chatId, '👆 اضغط على زر "التحدث مع الذكاء الاصطناعي" لبدء المحادثة.');
    return;
  }

  // هل يوجد نقاط؟
  if (user.points <= 0) {
    bot.sendMessage(chatId, '❌ رصيدك من النقاط صفر. اضغط على "جمع نقاط" للحصول على المزيد.');
    return;
  }

  // خصم نقطة
  updatePoints(userId, -1);
  const newPoints = user.points - 1;

  // إظهار مؤشر الكتابة
  await bot.sendChatAction(chatId, 'typing');

  // إرسال إلى الذكاء الاصطناعي
  const reply = await sendToAI(text);

  // إرسال الرد
  await bot.sendMessage(chatId, reply);

  // تحديث زر النقاط في الرسالة الثابتة
  const controlMsgId = getControlMsgId(userId);
  if (controlMsgId) {
    const updatedKeyboard = {
      inline_keyboard: [
        [
          { text: `⭐ النقاط: ${newPoints}`, callback_data: 'show_points' },
          { text: '💰 جمع نقاط', callback_data: 'collect_points' }
        ]
      ]
    };
    bot.editMessageReplyMarkup(updatedKeyboard, {
      chat_id: chatId,
      message_id: controlMsgId,
    }).catch(() => {});
  }
});

// ---------- معالجة الأخطاء ----------
bot.on('error', (error) => {
  console.error('خطأ في البوت:', error);
});

console.log('✅ البوت يعمل الآن...');
