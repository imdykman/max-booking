📄 Резюме проекта: Чат-бот и приложение ОТДИС
1. Общая архитектура
Компонент	Технология	Размещение
Чат-бот	Node.js, @maxhub/max-bot-api	Ваш Windows Server (pm2)
Мини-приложение	HTML/CSS/JS, MAX Web App SDK	GitHub Pages
ИИ-ассистент	YandexGPT API (Yandex Cloud)	Облако
Хранение данных	JSON-файлы (bookings.json)	На сервере
2. Ключевые файлы проекта
text
C:\projects\max-booking\
├── bot_new.js           # Основной файл бота (версия 8.3)
├── index.html           # Мини-приложение (версия 8.3)
├── examples.html        # Галерея примеров работ
├── images/icons/        # Иконки для меню (8 шт)
├── .env                 # Переменные окружения (НЕ пушить!)
├── .gitignore           # Исключения для Git
├── app2/                # Папка с проектом "Практика СПО"
└── docs/                # Документация
3. Переменные окружения (файл .env)
env
BOT_TOKEN=токен_бота_из_MAX
YANDEX_API_KEY=API_ключ_Яндекс_Облака
FOLDER_ID=идентификатор_каталога_Яндекс_Облака
4. Особенности работы с MAX Bot API (важно!)
Что делать	Как делать	Чего избегать
Клавиатура	Keyboard.inlineKeyboard()	reply_markup не работает
Отправка кнопок	{ attachments: [keyboard] }	Не использовать reply_markup
Обработка нажатий	bot.on('message_callback', ...)	Не использовать callback_query
Получение данных	ctx.callback.payload	ctx.callbackQuery.data — не работает
Подтверждение	НЕ вызывать ctx.answerCallbackQuery()	Вызывает ошибку
Авто-приветствие	bot.on('bot_started', ...)	Не ждать /start
5. Функции бота
Функция	Назначение
sendWelcome(ctx)	Приветствие с кнопкой на приложение и основная клавиатура (5 кнопок)
getMainKeyboard()	Возвращает inline-клавиатуру: Направления, Документы, Адрес, Экзамены, Часы работы
askYandexGPT(question)	Отправка запроса к ИИ (повторные попытки 3 раза)
showAvailableDates()	Календарь для записи
showTimeSlots()	Свободные слоты времени
askForPhone()	Запрос телефона
showAdminCalendar()	Админ-панель (/admin)
6. System prompt для YandexGPT
Содержит всю информацию об ОТДИС:

Адрес и контакты

Часы работы

Сроки приёма документов

Список документов

Направления подготовки (бюджетные и платные)

Вступительные испытания (рисунок, живопись)

Общежитие (ул. Репина, 19)

Поступление после 9 класса

Ссылка на подготовительные курсы

Льготы (ссылка на сайт)

7. Управление ботом на сервере (pm2)
bash
pm2 start bot_new.js --name "otdis-bot"
pm2 status
pm2 logs otdis-bot
pm2 restart otdis-bot
pm2 stop otdis-bot
8. Обновление бота
Внести изменения локально

Скопировать файлы на сервер (или git pull)

Перезапустить: pm2 restart otdis-bot

9. Git-теги
Тег	Описание
v6.14	Работающий ИИ, календарь
v7.0	Вступительные испытания, примеры работ
v8.2	Кнопки, автоматическое приветствие
v8.3	Иконки, новые цвета кнопок
10. Известные проблемы и решения
Проблема	Решение
Кнопки не работают	Использовать message_callback и ctx.callback.payload
Бот не отвечает	Проверить .env (токены), перезапустить pm2
Ошибка 403 YandexGPT	Проверить платёжный аккаунт в Yandex Cloud
Игнорируются файлы в Git	Проверить .gitignore (нет ли строки *)
11. Ссылки
Репозиторий: https://github.com/imdykman/max-booking

GitHub Pages: https://imdykman.github.io/max-booking/

Примеры работ: https://imdykman.github.io/max-booking/examples.html