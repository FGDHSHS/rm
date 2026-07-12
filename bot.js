const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
require('dotenv').config();

// ======== الإعدادات باستخدام المتغيرات الجديدة ========
const BOT_TOKEN = process.env.b || 'YOUR_BOT_TOKEN_HERE';
const BASE_URL = process.env.r || "https://dsfsdjfc-ddd.hf.space";
const API_KEY = process.env.a || "my_secret_key_123";
const BOT_USERNAME = 'kr_x20bot';

// ======== إنشاء البوت (بدون بدء polling تلقائي) ========
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
console.log('🤖 جاري تهيئة البوت...');

// ======== قاعدة البيانات ========
const db = new sqlite3.Database('./bot_data.db');
const dbGet = promisify(db.get.bind(db));
const dbRun = promisify(db.run.bind(db));

async function initDB() {
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
initDB().catch(console.error);

// ======== دوال النقاط والجلسات ========
async function getPoints(userId) {
    let row = await dbGet(`SELECT points FROM users WHERE user_id = ?`, userId);
    if (!row) {
        await dbRun(`INSERT INTO users (user_id, points) VALUES (?, 7)`, userId);
        row = { points: 7 };
    }
    return row.points;
}

async function updatePoints(userId, delta) {
    const current = await getPoints(userId);
    const newPoints = Math.max(0, current + delta);
    await dbRun(`UPDATE users SET points = ? WHERE user_id = ?`, newPoints, userId);
    return newPoints;
}

async function usePoint(userId) {
    const current = await getPoints(userId);
    if (current <= 0) return false;
    await updatePoints(userId, -1);
    return true;
}

async function setSessionActive(userId, active) {
    await dbRun(`UPDATE users SET session_active = ? WHERE user_id = ?`, active ? 1 : 0, userId);
}

async function isSessionActive(userId) {
    const row = await dbGet(`SELECT session_active FROM users WHERE user_id = ?`, userId);
    return row ? row.session_active === 1 : false;
}

async function recordReferral(referrerId, refereeId) {
    if (referrerId === refereeId) return false;
    try {
        await dbRun(
            `INSERT INTO referrals (referrer_id, referee_id) VALUES (?, ?)`,
            referrerId, refereeId
        );
        await updatePoints(referrerId, 1);
        return true;
    } catch (err) {
        if (err.message.includes('UNIQUE')) return false;
        throw err;
    }
}

async function hasReferral(referrerId, refereeId) {
    const row = await dbGet(
        `SELECT id FROM referrals WHERE referrer_id = ? AND referee_id = ?`,
        referrerId, refereeId
    );
    return !!row;
}

// ======== دوال API ========
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
        }
        console.error(`❌ API error: ${response.status}`);
        return null;
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

// ======== أزرار ========
function mainMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '💬 التحدث مع الذكاء الاصطناعي', callback_data: 'start_chat' }]
            ]
        }
    };
}

function chatMenu() {
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

// ======== معالجة الرسائل النصية ========
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const active = await isSessionActive(userId);
    if (!active) {
        await bot.sendMessage(
            chatId,
            '👋 مرحباً! اضغط على الزر أدناه لبدء المحادثة مع الذكاء الاصطناعي.',
            mainMenu()
        );
        return;
    }

    const hasPoint = await usePoint(userId);
    if (!hasPoint) {
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

    // إظهار "جاري الكتابة..." (التأكيد)
    await bot.sendChatAction(chatId, 'typing');

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

    const points = await getPoints(userId);
    await bot.sendMessage(
        chatId,
        `📊 نقاطك المتبقية: ${points}`,
        chatMenu()
    );
});

// ======== معالجة الأزرار ========
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    await bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'start_chat') {
        const points = await getPoints(userId);
        if (points <= 0) {
            await bot.sendMessage(
                chatId,
                '⚠️ ليس لديك نقاط كافية! اضغط على "جمع نقاط" للحصول على نقاط.',
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

        await setSessionActive(userId, true);

        await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: callbackQuery.message.message_id }
        );

        await bot.sendMessage(
            chatId,
            `🤖 <b>بدأت المحادثة!</b>\n\nلديك ${points} نقطة متبقية.\nأرسل رسالتك الآن.`,
            { ...chatMenu(), parse_mode: 'HTML' }
        );

        await sendMessageToAI('شخصية خيالية تدعى 😈').catch(() => {});
    }

    else if (data === 'show_points') {
        const points = await getPoints(userId);
        await bot.sendMessage(chatId, `🔢 <b>نقاطك الحالية:</b> ${points}`, { parse_mode: 'HTML' });
    }

    else if (data === 'get_referral_link') {
        const link = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
        await bot.sendMessage(
            chatId,
            `🎁 <b>رابط جمع النقاط الخاص بك:</b>\n\n${link}\n\nقم بمشاركة الرابط مع أصدقائك، كل شخص يدخل عبر الرابط يمنحك نقطة إضافية (مرة واحدة لكل زائر).`,
            { parse_mode: 'HTML' }
        );
    }
});

// ======== أمر /start مع الإحالات ========
bot.onText(/\/start(?: ref_(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const referrerId = match[1] ? parseInt(match[1]) : null;

    if (referrerId && referrerId !== userId) {
        const already = await hasReferral(referrerId, userId);
        if (!already) {
            const success = await recordReferral(referrerId, userId);
            if (success) {
                try {
                    await bot.sendMessage(
                        referrerId,
                        `🎉 حصلت على نقطة إضافية! المستخدم @${msg.from.username || userId} دخل عبر رابطك.`
                    );
                } catch (e) {}
                await bot.sendMessage(
                    chatId,
                    `🎁 تم منح نقطة لصديقك (@${msg.from.username || userId}) شكراً لدخولك عبر الرابط.`
                );
            } else {
                await bot.sendMessage(chatId, '⚠️ حدث خطأ في منح النقطة، حاول مرة أخرى.');
            }
        } else {
            await bot.sendMessage(chatId, 'ℹ️ سبق لك دخول هذا الرابط، لا يمكن الحصول على نقطة إضافية.');
        }
    }

    const points = await getPoints(userId);
    await bot.sendMessage(
        chatId,
        `👋 مرحباً بك في البوت!\n\nلديك ${points} نقطة مجانية.\nأرسل أي رسالة لتبدأ المحادثة.`,
        mainMenu()
    );
});

// ======== أوامر إضافية ========
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

bot.onText(/\/points/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const points = await getPoints(userId);
    await bot.sendMessage(chatId, `🔢 نقاطك: ${points}`);
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
        chatId,
        `📖 الأوامر المتاحة:\n/start - إظهار زر البدء\n/reset - إعادة تعيين المحادثة\n/points - عرض نقاطك\n/help - هذه المساعدة\n\n💡 للدعوة: استخدم زر "جمع نقاط" للحصول على رابط.`
    );
});

// ======== بدء Polling مع إعادة المحاولة عند 409 ========
function startBot() {
    bot.startPolling({
        params: { timeout: 30 }
    }).then(() => {
        console.log('✅ البوت جاهز تماماً.');
    }).catch((err) => {
        if (err.message && err.message.includes('409')) {
            console.warn('⚠️ تعارض في polling (409)، سنحاول مرة أخرى بعد 5 ثوان...');
            setTimeout(startBot, 5000);
        } else {
            console.error('❌ فشل بدء polling:', err.message);
        }
    });
}

startBot();

// معالجة أخطاء الـ polling العامة
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.message);
    if (error.message && error.message.includes('409')) {
        console.warn('⚠️ تعارض، سنعيد المحاولة...');
        setTimeout(startBot, 5000);
    }
});
