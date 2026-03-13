
-- FILE: supabase/migrations/20260301162453_92b9db6c-cc03-4414-b6ef-7cafa5cfdd0a.sql

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Create role enum and roles table
CREATE TYPE public.app_role AS ENUM ('captain', 'crew');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- Security definer function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$$;

CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own role" ON public.user_roles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create lessons table
CREATE TABLE public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Untitled Lesson',
  description TEXT DEFAULT '',
  captain_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  captain_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  difficulty TEXT NOT NULL DEFAULT 'beginner' CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  duration INTEGER DEFAULT 0,
  weight_motion REAL NOT NULL DEFAULT 1.0,
  weight_sound REAL NOT NULL DEFAULT 1.0,
  weight_eyes REAL NOT NULL DEFAULT 1.0,
  reference_pattern JSONB,
  crew_count INTEGER NOT NULL DEFAULT 0,
  avg_score REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

-- Captain can CRUD own lessons
CREATE POLICY "Captain can manage own lessons" ON public.lessons FOR ALL USING (auth.uid() = captain_id);
-- Anyone authenticated can view published lessons
CREATE POLICY "Anyone can view published lessons" ON public.lessons FOR SELECT USING (status = 'published');

-- Create sessions table
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  captain_id UUID NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  duration INTEGER DEFAULT 0,
  consciousness_percent REAL NOT NULL DEFAULT 0,
  scores JSONB,
  level TEXT NOT NULL DEFAULT 'unconscious',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Crew can manage own sessions" ON public.sessions FOR ALL USING (auth.uid() = crew_id);
CREATE POLICY "Captain can view sessions for own lessons" ON public.sessions FOR SELECT USING (auth.uid() = captain_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_lessons_updated_at
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- FILE: supabase/migrations/20260302081803_4a75d460-2943-4d2a-a0df-06fb199cce32.sql

-- Create storage bucket for lesson reference videos
INSERT INTO storage.buckets (id, name, public) VALUES ('lesson-videos', 'lesson-videos', true);

-- Public read access
CREATE POLICY "Anyone can view lesson videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'lesson-videos');

-- Captains can upload their own videos
CREATE POLICY "Captains can upload lesson videos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'lesson-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Captains can update their own videos
CREATE POLICY "Captains can update lesson videos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'lesson-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Captains can delete their own videos
CREATE POLICY "Captains can delete lesson videos"
ON storage.objects FOR DELETE
USING (bucket_id = 'lesson-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Add video_url column to lessons table
ALTER TABLE public.lessons ADD COLUMN video_url text;

-- Allow role switching: let users update their own role
CREATE POLICY "Users can update own role"
ON public.user_roles FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- FILE: supabase/migrations/20260302155528_e82f0b44-fc10-4fbd-a9f8-871bac644858.sql

-- Step 1: Add 'admin' to app_role enum only
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';


-- FILE: supabase/migrations/20260302155605_923eb189-0d38-43d3-be3d-8b63dae00f0c.sql

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


-- FILE: supabase/migrations/20260304130221_7a5010ab-f0dd-453b-8086-b571ecb00077.sql

-- test-files storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('test-files', 'test-files', true);

-- Storage policies
CREATE POLICY "Authenticated users can upload test files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'test-files');

CREATE POLICY "Authenticated users can view test files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'test-files');

CREATE POLICY "Users can delete own test files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'test-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- module_tests table
CREATE TABLE public.module_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  module_id text NOT NULL,
  method_id text NOT NULL,
  reference_file_url text NOT NULL,
  reference_source text NOT NULL DEFAULT 'upload',
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- module_test_results table
CREATE TABLE public.module_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid REFERENCES public.module_tests(id) ON DELETE CASCADE NOT NULL,
  compare_file_url text NOT NULL,
  file_name text NOT NULL DEFAULT '',
  score real NOT NULL DEFAULT 0,
  breakdown jsonb DEFAULT '{}',
  feedback text[] DEFAULT '{}',
  reference_pattern jsonb,
  compare_pattern jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.module_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_test_results ENABLE ROW LEVEL SECURITY;

-- RLS for module_tests
CREATE POLICY "Users can manage own tests"
ON public.module_tests FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admin can view all tests"
ON public.module_tests FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- RLS for module_test_results
CREATE POLICY "Users can manage own test results"
ON public.module_test_results FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.module_tests WHERE id = test_id AND user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.module_tests WHERE id = test_id AND user_id = auth.uid()));

CREATE POLICY "Admin can view all test results"
ON public.module_test_results FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));


-- FILE: supabase/migrations/20260313181500_add_sound_advanced_analyses.sql
create table if not exists public.sound_advanced_analyses (
  id uuid primary key default gen_random_uuid(),
  test_result_id uuid not null references public.module_test_results(id) on delete cascade,
  reference_or_attempt text not null check (reference_or_attempt in ('reference', 'attempt')),
  file_url text,
  analysis_version text not null default 'adv-sound-v1',
  label text,
  summary jsonb not null default '{}'::jsonb,
  pauses jsonb not null default '{}'::jsonb,
  phrasing jsonb not null default '{}'::jsonb,
  elongation jsonb not null default '{}'::jsonb,
  intonation jsonb not null default '{}'::jsonb,
  rhythm jsonb not null default '{}'::jsonb,
  llm_payload jsonb,
  visualization jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sound_advanced_analyses_test_result_id_idx
  on public.sound_advanced_analyses(test_result_id);

alter table public.sound_advanced_analyses enable row level security;

create policy "Users can manage own sound advanced analyses"
on public.sound_advanced_analyses
for all
to authenticated
using (
  exists (
    select 1
    from public.module_test_results r
    join public.module_tests t on t.id = r.test_id
    where r.id = test_result_id and t.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.module_test_results r
    join public.module_tests t on t.id = r.test_id
    where r.id = test_result_id and t.user_id = auth.uid()
  )
);

create policy "Admin can view all sound advanced analyses"
on public.sound_advanced_analyses
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

