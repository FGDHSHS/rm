const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

// إعدادات البوت
const BOT_TOKEN = 'Y7801607857:AAGMzMe7ioctkDQJxxAVydtsUzf0ZXtiBxI'; // ضع توكن البوت هنا
const BASE_URL = "https://dsfsdjfc-ddd.hf.space";
const API_KEY = "my_secret_key_123";

// إنشاء البوت
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// دالة إرسال رسالة للـ API
async function sendMessage(message) {
    try {
        const response = await fetch(`${BASE_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            body: JSON.stringify({ message: message })
        });

        if (response.ok) {
            const data = await response.json();
            return data.reply || '';
        } else {
            const error = await response.json();
            console.error(`❌ خطأ ${response.status}: ${error.error || 'خطأ غير معروف'}`);
            return null;
        }
    } catch (error) {
        console.error(`❌ فشل الاتصال: ${error.message}`);
        return null;
    }
}

// دالة إعادة تعيين المحادثة
async function resetConversation() {
    try {
        const response = await fetch(`${BASE_URL}/reset`, {
            method: 'POST',
            headers: {
                'X-API-Key': API_KEY
            }
        });

        if (response.ok) {
            console.log('✅ تم إعادة تعيين المحادثة');
        } else {
            const error = await response.json();
            console.error(`❌ فشل إعادة التعيين: ${error.error || 'خطأ غير معروف'}`);
        }
    } catch (error) {
        console.error(`❌ فشل الاتصال: ${error.message}`);
    }
}

// إعادة تعيين المحادثة عند بدء البوت
resetConversation();

// إرسال البرومبت الأول
sendMessage('شخصية خيالية تدعى 😈');

// التعامل مع رسائل المستخدمين
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userMessage = msg.text;

    // تجاهل الأوامر
    if (userMessage && userMessage.startsWith('/')) return;

    if (userMessage) {
        // إرسال رسالة "جاري الكتابة..."
        bot.sendChatAction(chatId, 'typing');

        const reply = await sendMessage(userMessage);
        
        if (reply) {
            // تقسيم الرد إذا كان طويلاً
            if (reply.length > 4096) {
                const parts = reply.match(/.{1,4096}/g);
                for (const part of parts) {
                    await bot.sendMessage(chatId, part);
                }
            } else {
                await bot.sendMessage(chatId, reply);
            }
        } else {
            await bot.sendMessage(chatId, '❌ عذراً، حدث خطأ. حاول مرة أخرى.');
        }
    }
});

// أمر /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
        chatId,
        '👋 مرحباً! أنا بوت الذكاء الاصطناعي.\nأرسل لي أي رسالة وسأرد عليك.'
    );
});

// أمر /reset لإعادة تعيين المحادثة
bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;
    await resetConversation();
    await bot.sendMessage(chatId, '🔄 تم إعادة تعيين المحادثة بنجاح!');
});

console.log('🤖 البوت يعمل...');
