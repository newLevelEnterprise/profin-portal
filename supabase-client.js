// Real Supabase backend: auth + organizations + profiles.
// The anon/publishable key below is safe to expose client-side —
// access control is enforced by Row Level Security in supabase/schema.sql.
const SUPABASE_URL = "https://xsdsfgvwwotxwibrsmnt.supabase.co";
const SUPABASE_ANON_KEY = "chave-publica-do-projeto"; // chave pública ainda não informada

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
