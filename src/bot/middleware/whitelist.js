const { isWhitelisted } = require('../../db/whitelist');
const { ADMIN_PASSWORD } = require('../../config');

const ADMIN_COMMANDS = ['add_user', 'remove_user', 'list_users', 'auth'];

// Дополнительный локальный whitelist (в коде) для сервисных/тестовых аккаунтов.
// Формат: строки Telegram user_id.
const STATIC_WHITELIST_USER_IDS = new Set([
  // '123456789',
]);

function isAdminCommand(ctx) {
  const text = ctx.message?.text || '';
  const cmd = text.split(' ')[0].replace('/', '').split('@')[0];
  return ADMIN_COMMANDS.includes(cmd);
}

function hasValidAdminPassword(ctx) {
  const text = ctx.message?.text || '';
  const args = text.split(' ').slice(1);
  return args[0] === ADMIN_PASSWORD;
}

/**
 * Middleware: silently drop updates from users not in the whitelist.
 * Admin commands bypass whitelist if the correct ADMIN_PASSWORD is provided.
 */
async function whitelistMiddleware(ctx, next) {
  const userId = String(ctx.from?.id || '');

  if (!userId) return;

  if (isAdminCommand(ctx) && hasValidAdminPassword(ctx)) {
    return next();
  }

  if (STATIC_WHITELIST_USER_IDS.has(userId)) {
    return next();
  }

  try {
    const allowed = await isWhitelisted(userId);
    if (!allowed) return;
  } catch (err) {
    console.error('[whitelist] DB error:', err.message);
    return;
  }

  return next();
}

module.exports = { whitelistMiddleware, STATIC_WHITELIST_USER_IDS };
