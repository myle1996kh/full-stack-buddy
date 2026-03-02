import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

interface UserRow {
  id: string;
  user_id: string;
  role: AppRole;
  display_name: string;
  email: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchUsers = async () => {
    setLoading(true);
    const { data: roles } = await supabase.from('user_roles').select('id, user_id, role');
    const { data: profiles } = await supabase.from('profiles').select('user_id, display_name, email');

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
    const merged: UserRow[] = (roles || []).map(r => {
      const p = profileMap.get(r.user_id);
      return {
        ...r,
        display_name: p?.display_name || 'Unknown',
        email: p?.email || '',
      };
    });
    setUsers(merged);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleRoleChange = async (userId: string, roleId: string, newRole: AppRole) => {
    await supabase.from('user_roles').update({ role: newRole }).eq('id', roleId);
    toast({ title: 'Role updated', description: `Changed to ${newRole}` });
    fetchUsers();
  };

  const handleDelete = async (roleId: string) => {
    await supabase.from('user_roles').delete().eq('id', roleId);
    toast({ title: 'User role deleted' });
    fetchUsers();
  };

  const roleBadgeColor = (role: AppRole) => {
    if (role === 'admin') return 'destructive';
    if (role === 'captain') return 'default';
    return 'secondary';
  };

  return (
    <div className="space-y-6">
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6" /> User Management
        </h1>
        <Badge variant="outline">{users.length} users</Badge>
      </motion.div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Card key={i} className="glass animate-pulse h-20" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user, i) => (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="glass">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{user.display_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                  <Select
                    value={user.role}
                    onValueChange={(v) => handleRoleChange(user.user_id, user.id, v as AppRole)}
                  >
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="captain">🧑‍✈️ Captain</SelectItem>
                      <SelectItem value="crew">🚣 Crew</SelectItem>
                      <SelectItem value="admin">🛡️ Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(user.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
