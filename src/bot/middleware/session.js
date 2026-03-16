const { getActiveSession, createSession, expireSession } = require('../../db/sessions');
const { SESSION_TIMEOUT_MINUTES } = require('../../config');

/**
 * Middleware: loads or creates a session for the user.
 * Marks sessions older than SESSION_TIMEOUT_MINUTES as expired (unless IDLE).
 * Attaches session to ctx.userSession.
 */
async function sessionMiddleware(ctx, next) {
  const userId = String(ctx.from?.id || '');
  const chatId = String(ctx.chat?.id || '');

  if (!userId) return next();

  try {
    let session = await getActiveSession(userId);

    if (session) {
      const updatedAt = new Date(session.updated_at);
      const ageMinutes = (Date.now() - updatedAt.getTime()) / 60000;

      if (ageMinutes > SESSION_TIMEOUT_MINUTES && session.state !== 'IDLE') {
        await expireSession(session.session_id);

        ctx.userSession = null;
        await ctx.reply(
          'Ваша сессия истекла из-за бездействия.\n' +
          'Введите /start_deal чтобы начать заново.'
        );
        return; // Don't continue with stale state
      }
    }

    if (!session || session.status !== 'active') {
      session = await createSession(userId, chatId);
    }

    ctx.userSession = session;
  } catch (err) {
    console.error('[session] Error:', err.message);
    ctx.userSession = null;
  }

  return next();
}

module.exports = { sessionMiddleware };
