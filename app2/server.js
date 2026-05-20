const express = require('express');
const cors = require('cors');
const { Bot } = require('@maxhub/max-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Запускаем бота для обработки команд
const bot = new Bot(process.env.BOT_TOKEN);

// Обработчик команды /start
bot.command('start', async (ctx) => {
    // Получаем имя пользователя
    const userName = ctx.message?.sender?.name || 'Абитуриент';
    
    await ctx.reply(
        `📋 *Практика СПО*\n\n👋 *Добро пожаловать, ${userName}!*\n\nПоиск и предложение практики в приложении.\n\n👇 Нажмите кнопку "Старт" ниже, чтобы открыть приложение.`
    );
});

bot.start();

// API маршруты (добавим позже)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер Практики СПО запущен на порту ${PORT}`);
});