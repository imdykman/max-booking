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

let cachedExamDates = null;
let cacheTimestamp = null;
const CACHE_DURATION = 3600000;

async function fetchExamDates() {
    if (cachedExamDates && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_DURATION) {
        return cachedExamDates;
    }
    try {
        const https = require('https');
        const html = await new Promise((resolve, reject) => {
            https.get('https://www.otdis.ru/abitur/spo/', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
        let consultText = '';
        if (html.includes('общая консультация')) {
            const consultIndex = html.indexOf('общая консультация');
            const beforeText = html.substring(Math.max(0, consultIndex - 100), consultIndex);
            const dateMatch = beforeText.match(/(\d{2}\.\d{2}\.\d{4})/);
            const timeMatch = beforeText.match(/(\d{2}\.\d{2})/);
            if (dateMatch && dateMatch[1].includes('2026')) {
                consultText = `${dateMatch[1]} в ${timeMatch ? timeMatch[1] : '16.00'} состоится общая консультация к вступительным испытаниям.`;
            }
        }
        const tableMatch = html.match(/Расписание вступительных испытаний([\s\S]*?)<\/table>/i);
        let examDates = [];
        if (tableMatch) {
            const tableHtml = tableMatch[1];
            const datePattern = /\b(\d{2}\.\d{2}\.\d{4})\b/g;
            const allDates = tableHtml.match(datePattern) || [];
            examDates = [...new Set(allDates.filter(d => d.includes('2026')))];
            examDates.sort();
        }
        const result = {
            examDates: examDates,
            consultText: consultText,
            fullText: examDates.length ? 
                `Вступительные испытания пройдут с ${examDates[0]} по ${examDates[examDates.length-1]} 2026 года. ${consultText} Актуальное расписание можно уточнить на сайте otdis.ru` :
                'уточняйте на сайте otdis.ru'
        };
        cachedExamDates = result;
        cacheTimestamp = Date.now();
        console.log(`📅 Даты ВИ: ${examDates.join(', ')} | Консультация: ${consultText}`);
        return result;
    } catch (e) {
        console.error('❌ Ошибка парсинга дат:', e.message);
        return cachedExamDates || { examDates: [], consultText: '', fullText: 'уточняйте на сайте otdis.ru' };
    }
}

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

// ========== ФУНКЦИИ ДЛЯ КАЛЕНДАРЯ ==========
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

// ========== КЛАВИАТУРЫ ==========
const footer = '\n\n---\n💡 *Больше информации в приложении* (кнопка "Старт") *или по текстовому запросу*';

function getMainMenu() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback('🎓 Направления подготовки', 'main_directions')],
        [Keyboard.button.callback('📊 Средние баллы', 'main_scores')],
        [Keyboard.button.callback('📋 Список документов', 'main_documents')],
        [Keyboard.button.callback('🎨 Вступительные испытания', 'main_exams')],
        [Keyboard.button.callback('⚡ Профессионалитет', 'main_prof')],
        [Keyboard.button.callback('📍 Контакты', 'main_contacts')],
        [Keyboard.button.callback('📚 Подготовительные курсы', 'main_prepcourses')],
        [Keyboard.button.callback('💬 Вопросы-ответы', 'main_faq')]
    ]);
}

function getDirectionsCategories() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback('Бюджетные места', 'cat_budget')],
        [Keyboard.button.callback('Платное обучение', 'cat_paid')],
        [Keyboard.button.callback('Для лиц с ОВЗ', 'cat_ovz')],
        [Keyboard.button.callback('← Назад', 'back_to_main')]
    ]);
}

function getBudgetSpecialties() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback('Конструирование, моделирование...', 'spec_construction')],
        [Keyboard.button.callback('Дизайн (легкая промышленность)', 'spec_design_light')],
        [Keyboard.button.callback('Мастер по изготовлению швейных изделий', 'spec_master')],
        [Keyboard.button.callback('Оператор швейного оборудования', 'spec_operator')],
        [Keyboard.button.callback('Художник по костюму', 'spec_artist')],
        [Keyboard.button.callback('Декоративно-прикладное искусство', 'spec_dpi')],
        [Keyboard.button.callback('← Назад', 'back_to_directions')]
    ]);
}

function getPaidSpecialties() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback('Реклама', 'spec_advert')],
        [Keyboard.button.callback('Банковское дело', 'spec_bank')],
        [Keyboard.button.callback('Дизайн (СМИ и полиграфия)', 'spec_design_media')],
        [Keyboard.button.callback('← Назад', 'back_to_directions')]
    ]);
}

function getOzvSpecialties() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback('Оператор швейного оборудования (швея)', 'spec_seamstress')],
        [Keyboard.button.callback('← Назад', 'back_to_directions')]
    ]);
}

function getExamsSubmenu() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback('Рисунок карандашом', 'exam_drawing')],
        [Keyboard.button.callback('Живопись красками', 'exam_painting')],
        [Keyboard.button.callback('Даты проведения', 'exam_dates')],
        [Keyboard.button.callback('← Назад', 'back_to_main')]
    ]);
}

function getSpecialtyInfo(specId) {
    const specs = {
        'construction': '🎓 *Конструирование, моделирование и технология швейных изделий*\n\n• Срок обучения: 2 года 10 месяцев\n• Квалификация: Технолог-конструктор швейных изделий\n• Форма обучения: Очная\n• Бюджетные места: есть',
        'design_light': '🎓 *Дизайн (легкая промышленность)*\n\n• Срок обучения: 3 года 10 месяцев\n• Квалификация: Дизайнер\n• Форма обучения: Очная\n• Бюджетные места: есть',
        'master': '🎓 *Мастер по изготовлению швейных изделий*\n\n• Срок обучения: 1 год 10 месяцев\n• Квалификация: Мастер швейного производства\n• Форма обучения: Очная\n• Бюджетные места: есть',
        'operator': '🎓 *Оператор швейного оборудования*\n\n• Срок обучения: 1 год 10 месяцев\n• Квалификация: Оператор швейного оборудования\n• Форма обучения: Очная\n• Бюджетные места: есть',
        'artist': '🎓 *Художник по костюму*\n\n• Срок обучения: 1 год 10 месяцев\n• Квалификация: Художник по костюму\n• Форма обучения: Очная\n• Бюджетные места: есть',
        'dpi': '🎓 *Декоративно-прикладное искусство*\n\n• Срок обучения: 3 года 10 месяцев\n• Квалификация: Специалист по художественно-графическому оформлению\n• Форма обучения: Очная\n• Бюджетные места: есть',
        'advert': '🎓 *Реклама*\n\n• Срок обучения: 2 года 10 месяцев\n• Квалификация: Специалист по рекламе\n• Форма обучения: Очная\n• Стоимость: 122 000 ₽/год',
        'bank': '🎓 *Банковское дело*\n\n• Срок обучения: 2 года 10 месяцев\n• Квалификация: Специалист банковского дела\n• Форма обучения: Очная\n• Стоимость: 122 000 ₽/год',
        'design_media': '🎓 *Дизайн (СМИ и полиграфия)*\n\n• Срок обучения: 3 года 10 месяцев\n• Квалификация: Графический дизайнер\n• Форма обучения: Очная\n• Стоимость: 132 500 ₽/год',
        'seamstress': '🎓 *Оператор швейного оборудования (швея)*\n\n• Срок обучения: 1 год 10 месяцев\n• Квалификация: Швея\n• Форма обучения: Очная\n• Для лиц с ОВЗ'
    };
    return specs[specId] || 'Информация уточняется';
}

async function sendWelcome(ctx) {
    const userName = ctx.message?.sender?.name || ctx.user?.name || 'Абитуриент';
    await ctx.reply(
        `🎓 *ОТДИС — Приёмная комиссия*\n\n👋 *Добро пожаловать, ${userName}!*\n\nЯ — официальный помощник. Выберите раздел:`,
        { attachments: [getMainMenu()] }
    );
}

async function askYandexGPT(question) {
    const maxRetries = 3;
    const examInfo = await fetchExamDates();
    const examDatesText = examInfo.fullText;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios({
                method: 'post',
                url: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
                headers: { 'Authorization': `Api-Key ${YANDEX_API_KEY}`, 'Content-Type': 'application/json' },
                data: {
                    modelUri: `gpt://${FOLDER_ID}/yandexgpt-lite`,
                    completionOptions: { stream: false, temperature: 0.7, maxTokens: 600 },
                    messages: [{ role: "system", text: `Ты — вежливый и дружелюбный помощник ОТДИС. Используй эту информацию:

📌 АДРЕС: г. Екатеринбург, пер. Красный, д. 3, метро "Динамо"
📞 ТЕЛЕФОН: +7 (343) 378-17-25 (доб. 3)
🕒 ЧАСЫ РАБОТЫ: Пн-Пт 09:00-16:00, Сб 10:00-14:00
📅 ПРИЁМ ДОКУМЕНТОВ: 20.06-15.08.2026, для ВИ до 10.08
📋 ДОКУМЕНТЫ: паспорт, аттестат, 4 фото, медсправка 086, прививочный сертификат, полис, СНИЛС, ИНН, льготы, приписное
🎓 БЮДЖЕТ: Конструирование, Дизайн (легпром), Мастер швейных изделий, Оператор, Художник по костюму, ДПИ
💰 ПЛАТНО: Реклама 122к, Банковское дело 122к, Дизайн (СМИ) 132.5к
🎨 ВСТУПИТЕЛЬНЫЕ: ${examDatesText}
🏢 ОБЩЕЖИТИЕ: ул. Репина, 19
🎓 ПОСТУПЛЕНИЕ ПОСЛЕ 9: да
📚 ПОДГОТОВИТЕЛЬНЫЕ КУРСЫ: https://forms.yandex.ru/u/644a463b02848f025d94c774/
💡 ЛЬГОТЫ: https://www.otdis.ru/abitur/spo/

ПРАВИЛА: начинай с приветствия, благодари за вопрос, в конце спроси "Остались ли вопросы?". НЕ отправляй на сайт (кроме ссылок). НЕ задавай уточняющих вопросов.` }, { role: "user", text: question }]
                }
            });
            return response.data.result.alternatives[0].message.text;
        } catch (e) {
            console.log(`⚠️ Попытка ${attempt} из ${maxRetries} не удалась: ${e.message}`);
            if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }
    return '❓ Извините, сервер временно недоступен. Попробуйте ещё раз через минуту.';
}

// ========== ОСНОВНЫЕ ОБРАБОТЧИКИ ==========
bot.on('bot_started', async (ctx) => { await sendWelcome(ctx); });
bot.command('start', async (ctx) => { await sendWelcome(ctx); });
bot.command('admin', async (ctx) => { await showAdminCalendar(ctx); });

bot.on('message_callback', async (ctx) => {
    const data = ctx.callback.payload;
    console.log(`🔘 НАЖАТА КНОПКА: ${data}`);
    
    // Игнорируем старые/неизвестные кнопки без ответа
const knownButtons = [
    'back_to_main', 'back_to_directions', 'main_directions', 'cat_budget', 'cat_paid', 'cat_ovz',
    'main_exams', 'exam_drawing', 'exam_painting', 'exam_dates',
    'spec_construction', 'spec_design_light', 'spec_master', 'spec_operator', 'spec_artist', 'spec_dpi',
    'spec_advert', 'spec_bank', 'spec_design_media', 'spec_seamstress',
    'main_scores', 'main_documents', 'main_prof', 'main_contacts', 'main_prepcourses', 'main_faq'
];

if (!knownButtons.includes(data)) {
    console.log(`⚠️ Игнорируем неизвестную кнопку: ${data}`);
    return; // просто выходим, без ответа
}

    // Навигация
    if (data === 'back_to_main') { await ctx.reply('Главное меню:', { attachments: [getMainMenu()] }); return; }
    if (data === 'back_to_directions') { await ctx.reply('Выберите категорию:', { attachments: [getDirectionsCategories()] }); return; }
    if (data === 'main_directions') { await ctx.reply('Выберите категорию:', { attachments: [getDirectionsCategories()] }); return; }
    if (data === 'cat_budget') { await ctx.reply('Бюджетные специальности:', { attachments: [getBudgetSpecialties()] }); return; }
    if (data === 'cat_paid') { await ctx.reply('Платные специальности:', { attachments: [getPaidSpecialties()] }); return; }
    if (data === 'cat_ovz') { await ctx.reply('Специальности для лиц с ОВЗ:', { attachments: [getOzvSpecialties()] }); return; }
    if (data === 'main_exams') { await ctx.reply('Выберите раздел:', { attachments: [getExamsSubmenu()] }); return; }
    if (data === 'exam_drawing') { await ctx.reply('✏️ *Рисунок карандашом*\n\nДля специальностей: Конструирование, Реклама\n\nПостановка из нескольких геометрических фигур.\n\n⭐ Оценивание: "зачёт / незачёт"' + footer); return; }
    if (data === 'exam_painting') { await ctx.reply('🎨 *Живопись красками*\n\nДля специальностей: Дизайн (легкая промышленность), Декоративно-прикладное искусство\n\nПостановка из нескольких бытовых предметов.\n\n⭐ Оценивание: "зачёт / незачёт"' + footer); return; }
    if (data === 'exam_dates') { const examInfo = await fetchExamDates(); await ctx.reply(`📅 *Даты вступительных испытаний*\n\n${examInfo.fullText}${footer}`); return; }
    
    // Специальности
    const specs = ['spec_construction', 'spec_design_light', 'spec_master', 'spec_operator', 'spec_artist', 'spec_dpi', 'spec_advert', 'spec_bank', 'spec_design_media', 'spec_seamstress'];
    if (specs.includes(data)) {
        const info = getSpecialtyInfo(data.replace('spec_', ''));
        await ctx.reply(info + footer);
        if (data === 'spec_advert' || data === 'spec_bank' || data === 'spec_design_media') {
            await ctx.reply('Выберите другую специальность:', { attachments: [getPaidSpecialties()] });
        } else if (data === 'spec_seamstress') {
            await ctx.reply('Выберите другую специальность:', { attachments: [getOzvSpecialties()] });
        } else {
            await ctx.reply('Выберите другую специальность:', { attachments: [getBudgetSpecialties()] });
        }
        return;
    }
    
    // Простые ответы
    if (data === 'main_scores') { await ctx.reply('📊 *Средние баллы аттестата 2025:*\n\n• Реклама — 4.1\n• Банковское дело — 3.9\n• Дизайн в СМИ — 4.03\n• КМ и технология — 4.3\n• Мастер швейных изделий — 3.9\n• Оператор швейного оборудования — 3.79' + footer); return; }
    if (data === 'main_documents') { await ctx.reply('📋 *Список документов:*\n\n1️⃣ Паспорт\n2️⃣ Аттестат\n3️⃣ Фото 3×4 (4 шт)\n4️⃣ Медсправка 086\n5️⃣ Прививочный сертификат\n6️⃣ Медполис\n7️⃣ СНИЛС\n8️⃣ ИНН\n9️⃣ Документы о льготах\n🔟 Приписное' + footer); return; }
    if (data === 'main_prof') { await ctx.reply('⚡ *Профессионалитет*\n\n«Профессионалитет» — федеральный проект с сокращёнными сроками обучения.\n\n📌 Программы:\n• Мастер по изготовлению швейных изделий\n• Оператор швейного оборудования\n• Конструирование, моделирование швейных изделий\n• Дизайнер в легкой промышленности' + footer); return; }
    if (data === 'main_contacts') { await ctx.reply('📍 *Контакты*\n\n📞 +7 (343) 378-17-25 (доб. 3)\n✉️ postupi@otdis.ru\n🌐 otdis.ru\n🏢 г. Екатеринбург, пер. Красный, д. 3\n\n🚇 Метро: "Динамо", выход к Красному переулку' + footer); return; }
    if (data === 'main_prepcourses') { await ctx.reply('📚 *Подготовительные курсы*\n\n🎨 Подготовка к рисунку и живописи\n• Продолжительность: 48 часов\n• Место: Стахановская, д. 43\n• Координатор: Лапина Анна Валерьевна\n• Телефон: (343) 378-17-25 (доб.15)\n\n🔗 Запись: https://forms.yandex.ru/u/644a463b02848f025d94c774/' + footer); return; }
    if (data === 'main_faq') { await ctx.reply('💬 *Часто задаваемые вопросы*\n\n❓ *Какие документы нужны для поступления?*\nПаспорт, аттестат, фото 3×4, медсправка 086, прививочный сертификат, полис, СНИЛС, ИНН, документы о льготах, приписное.\n\n❓ *Можно ли перевестись с платного на бюджет?*\nДа, если учитесь на "отлично" и есть свободные бюджетные места.\n\n❓ *Как подать заявление дистанционно?*\nЧерез личный кабинет абитуриента или портал Госуслуг.\n\n❓ *Есть ли общежитие?*\nДа, ул. Репина, 19' + footer); return; }
        
});

bot.on('message_created', async (ctx) => {
    const text = ctx.message?.body?.text || '';
    if (text.startsWith('/')) return;
    console.log(`💬 Получен текст: "${text}"`);
    const aiAnswer = await askYandexGPT(text);
    await ctx.reply(aiAnswer + footer);
});

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.callbackQuery.from?.id?.toString();
    if (data === 'cancel_booking') { userStates.delete(userId); await sendWelcome(ctx); return; }
    if (data === 'back_to_dates') { await showAvailableDates(ctx, userId); return; }
    if (data.startsWith('nav_')) { const offset = parseInt(data.replace('nav_', '')); await showAvailableDates(ctx, userId, offset); return; }
    if (data.startsWith('date_')) { const dateISO = data.replace('date_', ''); await showTimeSlots(ctx, userId, dateISO); return; }
    if (data.startsWith('time_')) { const parts = data.replace('time_', '').split('_'); const time = parts[0].replace(/(\d{2})(\d{2})/, '$1:$2'); const dateISO = parts[1]; await askForPhone(ctx, userId, dateISO, time); return; }
});

bot.start();
console.log('\n' + '='.repeat(50));
console.log('🤖 Бот ОТДИС v8.5 (Трёхуровневое меню)');
console.log('📱 Навигация как в приложении');
console.log('👑 Админ: /admin');
console.log('='.repeat(50));