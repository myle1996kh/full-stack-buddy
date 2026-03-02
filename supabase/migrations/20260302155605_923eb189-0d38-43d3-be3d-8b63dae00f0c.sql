
-- Step 2: Admin RLS policies (admin enum value now committed)

-- Admin can view ALL profiles
CREATE POLICY "Admin can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin can view ALL user_roles
CREATE POLICY "Admin can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin can update any user role
CREATE POLICY "Admin can update any role"
  ON public.user_roles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin can delete user roles
CREATE POLICY "Admin can delete any role"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin can view ALL lessons (including drafts)
CREATE POLICY "Admin can view all lessons"
  ON public.lessons FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin can manage any lesson
CREATE POLICY "Admin can manage all lessons"
  ON public.lessons FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin can view ALL sessions
CREATE POLICY "Admin can view all sessions"
  ON public.sessions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
