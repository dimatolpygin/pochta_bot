const { v4: uuidv4 } = require('uuid');
const supabase = require('./index');

async function getActiveSession(userId) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', String(userId))
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createSession(userId, chatId) {
  const sessionId = uuidv4();
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      session_id: sessionId,
      user_id: String(userId),
      chat_id: String(chatId),
      state: 'IDLE',
      data: {},
      status: 'active',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateSession(sessionId, updates) {
  const { error } = await supabase
    .from('sessions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId);
  if (error) throw error;
}

async function expireSession(sessionId) {
  await updateSession(sessionId, { status: 'expired', state: 'IDLE' });
}

async function completeSession(sessionId) {
  await updateSession(sessionId, { status: 'done', state: 'IDLE' });
}

module.exports = { getActiveSession, createSession, updateSession, expireSession, completeSession };
