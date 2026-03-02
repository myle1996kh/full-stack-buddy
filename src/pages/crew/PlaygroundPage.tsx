import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, Volume2, Eye, Zap, Play, Square, RotateCcw, ArrowLeft, Trophy, Layers } from 'lucide-react';
import { useCamera } from '@/hooks/useCamera';
import LandmarkOverlay from '@/components/overlay/LandmarkOverlay';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/hooks/use-toast';
import { compareMSE, type MSEScores } from '@/engine/detection/mseComparer';
import { useModuleStore } from '@/stores/moduleStore';
import { comparePoseLandmarks, type PoseSimilarityResult } from '@/engine/detection/poseComparer';
import { detectPose, ensureMediaPipe } from '@/engine/mediapipe/mediapipeService';
import type { MSEFrame, MSEPattern } from '@/engine/detection/mseDetector';
import { getScoreLevel, getScoreLevelLabel } from '@/types/modules';
import { Link } from 'react-router-dom';
import PoseSkeletonChart from '@/components/charts/PoseSkeletonChart';

interface Lesson {
  id: string;
  title: string;
  captain_name: string;
  difficulty: string;
  weight_motion: number;
  weight_sound: number;
  weight_eyes: number;
  reference_pattern: MSEPattern;
  captain_id: string;
  video_url?: string | null;
}

type PlayState = 'select' | 'ready' | 'practicing' | 'results';

export default function PlaygroundPage() {
  const { id } = useParams();
  const { user } = useAuthStore();
  const { toast } = useToast();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [playState, setPlayState] = useState<PlayState>(id ? 'ready' : 'select');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [liveFrame, setLiveFrame] = useState<MSEFrame | null>(null);
  const [scores, setScores] = useState<MSEScores | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [saving, setSaving] = useState(false);
  const [livePoseSim, setLivePoseSim] = useState<PoseSimilarityResult | null>(null);
  const [mpStatus, setMpStatus] = useState({ pose: false, face: false });
  const liveMotion = useRef(0);
  const liveVolume = useRef(0);
  const liveGazeZone = useRef('—');
  const mediaPipeReady = useRef(false);
  const frameCounter = useRef(0);
  const refVideoRef = useRef<HTMLVideoElement>(null);
  const [videoPlayable, setVideoPlayable] = useState(true);

  useEffect(() => {
    ensureMediaPipe().then(() => { mediaPipeReady.current = true; }).catch(() => {});
  }, []);

  const onFrame = useCallback((frame: MSEFrame) => {
    liveMotion.current = Math.round(frame.motion.motionLevel * 100);
    liveVolume.current = Math.round(frame.sound.volume);
    liveGazeZone.current = frame.gaze.zone;
    setLiveFrame(frame);

    frameCounter.current++;
    if (mediaPipeReady.current && lesson?.reference_pattern?.motion?.poseSnapshots?.length && frameCounter.current % 5 === 0) {
      const videoEl = cam.videoRef.current;
      if (videoEl) {
        try {
          const poseResult = detectPose(videoEl, performance.now());
          if (poseResult?.landmarks?.length) {
            const lmk = poseResult.landmarks[0].map(l => ({ x: l.x, y: l.y, z: l.z }));
            const refSnaps = lesson.reference_pattern.motion.poseSnapshots;
            const refIdx = Math.min(
              Math.floor((frameCounter.current / 30) % refSnaps.length),
              refSnaps.length - 1
            );
            const sim = comparePoseLandmarks(refSnaps[refIdx].landmarks, lmk);
            setLivePoseSim(sim);
          }
        } catch { /* ignore */ }
      }
    }
  }, [lesson]);

  const cam = useCamera({ onFrame });

  useEffect(() => {
    if (id) {
      supabase.from('lessons').select('*').eq('id', id).single().then(({ data }) => {
        if (data) {
          setLesson(data as unknown as Lesson);
          setVideoPlayable(true);
          setPlayState('ready');
        }
      });
    } else {
      supabase.from('lessons').select('*').eq('status', 'published').order('created_at', { ascending: false }).then(({ data }) => {
        setLessons((data || []) as unknown as Lesson[]);
      });
    }
  }, [id]);

  const handleSelectLesson = (l: Lesson) => {
    setLesson(l);
    setVideoPlayable(true);
    setPlayState('ready');
  };

  const handleStart = async () => {
    await cam.startCamera();
    await cam.startDetection();
    // Play reference video in sync
    if (refVideoRef.current) {
      refVideoRef.current.currentTime = 0;
      refVideoRef.current.muted = true;
      refVideoRef.current.play().catch(() => {
        setVideoPlayable(false);
      });
    }
    setPlayState('practicing');
  };

  const handleStop = async () => {
    cam.stopDetection();
    const pattern = await cam.extractPattern();
    cam.stopCamera();
    // Pause reference video
    if (refVideoRef.current) refVideoRef.current.pause();

    if (pattern && lesson) {
      const moduleConfigs = useModuleStore.getState().configs;
      const result = compareMSE(lesson.reference_pattern, pattern, {
        motion: lesson.weight_motion,
        sound: lesson.weight_sound,
        eyes: lesson.weight_eyes,
      }, {
        motion: moduleConfigs.motion.enabled,
        sound: moduleConfigs.sound.enabled,
        eyes: moduleConfigs.eyes.enabled,
      });
      setScores(result);
      setPlayState('results');

      if (user) {
        setSaving(true);
        await supabase.from('sessions').insert({
          crew_id: user.id,
          lesson_id: lesson.id,
          captain_id: lesson.captain_id,
          duration: Math.round(pattern.duration),
          consciousness_percent: result.overall,
          scores: result as any,
          level: getScoreLevel(result.overall),
        });
        setSaving(false);
      }
    }
  };

  const handleRetry = () => {
    setScores(null);
    setPlayState('ready');
  };

  // Lesson selection view
  if (playState === 'select') {
    return (
      <div className="space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">🎮 Select a Lesson</h1>
        {lessons.length === 0 ? (
          <Card className="glass"><CardContent className="p-8 text-center text-sm text-muted-foreground">No published lessons yet</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {lessons.map(l => (
              <Card key={l.id} className="glass cursor-pointer hover:border-primary/30 transition-colors" onClick={() => handleSelectLesson(l)}>
                <CardContent className="p-4">
                  <h3 className="font-medium">{l.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">by {l.captain_name} · {l.difficulty}</p>
                  {l.video_url && (
                    <p className="text-[10px] text-primary mt-1">📹 Has reference video</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Results view
  if (playState === 'results' && scores) {
    const level = getScoreLevel(scores.overall);
    const levelColors: Record<string, string> = {
      unconscious: 'text-score-gray', awakening: 'text-score-yellow', developing: 'text-score-orange',
      conscious: 'text-score-green', mastery: 'text-score-gold',
    };

    return (
      <div className="space-y-4 animate-slide-up">
        <h1 className="text-xl font-bold">📊 Session Results</h1>

        <Card className="glass">
          <CardContent className="p-8 text-center">
            <Trophy className={`w-10 h-10 mx-auto mb-3 ${levelColors[level]}`} />
            <div className="text-5xl font-bold text-mse-consciousness mb-2">{scores.overall}%</div>
            <div className={`text-sm font-medium uppercase ${levelColors[level]}`}>{getScoreLevelLabel(level)}</div>
          </CardContent>
        </Card>

        {[
          { key: 'motion' as const, icon: Activity, label: 'Motion', color: 'bg-mse-motion', textColor: 'text-mse-motion' },
          { key: 'sound' as const, icon: Volume2, label: 'Sound', color: 'bg-mse-sound', textColor: 'text-mse-sound' },
          { key: 'eyes' as const, icon: Eye, label: 'Eyes', color: 'bg-mse-eyes', textColor: 'text-mse-eyes' },
        ].map(item => (
          <Card key={item.key} className="glass">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <item.icon className={`w-4 h-4 ${item.textColor}`} />
                  <span className="text-sm font-medium">{item.label}</span>
                </div>
                <span className={`text-lg font-bold ${item.textColor}`}>{scores[item.key].score}%</span>
              </div>
              {Object.entries(scores[item.key].breakdown).map(([sub, val]) => (
                <div key={sub} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground capitalize">{sub.replace(/_/g, ' ')}</span>
                    <span className="font-mono">{Math.round(val as number)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${item.color} transition-all`} style={{ width: `${val}%` }} />
                  </div>
                </div>
              ))}
              {scores[item.key].feedback.map((fb, i) => (
                <p key={i} className="text-xs text-muted-foreground">💡 {fb}</p>
              ))}
            </CardContent>
          </Card>
        ))}

        <div className="flex gap-3 pb-4">
          <Button variant="outline" className="flex-1 gap-2" onClick={handleRetry}>
            <RotateCcw className="w-4 h-4" /> Try Again
          </Button>
          <Link to="/crew/progress" className="flex-1">
            <Button className="w-full gap-2">View Progress</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Ready / Practicing view
  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => { cam.destroy(); setPlayState('select'); setLesson(null); }}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-lg font-bold truncate">🎮 {lesson?.title || 'Playground'}</h1>
      </div>

      {/* Split view */}
      <div className="grid grid-cols-2 gap-3">
        {/* Reference panel - Captain's video or data */}
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-muted/30 relative">
              {lesson?.video_url && videoPlayable ? (
                <video
                  ref={refVideoRef}
                  src={lesson.video_url}
                  className="w-full h-full object-cover"
                  playsInline
                  preload="auto"
                  loop
                  muted
                  controls
                  onLoadedData={() => setVideoPlayable(true)}
                  onError={() => setVideoPlayable(false)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-3">
                  <div className="text-center w-full space-y-2">
                    <p className="text-[10px] text-muted-foreground">🧑‍✈️ Captain detected pattern</p>
                    {lesson && (
                      <>
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                            <p className="text-muted-foreground">Motion</p>
                            <p className="font-mono text-mse-motion">{Math.round((lesson.reference_pattern?.motion?.avgMotionLevel || 0) * 100)}%</p>
                          </div>
                          <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                            <p className="text-muted-foreground">Pitch</p>
                            <p className="font-mono text-mse-sound">{lesson.reference_pattern?.sound?.avgPitch || 0}Hz</p>
                          </div>
                          <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                            <p className="text-muted-foreground">Gaze</p>
                            <p className="font-mono text-mse-eyes">{lesson.reference_pattern?.eyes?.primaryZone || '—'}</p>
                          </div>
                        </div>
                        <p className="text-[9px] text-muted-foreground">{lesson?.video_url ? 'Video không phát được trên trình duyệt này, đang dùng pattern làm mẫu.' : 'Lesson này chưa có video, đang dùng pattern làm mẫu.'}</p>
                      </>
                    )}
                  </div>
                </div>
              )}
              <p className="absolute top-1 left-1 text-[10px] text-muted-foreground bg-background/60 px-1 rounded">🧑‍✈️ Captain</p>
            </div>
          </CardContent>
        </Card>

        {/* Live camera */}
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-muted/30 relative">
              <video
                ref={cam.videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
                style={{ transform: 'scaleX(-1)' }}
              />
              {showOverlay && (
                <LandmarkOverlay
                  videoRef={cam.videoRef as React.RefObject<HTMLVideoElement>}
                  active={cam.active}
                  mirrored={true}
                  onResults={(pose, face) => setMpStatus({ pose: Boolean(pose?.landmarks?.length), face: Boolean(face?.faceLandmarks?.length) })}
                />
              )}
              {!cam.active && playState === 'practicing' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <p className="absolute top-1 left-1 text-[10px] text-muted-foreground bg-background/60 px-1 rounded">🎥 You</p>
              <button
                onClick={() => setShowOverlay(v => !v)}
                className={`absolute bottom-1 right-1 p-1 rounded backdrop-blur-sm transition-colors ${
                  showOverlay ? 'bg-primary/20 text-primary' : 'bg-muted/60 text-muted-foreground'
                }`}
                title={showOverlay ? 'Hide overlay' : 'Show overlay'}
              >
                <Layers className="w-3 h-3" />
              </button>
              {showOverlay && cam.active && (
                <div className="absolute bottom-1 left-1 text-[9px] px-1.5 py-0.5 rounded bg-background/70 border border-border/50 font-mono">
                  MP P:{mpStatus.pose ? '✓' : '…'} F:{mpStatus.face ? '✓' : '…'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Captain pattern preview (fallback when lesson has no video) */}
      {(!lesson?.video_url || !videoPlayable) && lesson?.reference_pattern?.motion?.poseSnapshots?.length ? (
        <Card className="glass">
          <CardContent className="p-4 space-y-2">
            <h3 className="text-sm font-medium">Captain Pose Pattern</h3>
            <p className="text-xs text-muted-foreground">Không có video record — dùng skeleton keyframes để bạn bắt chước theo.</p>
            <PoseSkeletonChart snapshots={lesson.reference_pattern.motion.poseSnapshots} />
          </CardContent>
        </Card>
      ) : null}

      {/* Live MSE Gauges */}
      <Card className="glass">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-medium">Real-time MSE Match</h3>
          {[
            { icon: Activity, label: 'Motion', value: liveMotion.current, color: 'bg-mse-motion' },
            { icon: Volume2, label: 'Sound', value: Math.min(100, liveVolume.current), color: 'bg-mse-sound' },
            { icon: Eye, label: 'Eyes', value: liveFrame?.gaze.faceDetected ? 80 : 20, color: 'bg-mse-eyes' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <item.icon className="w-4 h-4 shrink-0" />
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-1">
                  <span>{item.label}</span>
                  <span className="font-mono">{playState === 'practicing' ? `${item.value}%` : '—'}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${item.color} transition-all duration-200`}
                    style={{ width: playState === 'practicing' ? `${item.value}%` : '0%' }} />
                </div>
              </div>
            </div>
          ))}

          {/* Real-time Pose Similarity */}
          {playState === 'practicing' && livePoseSim && (
            <div className="pt-2 border-t border-border/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">🦴 Pose Similarity</span>
                <span className="font-mono text-sm font-bold" style={{
                  color: livePoseSim.overall >= 70 ? 'hsl(var(--mse-motion))' : livePoseSim.overall >= 40 ? 'hsl(var(--score-yellow))' : 'hsl(var(--destructive))'
                }}>
                  {livePoseSim.overall}%
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Object.entries(livePoseSim.perJoint).map(([joint, val]) => (
                  <div key={joint} className="text-center">
                    <div className="text-[8px] text-muted-foreground truncate">{joint.replace(/([A-Z])/g, ' $1').trim()}</div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden mt-0.5">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${val}%`,
                          backgroundColor: val >= 70 ? 'hsl(var(--score-green))' : val >= 40 ? 'hsl(var(--score-yellow))' : 'hsl(var(--destructive))',
                        }}
                      />
                    </div>
                    <div className="text-[8px] font-mono text-muted-foreground">{val}%</div>
                  </div>
                ))}
              </div>
              {livePoseSim.feedback.length > 0 && (
                <p className="text-[10px] text-muted-foreground">💡 {livePoseSim.feedback[0]}</p>
              )}
            </div>
          )}

          {/* Live pose label */}
          {playState === 'practicing' && liveFrame && (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/30">
              <span className="text-muted-foreground">Pose</span>
              <span className="font-mono capitalize text-mse-consciousness">{liveFrame.motion.pose}</span>
            </div>
          )}

          <div className="pt-2 border-t border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-mse-consciousness" /><span className="text-sm font-medium">Consciousness</span></div>
            <span className="text-xl font-bold text-mse-consciousness">
              {playState === 'practicing' ? `${Math.round((liveMotion.current + Math.min(100, liveVolume.current) + (liveFrame?.gaze.faceDetected ? 80 : 20)) / 3)}%` : '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 pt-2">
        {playState === 'ready' && (
          <Button size="lg" onClick={handleStart} className="gap-2">
            <Play className="w-4 h-4" /> Start Practice
          </Button>
        )}
        {playState === 'practicing' && (
          <>
            <Button size="lg" variant="destructive" onClick={handleStop} className="gap-2">
              <Square className="w-4 h-4" /> Stop
            </Button>
            <span className="text-lg font-mono text-muted-foreground">{cam.elapsed}s</span>
          </>
        )}
      </div>
    </div>
  );
}
