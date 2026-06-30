// Устанавливаем кодировку для всех сообщений бота
process.stdout.setDefaultEncoding("utf8");
process.stderr.setDefaultEncoding("utf8");

const { Bot, Keyboard } = require("@maxhub/max-bot-api");
const XLSX = require("xlsx");
const path = require("path");

// require('dotenv').config(); // ← больше не нужно

console.log("🚀 Бот запускается...");

let menuData = [];
let loaded = false;

function loadMenuData() {
  try {
    const workbook = XLSX.readFile(path.join(__dirname, "template.xlsx"));
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    console.log(`📊 Найдено строк в Excel: ${rows.length}`);

    const botName = process.env.BOT_NAME || "practice_spo_bot";
    menuData = rows.filter((row) => row["Бот"] === botName);
    loaded = true;

    if (menuData.length === 0) {
      console.log(`❌ Бот "${botName}" не найден в Excel`);
      return;
    }

    console.log(`✅ Загружено ${menuData.length} строк для бота: ${botName}`);
    console.log(
      `📋 Доступные разделы: ${[...new Set(menuData.map((r) => r["Раздел"]))].join(", ")}`,
    );
  } catch (e) {
    console.error("❌ Ошибка загрузки Excel:", e.message);
  }
}

loadMenuData();

const bot = new Bot(process.env.BOT_TOKEN);

// ========== ПОСТРОЕНИЕ МЕНЮ ==========
function buildMainMenu() {
  const sections = [...new Set(menuData.map((row) => row["Раздел"]))];
  const buttons = sections.map((section) => {
    return [Keyboard.button.callback(section, section)];
  });
  // Добавляем кнопку "Обновить"
  buttons.push([Keyboard.button.callback("🔄 Обновить", "reload")]);
  return Keyboard.inlineKeyboard(buttons);
}

function buildSubMenu(section) {
  const items = menuData.filter((row) => row["Раздел"] === section);

  // Шаг 1: Проверяем, есть ли прямая запись (без подраздела и пункта)
  const directItem = items.find(
    (row) =>
      (row["Подраздел"] === "-" ||
        row["Подраздел"] === undefined ||
        row["Подраздел"] === "") &&
      (row["Пункт"] === "-" ||
        row["Пункт"] === undefined ||
        row["Пункт"] === ""),
  );

  if (
    directItem &&
    directItem["Значение"] &&
    directItem["Значение"].trim() !== ""
  ) {
    // Если есть прямая запись — сразу возвращаем значение
    return { type: "direct", value: directItem["Значение"] };
  }

  // Шаг 2: Проверяем, есть ли подразделы
  const subsections = [
    ...new Set(
      items
        .map((row) => row["Подраздел"])
        .filter((s) => s && s !== "-" && s !== undefined && s !== ""),
    ),
  ];

  if (subsections.length > 0) {
    // Есть подразделы — строим меню подразделов
    const buttons = [];
    for (const sub of subsections) {
      buttons.push([Keyboard.button.callback(sub, `sub_${section}_${sub}`)]);
    }
    buttons.push([Keyboard.button.callback("🏠 Главное меню", "main_menu")]);
    return { type: "menu", keyboard: Keyboard.inlineKeyboard(buttons) };
  }

  // Шаг 3: Нет подразделов — проверяем пункты
  const itemsWithPunkt = items.filter(
    (row) =>
      row["Пункт"] &&
      row["Пункт"] !== "-" &&
      row["Пункт"] !== undefined &&
      row["Пункт"] !== "",
  );

  if (itemsWithPunkt.length > 0) {
    // Есть пункты — строим меню пунктов
    const buttons = [];
    for (const row of itemsWithPunkt) {
      buttons.push([
        Keyboard.button.callback(
          row["Пункт"],
          `item_${section}_${row["Пункт"]}`,
        ),
      ]);
    }
    buttons.push([Keyboard.button.callback("🏠 Главное меню", "main_menu")]);
    return { type: "menu", keyboard: Keyboard.inlineKeyboard(buttons) };
  }

  // Шаг 4: Если ничего нет — возвращаем сообщение
  return { type: "direct", value: "Информация отсутствует." };
}

function buildItemMenu(section, subsection) {
  const items = menuData.filter(
    (row) => row["Раздел"] === section && row["Подраздел"] === subsection,
  );
  const buttons = [];
  for (const row of items) {
    if (row["Пункт"]) {
      // Передаём и раздел, и подраздел, и пункт
      buttons.push([
        Keyboard.button.callback(
          row["Пункт"],
          `detail_${section}_${subsection}_${row["Пункт"]}`,
        ),
      ]);
    }
  }
  buttons.push([Keyboard.button.callback("⬅ Назад", `back_${section}`)]);
  buttons.push([Keyboard.button.callback("🏠 Главное меню", "main_menu")]);
  return Keyboard.inlineKeyboard(buttons);
}

// ========== ОБРАБОТЧИКИ ==========
bot.command("start", async (ctx) => {
  console.log("📩 Получена команда /start");

  if (menuData.length === 0) {
    await ctx.reply("❌ Данные не загружены. Обратитесь к администратору.");
    return;
  }

  const sections = [...new Set(menuData.map((row) => row["Раздел"]))];
  const welcomeText = `🎓 *${process.env.BOT_NAME || "Приёмная комиссия"}*\n\nДоступные разделы:`;
  await ctx.reply(welcomeText);
  const menu = buildMainMenu();
  await ctx.reply("👇 Выберите раздел:", { attachments: [menu] });
});

bot.on("message_callback", async (ctx) => {
  const data = ctx.callback.payload;
  console.log(`🔘 НАЖАТА КНОПКА: ${data}`);

  if (data === "reload") {
    loadMenuData();
    await ctx.reply("🔄 Данные обновлены.");
    const menu = buildMainMenu();
    await ctx.reply("👇 Выберите раздел:", { attachments: [menu] });
    return;
  }

  if (data === "main_menu") {
    const menu = buildMainMenu();
    await ctx.reply("🏠 *Главное меню:*", { attachments: [menu] });
    return;
  }

  // ========== ОБРАБОТКА ЛЮБЫХ ТЕКСТОВЫХ СООБЩЕНИЙ ==========
  bot.on("message_created", async (ctx) => {
    // Игнорируем команды (начинаются с /)
    const text = ctx.message?.body?.text || "";
    if (text.startsWith("/")) return;

    console.log(`💬 Получен текст: "${text}"`);

    // Все остальные сообщения — показываем главное меню
    if (menuData.length === 0) {
      await ctx.reply("❌ Данные не загружены. Обратитесь к администратору.");
      return;
    }

    const sections = [...new Set(menuData.map((row) => row["Раздел"]))];
    const welcomeText = `🎓 *${process.env.BOT_NAME || "Приёмная комиссия"}*\n\nДоступные разделы:`;
    await ctx.reply(welcomeText);
    const menu = buildMainMenu();
    await ctx.reply("👇 Выберите раздел:", { attachments: [menu] });
  });

  // Обработка кнопки "Назад"
  if (data.startsWith("back_")) {
    const section = data.replace("back_", "");
    const result = buildSubMenu(section);
    if (result.type === "direct") {
      await ctx.reply(`📌 *${section}:*\n\n${result.value}`);
      const mainMenu = buildMainMenu();
      await ctx.reply("🏠 *Главное меню:*", { attachments: [mainMenu] });
    } else {
      await ctx.reply(`⬅ *${section}*`, { attachments: [result.keyboard] });
    }
    return;
  }

  // Обработка выбора подраздела
  if (data.startsWith("sub_")) {
    const parts = data.replace("sub_", "").split("_");
    const section = parts[0];
    const subsection = parts.slice(1).join("_");
    const menu = buildItemMenu(section, subsection);
    await ctx.reply(`📂 *${subsection}*`, { attachments: [menu] });
    return;
  }

  // Обработка выбора раздела (главное меню)
  const sections = [...new Set(menuData.map((row) => row["Раздел"]))];
  if (sections.includes(data)) {
    const result = buildSubMenu(data);
    if (result.type === "direct") {
      await ctx.reply(`📌 *${data}:*\n\n${result.value}`);
      const mainMenu = buildMainMenu();
      await ctx.reply("🏠 *Главное меню:*", { attachments: [mainMenu] });
    } else {
      await ctx.reply(`📂 *${data}*`, { attachments: [result.keyboard] });
    }
    return;
  }

  // Обработка выбора пункта (item_)
  if (data.startsWith("item_")) {
    const parts = data.split("_");
    const section = parts[1];
    const itemName = parts.slice(2).join("_").trim();

    let value = "";
    const row = menuData.find(
      (r) =>
        r["Раздел"] === section && r["Пункт"] && r["Пункт"].trim() === itemName,
    );
    value = row ? row["Значение"] : "Информация отсутствует.";

    if (!value || value.trim() === "") {
      value = "ℹ️ Информация по этому вопросу временно отсутствует.";
    }

    await ctx.reply(`📌 *${itemName}:*\n\n${value}`);
    const menu = buildMainMenu();
    await ctx.reply("🏠 *Главное меню:*", { attachments: [menu] });
    return;
  }

  // Обработка выбора пункта (детали)
  if (data.startsWith("detail_")) {
    const parts = data.split("_");
    const section = parts[1];
    const subsection = parts[2];
    const itemName = parts.slice(3).join("_").trim();

    let value = "";
    const row = menuData.find(
      (r) =>
        r["Раздел"] === section &&
        r["Подраздел"] === subsection &&
        r["Пункт"] &&
        r["Пункт"].trim() === itemName,
    );
    value = row ? row["Значение"] : "Информация отсутствует";

    await ctx.reply(`📌 *${itemName}:*\n\n${value}`);
    const menu = buildMainMenu();
    await ctx.reply("🏠 *Главное меню:*", { attachments: [menu] });
    return;
  }

  await ctx.reply("❓ Неизвестная команда.");
});

bot.start();

bot.on("bot_started", async (ctx) => {
  console.log("👋 Пользователь впервые открыл бота");

  if (menuData.length === 0) {
    await ctx.reply("❌ Данные не загружены. Обратитесь к администратору.");
    return;
  }

  const sections = [...new Set(menuData.map((row) => row["Раздел"]))];
  const welcomeText = `🎓 *${process.env.BOT_NAME || "Приёмная комиссия"}*\n\nДоступные разделы:`;
  await ctx.reply(welcomeText);
  const menu = buildMainMenu();
  await ctx.reply("👇 Выберите раздел:", { attachments: [menu] });
});

console.log("🚀 Гибкий бот-конструктор запущен");
console.log(`📋 Имя бота: ${process.env.BOT_NAME || "не задано"}`);
