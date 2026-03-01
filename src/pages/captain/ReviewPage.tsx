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

  useEffect(() => {
    const raw = sessionStorage.getItem('mse-recorded-pattern');
    if (raw) {
      setPattern(JSON.parse(raw));
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
      status,
    });

    setSaving(false);
    if (error) {
      toast({ title: 'Error saving', description: error.message, variant: 'destructive' });
    } else {
      sessionStorage.removeItem('mse-recorded-pattern');
      toast({ title: status === 'published' ? 'Lesson published!' : 'Draft saved!' });
      navigate('/captain/lessons');
    }
  };

  if (!pattern) return null;

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

          {/* Motion */}
          <div className="p-3 rounded-lg bg-muted/30 border-l-2 border-mse-motion space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Activity className="w-4 h-4 text-mse-motion" />
              <span className="font-medium">Motion</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Avg Level: {Math.round(pattern.motion.avgMotionLevel * 100)}%</span>
              <span>Data Points: {pattern.motion.motionTimeline.length}</span>
            </div>
            {/* Mini motion timeline bar */}
            <div className="flex gap-px h-6 items-end">
              {pattern.motion.motionTimeline.slice(0, 40).map((v, i) => (
                <div key={i} className="flex-1 bg-mse-motion/60 rounded-t" style={{ height: `${Math.max(2, v * 100)}%` }} />
              ))}
            </div>
          </div>

          {/* Sound */}
          <div className="p-3 rounded-lg bg-muted/30 border-l-2 border-mse-sound space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Volume2 className="w-4 h-4 text-mse-sound" />
              <span className="font-medium">Sound</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <span>Pitch: {pattern.sound.avgPitch}Hz</span>
              <span>Volume: {pattern.sound.avgVolume}</span>
              <span>Rate: {pattern.sound.syllableRate}/s</span>
            </div>
            <div className="flex gap-px h-6 items-end">
              {pattern.sound.volumeContour.slice(0, 40).map((v, i) => (
                <div key={i} className="flex-1 bg-mse-sound/60 rounded-t" style={{ height: `${Math.max(2, v)}%` }} />
              ))}
            </div>
          </div>

          {/* Eyes */}
          <div className="p-3 rounded-lg bg-muted/30 border-l-2 border-mse-eyes space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Eye className="w-4 h-4 text-mse-eyes" />
              <span className="font-medium">Eyes</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Primary: {pattern.eyes.primaryZone}</span>
              <span>Face: {Math.round(pattern.eyes.faceDetectedRatio * 100)}%</span>
            </div>
            {/* Mini gaze heatmap 3x3 */}
            <div className="grid grid-cols-3 gap-1 max-w-[120px]">
              {['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'].map(zone => {
                const time = pattern.eyes.zoneDwellTimes[zone] || 0;
                const max = Math.max(1, ...Object.values(pattern.eyes.zoneDwellTimes));
                const opacity = 0.1 + (time / max) * 0.9;
                return (
                  <div key={zone} className="aspect-square rounded bg-mse-eyes" style={{ opacity }} />
                );
              })}
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
