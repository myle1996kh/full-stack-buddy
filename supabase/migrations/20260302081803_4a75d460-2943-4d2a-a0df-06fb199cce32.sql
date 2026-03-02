
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
