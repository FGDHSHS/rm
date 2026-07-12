const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
require('dotenv').config();

// ======== إعدادات البوت ========
const BOT_TOKEN = process.env.b || 'YOUR_BOT_TOKEN_HERE';
const BASE_URL = process.env.r || "https://dsfsdjfc-ddd.hf.space";
const API_KEY = process.env.a|| "my_secret_key_123";
const BOT_USERNAME = 'kr_x20bot'; // اسم المستخدم الخاص بالبوت

// ======== إنشاء البوت ========
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 البوت بدأ بالعمل...');

// ======== قاعدة البيانات ========
const db = new sqlite3.Database('./bot_data.db');

// دوال مساعدة للتعامل مع قاعدة البيانات (promisify)
const dbGet = promisify(db.get.bind(db));
const dbRun = promisify(db.run.bind(db));
const dbAll = promisify(db.all.bind(db));

// إنشاء الجداول إذا لم تكن موجودة
async function initDatabase() {
    await dbRun(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            points INTEGER DEFAULT 7,
            session_active INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER,
            referee_id INTEGER,
            used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(referrer_id, referee_id)
        )
    `);
    console.log('✅ قاعدة البيانات جاهزة');
}
initDatabase().catch(console.error);

// ======== دوال النقاط والجلسات ========

// الحصول على نقاط المستخدم (إن لم يكن موجوداً يتم إنشاؤه بـ 7 نقاط)
async function getPoints(userId) {
    let row = await dbGet(`SELECT points FROM users WHERE user_id = ?`, userId);
    if (!row) {
        await dbRun(`INSERT INTO users (user_id, points) VALUES (?, 7)`, userId);
        row = { points: 7 };
    }
    return row.points;
}

// تحديث النقاط (زيادة أو نقصان)
async function updatePoints(userId, delta) {
    const current = await getPoints(userId);
    const newPoints = Math.max(0, current + delta);
    await dbRun(`UPDATE users SET points = ? WHERE user_id = ?`, newPoints, userId);
    return newPoints;
}

// استهلاك نقطة واحدة (ترجع true إذا نجحت، false إذا لا يوجد نقاط)
async function usePoint(userId) {
    const current = await getPoints(userId);
    if (current <= 0) return false;
    await updatePoints(userId, -1);
    return true;
}

// تفعيل جلسة المحادثة
async function setSessionActive(userId, active) {
    await dbRun(`UPDATE users SET session_active = ? WHERE user_id = ?`, active ? 1 : 0, userId);
}

// التحقق من نشاط الجلسة
async function isSessionActive(userId) {
    const row = await dbGet(`SELECT session_active FROM users WHERE user_id = ?`, userId);
    if (!row) return false;
    return row.session_active === 1;
}

// تسجيل إحالة (مرة واحدة لكل زائر)
async function recordReferral(referrerId, refereeId) {
    // منع الإحالة لنفس الشخص
    if (referrerId === refereeId) return false;
    try {
        await dbRun(
            `INSERT INTO referrals (referrer_id, referee_id) VALUES (?, ?)`,
            referrerId, refereeId
        );
        // إضافة نقطة للمُحيل
        await updatePoints(referrerId, 1);
        return true;
    } catch (err) {
        // إذا كان هناك تكرار (UNIQUE) يعني سبق الإحالة
        if (err.message.includes('UNIQUE')) return false;
        throw err;
    }
}

// التحقق مما إذا كان المستخدم قد حصل على نقطة من هذا المُحيل مسبقاً
async function hasReferral(referrerId, refereeId) {
    const row = await dbGet(
        `SELECT id FROM referrals WHERE referrer_id = ? AND referee_id = ?`,
        referrerId, refereeId
    );
    return !!row;
}

// ======== دوال الاتصال بـ API ========

async function sendMessageToAI(message) {
    try {
        const response = await fetch(`${BASE_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            body: JSON.stringify({ message })
        });
        if (response.ok) {
            const data = await response.json();
            return data.reply || '';
        } else {
            console.error(`❌ API error: ${response.status}`);
            return null;
        }
    } catch (error) {
        console.error(`❌ Fetch error: ${error.message}`);
        return null;
    }
}

async function resetConversation() {
    try {
        await fetch(`${BASE_URL}/reset`, {
            method: 'POST',
            headers: { 'X-API-Key': API_KEY }
        });
        return true;
    } catch (error) {
        console.error(`❌ Reset error: ${error.message}`);
        return false;
    }
}

// ======== إنشاء أزرار ========

function createMainMenuKeyboard(userId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '💬 التحدث مع الذكاء الاصطناعي', callback_data: 'start_chat' }
                ]
            ]
        }
    };
}

function createChatMenuKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔢 نقاطي', callback_data: 'show_points' },
                    { text: '🎁 جمع نقاط', callback_data: 'get_referral_link' }
                ]
            ]
        }
    };
}

// ======== أوامر البوت ========

// 1. معالجة الرسائل النصية (غير الأوامر)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // تجاهل الأوامر (تبدأ بـ /)
    if (!text || text.startsWith('/')) return;

    // التحقق من وجود جلسة نشطة للمستخدم
    const active = await isSessionActive(userId);
    if (active) {
        // المحادثة مفعلة → استهلاك نقطة والرد
        const hasPoint = await usePoint(userId);
        if (!hasPoint) {
            // لا توجد نقاط → إظهار رسالة مع زر جمع نقاط
            await bot.sendMessage(
                chatId,
                '⚠️ نفدت نقاطك! اضغط على زر "جمع نقاط" للحصول على نقاط إضافية.',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎁 جمع نقاط', callback_data: 'get_referral_link' }]
                        ]
                    }
                }
            );
            return;
        }

        // إرسال إشارة الكتابة
        bot.sendChatAction(chatId, 'typing');

        const reply = await sendMessageToAI(text);
        if (reply) {
            if (reply.length > 4096) {
                const parts = reply.match(/.{1,4096}/g);
                for (const part of parts) await bot.sendMessage(chatId, part);
            } else {
                await bot.sendMessage(chatId, reply);
            }
        } else {
            await bot.sendMessage(chatId, '❌ عذراً، حدث خطأ. حاول مرة أخرى.');
        }

        // بعد الرد، نعرض أزرار النقاط وجمع النقاط (لكن لا نكررها إلا إذا أراد المستخدم)
        // يمكن إرسالها مرة أخرى، لكن الأفضل أن نرسل رسالة منفصلة مع الأزرار بعد كل رد؟
        // حسب الطلب، الأزرار تظهر عند بدء المحادثة وتبقى في الرسالة السابقة.
        // لكن يمكننا إرسال رسالة جديدة تحوي الأزرار لتكون متاحة.
        // سنرسل رسالة مختصرة مع الأزرار بعد كل رد (اختياري)
        // لكن لتجنب الإزعاج، سنرسل الأزرار فقط عند بدء المحادثة.
    } else {
        // الجلسة غير مفعلة → نعرض زر بدء المحادثة
        await bot.sendMessage(
            chatId,
            '👋 مرحباً! اضغط على الزر أدناه لبدء المحادثة مع الذكاء الاصطناعي.',
            createMainMenuKeyboard(userId)
        );
    }
});

// 2. معالجة الضغط على الأزرار (callback_query)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    // تأكيد الاستلام (لإزالة الدائرة)
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'start_chat') {
        // التحقق من النقاط
        const points = await getPoints(userId);
        if (points <= 0) {
            await bot.sendMessage(
                chatId,
                '⚠️ ليس لديك نقاط كافية! اضغط على زر "جمع نقاط" للحصول على نقاط.',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎁 جمع نقاط', callback_data: 'get_referral_link' }]
                        ]
                    }
                }
            );
            return;
        }

        // تفعيل الجلسة
        await setSessionActive(userId, true);

        // إزالة الزر القديم (اختياري)
        await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: callbackQuery.message.message_id }
        );

        // إرسال رسالة ترحيب مع أزرار النقاط وجمع النقاط
        await bot.sendMessage(
            chatId,
            `🤖 <b>بدأت المحادثة!</b>\n\nلديك ${points} نقطة متبقية.\nأرسل رسالتك الآن.`,
            { ...createChatMenuKeyboard(), parse_mode: 'HTML' }
        );

        // إرسال البرومبت الأول للـ API (اختياري)
        await sendMessageToAI('شخصية خيالية تدعى 😈').catch(() => {});
    }

    else if (data === 'show_points') {
        const points = await getPoints(userId);
        await bot.sendMessage(chatId, `🔢 <b>نقاطك الحالية:</b> ${points}`, { parse_mode: 'HTML' });
    }

    else if (data === 'get_referral_link') {
        // إنشاء رابط دعوة فريد
        const link = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
        await bot.sendMessage(
            chatId,
            `🎁 <b>رابط جمع النقاط الخاص بك:</b>\n\n${link}\n\nقم بمشاركة الرابط مع أصدقائك، كل شخص يدخل عبر الرابط يمنحك نقطة إضافية (مرة واحدة لكل زائر).`,
            { parse_mode: 'HTML' }
        );
    }
});

// 3. معالجة أمر /start (مع دعم الإحالات)
bot.onText(/\/start(?: ref_(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const referrerId = match[1] ? parseInt(match[1]) : null;

    // إذا كان هناك مُحيل، وليس المستخدم نفسه
    if (referrerId && referrerId !== userId) {
        // التحقق من عدم تكرار الإحالة
        const already = await hasReferral(referrerId, userId);
        if (!already) {
            const success = await recordReferral(referrerId, userId);
            if (success) {
                // إشعار المُحيل (اختياري)
                try {
                    await bot.sendMessage(
                        referrerId,
                        `🎉 حصلت على نقطة إضافية! المستخدم @${msg.from.username || userId} دخل عبر رابطك.`
                    );
                } catch (e) {}
                // إشعار المستخدم الجديد
                await bot.sendMessage(
                    chatId,
                    `🎁 تم منح نقطة للمُحيل @${msg.from.username || userId} شكراً لدخولك عبر الرابط.`
                );
            } else {
                await bot.sendMessage(chatId, '⚠️ حدث خطأ في منح النقطة، حاول مرة أخرى.');
            }
        } else {
            await bot.sendMessage(chatId, 'ℹ️ سبق لك دخول هذا الرابط، لا يمكن الحصول على نقطة إضافية.');
        }
    }

    // رسالة ترحيب عامة (لأي /start)
    const points = await getPoints(userId);
    await bot.sendMessage(
        chatId,
        `👋 مرحباً بك في البوت!\n\nلديك ${points} نقطة مجانية.\nأرسل أي رسالة لتبدأ المحادثة.`,
        createMainMenuKeyboard(userId)
    );
});

// 4. أمر /reset (إعادة تعيين الجلسة)
bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    await setSessionActive(userId, false);
    await resetConversation();
    await bot.sendMessage(
        chatId,
        '🔄 تم إعادة تعيين المحادثة. أرسل أي رسالة لإظهار زر البدء من جديد.'
    );
});

// 5. أمر /points (عرض النقاط)
bot.onText(/\/points/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const points = await getPoints(userId);
    await bot.sendMessage(chatId, `🔢 نقاطك: ${points}`);
});

// 6. أمر /help
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
        chatId,
        `📖 الأوامر المتاحة:\n/start - إظهار زر البدء\n/reset - إعادة تعيين المحادثة\n/points - عرض نقاطك\n/help - هذه المساعدة\n\n💡 للدعوة: استخدم زر "جمع نقاط" للحصول على رابط.`
    );
});

// ======== معالجة أخطاء الـ polling ========
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.message);
});

console.log('✅ البوت جاهز.');
