require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const initSqlJs = require('sql.js');
const axios = require('axios');
const fs = require('fs');

// ===================== إعدادات البوت والذكاء الاصطناعي =====================
const BOT_TOKEN = process.env.b || 'YOUR_BOT_TOKEN_HERE';
const AI_BASE_URL = process.env.r || "https://dsfsdjfc-ddd.hf.space";
const AI_API_KEY = process.env.a || "my_secret_key_123";

const bot = new Telegraf(BOT_TOKEN);

// ===================== قاعدة البيانات (sql.js) =====================
let db;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  // نحاول تحميل قاعدة بيانات موجودة أو إنشاء جديدة
  if (fs.existsSync('bot_data.sqlite')) {
    const buffer = fs.readFileSync('bot_data.sqlite');
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // إنشاء الجداول
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    points INTEGER DEFAULT 7,
    referred_by INTEGER,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS referrals (
    referrer_id INTEGER,
    referred_user_id INTEGER UNIQUE,
    claimed BOOLEAN DEFAULT 0,
    PRIMARY KEY (referrer_id, referred_user_id)
  )`);

  // حفظ التغييرات الأولية
  saveDatabase();
}

function saveDatabase() {
  const data = db.export();
  fs.writeFileSync('bot_data.sqlite', Buffer.from(data));
}

// دوال قاعدة البيانات المساعدة
function getUser(userId) {
  const stmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
  stmt.bind([userId]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function createUser(userId, referredBy = null) {
  db.run('INSERT OR IGNORE INTO users (user_id, points, referred_by) VALUES (?, 7, ?)', [userId, referredBy]);
  saveDatabase();
  return getUser(userId);
}

function updatePoints(userId, delta) {
  db.run('UPDATE users SET points = points + ? WHERE user_id = ?', [delta, userId]);
  saveDatabase();
}

function claimReferral(referrerId, referredUserId) {
  // تحقق مما إذا كان مسجلاً سابقاً
  const check = db.prepare('SELECT * FROM referrals WHERE referrer_id = ? AND referred_user_id = ?');
  check.bind([referrerId, referredUserId]);
  if (check.step()) {
    check.free();
    return false;
  }
  check.free();
  
  db.run('INSERT INTO referrals (referrer_id, referred_user_id, claimed) VALUES (?, ?, 1)', [referrerId, referredUserId]);
  saveDatabase();
  return true;
}

// ===================== أوامر البوت =====================

// الأمر /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const startPayload = ctx.startPayload; // قد يحتوي على كود الإحالة

  let user = getUser(userId);
  let referredBy = null;

  // تحليل معامل الإحالة (ref_<user_id>)
  if (startPayload && startPayload.startsWith('ref_')) {
    const refId = parseInt(startPayload.replace('ref_', ''));
    if (refId && refId !== userId) {
      referredBy = refId;
    }
  }

  if (!user) {
    // مستخدم جديد
    user = createUser(userId, referredBy);

    // معالجة الإحالة إذا وجدت
    if (referredBy && claimReferral(referredBy, userId)) {
      // إضافة نقطة للمُحيل
      updatePoints(referredBy, 1);
      // إشعار المُحيل
      try {
        await bot.telegram.sendMessage(referredBy, '🎉 لقد دخل مستخدم جديد عبر رابطك، وتمت إضافة نقطة واحدة إلى رصيدك.');
      } catch (e) {
        // ربما المستخدم لم يبدأ البوت بعد أو حظر البوت
      }
      // رسالة ترحيب للمستخدم الجديد
      await ctx.reply('تم تسجيلك عبر رابط صديقك، وقد حصل صديقك على نقطة مكافأة.');
    }
  } else {
    // مستخدم عائد - لا شيء خاص
  }

  // زر بدء المحادثة
  const startButton = Markup.inlineKeyboard([
    Markup.button.callback('التحدث مع الذكاء الاصطناعي', 'activate_chat')
  ]);

  await ctx.reply('مرحباً! اضغط على الزر أدناه لبدء التحدث مع الذكاء الاصطناعي.', startButton);
});

// تفعيل وضع المحادثة (زر "التحدث مع الذكاء الاصطناعي")
bot.action('activate_chat', async (ctx) => {
  const userId = ctx.from.id;
  let user = getUser(userId);
  if (!user) {
    user = createUser(userId);
  }

  // إعداد أزرار المحادثة
  const chatButtons = Markup.inlineKeyboard([
    [Markup.button.callback(`النقاط: ${user.points}`, 'show_points')],
    [Markup.button.callback('جمع نقاط', 'collect_points')]
  ]);

  await ctx.editMessageReplyMarkup(chatButtons.reply_markup).catch(() => {});
  await ctx.reply('تم تفعيل وضع المحادثة. الآن يمكنك إرسال أي رسالة مباشرة إلى الذكاء الاصطناعي. (كل رسالة تستهلك نقطة)');
});

// زر عرض النقاط (فقط يعرض العدد)
bot.action('show_points', async (ctx) => {
  const userId = ctx.from.id;
  const user = getUser(userId);
  await ctx.answerCbQuery(`رصيدك الحالي: ${user ? user.points : 0} نقطة.`);
});

// زر جمع نقاط - يرسل رابط الإحالة
bot.action('collect_points', async (ctx) => {
  const userId = ctx.from.id;
  const user = getUser(userId) || createUser(userId);
  const referralLink = `https://t.me/kr_x20bot?start=ref_${userId}`;
  await ctx.reply(`🔗 رابط الإحالة الخاص بك:\n${referralLink}\n\nشاركه مع أصدقائك، وعند دخولهم لأول مرة ستحصل على نقطة واحدة لكل صديق.`);
});

// ===================== معالجة الرسائل النصية (المحادثة مع AI) =====================
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text;

  // تجاهل الأوامر (مثل /start)
  if (messageText.startsWith('/')) return;

  const user = getUser(userId);
  if (!user || user.points < 1) {
    // لا نقاط كافية
    const collectButton = Markup.inlineKeyboard([
      Markup.button.callback('جمع نقاط', 'collect_points')
    ]);
    return ctx.reply('⚠️ رصيدك من النقاط غير كافٍ. يمكنك جمع نقاط عبر الإحالات.', collectButton);
  }

  // إظهار مؤشر "جاري الكتابة..."
  await ctx.sendChatAction('typing');

  // خصم نقطة
  updatePoints(userId, -1);

  try {
    // استدعاء واجهة الذكاء الاصطناعي
    const response = await axios.post(
      `${AI_BASE_URL}/chat`,
      { message: messageText },
      { headers: { 'Content-Type': 'application/json', 'X-API-Key': AI_API_KEY } }
    );

    const reply = response.data?.reply || 'عذراً، لم أستطع الرد. حاول مرة أخرى.';

    // تحديث أزرار المحادثة (تظهر بعد كل رد)
    const updatedUser = getUser(userId);
    const chatButtons = Markup.inlineKeyboard([
      [Markup.button.callback(`النقاط: ${updatedUser.points}`, 'show_points')],
      [Markup.button.callback('جمع نقاط', 'collect_points')]
    ]);

    await ctx.reply(reply, chatButtons);
  } catch (error) {
    // استرجاع النقطة إذا فشل الرد
    updatePoints(userId, 1);
    console.error('خطأ في الاتصال بالذكاء الاصطناعي:', error.message);
    await ctx.reply('❌ حدث خطأ أثناء معالجة رسالتك. تم استرجاع النقطة. حاول لاحقاً.');
  }
});

// ===================== تشغيل البوت =====================
(async () => {
  await initDatabase();
  console.log('✅ قاعدة البيانات جاهزة');
  
  bot.launch()
    .then(() => console.log('✅ البوت يعمل بنجاح'))
    .catch(err => console.error('فشل تشغيل البوت:', err));
})();

// إيقاف آمن عند انتهاء العملية
process.once('SIGINT', () => {
  saveDatabase();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  saveDatabase();
  bot.stop('SIGTERM');
});
