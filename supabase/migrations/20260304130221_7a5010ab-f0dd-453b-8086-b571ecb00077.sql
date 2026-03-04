
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
