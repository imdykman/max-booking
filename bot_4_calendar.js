// ========== ПОДКЛЮЧЕНИЕ БИБЛИОТЕК ==========
const fs = require('fs');
const path = require('path');
const { Bot } = require('@maxhub/max-bot-api');
const axios = require('axios');
require('dotenv').config();

// ========== КЛЮЧ YANDEXGPT ==========
const YANDEX_API_KEY = process.env.YANDEX_API_KEY;
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

// ========== ОСНОВНЫЕ ФУНКЦИИ БОТА ==========
const sendMainMenu = (ctx, customMessage = null) => {
    const message = customMessage || (`🎓 *ОТДИС — Приёмная комиссия*\n\n👋 *Добро пожаловать, ${ctx.message?.sender?.name || 'Абитуриент'}!*\n\n👇 *Отправьте номер нужного пункта (1-5)*`);
    ctx.reply(message + '\n\n1️⃣ 📊 Средние баллы\n2️⃣ 📋 Список документов\n3️⃣ 📅 Запись на подачу документов или на консультацию\n4️⃣ 📍 Контакты\n5️⃣ ❓ Задать вопрос\n\n💡 *Совет:* Напишите "меню" или "0", чтобы вернуться');
};

const shouldShowMenu = (text) => {
    if (!text) return true;
    const variants = ['начать', 'старт', '0', 'меню', 'start', '/start', 'привет', 'здравствуй', 'да', 'help', 'помощь'];
    return variants.includes(text.toLowerCase().trim());
};

// ========== ФУНКЦИЯ YANDEXGPT ==========
async function askYandexGPT(question) {
    const API_KEY = process.env.YANDEX_API_KEY;
    const FOLDER_ID = process.env.FOLDER_ID;
    
    const q = question.toLowerCase();
    let localAnswer = null;
    
    if (q.includes('как поступить') || q.includes('поступление')) {
        localAnswer = '🎓 *Как поступить в ОТДИС:*\n\n1. Выберите направление на сайте otdis.ru\n2. Подготовьте документы: паспорт, аттестат, 4 фото 3×4, медсправку 086, СНИЛС\n3. Подайте заявление в приёмной комиссии (каб. 101) или через Госуслуги\n4. Вступительные испытания — по среднему баллу аттестата\n\n📞 По вопросам: +7 (343) 378-17-25 (доб. 3)';
    } 
    else if (q.includes('документ') || q.includes('список документов')) {
        localAnswer = '📋 *Список документов:*\n\n1️⃣ Паспорт\n2️⃣ Аттестат\n3️⃣ Фото 3×4 (4 шт)\n4️⃣ Медсправка 086\n5️⃣ Прививочный сертификат\n6️⃣ Медполис\n7️⃣ СНИЛС\n8️⃣ ИНН (при наличии)\n9️⃣ Документы о льготах\n🔟 Приписное (для юношей)\n\n🗓️ Срок подачи: до 15 августа';
    }
    else if (q.includes('средний балл') || q.includes('проходной балл')) {
        localAnswer = '📊 *Средние баллы аттестата 2025:*\n\n• Реклама — 4.1\n• Банковское дело — 3.9\n• Дизайн в СМИ — 4.03\n• Коммерция и технология — 4.3\n• Мастер швейных изделий — 3.9\n• Оператор швейного оборудования — 3.79';
    }
    else if (q.includes('контакты') || q.includes('телефон') || q.includes('адрес')) {
        localAnswer = '📍 *Контакты приёмной комиссии:*\n\n📞 +7 (343) 378-17-25 (доб. 3)\n✉️ postupi@otdis.ru\n🌐 otdis.ru\n🏢 г. Екатеринбург, пер. Красный, д. 3\n🕒 Пн-Пт 09:00-16:00, Сб 10:00-14:00';
    }

    else if (q.includes('дизайн') && (q.includes('экзамен') || q.includes('поступить') || q.includes('вступительный'))) {
    localAnswer = '🎨 *Творческие испытания для специальностей в сфере дизайна в ОТДИС:*\n\n• Живопись красками (постановка из нескольких бытовых предметов)\n\nДля специальностей: "Дизайн (легкая промышленность)" и "Декоративно-прикладное искусство".\n\n⭐ Оценивание: система "зачёт / незачёт".\n\n📅 Срок проведения: 6 — 12 августа 2026 года.\n\n📌 День испытания выбирается при подаче заявления.\n\n📞 По вопросам: +7 (343) 378-17-25 (доб. 3)';
    }
    
    else if ((q.includes('конструирование') || q.includes('реклама')) && (q.includes('экзамен') || q.includes('поступить') || q.includes('вступительный'))) {
    localAnswer = '✏️ *Творческие испытания для специальностей:*\n\n• Конструирование, моделирование и технология швейных изделий\n• Реклама\n\n📝 Задание: рисунок карандашом (постановка из нескольких геометрических фигур)\n\n⭐ Оценивание: система "зачёт / незачёт".\n\n📅 Срок проведения: 6 — 12 августа 2026 года.';
    }

    if (localAnswer) {
        return localAnswer;
    }
    
    try {
        const response = await axios({
            method: 'post',
            url: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
            headers: {
                'Authorization': `Api-Key ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                modelUri: `gpt://${FOLDER_ID}/yandexgpt-lite`,
                completionOptions: { stream: false, temperature: 0.7, maxTokens: 500 },
                messages: [
                    { role: "system", text: `Ты — официальный помощник приёмной комиссии ОТДИС (Областной техникум дизайна и сервиса, г. Екатеринбург).
Твоя задача — отвечать на любые вопросы абитуриентов и их родителей, СРАЗУ понимая, что речь идёт об ОТДИС.
НЕ ЗАДАВАЙ уточняющих вопросов типа "какого учреждения" или "какого города". Ты уже знаешь контекст.
Отвечай конкретно, дружелюбно и по делу.

ПОДСКАЗКИ ДЛЯ АБИТУРИЕНТОВ:
• Доехать лучше всего на метро до станции "Динамо" (выход к Красному переулку)
• Скажите "Старт" или нажмите кнопку "Главное меню" — там вы найдёте всё: направления, документы, вступительные испытания, примеры работ и запись на консультацию

Если не знаешь точного ответа — скажи: "Уточню у приёмной комиссии и отвечу вам в ближайшее время."
Никогда не отправляй пользователя на сайт — давай ответ самостоятельно.` },
                    { role: "user", text: question }
                ]
            }
        });
        return response.data.result.alternatives[0].message.text;
    } catch (e) {
        console.error('Ошибка YandexGPT:', e.message);
        return '❓ Извините, я временно не могу ответить. Напишите свой вопрос, и специалист свяжется с вами.';
    }
}

// ========== ОБРАБОТЧИКИ ==========
bot.command('admin', async (ctx) => { await showAdminCalendar(ctx); });

bot.command('start', (ctx) => {
    const userName = ctx.message?.sender?.name || 'Абитуриент';
    ctx.reply(`🎓 *ОТДИС — Приёмная комиссия*\n\n👋 *Добро пожаловать, ${userName}!*\n\n👇 *Отправьте номер нужного пункта (1-5)*`);
    sendMainMenu(ctx);
});

bot.command('startapp', async (ctx) => {
    const fullText = ctx.message?.body?.text || '';
    const payload = fullText.replace('/startapp', '').trim();
    console.log(`📥 Получен диплинк. Payload: "${payload}"`);
    if (!payload) {
        await ctx.reply(`👋 Добро пожаловать! Напишите "меню" или "0", чтобы начать.`);
        return;
    }
    const decodedText = decodeURIComponent(payload);
    console.log(`📄 Расшифровано: ${decodedText}`);
    if (decodedText.includes('ЗАПИСЬ:')) {
        const lines = decodedText.split('\n');
        let bookingData = {};
        for (const line of lines) {
            if (line.includes('Имя:')) bookingData.user_name = line.replace('Имя:', '').trim();
            if (line.includes('Телефон:')) bookingData.phone = line.replace('Телефон:', '').trim();
            if (line.includes('Дата:')) bookingData.date = line.replace('Дата:', '').trim();
            if (line.includes('Время:')) bookingData.time = line.replace('Время:', '').trim();
        }
        bookingData.user_id = ctx.message?.sender?.user_id?.toString();
        bookingData.purpose = 'Запись через мини-приложение';
        addBooking(bookingData);
        await ctx.reply(`✅ *Вы успешно записаны!*\n\n📅 *Дата:* ${bookingData.date}\n🕐 *Время:* ${bookingData.time}\n📞 *Телефон:* ${bookingData.phone || 'не указан'}\n\nСпециалист свяжется с вами для подтверждения.\n\n🔹 Напишите "меню" или "0", чтобы вернуться в главное меню`);
        console.log(`💾 Сохранена запись: ${bookingData.user_name} на ${bookingData.date} ${bookingData.time}`);
    } else {
        await ctx.reply(`📝 *Данные получены*\n\nНо формат не распознан. Пожалуйста, попробуйте ещё раз или напишите "меню", чтобы вернуться в главное меню.`);
    }
});

bot.on('message_created', async (ctx) => {
    const text = ctx.message?.body?.text || '';
    console.log(`🔍 ВСЕ СООБЩЕНИЯ: "${text}"`);
    const textLower = text.toLowerCase().trim();
    const userName = ctx.message?.sender?.name || 'Абитуриент';
    const userId = ctx.message?.sender?.user_id?.toString();
    
    const state = userStates.get(userId);
    if (state && state.step === 'awaiting_phone') {
        const phone = text === 'пропустить' ? null : text;
        await saveBookingFinal(ctx, userId, userName, phone);
        return;
    }
    
    if (text.startsWith('ЗАПИСЬ:')) {
        console.log(`📝 Получена запись из мини-приложения от ${userName}`);
        const lines = text.split('\n');
        let bookingData = {};
        for (const line of lines) {
            if (line.includes('Имя:')) bookingData.user_name = line.replace('Имя:', '').trim();
            if (line.includes('Телефон:')) bookingData.phone = line.replace('Телефон:', '').trim();
            if (line.includes('Дата:')) bookingData.date = line.replace('Дата:', '').trim();
            if (line.includes('Время:')) bookingData.time = line.replace('Время:', '').trim();
        }
        bookingData.user_id = userId;
        bookingData.purpose = 'Запись через мини-приложение';
        addBooking(bookingData);
        await ctx.reply(`✅ *Вы успешно записаны!*\n\n📅 *Дата:* ${bookingData.date}\n🕐 *Время:* ${bookingData.time}\n📞 *Телефон:* ${bookingData.phone || 'не указан'}\n\nСпециалист свяжется с вами для подтверждения.\n\n🔹 Напишите "меню" или "0", чтобы вернуться в главное меню`);
        console.log(`💾 Сохранена запись: ${bookingData.user_name} на ${bookingData.date} ${bookingData.time}`);
        return;
    }
    
    if (shouldShowMenu(text)) {
        sendMainMenu(ctx);
        userStates.delete(userId);
        return;
    }
    
    let reply = '';
    
    if (text === '1' || textLower.includes('балл')) {
        reply = '📊 *СРЕДНИЕ БАЛЛЫ 2025*\n\n• Реклама — 4,1\n• Банковское дело — 3,9\n• Дизайн в СМИ — 4,03\n• КМ и технология — 4,3\n• Мастер швейных изделий — 3,9\n• Оператор швейного оборудования — 3,79';
    }
    else if (text === '2' || textLower.includes('документ')) {
        reply = '📋 *СПИСОК ДОКУМЕНТОВ*\n\n1️⃣ Паспорт\n2️⃣ Аттестат\n3️⃣ Фото 3×4 (4 шт)\n4️⃣ Медсправка 086\n5️⃣ Прививочный сертификат\n6️⃣ Медполис\n7️⃣ СНИЛС\n8️⃣ Документы о льготах\n9️⃣ ИНН\n🔟 Документы об инвалидности\n1️⃣1️⃣ Заключение ПМПК\n1️⃣2️⃣ Приписное\n\n🗓️ Срок подачи: до 15 августа';
    }
    else if (text === '3' || textLower.includes('запись')) {
        const appUrl = `https://imdykman.github.io/max-booking/`;
        await ctx.reply(`📅 *Запись на подачу документов или на консультацию*\n\nНажмите на кнопку ниже, чтобы открыть календарь и выбрать удобное время:`, {
            reply_markup: { inline_keyboard: [[{ text: "📅 Открыть календарь", web_app: { url: appUrl } }]] }
        });
        return;
    }
    else if (text === '4' || textLower.includes('контакт')) {
        reply = '📍 *КОНТАКТЫ*\n\n📞 +7 (343) 378-17-25 (доб. 3)\n✉️ postupi@otdis.ru\n🌐 otdis.ru\n🏢 г. Екатеринбург, пер. Красный, д. 3\n🕒 Пн-Пт 09:00-16:00, Сб 10:00-14:00';
    }
    else if (text === '5' || (text && !text.startsWith('/') && !text.startsWith('ЗАПИСЬ:'))) {
        const aiAnswer = await askYandexGPT(text);
        reply = aiAnswer || '❓ Извините, я временно не могу ответить. Напишите свой вопрос, и специалист свяжется с вами.';
    }
    else if (text && !text.startsWith('/')) {
        console.log(`📝 Вопрос от ${userName}: ${text}`);
        reply = `❓ *Спасибо, ${userName}!* Ваш вопрос принят.`;
    }
    
    if (reply) ctx.reply(reply);
});

// Обработка callback-запросов
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.callbackQuery.from?.id?.toString();
    
    if (data.startsWith('no_slots_')) {
        await ctx.answerCallbackQuery({ text: 'На эту дату все слоты заняты', show_alert: true });
        return;
    }
    if (data === 'cancel_booking') {
        userStates.delete(userId);
        sendMainMenu(ctx);
        await ctx.answerCallbackQuery();
        return;
    }
    if (data === 'back_to_dates') {
        await showAvailableDates(ctx, userId);
        await ctx.answerCallbackQuery();
        return;
    }
    if (data.startsWith('nav_')) {
        const offset = parseInt(data.replace('nav_', ''));
        await showAvailableDates(ctx, userId, offset);
        await ctx.answerCallbackQuery();
        return;
    }
    if (data.startsWith('date_')) {
        const dateISO = data.replace('date_', '');
        await showTimeSlots(ctx, userId, dateISO);
        await ctx.answerCallbackQuery();
        return;
    }
    if (data.startsWith('time_')) {
        const parts = data.replace('time_', '').split('_');
        const time = parts[0].replace(/(\d{2})(\d{2})/, '$1:$2');
        const dateISO = parts[1];
        await askForPhone(ctx, userId, dateISO, time);
        await ctx.answerCallbackQuery();
        return;
    }
    await ctx.answerCallbackQuery();
});

// Запуск
bot.start();
console.log('\n' + '='.repeat(50));
console.log('🤖 Бот ОТДИС v4.0 (с календарём)');
console.log('📅 Выберите пункт 3 для записи');
console.log('👑 Админ: /admin');
console.log('='.repeat(50));