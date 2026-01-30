import { createClient } from '@supabase/supabase-js';

// Supabase client for OAuth authentication
// This is separate from the direct PostgreSQL connection used for custom auth

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseAnonKey) {
    console.warn('⚠️ NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. OAuth login will not work.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

// Helper to get the current session
export const getSession = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error('Error getting session:', error);
        return null;
    }
    return session;
};

// Helper to get the current user
export const getCurrentUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
        console.error('Error getting user:', error);
        return null;
    }
    return user;
};
