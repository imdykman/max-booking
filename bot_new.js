// ========== ПОДКЛЮЧЕНИЕ БИБЛИОТЕК ==========
const fs = require('fs');
const path = require('path');
const { Bot, Keyboard } = require('@maxhub/max-bot-api');
const axios = require('axios');
require('dotenv').config();

// ========== КЛЮЧ YANDEXGPT ==========
const YANDEX_API_KEY = process.env.YANDEX_API_KEY;
const FOLDER_ID = process.env.FOLDER_ID;
console.log('🔑 Ключ загружен?', YANDEX_API_KEY ? 'ДА' : 'НЕТ');

// ========== ТОКЕН БОТА ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Bot(BOT_TOKEN);

// ========== ХРАНЕНИЕ ЗАПИСЕЙ ==========
const BOOKINGS_FILE = './bookings.json';

function loadBookings() {
    try {
        if (fs.existsSync(BOOKINGS_FILE)) {
            return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveBookings(bookings) {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), 'utf8');
}

function getBookedSlots(date) {
    return loadBookings().filter(b => b.date === date).map(b => b.time);
}

function addBooking(booking) {
    const bookings = loadBookings();
    bookings.push({ ...booking, id: Date.now(), created_at: new Date().toISOString() });
    saveBookings(bookings);
}

// ========== ГЕНЕРАЦИЯ СЛОТОВ ==========
function generateTimeSlots(date) {
    const dayOfWeek = new Date(date).getDay();
    let startHour, endHour;
    
    if (dayOfWeek === 6) {
        startHour = 10;
        endHour = 13;
    } else if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        startHour = 9;
        endHour = 15;
    } else {
        return [];
    }
    
    const slots = [];
    for (let hour = startHour; hour < endHour; hour++) {
        for (let minute of [0, 30]) {
            if (hour === endHour - 1 && minute === 30) continue;
            slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
        }
    }
    return slots;
}

// ========== ФУНКЦИИ ДЛЯ ДАТ ==========
function formatDateISO(date) {
    return date.toISOString().split('T')[0];
}

function formatDateReadable(date) {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    return `${day}.${month}`;
}

function getDayName(date) {
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return days[date.getDay()];
}

function isWorkingDay(date) {
    const dayOfWeek = date.getDay();
    return dayOfWeek >= 1 && dayOfWeek <= 6;
}

function hasFreeSlots(dateISO) {
    const slots = generateTimeSlots(dateISO);
    const bookedSlots = getBookedSlots(dateISO);
    return slots.some(slot => !bookedSlots.includes(slot));
}

// ========== ПОЛУЧЕНИЕ КЛАВИАТУРЫ С ДАТАМИ ==========
function getAvailableDatesKeyboard(offset = 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startDate = new Date(today);
    startDate.setDate(today.getDate() + offset);
    
    const buttons = [];
    
    for (let i = 0; i < 14; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const dateISO = formatDateISO(date);
        const hasSlots = hasFreeSlots(dateISO);
        const isWork = isWorkingDay(date);
        const isToday = dateISO === formatDateISO(today);
        
        if (!isWork) continue;
        
        let emoji = hasSlots ? '✅' : '🔴';
        if (isToday) emoji = '🔘';
        
        const dayName = getDayName(date);
        const dateStr = formatDateReadable(date);
        const text = `${emoji} ${dayName} ${dateStr}`;
        
        if (hasSlots) {
            buttons.push([{ text: text, callback_data: `date_${dateISO}` }]);
        } else {
            buttons.push([{ text: text, callback_data: `no_slots_${dateISO}` }]);
        }
    }
    
    const navRow = [];
    if (offset > 0) {
        navRow.push({ text: "◀️ Назад", callback_data: `nav_${offset - 14}` });
    }
    navRow.push({ text: "Вперед ▶️", callback_data: `nav_${offset + 14}` });
    buttons.push(navRow);
    buttons.push([{ text: "❌ Отмена", callback_data: "cancel_booking" }]);
    
    return { inline_keyboard: buttons };
}

// ========== ХРАНИЛИЩЕ СОСТОЯНИЙ ==========
const userStates = new Map();

// ========== ФУНКЦИИ ДЛЯ ЗАПИСИ ==========
async function showAvailableDates(ctx, userId, offset = 0) {
    const keyboard = getAvailableDatesKeyboard(offset);
    const message = '📅 *Доступные даты для записи*\n\n✅ — есть свободное время\n🔴 — всё занято\n🔘 — сегодня\n\nВыберите дату:';
    userStates.set(userId, { step: 'awaiting_date', calendarOffset: offset });
    await ctx.reply(message, { reply_markup: keyboard });
}

async function showTimeSlots(ctx, userId, dateISO) {
    const allSlots = generateTimeSlots(dateISO);
    const bookedSlots = getBookedSlots(dateISO);
    const freeSlots = allSlots.filter(slot => !bookedSlots.includes(slot));
    
    if (freeSlots.length === 0) {
        await ctx.reply(`❌ На эту дату нет свободных слотов. Выберите другую дату.`);
        await showAvailableDates(ctx, userId);
        return;
    }
    
    const buttons = [];
    for (let i = 0; i < freeSlots.length; i += 2) {
        const row = freeSlots.slice(i, i + 2).map(slot => ({
            text: slot,
            callback_data: `time_${slot.replace(':', '')}_${dateISO}`
        }));
        buttons.push(row);
    }
    buttons.push([{ text: "◀️ Назад к датам", callback_data: "back_to_dates" }]);
    
    userStates.set(userId, { step: 'awaiting_time', selectedDate: dateISO });
    const dateObj = new Date(dateISO);
    const dateReadable = `${getDayName(dateObj)} ${dateObj.getDate()}.${dateObj.getMonth() + 1}`;
    
    await ctx.reply(`📅 *Дата:* ${dateReadable}\n\n🕐 *Выберите время:*`, { reply_markup: { inline_keyboard: buttons } });
}

async function askForPhone(ctx, userId, dateISO, time) {
    userStates.set(userId, { step: 'awaiting_phone', selectedDate: dateISO, selectedTime: time });
    await ctx.reply(`📞 *Укажите номер телефона для связи*\n\nПример: +7 912 345 67 89\n\nИли отправьте "пропустить"`);
}

async function saveBookingFinal(ctx, userId, userName, phone) {
    const state = userStates.get(userId);
    addBooking({
        user_id: userId,
        user_name: userName,
        phone: phone || 'не указан',
        date: state.selectedDate,
        time: state.selectedTime,
        purpose: 'Запись'
    });
    
    const dateObj = new Date(state.selectedDate);
    const dateReadable = `${getDayName(dateObj)} ${dateObj.getDate()}.${dateObj.getMonth() + 1}`;
    
    await ctx.reply(`✅ *Вы успешно записаны!*\n\n📅 *Дата:* ${dateReadable}\n🕐 *Время:* ${state.selectedTime}\n📞 *Телефон:* ${phone || 'не указан'}\n\nСпециалист свяжется с вами для подтверждения.`);
    userStates.delete(userId);
}

// ========== АДМИН-ФУНКЦИЯ ==========
async function showAdminCalendar(ctx) {
    const adminIds = ['18245428'];
    const userId = ctx.message?.sender?.user_id?.toString();
    
    if (!adminIds.includes(userId)) {
        await ctx.reply(`⛔ У вас нет доступа`);
        return;
    }
    
    const bookings = loadBookings();
    const today = new Date().toISOString().split('T')[0];
    const futureBookings = bookings.filter(b => b.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    
    if (futureBookings.length === 0) {
        await ctx.reply(`📭 *Нет активных записей*`);
        return;
    }
    
    let message = '📅 *ЗАПИСИ*\n\n';
    for (const b of futureBookings) {
        const d = new Date(b.date);
        message += `📆 ${d.getDate()}.${d.getMonth() + 1} ${b.time} | ${b.user_name}\n   📞 ${b.phone}\n\n`;
    }
    await ctx.reply(message);
}

// ========== КЛАВИАТУРА ==========
function getMainKeyboard() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback('Направления подготовки', 'directions')],
        [Keyboard.button.callback('Какие документы нужны?', 'documents')],
        [Keyboard.button.callback('Где подать документы?', 'address')],
        [Keyboard.button.callback('Вступительные испытания', 'exams')],
        [Keyboard.button.callback('Часы работы', 'hours')]
    ]);
}

// ========== ФУНКЦИЯ ПРИВЕТСТВИЯ ==========
async function sendWelcome(ctx) {
    const userName = ctx.message?.sender?.name || ctx.user?.name || 'Абитуриент';
    
    await ctx.reply(
        `🎓 *ОТДИС — Приёмная комиссия*\n\n👋 *Добро пожаловать, ${userName}!*\n\nЯ — официальный помощник. Выберите вопрос:`,
        { attachments: [getMainKeyboard()] }
    );
}
    
// ========== ФУНКЦИЯ YANDEXGPT ==========
async function askYandexGPT(question) {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios({
                method: 'post',
                url: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
                headers: {
                    'Authorization': `Api-Key ${YANDEX_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                data: {
                    modelUri: `gpt://${FOLDER_ID}/yandexgpt-lite`,
                    completionOptions: { stream: false, temperature: 0.7, maxTokens: 600 },
                    messages: [
                        { role: "system", text: `Ты — вежливый и дружелюбный официальный помощник приёмной комиссии ОТДИС (Областной техникум дизайна и сервиса, г. Екатеринбург).

ВОТ ИНФОРМАЦИЯ, КОТОРУЮ ТЫ ДОЛЖЕН ЗНАТЬ:

📌 АДРЕС И КОНТАКТЫ:
• Адрес: г. Екатеринбург, пер. Красный, д. 3
• Метро: "Динамо", выход к Красному переулку
• Телефон: +7 (343) 378-17-25 (доб. 3)
• E-mail: postupi@otdis.ru
• Сайт: otdis.ru

🕒 ЧАСЫ РАБОТЫ ПРИЁМНОЙ КОМИССИИ:
• Понедельник — Пятница: 09:00 — 16:00
• Суббота: 10:00 — 14:00
• Воскресенье: выходной

📅 СРОКИ РАБОТЫ ПРИЁМНОЙ КОМИССИИ:
• Начало работы: 20 июня 2026
• Окончание приёма документов: 15 августа 2026
• Для направлений со вступительными испытаниями: до 10 августа 2026

📋 СПИСОК ДОКУМЕНТОВ ДЛЯ ПОСТУПЛЕНИЯ:
1. Паспорт
2. Аттестат
3. Фото 3×4 (4 шт)
4. Медсправка 086
5. Прививочный сертификат
6. Медицинский полис
7. СНИЛС
8. ИНН (при наличии)
9. Документы о льготах
10. Приписное (для юношей)

🎓 НАПРАВЛЕНИЯ ПОДГОТОВКИ:
Бюджетные места: Конструирование, моделирование и технология швейных изделий, Дизайн (легкая промышленность), Мастер по изготовлению швейных изделий, Оператор швейного оборудования, Художник по костюму, Декоративно-прикладное искусство
Платные места: Реклама (122 000 ₽/год), Банковское дело (122 000 ₽/год), Дизайн (СМИ и полиграфия) (132 500 ₽/год)

Для лиц с ОВЗ или для детей с ОВЗ есть направление профессиональной подготовки "Швея"

🎨 ВСТУПИТЕЛЬНЫЕ ИСПЫТАНИЯ:
Рисунок карандашом: Конструирование, Реклама
Живопись красками: Дизайн (легкая промышленность), Декоративно-прикладное искусство
Оценивание: "зачёт / незачёт"
Срок: 6 — 12 августа

🏢 ОБЩЕЖИТИЕ:
• Общежитие есть
• Адрес: ул. Репина, 19, Екатеринбург

🎓 ПОСТУПЛЕНИЕ ПОСЛЕ 9 КЛАССОВ:
• Да, мы принимаем на обучение на базе 9 классов

📚 ПОДГОТОВИТЕЛЬНЫЕ КУРСЫ:
• Записаться можно по ссылке: https://forms.yandex.ru/u/644a463b02848f025d94c774/

💡 ЛЬГОТЫ ПРИ ПОСТУПЛЕНИИ:
• Подробно о льготах можно узнать в правилах приёма на официальном сайте: https://www.otdis.ru/abitur/spo/

ПРАВИЛА ОБЩЕНИЯ:
• Первый ответ начинай ответ с приветствия: "Здравствуйте!" или "Добрый день!"
• Благодари за вопрос
• Отвечай по существу, используя информацию выше
• В конце спроси: "Остались ли у вас ещё вопросы?"
• НЕ отправляй пользователя на сайт (кроме ссылок на льготы и подготовительные курсы — они приведены выше)
• НЕ задавай уточняющих вопросов` },
                        { role: "user", text: question }
                    ]
                }
            });
            return response.data.result.alternatives[0].message.text;
        } catch (e) {
            console.log(`⚠️ Попытка ${attempt} из ${maxRetries} не удалась: ${e.message}`);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }
        }
    }
    return '❓ Извините, сервер временно недоступен. Попробуйте ещё раз через минуту.';
}

// ========== ОБРАБОТЧИКИ ==========
bot.on('bot_started', async (ctx) => {
    console.log('👋 Пользователь впервые открыл бота');
    await sendWelcome(ctx);
});

bot.command('start', async (ctx) => {
    await sendWelcome(ctx);
});

bot.command('admin', async (ctx) => { await showAdminCalendar(ctx); });

// Обработка нажатий на кнопки
bot.on('message_callback', async (ctx) => {
    const data = ctx.callback.payload;
    console.log(`🔘 НАЖАТА КНОПКА: ${data}`);
    
    const answers = {
        'directions': '🎓 *Направления подготовки:*\n\n• Конструирование, моделирование и технология швейных изделий\n• Дизайн (легкая промышленность)\n• Декоративно-прикладное искусство\n• Мастер по изготовлению швейных изделий\n• Художник по костюму\n• Реклама\n• Банковское дело\n• Дизайн (СМИ и полиграфия)',
        'documents': '📋 *Список документов:*\n\n1️⃣ Паспорт\n2️⃣ Аттестат\n3️⃣ Фото 3×4 (4 шт)\n4️⃣ Медсправка 086\n5️⃣ Прививочный сертификат\n6️⃣ Медполис\n7️⃣ СНИЛС\n8️⃣ ИНН\n9️⃣ Документы о льготах\n🔟 Приписное',
        'address': '📍 *Адрес:* г. Екатеринбург, пер. Красный, д. 3\n\n🚇 *Метро:* "Динамо", выход к Красному переулку',
        'hours': '🕒 *Часы работы:*\n\nПн-Пт 09:00-16:00\nСб 10:00-14:00\nВс — выходной',
        'exams': '🎨 *Вступительные испытания:*\n\n• Рисунок карандашом (Конструирование, Реклама)\n• Живопись красками (Дизайн, ДПИ)\n\n⭐ Оценивание: "зачёт / незачёт"\n📅 Срок: 6 — 12 августа'
    };
    
    const footer = '\n\n---\n💡 *Больше информации в приложении* (кнопка "Старт") *или по текстовому запросу*';
    
    if (answers[data]) {
        await ctx.reply(answers[data] + footer);
    } else {
        await ctx.reply('❓ Вопрос не распознан. Пожалуйста, выберите из меню или напишите текстом.' + footer);
    }
    
    // Возвращаем клавиатуру
    await ctx.reply('👇 *Выберите следующий вопрос:*', { attachments: [getMainKeyboard()] });
});

// Обработка текстовых сообщений
bot.on('message_created', async (ctx) => {
    const text = ctx.message?.body?.text || '';
    if (text.startsWith('/')) return;
    
    console.log(`💬 Получен текст: "${text}"`);
    
    const aiAnswer = await askYandexGPT(text);
    const footer = '\n\n---\n💡 *Больше информации в приложении* (кнопка "Старт") *или по текстовому запросу*';
    
    await ctx.reply(aiAnswer + footer);
    
    // Возвращаем клавиатуру
    await ctx.reply('👇 *Выберите следующий вопрос:*', { attachments: [getMainKeyboard()] });
});

// Обработка callback-запросов (календарь)
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.callbackQuery.from?.id?.toString();
    
    if (data.startsWith('no_slots_')) {
        await ctx.answerCallbackQuery({ text: 'На эту дату все слоты заняты', show_alert: true });
        return;
    }
    if (data === 'cancel_booking') {
        userStates.delete(userId);
        await sendWelcome(ctx);
        return;
    }
    if (data === 'back_to_dates') {
        await showAvailableDates(ctx, userId);
        return;
    }
    if (data.startsWith('nav_')) {
        const offset = parseInt(data.replace('nav_', ''));
        await showAvailableDates(ctx, userId, offset);
        return;
    }
    if (data.startsWith('date_')) {
        const dateISO = data.replace('date_', '');
        await showTimeSlots(ctx, userId, dateISO);
        return;
    }
    if (data.startsWith('time_')) {
        const parts = data.replace('time_', '').split('_');
        const time = parts[0].replace(/(\d{2})(\d{2})/, '$1:$2');
        const dateISO = parts[1];
        await askForPhone(ctx, userId, dateISO, time);
        return;
    }
});

// Запуск
bot.start();
console.log('\n' + '='.repeat(50));
console.log('🤖 Бот ОТДИС v8.0 (ИИ + кнопки)');
console.log('💬 Кнопки работают, ИИ отвечает');
console.log('👑 Админ: /admin');
console.log('='.repeat(50));