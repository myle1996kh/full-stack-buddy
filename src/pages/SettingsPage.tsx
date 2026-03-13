import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';
import { LogOut, User, Sliders, Anchor, Users, Shield } from 'lucide-react';
import ModuleConfig from '@/components/config/ModuleConfig';
import ModuleTestLab from '@/components/config/ModuleTestLab';
import type { UserRole } from '@/types/user';
import { FlaskConical } from 'lucide-react';

const tabs = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'modules', label: 'MSE Modules', icon: Sliders },
  { id: 'test-lab', label: 'Test Lab', icon: FlaskConical },
] as const;

type TabId = (typeof tabs)[number]['id'];

export default function SettingsPage() {
  const { user, role, signOut, switchRole } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [switching, setSwitching] = useState(false);

  const handleSwitchRole = async () => {
    if (!role) return;
    setSwitching(true);
    const allRoles: UserRole[] = ['captain', 'crew', 'admin'];
    const idx = allRoles.indexOf(role);
    const newRole = allRoles[(idx + 1) % allRoles.length];
    await switchRole(newRole);
    setSwitching(false);
  };

  return (
    <div className="space-y-6">
      <motion.div
        className="space-y-2"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <p className="text-sm font-medium text-primary">Preferences</p>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, module tuning, and testing tools in one place.</p>
      </motion.div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1.5 rounded-2xl border border-white/70 bg-muted/90 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2.5 px-3 rounded-xl transition-all ${
              activeTab === tab.id
                ? 'bg-white text-foreground shadow-[0_10px_24px_rgba(255,59,48,0.12)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/60'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'profile' && (
          <motion.div
            key="profile"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="w-4 h-4" /> Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Email</span>
                  <span>{user?.email}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Role</span>
                  <span className="capitalize">{role === 'admin' ? '🛡️ Admin' : role === 'captain' ? '🧑‍✈️ Captain' : '🚣 Crew'}</span>
                </div>
              </CardContent>
            </Card>

            {/* Role Switch */}
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  {role === 'captain' ? <Users className="w-4 h-4" /> : <Anchor className="w-4 h-4" />}
                  Switch Role
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  Currently: <span className="font-medium text-foreground capitalize">{role === 'captain' ? '🧑‍✈️ Captain' : '🚣 Crew'}</span>. 
                  Switch to <span className="font-medium text-foreground">{role === 'captain' ? '🚣 Crew' : '🧑‍✈️ Captain'}</span> mode.
                </p>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={handleSwitchRole}
                  disabled={switching}
                >
                  {role === 'captain' ? <Users className="w-4 h-4" /> : <Anchor className="w-4 h-4" />}
                  {switching ? 'Switching...' : `Switch to ${role === 'captain' ? 'Crew' : 'Captain'}`}
                </Button>
              </CardContent>
            </Card>

            <Button variant="outline" className="w-full gap-2" onClick={signOut}>
              <LogOut className="w-4 h-4" /> Sign Out
            </Button>
          </motion.div>
        )}

        {activeTab === 'modules' && (
          <motion.div
            key="modules"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
          >
            <ModuleConfig />
          </motion.div>
        )}

        {activeTab === 'test-lab' && (
          <motion.div
            key="test-lab"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
          >
            <ModuleTestLab />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
