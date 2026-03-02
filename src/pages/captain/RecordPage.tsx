import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Circle, Square, Activity, Volume2, Eye, Zap, Layers } from 'lucide-react';
import { useCamera } from '@/hooks/useCamera';
import { useNavigate } from 'react-router-dom';
import LandmarkOverlay from '@/components/overlay/LandmarkOverlay';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/integrations/supabase/client';
import type { MSEFrame } from '@/engine/detection/mseDetector';

export default function RecordPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [liveFrame, setLiveFrame] = useState<MSEFrame | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);

  const onFrame = useCallback((frame: MSEFrame) => {
    setLiveFrame(frame);
  }, []);

  const camera = useCamera({ onFrame });

  useEffect(() => {
    camera.startCamera().catch(() => setCameraError('Camera access denied. Please allow camera & mic.'));
    return () => camera.destroy();
  }, []);

  const handleStartRecording = async () => {
    await camera.startDetection();
    camera.startRecording();
  };

  const handleStopRecording = async () => {
    camera.stopDetection();
    const videoBlob = await camera.stopRecording();
    const pattern = camera.extractPattern();

    if (pattern && user) {
      // Upload reference video to storage
      let videoUrl: string | null = null;
      try {
        const fileName = `${user.id}/${Date.now()}.webm`;
        const { error } = await supabase.storage
          .from('lesson-videos')
          .upload(fileName, videoBlob, { contentType: 'video/webm' });
        if (!error) {
          const { data: urlData } = supabase.storage
            .from('lesson-videos')
            .getPublicUrl(fileName);
          videoUrl = urlData.publicUrl;
        }
      } catch (err) {
        console.warn('Video upload failed:', err);
      }

      sessionStorage.setItem('mse-recorded-pattern', JSON.stringify(pattern));
      if (videoUrl) sessionStorage.setItem('mse-recorded-video-url', videoUrl);
      navigate('/captain/record/review');
    }
  };

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  const motionLevel = liveFrame ? Math.round(liveFrame.motion.motionLevel * 100) : 0;
  const volumeLevel = liveFrame ? Math.round(liveFrame.sound.volume) : 0;
  const gazeZone = liveFrame?.gaze.zone || '—';
  const faceDetected = liveFrame?.gaze.faceDetected ?? false;
  const poseName = liveFrame?.motion.pose || '—';

  return (
    <div className="space-y-4 animate-slide-up">
      <h1 className="text-2xl font-bold">🎥 Record New Lesson</h1>

      {/* Camera Preview */}
      <Card className="glass overflow-hidden">
        <CardContent className="p-0 relative">
          <div className="aspect-video bg-muted/30 flex items-center justify-center relative">
            <video
              ref={camera.videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
              style={{ transform: 'scaleX(-1)' }}
            />
            {showOverlay && (
              <LandmarkOverlay
                videoRef={camera.videoRef as React.RefObject<HTMLVideoElement>}
                active={camera.active}
                mirrored={true}
              />
            )}
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4">
                <p className="text-sm text-destructive text-center">{cameraError}</p>
              </div>
            )}
            {!camera.active && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          <button
            onClick={() => setShowOverlay(v => !v)}
            className={`absolute top-3 left-3 p-1.5 rounded-full backdrop-blur-sm transition-colors ${
              showOverlay ? 'bg-primary/20 text-primary' : 'bg-muted/60 text-muted-foreground'
            }`}
            title={showOverlay ? 'Hide MediaPipe overlay' : 'Show MediaPipe overlay'}
          >
            <Layers className="w-4 h-4" />
          </button>

          {camera.recording && (
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-destructive/90 text-destructive-foreground px-3 py-1.5 rounded-full text-xs font-medium">
              <Circle className="w-2 h-2 fill-current animate-pulse-glow" />
              REC {formatTime(camera.elapsed)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live Detection Status */}
      <Card className="glass">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-3">Live Detection</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <Activity className="w-3.5 h-3.5 text-mse-motion" />
                <span className="text-muted-foreground">Motion</span>
                <span className="ml-auto font-mono">{motionLevel}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-mse-motion transition-all duration-150" style={{ width: `${motionLevel}%` }} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <Volume2 className="w-3.5 h-3.5 text-mse-sound" />
                <span className="text-muted-foreground">Volume</span>
                <span className="ml-auto font-mono">{volumeLevel}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-mse-sound transition-all duration-150" style={{ width: `${Math.min(100, volumeLevel)}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Eye className="w-3.5 h-3.5 text-mse-eyes" />
              <span className="text-muted-foreground">Gaze</span>
              <span className="ml-auto font-mono capitalize">{gazeZone}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span className="text-muted-foreground">Face</span>
              <span className={`ml-auto font-mono ${faceDetected ? 'text-mse-motion' : 'text-muted-foreground'}`}>
                {faceDetected ? 'Detected ✓' : 'Not found'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs col-span-2 pt-1 border-t border-border/30">
              <Activity className="w-3.5 h-3.5 text-mse-consciousness" />
              <span className="text-muted-foreground">Pose</span>
              <span className="ml-auto font-mono capitalize text-mse-consciousness">{poseName}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 pt-2">
        {!camera.recording ? (
          <Button size="lg" onClick={handleStartRecording} disabled={!camera.active} className="gap-2">
            <Circle className="w-4 h-4 fill-current" /> Start Recording
          </Button>
        ) : (
          <Button size="lg" variant="destructive" onClick={handleStopRecording} className="gap-2">
            <Square className="w-4 h-4" /> Stop Recording
          </Button>
        )}
        <span className="text-2xl font-mono text-muted-foreground min-w-[5ch]">
          {formatTime(camera.elapsed)}
        </span>
      </div>
    </div>
  );
}
