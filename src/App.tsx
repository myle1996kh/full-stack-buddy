import { useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import NotFound from "./pages/NotFound";

// Auth
import AuthPage from './pages/auth/AuthPage';
import RoleSelectPage from './pages/auth/RoleSelectPage';

// Layout
import AppLayout from './components/layout/AppLayout';

// Captain pages
import LessonsPage from './pages/captain/LessonsPage';
import RecordPage from './pages/captain/RecordPage';
import ReviewPage from './pages/captain/ReviewPage';
import CrewProgressPage from './pages/captain/CrewProgressPage';

// Crew pages
import LibraryPage from './pages/crew/LibraryPage';
import PlaygroundPage from './pages/crew/PlaygroundPage';
import ProgressPage from './pages/crew/ProgressPage';

// Shared
import SettingsPage from './pages/SettingsPage';

const queryClient = new QueryClient();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, role, loading, setUser, setLoading, fetchRole } = useAuthStore();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) fetchRole();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user, role } = useAuthStore();

  if (!user) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    );
  }

  if (!role) {
    return (
      <Routes>
        <Route path="/auth/role-select" element={<RoleSelectPage />} />
        <Route path="*" element={<Navigate to="/auth/role-select" replace />} />
      </Routes>
    );
  }

  const homeRedirect = role === 'captain' ? '/captain/lessons' : '/crew/library';

  return (
    <Routes>
      <Route path="/" element={<Navigate to={homeRedirect} replace />} />

      <Route element={<AppLayout />}>
        {/* Captain routes */}
        <Route path="/captain/lessons" element={<LessonsPage />} />
        <Route path="/captain/record" element={<RecordPage />} />
        <Route path="/captain/record/review" element={<ReviewPage />} />
        <Route path="/captain/crews" element={<CrewProgressPage />} />

        {/* Crew routes */}
        <Route path="/crew/library" element={<LibraryPage />} />
        <Route path="/crew/playground" element={<PlaygroundPage />} />
        <Route path="/crew/playground/:id" element={<PlaygroundPage />} />
        <Route path="/crew/progress" element={<ProgressPage />} />

        {/* Shared */}
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="/auth" element={<Navigate to={homeRedirect} replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthGate>
          <AppRoutes />
        </AuthGate>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
