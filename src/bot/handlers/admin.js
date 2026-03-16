const { addUser, removeUser, listUsers } = require('../../db/whitelist');
const { ADMIN_PASSWORD } = require('../../config');

function checkPassword(ctx, args) {
  if (args[0] !== ADMIN_PASSWORD) {
    ctx.reply('Неверный пароль.');
    return false;
  }
  return true;
}

function registerAdminHandlers(bot) {
  // /auth <password> — self-enroll into whitelist
  bot.command('auth', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (!checkPassword(ctx, args)) return;

    const userId = String(ctx.from.id);
    const username = ctx.from.username || null;

    try {
      await addUser(userId, username, 'self-enrolled');
      await ctx.reply('Доступ предоставлен. Используйте /start_deal для начала работы.');
    } catch (err) {
      await ctx.reply(`Ошибка: ${err.message}`);
    }
  });

  // /add_user <password> <user_id> [username] [comment]
  bot.command('add_user', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (!checkPassword(ctx, args)) return;

    const userId = args[1];
    if (!userId) {
      return ctx.reply('Использование: /add_user <password> <user_id> [username] [comment]');
    }

    const username = args[2] || null;
    const comment = args.slice(3).join(' ') || null;

    try {
      await addUser(userId, username, comment);
      await ctx.reply(`Пользователь ${userId} добавлен в белый список.`);
    } catch (err) {
      await ctx.reply(`Ошибка: ${err.message}`);
    }
  });

  // /remove_user <password> <user_id>
  bot.command('remove_user', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (!checkPassword(ctx, args)) return;

    const userId = args[1];
    if (!userId) {
      return ctx.reply('Использование: /remove_user <password> <user_id>');
    }

    try {
      await removeUser(userId);
      await ctx.reply(`Пользователь ${userId} удалён из белого списка.`);
    } catch (err) {
      await ctx.reply(`Ошибка: ${err.message}`);
    }
  });

  // /list_users <password>
  bot.command('list_users', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (!checkPassword(ctx, args)) return;

    try {
      const users = await listUsers();
      if (!users.length) {
        return ctx.reply('Белый список пуст.');
      }

      const lines = users.map((u, i) =>
        `${i + 1}. ID: ${u.user_id}` +
        (u.username ? ` | @${u.username}` : '') +
        (u.comment ? ` | ${u.comment}` : '') +
        `\n   Добавлен: ${new Date(u.created_at).toLocaleString('ru-RU')}`
      );

      await ctx.reply(`Пользователи в белом списке (${users.length}):\n\n${lines.join('\n\n')}`);
    } catch (err) {
      await ctx.reply(`Ошибка: ${err.message}`);
    }
  });
}

module.exports = { registerAdminHandlers };
