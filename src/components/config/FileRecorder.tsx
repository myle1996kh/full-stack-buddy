import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Mic, Video, Square, Circle, Timer } from 'lucide-react';
import type { MSEModuleId } from '@/types/modules';

interface FileRecorderProps {
  moduleId: MSEModuleId;
  onRecorded: (file: File) => void;
  onCancel: () => void;
}

export default function FileRecorder({ moduleId, onRecorded, onCancel }: FileRecorderProps) {
  const isAudioOnly = moduleId === 'sound';
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [state, setState] = useState<'preview' | 'recording' | 'done'>('preview');
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start camera/mic preview
  useEffect(() => {
    let cancelled = false;

    const startPreview = async () => {
      try {
        const constraints: MediaStreamConstraints = isAudioOnly
          ? { audio: true, video: false }
          : { audio: true, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current && !isAudioOnly) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        console.error('Media access denied:', err);
      }
    };

    startPreview();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [isAudioOnly]);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];

    const mimeType = isAudioOnly
      ? (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm')
      : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm');

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(500);
    recorderRef.current = recorder;
    setState('recording');
    setElapsed(0);
    intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
  }, [isAudioOnly]);

  const stopRecording = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    recorder.onstop = () => {
      const type = isAudioOnly ? 'audio/webm' : 'video/webm';
      const ext = isAudioOnly ? 'webm' : 'webm';
      const blob = new Blob(chunksRef.current, { type });
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type });
      setState('done');
      onRecorded(file);
    };
    recorder.stop();

    // Stop stream
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, [isAudioOnly, onRecorded]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-lg border border-border bg-secondary/50 overflow-hidden"
    >
      {/* Video preview (or audio visualizer placeholder) */}
      {isAudioOnly ? (
        <div className="flex items-center justify-center h-28 bg-secondary">
          <motion.div
            animate={state === 'recording' ? { scale: [1, 1.2, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1 }}
          >
            <Mic className={`w-10 h-10 ${state === 'recording' ? 'text-destructive' : 'text-muted-foreground'}`} />
          </motion.div>
        </div>
      ) : (
        <div className="relative">
          <video
            ref={videoRef}
            className="w-full h-36 object-cover bg-background"
            playsInline
            muted
          />
          {state === 'recording' && (
            <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/90 text-destructive-foreground text-[10px] font-mono">
              <Circle className="w-2 h-2 fill-current animate-pulse" />
              REC
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Timer className="w-3.5 h-3.5" />
          <span className="font-mono">{formatTime(elapsed)}</span>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onCancel}>
            Hủy
          </Button>

          {state === 'preview' && (
            <Button size="sm" className="text-xs h-7 gap-1" onClick={startRecording}>
              {isAudioOnly ? <Mic className="w-3 h-3" /> : <Video className="w-3 h-3" />}
              Bắt đầu
            </Button>
          )}

          {state === 'recording' && (
            <Button size="sm" variant="destructive" className="text-xs h-7 gap-1" onClick={stopRecording}>
              <Square className="w-3 h-3" />
              Dừng
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
