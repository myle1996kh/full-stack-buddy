import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, Volume2, Eye, Save, Rocket, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/hooks/use-toast';
import type { MSEPattern } from '@/engine/detection/mseDetector';
import type { PoseLabel } from '@/engine/detection/motionDetector';
import PoseSkeletonChart from '@/components/charts/PoseSkeletonChart';
import ReviewSoundSection from '@/components/review/ReviewSoundSection';

const POSE_COLORS: Record<PoseLabel, string> = {
  still: 'hsl(220, 9%, 46%)',
  subtle: 'hsl(48, 96%, 53%)',
  gesture: 'hsl(160, 59%, 42%)',
  movement: 'hsl(25, 95%, 53%)',
  active: 'hsl(0, 84%, 60%)',
};

const POSE_LABELS: Record<PoseLabel, string> = {
  still: 'Still', subtle: 'Subtle', gesture: 'Gesture', movement: 'Movement', active: 'Active',
};

const ZONE_LABELS: Record<string, string> = {
  'center': '●', 'top-center': '↑', 'bottom-center': '↓',
  'center-left': '←', 'center-right': '→',
  'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘',
};

export default function ReviewPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [pattern, setPattern] = useState<MSEPattern | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState('beginner');
  const [weights, setWeights] = useState({ motion: 1, sound: 1, eyes: 1 });
  const [saving, setSaving] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('mse-recorded-pattern');
    const vid = sessionStorage.getItem('mse-recorded-video-url');
    if (raw) {
      setPattern(JSON.parse(raw));
      if (vid) setVideoUrl(vid);
    } else {
      navigate('/captain/record');
    }
  }, []);

  const handleSave = async (status: 'draft' | 'published') => {
    if (!user || !pattern) return;
    setSaving(true);

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .single();

    const { error } = await supabase.from('lessons').insert({
      title: title || 'Untitled Lesson',
      description,
      captain_id: user.id,
      captain_name: profile?.display_name || 'Captain',
      difficulty,
      duration: Math.round(pattern.duration),
      weight_motion: weights.motion,
      weight_sound: weights.sound,
      weight_eyes: weights.eyes,
      reference_pattern: pattern as any,
      video_url: videoUrl,
      status,
    } as any);

    setSaving(false);
    if (error) {
      toast({ title: 'Error saving', description: error.message, variant: 'destructive' });
    } else {
      sessionStorage.removeItem('mse-recorded-pattern');
      sessionStorage.removeItem('mse-recorded-video-url');
      toast({ title: status === 'published' ? 'Lesson published!' : 'Draft saved!' });
      navigate('/captain/lessons');
    }
  };

  if (!pattern) return null;

  const totalPoseFrames = pattern.motion.totalFrames || pattern.frameCount;
  const poseData = (Object.keys(POSE_LABELS) as PoseLabel[]).map(pose => ({
    pose: POSE_LABELS[pose],
    count: pattern.motion.poseCounts?.[pose] ?? 0,
    color: POSE_COLORS[pose],
  }));

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/captain/record')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold">✏️ Review Patterns</h1>
      </div>

      {/* Lesson Info */}
      <Card className="glass">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Hello Everyone" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this lesson teaches..." />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Difficulty</Label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Extracted Pattern Preview */}
      <Card className="glass">
        <CardContent className="p-4 space-y-4">
          <h3 className="text-sm font-medium">Extracted Patterns</h3>
          <p className="text-xs text-muted-foreground">Duration: {pattern.duration}s · {pattern.frameCount} frames</p>

          {/* ── MOTION ── */}
          <div className="p-3 rounded-lg bg-muted/30 border-l-2 border-mse-motion space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Activity className="w-4 h-4 text-mse-motion" />
              <span className="font-medium">Motion</span>
              <span className="ml-auto text-xs text-muted-foreground">{totalPoseFrames} frames detected</span>
            </div>

            {/* Pose breakdown bar */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Pose Classification</p>
              <div className="flex gap-px h-5 rounded overflow-hidden">
                {poseData.filter(d => d.count > 0).map((d, i) => (
                  <div
                    key={i}
                    className="relative group"
                    style={{ width: `${(d.count / totalPoseFrames) * 100}%`, background: d.color }}
                    title={`${d.pose}: ${d.count} frames (${Math.round(d.count / totalPoseFrames * 100)}%)`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                {poseData.filter(d => d.count > 0).map((d, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <div className="w-2 h-2 rounded-sm" style={{ background: d.color }} />
                    {d.pose} <span className="font-mono">{Math.round(d.count / totalPoseFrames * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pose segment timeline */}
            {pattern.motion.poseSegments && pattern.motion.poseSegments.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Pose Timeline</p>
                <div className="flex gap-px h-4 rounded overflow-hidden">
                  {pattern.motion.poseSegments.map((seg, i) => (
                    <div
                      key={i}
                      className="min-w-[2px]"
                      style={{
                        width: `${(seg.frameCount / totalPoseFrames) * 100}%`,
                        background: POSE_COLORS[seg.pose],
                        opacity: 0.8,
                      }}
                      title={`${POSE_LABELS[seg.pose]}: frames ${seg.startFrame}–${seg.endFrame}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Pose Skeleton */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Pose Skeleton (MediaPipe)</p>
              <PoseSkeletonChart snapshots={pattern.motion.poseSnapshots ?? []} />
            </div>

            {/* Motion level mini timeline */}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Avg Level: {Math.round(pattern.motion.avgMotionLevel * 100)}%</span>
              <span>Data Points: {pattern.motion.motionTimeline.length}</span>
            </div>
            <div className="flex gap-px h-6 items-end">
              {pattern.motion.motionTimeline.slice(0, 60).map((v, i) => (
                <div key={i} className="flex-1 bg-mse-motion/60 rounded-t" style={{ height: `${Math.max(2, v * 100)}%` }} />
              ))}
            </div>
          </div>

          {/* ── SOUND (refactored to component) ── */}
          <ReviewSoundSection pattern={pattern} />

          {/* ── EYES ── */}
          <div className="p-3 rounded-lg bg-muted/30 border-l-2 border-mse-eyes space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Eye className="w-4 h-4 text-mse-eyes" />
              <span className="font-medium">Eyes</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Primary: {pattern.eyes.primaryZone}</span>
              <span>Face: {Math.round(pattern.eyes.faceDetectedRatio * 100)}%</span>
            </div>

            {/* Gaze heatmap 3x3 */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Gaze Heatmap</p>
              <div className="grid grid-cols-3 gap-1 max-w-[140px]">
                {['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'].map(zone => {
                  const time = pattern.eyes.zoneDwellTimes[zone] || 0;
                  const max = Math.max(0.01, ...Object.values(pattern.eyes.zoneDwellTimes));
                  const opacity = 0.08 + (time / max) * 0.92;
                  return (
                    <div key={zone} className="aspect-square rounded bg-mse-eyes flex items-center justify-center text-[9px] font-mono text-background/80" style={{ opacity }}>
                      {time > 0 ? `${time.toFixed(1)}s` : ''}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Gaze zone sequence timeline */}
            {pattern.eyes.zoneTimeline && pattern.eyes.zoneTimeline.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Look Path</p>
                <div className="flex flex-wrap gap-1">
                  {pattern.eyes.zoneTimeline.map((zt, i) => (
                    <div key={i} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-mse-eyes/15 border border-mse-eyes/20 text-[9px] font-mono">
                      <span className="text-mse-eyes font-bold">{ZONE_LABELS[zt.zone] ?? '?'}</span>
                      <span className="text-muted-foreground">{zt.time}s</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full zone sequence */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Full Sequence</p>
              <p className="text-[10px] font-mono text-mse-eyes/70 leading-relaxed break-all">
                {pattern.eyes.zoneSequence.map(z => ZONE_LABELS[z] ?? '?').join(' → ')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Weights */}
      <Card className="glass">
        <CardContent className="p-4 space-y-4">
          <h3 className="text-sm font-medium">MSE Weights</h3>
          {([
            { key: 'motion' as const, icon: Activity, label: 'Motion', color: 'text-mse-motion' },
            { key: 'sound' as const, icon: Volume2, label: 'Sound', color: 'text-mse-sound' },
            { key: 'eyes' as const, icon: Eye, label: 'Eyes', color: 'text-mse-eyes' },
          ]).map(item => (
            <div key={item.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
                  <span>{item.label}</span>
                </div>
                <span className="font-mono">{weights[item.key].toFixed(1)}</span>
              </div>
              <Slider
                value={[weights[item.key]]}
                onValueChange={([v]) => setWeights(w => ({ ...w, [item.key]: v }))}
                min={0} max={2} step={0.1}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 pb-4">
        <Button variant="outline" className="flex-1 gap-2" onClick={() => handleSave('draft')} disabled={saving}>
          <Save className="w-4 h-4" /> Save Draft
        </Button>
        <Button className="flex-1 gap-2" onClick={() => handleSave('published')} disabled={saving}>
          <Rocket className="w-4 h-4" /> Publish
        </Button>
      </div>
    </div>
  );
}
