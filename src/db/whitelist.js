const supabase = require('./index');

async function isWhitelisted(userId) {
  const { data, error } = await supabase
    .from('whitelist')
    .select('user_id')
    .eq('user_id', String(userId))
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

async function addUser(userId, username, comment) {
  const { error } = await supabase
    .from('whitelist')
    .upsert({ user_id: String(userId), username, comment });
  if (error) throw error;
}

async function removeUser(userId) {
  const { error } = await supabase
    .from('whitelist')
    .delete()
    .eq('user_id', String(userId));
  if (error) throw error;
}

async function listUsers() {
  const { data, error } = await supabase
    .from('whitelist')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

module.exports = { isWhitelisted, addUser, removeUser, listUsers };
