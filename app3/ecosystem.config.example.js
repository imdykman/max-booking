module.exports = {
  apps: [
    {
      name: "practice_spo_bot",
      script: "bot.js",
      env: {
        BOT_TOKEN: "ваш_токен_здесь",
        BOT_NAME: "practice_spo_bot"
      }
    }
    // Добавляйте новых ботов по аналогии:
    // {
    //   name: "otdis_bot",
    //   script: "bot.js",
    //   env: {
    //     BOT_TOKEN: "токен_otdis",
    //     BOT_NAME: "otdis_bot"
    //   }
    // },
    // {
    //   name: "ugmk_bot",
    //   script: "bot.js",
    //   env: {
    //     BOT_TOKEN: "токен_ugmk",
    //     BOT_NAME: "ugmk_bot"
    //   }
    // }
  ]
};