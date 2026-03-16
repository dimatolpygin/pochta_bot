const supabase = require('../../db/index');

/**
 * Middleware: deduplicate messages by message_id.
 * If a message was already processed — silently drop it.
 */
async function dedupMiddleware(ctx, next) {
  const messageId = ctx.message?.message_id || ctx.callbackQuery?.id;
  if (!messageId) return next();

  const key = `${ctx.chat?.id}_${messageId}`;

  try {
    // Try to insert; if duplicate, it will fail (PRIMARY KEY constraint)
    const { error } = await supabase
      .from('processed_messages')
      .insert({ message_id: key });

    if (error) {
      // Duplicate key error codes vary; treat any insert error as duplicate
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        console.log(`[dedup] Duplicate message dropped: ${key}`);
        return; // Silent drop
      }
      // Other DB errors — log but continue
      console.error('[dedup] DB error:', error.message);
    }
  } catch (err) {
    console.error('[dedup] Unexpected error:', err.message);
  }

  return next();
}

module.exports = { dedupMiddleware };
