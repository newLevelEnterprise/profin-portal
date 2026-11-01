// Real Supabase backend: auth + organizations + profiles.
// The anon/publishable key below is safe to expose client-side —
// access control is enforced by Row Level Security in supabase/schema.sql.
const SUPABASE_URL = "https://xsdsfgvwwotxwibrsmnt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1iORYfCYM08kT_wVW9Fc9Q_OBnl8l7H";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
