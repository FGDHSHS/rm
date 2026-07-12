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
