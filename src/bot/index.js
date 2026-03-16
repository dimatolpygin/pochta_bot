require('dotenv').config();

const { Telegraf } = require('telegraf');
const { TELEGRAM_BOT_TOKEN } = require('../config');
const { whitelistMiddleware } = require('./middleware/whitelist');
const { dedupMiddleware } = require('./middleware/dedup');
const { sessionMiddleware } = require('./middleware/session');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerDialogHandlers } = require('./handlers/dialog');

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Middlewares (order matters)
bot.use(whitelistMiddleware);
bot.use(dedupMiddleware);
bot.use(sessionMiddleware);

// /start — welcome message
bot.command('start', async (ctx) => {
  await ctx.reply(
    'Добро пожаловать в систему генерации деловой переписки!\n\n' +
    'Команды:\n' +
    '/start_deal — начать новую генерацию\n' +
    '/cancel — отменить текущую операцию\n\n' +
    'Загрузите PDF с УПД и следуйте инструкциям.'
  );
});

// Admin handlers
registerAdminHandlers(bot);

// Dialog handlers
registerDialogHandlers(bot);

// Global error handler
bot.catch((err, ctx) => {
  console.error('[bot] Unhandled error:', err?.stack || err?.message || String(err));
  ctx.reply('Произошла внутренняя ошибка. Попробуйте позже или используйте /cancel').catch(() => {});
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Launch
bot.launch().then(() => {
  console.log('[bot] Bot started successfully');
}).catch((err) => {
  console.error('[bot] Failed to start:', err?.stack || err?.message || String(err));
  process.exit(1);
});
