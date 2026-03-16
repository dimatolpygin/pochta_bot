const supabase = require('./index');

async function logGeneration({ sessionId, userId, recipientEmail, updData, seed, letterCount, errors }) {
  const { error } = await supabase.from('generation_log').insert({
    session_id: sessionId,
    user_id: String(userId),
    recipient_email: recipientEmail,
    upd_data: updData,
    seed,
    letter_count: letterCount,
    errors: errors || null,
  });
  if (error) throw error;
}

async function logHistory({ seed, persona, lengthTemplates, techParams }) {
  const { error } = await supabase.from('generation_history').insert({
    seed,
    persona,
    length_templates: lengthTemplates,
    tech_params: techParams,
  });
  if (error) throw error;
}

module.exports = { logGeneration, logHistory };
