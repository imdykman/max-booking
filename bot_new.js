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

// ========== КЛАВИАТУРА С ВОПРОСАМИ ==========
const questionsKeyboard = {
    keyboard: [
        [{ text: "🎓 Направления подготовки" }],
        [{ text: "📋 Какие документы нужны?" }],
        [{ text: "📍 Где подать документы?" }],
        [{ text: "💰 Стоимость обучения" }],
        [{ text: "🎨 Вступительные испытания" }],
        [{ text: "🕒 Часы работы" }],
        [{ text: "⚡ Профессионалитет" }],
        [{ text: "📚 Подготовительные курсы" }],
        [{ text: "📅 Запись на консультацию" }],
        [{ text: "❓ Другой вопрос" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
};

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========
async function sendWelcome(ctx) {
    const userName = ctx.message?.sender?.name || 'Абитуриент';
    await ctx.reply(
        `🎓 *ОТДИС — Приёмная комиссия*\n\n` +
        `👋 *Добро пожаловать, ${userName}!*\n\n` +
        `Я — официальный помощник. Задайте мне любой вопрос о поступлении.\n\n` +
        `📱 *У нас есть удобное приложение-календарь!*\n` +
        `Нажмите на кнопку ниже, чтобы открыть его:`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📅 Открыть приложение ОТДИС", web_app: { url: "https://imdykman.github.io/max-booking/" } }]
                ]
            }
        }
    );
    await ctx.reply(
        `👇 *Или выберите популярный вопрос из кнопок ниже:*\n\n` +
        `💡 *Совет:* Если не нашли свой вопрос — просто напишите его текстом.`,
        { reply_markup: questionsKeyboard }
    );
}

// ========== ФУНКЦИЯ YANDEXGPT ==========
async function askYandexGPT(question) {
    const API_KEY = process.env.YANDEX_API_KEY;
    const FOLDER_ID = process.env.FOLDER_ID;
    
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
                    completionOptions: { stream: false, temperature: 0.7, maxTokens: 600 },
                    messages: [
                        { role: "system", text: `Ты — вежливый и дружелюбный официальный помощник приёмной комиссии ОТДИС (Областной техникум дизайна и сервиса, г. Екатеринбург).

ВОТ ВСЯ ИНФОРМАЦИЯ, КОТОРУЮ ТЫ ДОЛЖЕН ЗНАТЬ:

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

📅 СРОКИ ПРИЁМА ДОКУМЕНТОВ НА 2026 ГОД:
• Начало приёма: 20 июля 2026
• Окончание приёма: 15 августа 2026
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

Бюджетные места:
• Конструирование, моделирование и технология швейных изделий (2 года 10 мес., технолог-конструктор)
• Дизайн (легкая промышленность) (3 года 10 мес., дизайнер)
• Мастер по изготовлению швейных изделий (1 год 10 мес.)
• Оператор швейного оборудования (1 год 10 мес.)
• Художник по костюму (1 год 10 мес.)
• Декоративно-прикладное искусство (3 года 10 мес., специалист по художественно-графическому оформлению)

Платные места:
• Реклама — 122 000 ₽/год (2 года 10 мес.)
• Банковское дело — 122 000 ₽/год (2 года 10 мес.)
• Дизайн (СМИ и полиграфия) — 132 500 ₽/год (3 года 10 мес.)

🎨 ВСТУПИТЕЛЬНЫЕ ИСПЫТАНИЯ (творческие):

Рисунок карандашом — для специальностей:
• Конструирование, моделирование и технология швейных изделий
• Реклама

Живопись красками — для специальностей:
• Дизайн (легкая промышленность)
• Декоративно-прикладное искусство

Оценивание: "зачёт / незачёт"
Срок проведения: 6 — 12 августа 2026

⚡ ПРОФЕССИОНАЛИТЕТ:
Программы с сокращёнными сроками:
• Мастер по изготовлению швейных изделий
• Оператор швейного оборудования
• Конструирование, моделирование швейных изделий
• Дизайнер в легкой промышленности

📚 ПОДГОТОВИТЕЛЬНЫЕ КУРСЫ:
• Подготовка к рисунку и живописи
• Продолжительность: 48 часов
• Место: Стахановская, д. 43
• Координатор: Лапина Анна Валерьевна
• Телефон: (343) 378-17-25 (доб.15)

📊 СРЕДНИЕ БАЛЛЫ АТТЕСТАТА 2025:
• Реклама — 4.1
• Банковское дело — 3.9
• Дизайн в СМИ — 4.03
• Коммерция и технология — 4.3
• Мастер швейных изделий — 3.9
• Оператор швейного оборудования — 3.79

ПРАВИЛА ОБЩЕНИЯ:
• Всегда начинай ответ с приветствия: "Здравствуйте!" или "Добрый день!"
• Благодари за вопрос
• Если вопрос про адрес/где подать — отвечай адресом
• Если вопрос про документы — перечисляй список
• Если вопрос про стоимость — называй цены
• В конце спроси: "Остались ли у вас ещё вопросы?"
• НЕ отправляй пользователя на сайт
• НЕ задавай уточняющих вопросов — ты уже знаешь контекст ОТДИС` },
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
bot.command('admin', async (ctx) => { await showAdminCalendar(ctx); });

bot.command('start', async (ctx) => {
    await sendWelcome(ctx);
});

bot.command('startapp', async (ctx) => {
    const fullText = ctx.message?.body?.text || '';
    const payload = fullText.replace('/startapp', '').trim();
    console.log(`📥 Получен диплинк. Payload: "${payload}"`);
    
    if (!payload) {
        await sendWelcome(ctx);
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
        await ctx.reply(`✅ *Вы успешно записаны!*\n\n📅 *Дата:* ${bookingData.date}\n🕐 *Время:* ${bookingData.time}\n📞 *Телефон:* ${bookingData.phone || 'не указан'}\n\nСпециалист свяжется с вами для подтверждения.`);
        console.log(`💾 Сохранена запись: ${bookingData.user_name} на ${bookingData.date} ${bookingData.time}`);
    } else {
        await sendWelcome(ctx);
    }
});

bot.on('message_created', async (ctx) => {
    const text = ctx.message?.body?.text || '';
    console.log(`🔍 ВСЕ СООБЩЕНИЯ: "${text}"`);
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
        await ctx.reply(`✅ *Вы успешно записаны!*\n\n📅 *Дата:* ${bookingData.date}\n🕐 *Время:* ${bookingData.time}\n📞 *Телефон:* ${bookingData.phone || 'не указан'}\n\nСпециалист свяжется с вами для подтверждения.`);
        console.log(`💾 Сохранена запись: ${bookingData.user_name} на ${bookingData.date} ${bookingData.time}`);
        return;
    }
    
    // Запись на консультацию
    if (text === '📅 Запись на консультацию') {
        await ctx.reply(
            `📞 *Запись на консультацию*\n\nОставьте, пожалуйста, ваш номер телефона, и специалист свяжется с вами в ближайшее время.\n\nИли воспользуйтесь нашим приложением (кнопка "Открыть приложение ОТДИС").`
        );
        userStates.set(userId, { step: 'awaiting_phone', selectedDate: null, selectedTime: null });
        return;
    }
    
    // Другой вопрос
    if (text === '❓ Другой вопрос') {
        await ctx.reply(`❓ *Задайте ваш вопрос*\n\nНапишите его текстом, и я постараюсь ответить.`);
        return;
    }
    
    // Обработка кнопок с вопросами
    let questionForAI = text;
    if (text === '🎓 Направления подготовки') questionForAI = 'Какие направления подготовки есть в ОТДИС?';
    else if (text === '📋 Какие документы нужны?') questionForAI = 'Какие документы нужны для поступления?';
    else if (text === '📍 Где подать документы?') questionForAI = 'Где подать документы?';
    else if (text === '💰 Стоимость обучения') questionForAI = 'Сколько стоит обучение?';
    else if (text === '🎨 Вступительные испытания') questionForAI = 'Какие вступительные испытания?';
    else if (text === '🕒 Часы работы') questionForAI = 'Часы работы приёмной комиссии';
    else if (text === '⚡ Профессионалитет') questionForAI = 'Что такое Профессионалитет?';
    else if (text === '📚 Подготовительные курсы') questionForAI = 'Расскажи про подготовительные курсы';
    
    const aiAnswer = await askYandexGPT(questionForAI);
    await ctx.reply(aiAnswer);
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
console.log('🤖 Бот ОТДИС v8.0 (ИИ + кнопки)');
console.log('💬 Бот отвечает на любые вопросы');
console.log('👑 Админ: /admin');
console.log('='.repeat(50));