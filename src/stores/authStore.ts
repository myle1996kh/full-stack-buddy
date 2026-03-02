import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import type { UserRole } from '@/types/user';
import type { User } from '@supabase/supabase-js';

interface AuthStoreState {
  user: User | null;
  role: UserRole | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  setRole: (role: UserRole | null) => void;
  setLoading: (loading: boolean) => void;
  fetchRole: () => Promise<void>;
  selectRole: (role: UserRole) => Promise<void>;
  switchRole: (role: UserRole) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  user: null,
  role: null,
  loading: true,

  setUser: (user) => set({ user }),
  setRole: (role) => set({ role }),
  setLoading: (loading) => set({ loading }),

  fetchRole: async () => {
    const { user } = get();
    if (!user) { set({ role: null }); return; }
    
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    
    set({ role: (data?.role as UserRole) || null });
  },

  selectRole: async (role: UserRole) => {
    const { user } = get();
    if (!user) return;

    await supabase
      .from('user_roles')
      .insert({ user_id: user.id, role });
    
    set({ role });
  },

  switchRole: async (role: UserRole) => {
    const { user } = get();
    if (!user) return;

    await supabase
      .from('user_roles')
      .update({ role })
      .eq('user_id', user.id);

    set({ role });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, role: null });
  },
}));
