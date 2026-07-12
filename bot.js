const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
require('dotenv').config();

// إعدادات البوت
const BOT_TOKEN = process.env.b || 'YOUR_BOT_TOKEN_HERE';
const BASE_URL = process.env.r || "https://dsfsdjfc-ddd.hf.space";
const API_KEY = process.env.a|| "my_secret_key_123";

// إنشاء البوت
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// تخزين حالة المحادثة لكل مستخدم
const userSessions = new Map();

// دالة إرسال رسالة للـ API
async function sendMessage(message, userId) {
    try {
        const response = await fetch(`${BASE_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            body: JSON.stringify({ 
                message: message,
                user_id: userId // لإدارة الجلسات
            })
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
async function resetConversation(userId) {
    try {
        const response = await fetch(`${BASE_URL}/reset`, {
            method: 'POST',
            headers: {
                'X-API-Key': API_KEY
            },
            body: JSON.stringify({ user_id: userId })
        });

        if (response.ok) {
            console.log(`✅ تم إعادة تعيين المحادثة للمستخدم ${userId}`);
            return true;
        } else {
            const error = await response.json();
            console.error(`❌ فشل إعادة التعيين: ${error.error || 'خطأ غير معروف'}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ فشل الاتصال: ${error.message}`);
        return false;
    }
}

// أمر /start - يظهر الزر الشفاف
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // إعادة تعيين المحادثة للمستخدم
    await resetConversation(userId);
    
    // إرسال البرومبت الأول
    await sendMessage('شخصية خيالية تدعى 😈', userId);
    
    // إنشاء زر شفاف (Inline Keyboard)
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '💬 التحدث مع الذكاء الاصطناعي',
                        callback_data: 'start_chat'
                    }
                ]
            ]
        },
        parse_mode: 'HTML'
    };
    
    // رسالة الترحيب
    const welcomeMessage = `
👋 <b>مرحباً بك في بوت الذكاء الاصطناعي!</b>

✨ أنا هنا لمساعدتك والتحدث معك في أي موضوع.
🔮 فقط اضغط على الزر أدناه لبدء المحادثة.

<i>💡 ملاحظة: البوت يتعلم من محادثاتك ويطور نفسه!</i>
    `;
    
    await bot.sendMessage(chatId, welcomeMessage, options);
});

// معالجة الضغط على الزر
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    if (data === 'start_chat') {
        // إظهار رسالة تأكيد
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ تم بدء المحادثة! أرسل رسالتك الآن.',
            show_alert: false
        });
        
        // حذف الزر بعد الضغط عليه (اختياري)
        await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            }
        );
        
        // إرسال رسالة ترحيب للمحادثة
        const chatMessage = `
🤖 <b>أهلاً بك في المحادثة!</b>

💭 يمكنك الآن التحدث معي بحرية.
📝 أرسل أي سؤال أو موضوع تريد مناقشته.

🔄 لإعادة تعيين المحادثة أرسل /reset
❌ لإنهاء المحادثة أرسل /end
        `;
        
        await bot.sendMessage(chatId, chatMessage, { parse_mode: 'HTML' });
        
        // تفعيل جلسة المحادثة للمستخدم
        userSessions.set(userId, { active: true, startTime: Date.now() });
    }
});

// التعامل مع رسائل المستخدمين
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userMessage = msg.text;
    
    // تجاهل الأوامر
    if (!userMessage || userMessage.startsWith('/')) return;
    
    // التحقق من أن المحادثة مفعلة
    const session = userSessions.get(userId);
    if (!session || !session.active) {
        await bot.sendMessage(
            chatId,
            '⚠️ <b>يرجى بدء المحادثة أولاً!</b>\n\nأرسل /start ثم اضغط على زر "التحدث مع الذكاء الاصطناعي"',
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    // إرسال رسالة "جاري الكتابة..."
    bot.sendChatAction(chatId, 'typing');
    
    const reply = await sendMessage(userMessage, userId);
    
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
        await bot.sendMessage(
            chatId,
            '❌ عذراً، حدث خطأ. حاول مرة أخرى أو أرسل /reset لإعادة تعيين المحادثة.'
        );
    }
});

// أمر /reset لإعادة تعيين المحادثة
bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const success = await resetConversation(userId);
    if (success) {
        await bot.sendMessage(
            chatId,
            '🔄 <b>تم إعادة تعيين المحادثة بنجاح!</b>\n\nيمكنك الآن بدء محادثة جديدة.',
            { parse_mode: 'HTML' }
        );
    } else {
        await bot.sendMessage(
            chatId,
            '❌ فشل إعادة تعيين المحادثة. حاول مرة أخرى.'
        );
    }
});

// أمر /end لإنهاء المحادثة
bot.onText(/\/end/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    userSessions.delete(userId);
    await bot.sendMessage(
        chatId,
        '👋 <b>تم إنهاء المحادثة!</b>\n\nلبدء محادثة جديدة أرسل /start',
        { parse_mode: 'HTML' }
    );
});

// أمر /help
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
📖 <b>قائمة الأوامر:</b>

/start - بدء البوت وإظهار زر المحادثة
/reset - إعادة تعيين المحادثة الحالية
/end - إنهاء المحادثة الحالية
/help - عرض هذه المساعدة

💡 <b>كيفية الاستخدام:</b>
1. أرسل /start
2. اضغط على زر "التحدث مع الذكاء الاصطناعي"
3. ابدأ بالكتابة! 🚀
    `;
    
    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
});

console.log('🤖 البوت يعمل...');
console.log('✅ جاهز لاستقبال الرسائل');
