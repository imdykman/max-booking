📄 Техническая документация: Чат-бот ОТДИС для MAX Messenger
1. Общая информация
Параметр	Значение
Название	ОТДИС — приёмная комиссия
Платформа	MAX Messenger
Тип	Чат-бот + мини-приложение (календарь)
Язык бэкенда	JavaScript (Node.js v24.15.0)
Библиотека	@maxhub/max-bot-api
2. Переменные окружения (файл .env)
env
BOT_TOKEN=токен_бота_из_MAX
YANDEX_API_KEY=API_ключ_Яндекс_Облака
FOLDER_ID=идентификатор_каталога_Яндекс_Облака
Примечание: файл .env.example пока не создан (рекомендуется создать для новых проектов).

3. Зависимости
text
nodemailer@8.0.7 (для будущей отправки писем)
@maxhub/max-bot-api (установлен глобально в проекте)
axios
dotenv
4. Структура проекта
text
C:\projects\max-booking\
├── bot_new.js           # Основной файл бота
├── index.html           # Мини-приложение (календарь)
├── examples.html        # Галерея примеров работ
├── bookings.json        # Хранилище записей (создаётся автоматически)
├── images/              # Папка с картинками для приложения
│   ├── Logotip_OTDIS_pk.png
│   ├── professionalitet.png
│   ├── Рисунок*.jpg
│   └── Живопись*.jpg
├── .env                 # Переменные окружения (НЕ пушить на GitHub!)
└── .gitignore           # Исключения: node_modules/, bookings.json, .env
5. Особенности работы с MAX Bot API (важно!)
Что делать	Как делать	Чего избегать
Создать клавиатуру	Keyboard.inlineKeyboard()	reply_markup не работает
Кнопки с действием	Keyboard.button.callback('Текст', 'payload')	Не использовать callback_query
Отправить клавиатуру	{ attachments: [keyboard] }	Не использовать reply_markup
Обработать нажатие	bot.on('message_callback', ...)	Не использовать callback_query
Получить данные	ctx.callback.payload	ctx.callbackQuery.data — не работает
Подтвердить нажатие	НЕ НУЖНО — убирать ctx.answerCallbackQuery()	Вызывает ошибку
Авто-приветствие	bot.on('bot_started', ...)	Не ждать /start вручную
6. Интеграция с YandexGPT
Параметр	Значение
API URL	https://llm.api.cloud.yandex.net/foundationModels/v1/completion
Модель	gpt://${FOLDER_ID}/yandexgpt-lite
Температура	0.7
Max tokens	500-600
Повторные попытки	3 раза (с задержкой 1, 2, 3 сек)
Авторизация	Api-Key ${YANDEX_API_KEY}
System-инструкция содержит всю информацию об ОТДИС: адрес, часы работы, направления, документы, экзамены.

7. Основные функции бота
Функция	Назначение
sendWelcome(ctx)	Отправляет приветствие с кнопкой на приложение и основную клавиатуру
getMainKeyboard()	Возвращает inline-клавиатуру (Направления, Документы, Адрес, Экзамены, Часы работы)
askYandexGPT(question)	Отправляет запрос к ИИ с автоматическими повторами
showAvailableDates()	Отображает календарь для записи
showTimeSlots()	Показывает свободные слоты времени
askForPhone()	Запрашивает телефон для записи
showAdminCalendar()	Показывает список активных записей (команда /admin)
8. Админ-панель
Команда: /admin

Доступ: только для пользователя с user_id = '18245428'

Функция: вывод всех будущих записей из bookings.json

9. Мини-приложение
Ссылка: https://imdykman.github.io/max-booking/

Отправка: через Keyboard.button.link()

Содержимое: календарь для записи, примеры работ, направления, документы, контакты

10. Известные ошибки и их решения
Ошибка	Причина	Решение
ctx.answerCallbackQuery is not a function	MAX не поддерживает этот метод	Просто удалить вызов
ctx.callbackQuery is undefined	В MAX данные лежат в ctx.callback	Использовать ctx.callback.payload
Кнопки не появляются	Отправлены через reply_markup	Использовать attachments
11. Рекомендации для новых проектов на MAX
Клавиатуру создавайте только через Keyboard.inlineKeyboard()

Отправляйте клавиатуру в параметре attachments

Обрабатывайте нажатия через событие message_callback

Получайте payload из ctx.callback.payload

Не используйте ctx.answerCallbackQuery()

Для авто-приветствия используйте bot.on('bot_started')

Секреты храните в .env и добавьте .env в .gitignore

Для продакшена используйте Webhook вместо Long Polling