import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Volume2, Eye, Upload, Database, Play, Trash2, FileVideo, FileAudio, BarChart3, X, Loader2, Mic, Video, SlidersHorizontal, Info } from 'lucide-react';
import { Tooltip as RadixTooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import FileRecorder from '@/components/config/FileRecorder';
import ProsodyDebugPanel from '@/components/config/ProsodyDebugPanel';
import SoundVisualizationPanel from '@/components/config/SoundVisualizationPanel';
import MotionDebugPanel from '@/components/config/MotionDebugPanel';
import EyesDebugPanel from '@/components/config/EyesDebugPanel';
import { getAllModules } from '@/engine/modules/registry';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import {
  useModuleStore,
  type DeliveryMetricId,
  type FingerprintMetricId,
  type MotionAnglesMetricId,
  type EyesGazeMetricId,
} from '@/stores/moduleStore';
import {
  setSoundDeliveryParams,
  setSoundFingerprintParams,
  setSoundCoachSParams,
  setSoundApplyQualityPenalty,
  getSoundCoachSParams
} from '@/engine/modules/soundModule';
import {
  setMotionAnglesParams,
  setMotionApplyQualityPenalty as setMotionModuleApplyQualityPenalty,
} from '@/engine/modules/motionModule';
import {
  setEyesGazeParams,
  setEyesApplyQualityPenalty as setEyesModuleApplyQualityPenalty,
} from '@/engine/modules/eyesModule';
import { toast } from 'sonner';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  processAudioFile,
  processAudioFileToV2,
  processVideoForMotion,
  processVideoForPose,
  processVideoForEyes,
  processVideoForSound,
} from '@/engine/processing/fileProcessor';
import type { MSEModuleId, ComparisonResult, SoundFrame, EyesFrame, MotionFrame } from '@/types/modules';
import { extractAdvancedSoundAnalysis, extractSoundPatternV2 } from '@/engine/sound';
import type { AdvancedSoundAnalysis, SoundPatternV2 } from '@/engine/sound/types';
import { getRouter9RuntimeConfig } from '@/engine/sound/router9Config';

const deliveryMetricLabels: Record<DeliveryMetricId, string> = {
  elongation: 'Elongation',
  emphasis: 'Emphasis',
  expressiveness: 'Expressiveness',
  rhythm: 'Rhythm',
};

const deliveryMetricTooltips: Record<DeliveryMetricId, string> = {
  elongation: 'Đo pattern kéo dài: duration CV, elongatedRatio, max/median, duration profile corr, vị trí kéo dài. Threshold: segment elongated khi duration ≥ threshold × median (slider 1.0–3.0, default 1.5x).',
  emphasis: 'Đo pattern nhấn bằng relEnergy robust (median+MAD), energy CV, emphasisRatio, energy profile corr. Threshold: segment nhấn khi relEnergy > 1.3.',
  expressiveness: 'Đo độ biểu cảm theo pitch range từng segment + profile corr. Threshold: expressive segment khi pitchRange > 2.5 semitone.',
  rhythm: 'Đo nhịp qua speechRate, regularity, duration skewness, segment-count match. Nếu thiếu segment rõ ( <3 ) sẽ fallback contour profile.',
};

const fingerprintMetricLabels: Record<FingerprintMetricId, string> = {
  melody: 'Melody Character',
  energy: 'Energy Character',
  rhythm: 'Rhythm Character',
  voice: 'Voice Character',
};

const fingerprintMetricTooltips: Record<FingerprintMetricId, string> = {
  melody: 'Đo phong cách giai điệu: pitchRange, pitchVariability, pitchDirectionBias. Direction dùng slope threshold |s| > 0.01 để bỏ frame phẳng.',
  energy: 'Đo phong cách năng lượng: energyRange, energyVariability, energyPeakRatio. Peak frame khi energy > mean + 0.5×std.',
  rhythm: 'Đo phong cách nhịp: speechRate, regularity, pauseRate, avgPauseDuration. Similarity dùng ratio^2 nên lệch nhịp bị phạt nhanh.',
  voice: 'Đo màu giọng: brightness(p90-p50), warmth(p50-p10), voicedRatio. Similarity dùng ratio+offset nhỏ để ổn định khi giá trị thấp.',
};

const motionAnglesMetricLabels: Record<MotionAnglesMetricId, string> = {
  arms: 'Arms',
  legs: 'Legs',
  torso: 'Torso',
  timing: 'Timing',
};

const motionAnglesMetricTooltips: Record<MotionAnglesMetricId, string> = {
  arms: 'Đo similarity contour góc khớp tay (elbow/shoulder). maxAngleDiff = 60°; càng lệch nhiều thì score giảm tuyến tính.',
  legs: 'Đo similarity contour góc chân (knee/hip). Cùng ngưỡng maxAngleDiff = 60°.',
  torso: 'Đo 50% pose distribution cosine + 50% velocity contour similarity (velocity maxDiff = 0.5).',
  timing: 'Đo đồng bộ thời gian: 40% velocity correlation + 60% average angle correlation theo toàn bộ joints.',
};

const eyesGazeMetricLabels: Record<EyesGazeMetricId, string> = {
  zoneMatch: 'Zone Match',
  sequence: 'Sequence',
  focus: 'Focus',
  stability: 'Stability',
  engagement: 'Engagement',
};

const eyesGazeMetricTooltips: Record<EyesGazeMetricId, string> = {
  zoneMatch: 'Đo cosine similarity giữa vector dwell time của các zone (left/right/top/bottom/center...).',
  sequence: 'Đo LCS score giữa chuỗi chuyển vùng nhìn (zone sequence).',
  focus: 'Đo lệch tương đối avgFixationDuration: score ≈ 100 - |Δ|/ref. Nếu ref=0 thì dùng fallback 100 hoặc 50.',
  stability: 'Đo correlation contour gazeX và gazeY, rồi map về 0..100.',
  engagement: 'Đo 60% primary-zone match (match=100, mismatch=40) + 40% faceDetectedRatio×100.',
};

const comparerTooltips: Record<string, string> = {
  // Sound
  'style-delivery': 'So pattern delivery theo segment: elongation/emphasis/expressiveness/rhythm. Elongation threshold hiện chỉnh từ 1.0–3.0 (default 1.5x).',
  'style-fingerprint': 'So style thống kê: pitch/energy/rhythm/voice distributions. Energy peak threshold: mean + 0.5×std; melody slope cutoff |s| > 0.01.',

  // Motion
  'pose-angles': 'So contour góc khớp theo nhóm Arms/Legs/Torso/Timing. maxAngleDiff = 60°, powerCurve 1.0–2.0 (default 1.5).',
  'pose-relative': 'So góc tương đối theo thân người (rotation/camera-angle invariant). Hữu ích khi góc quay camera giữa 2 video khác nhau.',
  'pose-invariant': 'So đa feature bất biến (proportion + angles + topology), robust hơn với scale/body-size.',
  'multi-dtw': 'Legacy motion comparer đa tín hiệu (direction/trajectory/velocity/gestures/posture).',

  // Eyes
  'gaze-pattern': 'So zone distribution (cosine), sequence (LCS), focus duration, stability correlation, engagement.',
  'attention-profile': 'So phân bố attention theo nhóm focused/scanning/away và chuyển trạng thái attention theo thời gian.',
  'engagement-score': 'So mức giao tiếp bằng mắt tổng thể: gaze contact + head pose + blink + expressiveness.',
};

const moduleIcons: Record<MSEModuleId, React.ReactNode> = {
  motion: <Activity className="w-4 h-4" />,
  sound: <Volume2 className="w-4 h-4" />,
  eyes: <Eye className="w-4 h-4" />,
};

const moduleColors: Record<MSEModuleId, string> = {
  motion: 'hsl(var(--mse-motion))',
  sound: 'hsl(var(--mse-sound))',
  eyes: 'hsl(var(--mse-eyes))',
};

const moduleBorderClass: Record<MSEModuleId, string> = {
  motion: 'border-mse-motion/40',
  sound: 'border-mse-sound/40',
  eyes: 'border-mse-eyes/40',
};

interface CompareFile {
  file: File;
  name: string;
}

interface TestResult {
  fileName: string;
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
  debug?: Record<string, any>;
  comparePattern?: SoundPatternV2 | null;
  compareFileUrl?: string;
}

interface LessonOption {
  id: string;
  title: string;
  reference_pattern: any;
  video_url: string | null;
}

interface SoundVizPair {
  fileName: string;
  referencePattern: SoundPatternV2 | null;
  attemptPattern: SoundPatternV2 | null;
}

type CoachLLMMode = 'auto' | 'force_local' | 'force_llm';

export default function ModuleTestLab() {
  const { user } = useAuthStore();
  const {
    configs,
    deliveryParams,
    setDeliveryWeight,
    toggleDeliveryMetric,
    setElongationThreshold,
    fingerprintParams,
    setFingerprintWeight,
    toggleFingerprintMetric,
    soundCompareSettings,
    setApplyQualityPenalty,
    motionAnglesParams,
    setMotionAnglesWeight,
    toggleMotionAnglesMetric,
    setMotionPowerCurve,
    motionCompareSettings,
    setMotionApplyQualityPenalty,
    eyesGazeParams,
    setEyesGazeWeight,
    toggleEyesGazeMetric,
    eyesCompareSettings,
    setEyesApplyQualityPenalty,
  } = useModuleStore();
  const modules = getAllModules();

  const [selectedModule, setSelectedModule] = useState<MSEModuleId>('motion');
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const [selectedComparer, setSelectedComparer] = useState<string>(configs.motion.activeComparerId);
  const [referenceSource, setReferenceSource] = useState<'upload' | 'lesson' | 'record'>('upload');
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<LessonOption | null>(null);
  const [lessons, setLessons] = useState<LessonOption[]>([]);
  const [compareFiles, setCompareFiles] = useState<CompareFile[]>([]);
  const [showCompareRecorder, setShowCompareRecorder] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [soundVizPairs, setSoundVizPairs] = useState<SoundVizPair[]>([]);
  const [coachApiKeyInput, setCoachApiKeyInput] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.sessionStorage.getItem('coach-v2-router9-key') ?? '';
  });
  const [coachLlmMode, setCoachLlmMode] = useState<CoachLLMMode>(() => {
    if (typeof window === 'undefined') return 'auto';
    const saved = window.sessionStorage.getItem('coach-v2-llm-mode');
    return saved === 'force_local' || saved === 'force_llm' ? saved : 'auto';
  });
  const [coachSTempoGateEnabled, setCoachSTempoGateEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.sessionStorage.getItem('coach-s-tempo-gate-enabled') !== 'false';
  });
  const [coachSTempoGateThreshold, setCoachSTempoGateThreshold] = useState(() => {
    if (typeof window === 'undefined') return 45;
    const raw = Number(window.sessionStorage.getItem('coach-s-tempo-gate-threshold') ?? '45');
    return Number.isFinite(raw) ? raw : 45;
  });
  const [coachSTempoGateCapMin, setCoachSTempoGateCapMin] = useState(() => {
    if (typeof window === 'undefined') return 20;
    const raw = Number(window.sessionStorage.getItem('coach-s-tempo-gate-cap-min') ?? '20');
    return Number.isFinite(raw) ? raw : 20;
  });
  const [coachSTempoGateCapMax, setCoachSTempoGateCapMax] = useState(() => {
    if (typeof window === 'undefined') return 40;
    const raw = Number(window.sessionStorage.getItem('coach-s-tempo-gate-cap-max') ?? '40');
    return Number.isFinite(raw) ? raw : 40;
  });
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [loadingLessons, setLoadingLessons] = useState(false);

  const refInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);

  const currentModule = modules.find(m => m.id === selectedModule)!;
  const currentMethods = currentModule.methods;
  const currentComparer = currentModule.comparers.find(c => c.id === selectedComparer) || currentModule.comparers[0];
  const currentComparerTooltip = [
    currentComparer.description,
    comparerTooltips[currentComparer.id],
  ].filter(Boolean).join(' ');

  const router9Config = getRouter9RuntimeConfig();
  const coachRouterBase = router9Config.baseUrl;
  const coachRouterModel = router9Config.model;
  const coachRouterCombo = router9Config.combo;
  const envCoachKey = router9Config.apiKey;
  const activeCoachKey = coachApiKeyInput.trim() || envCoachKey;
  const hasCoachRouterKey = Boolean(activeCoachKey);
  const llmEnabledByConfig = router9Config.llmEnabled;

  const effectiveCoachLlmEnabled = coachLlmMode === 'force_local'
    ? false
    : coachLlmMode === 'force_llm'
      ? true
      : llmEnabledByConfig;

  const willCallRouter9 = effectiveCoachLlmEnabled && hasCoachRouterKey;

  const llmModeLabel = coachLlmMode === 'force_local'
    ? 'Force Local (no LLM call)'
    : coachLlmMode === 'force_llm'
      ? 'Force LLM (always try API call)'
      : 'Auto (respect env + key)';

  const envApiKeySourceLabel = router9Config.apiKeySource === 'VITE_NINEROUTER_API_KEY'
    ? 'ENV (VITE_NINEROUTER_API_KEY)'
    : router9Config.apiKeySource === 'VITE_ROUTER9_API_KEY'
      ? 'ENV (VITE_ROUTER9_API_KEY)'
      : 'NONE (fallback local formula)';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = coachApiKeyInput.trim();
    if (v) window.sessionStorage.setItem('coach-v2-router9-key', v);
    else window.sessionStorage.removeItem('coach-v2-router9-key');
  }, [coachApiKeyInput]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('coach-v2-llm-mode', coachLlmMode);
  }, [coachLlmMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('coach-s-tempo-gate-enabled', coachSTempoGateEnabled ? 'true' : 'false');
    window.sessionStorage.setItem('coach-s-tempo-gate-threshold', String(coachSTempoGateThreshold));
    window.sessionStorage.setItem('coach-s-tempo-gate-cap-min', String(coachSTempoGateCapMin));
    window.sessionStorage.setItem('coach-s-tempo-gate-cap-max', String(coachSTempoGateCapMax));
  }, [coachSTempoGateEnabled, coachSTempoGateThreshold, coachSTempoGateCapMin, coachSTempoGateCapMax]);

  const getBreakdownLabel = (key: string) => {
    if (selectedModule === 'sound' && selectedComparer === 'style-fingerprint' && key === 'intonation') {
      return 'Melody Style';
    }
    if (key === 'rhythmPause') return 'Rhythm/Pause';
    if (key === 'tempo') return 'Tempo';
    if (key === 'intonation') return 'Intonation';
    if (key === 'energy') return 'Energy';
    if (key === 'timbre') return 'Timbre';
    if (key === 'elongation') return 'Elongation';
    if (key === 'emphasis') return 'Emphasis';
    if (key === 'expressiveness') return 'Expressiveness';
    if (key === 'rhythm') return 'Rhythm';
    if (key === 'embedding') return 'Embedding';
    if (key === 'delivery') return 'Delivery';
    if (key === 'fingerprint') return 'Fingerprint';

    // Motion
    if (key === 'arms') return 'Arms';
    if (key === 'legs') return 'Legs';
    if (key === 'torso') return 'Torso';
    if (key === 'timing') return 'Timing';
    if (key === 'upperBody') return 'Upper Body';
    if (key === 'lowerBody') return 'Lower Body';
    if (key === 'symmetry') return 'Symmetry';
    if (key === 'dynamics') return 'Dynamics';
    if (key === 'proportions') return 'Proportions';
    if (key === 'angles') return 'Angles';
    if (key === 'topology') return 'Topology';

    // Eyes
    if (key === 'zoneMatch') return 'Zone Match';
    if (key === 'sequence') return 'Sequence';
    if (key === 'focus') return 'Focus';
    if (key === 'stability') return 'Stability';
    if (key === 'engagement') return 'Engagement';
    if (key === 'focusRatio') return 'Focus Ratio';
    if (key === 'scanPattern') return 'Scan Pattern';
    if (key === 'awayTime') return 'Away Time';
    if (key === 'transitions') return 'Transitions';
    if (key === 'gazeContact') return 'Gaze Contact';
    if (key === 'headPose') return 'Head Pose';
    if (key === 'blinkRate') return 'Blink Rate';

    return key;
  };

  const handleModuleChange = (moduleId: MSEModuleId) => {
    setSelectedModule(moduleId);
    const mod = modules.find(m => m.id === moduleId)!;
    const defaultMethod = mod.methods.find(m => m.isDefault) || mod.methods[0];
    setSelectedMethod(defaultMethod?.id || '');
    setSelectedComparer(configs[moduleId].activeComparerId);
    setResults([]);
    setSoundVizPairs([]);
  };

  const loadLessons = useCallback(async () => {
    setLoadingLessons(true);
    const { data, error } = await supabase
      .from('lessons')
      .select('id, title, reference_pattern, video_url')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setLessons(data.map(l => ({
        id: l.id,
        title: l.title,
        reference_pattern: l.reference_pattern,
        video_url: l.video_url,
      })));
    }
    setLoadingLessons(false);
  }, []);

  const handleReferenceSourceChange = (source: 'upload' | 'lesson' | 'record') => {
    setReferenceSource(source);
    if (source === 'lesson') loadLessons();
  };

  const handleReferenceRecorded = (file: File) => {
    setReferenceFile(file);
    setReferenceSource('upload'); // switch back to show the file
  };

  const handleCompareRecorded = (file: File) => {
    setCompareFiles(prev => [...prev, { file, name: file.name }]);
    setShowCompareRecorder(false);
  };

  const handleReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setReferenceFile(file);
  };

  const handleCompareUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setCompareFiles(prev => [...prev, ...files.map(f => ({ file: f, name: f.name }))]);
    if (compareInputRef.current) compareInputRef.current.value = '';
  };

  const removeCompareFile = (index: number) => {
    setCompareFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getAcceptType = () => {
    if (selectedModule === 'sound') return 'audio/*,video/*';
    return 'video/*';
  };

  function coerceSoundPatternForViz(pattern: any): SoundPatternV2 | null {
    if (!pattern) return null;
    if (pattern._v2 && Array.isArray(pattern._v2.pitchContourNorm)) return pattern._v2 as SoundPatternV2;
    if (
      typeof pattern.duration === 'number'
      && Array.isArray(pattern.pitchContourNorm)
      && Array.isArray(pattern.energyContourNorm)
      && Array.isArray(pattern.onsetTimes)
    ) {
      return pattern as SoundPatternV2;
    }
    return null;
  }

  function ensureAdvancedAnalysis<T extends SoundPatternV2 | null>(pattern: T): T {
    if (!pattern) return pattern;
    if (!pattern.advanced) {
      pattern.advanced = extractAdvancedSoundAnalysis(pattern);
    }
    return pattern;
  }

  const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, '-');

  async function uploadTestFile(file: File, kind: 'reference' | 'compare') {
    if (!user) return null;
    const filePath = `${user.id}/module-tests/${selectedModule}/${Date.now()}-${kind}-${sanitizeFileName(file.name)}`;
    const { error } = await supabase.storage
      .from('test-files')
      .upload(filePath, file, { upsert: false });

    if (error) {
      console.warn('Test file upload failed:', error);
      return null;
    }

    const { data } = supabase.storage.from('test-files').getPublicUrl(filePath);
    return data.publicUrl;
  }

  /**
   * Extract frames from a file using the appropriate processor for the selected module.
   */
  async function extractFrames(file: File, moduleId: MSEModuleId): Promise<any[]> {
    switch (moduleId) {
      case 'sound':
        return processAudioFile(file, (p) => setProgress(p));
      case 'motion':
        // Use pose detection if method requires it, otherwise use frame diff
        if (selectedMethod === 'full-pose' || selectedMethod === 'full-body-pose') {
          return processVideoForPose(file, (p) => setProgress(p));
        }
        return processVideoForMotion(file, (p) => setProgress(p));
      case 'eyes':
        return processVideoForEyes(file, (p) => setProgress(p));
      default:
        return [];
    }
  }

  const runComparison = async () => {
    if (!user) return;
    if (referenceSource === 'upload' && !referenceFile) {
      toast.error('Chọn file reference trước');
      return;
    }
    if (referenceSource === 'lesson' && !selectedLesson) {
      toast.error('Chọn lesson trước');
      return;
    }
    if (compareFiles.length === 0) {
      toast.error('Upload ít nhất 1 file để so sánh');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setResults([]);
    setSoundVizPairs([]);

    try {
      const comparer = currentComparer;
      const method = currentModule.methods.find(m => m.id === selectedMethod) || currentModule.methods[0];

      // Inject dynamic weights/params for all modules
      if (selectedModule === 'sound') {
        setSoundDeliveryParams({
          weights: deliveryParams.weights,
          enabledMetrics: deliveryParams.enabled,
          elongationThreshold: deliveryParams.elongationThreshold,
        });
        setSoundFingerprintParams({
          weights: fingerprintParams.weights,
          enabledMetrics: fingerprintParams.enabled,
        });
        const currentCoachS = getSoundCoachSParams();
        setSoundCoachSParams({
          ...currentCoachS,
          scoring: {
            ...currentCoachS.scoring,
            tempoGateEnabled: coachSTempoGateEnabled,
            tempoGateThreshold: coachSTempoGateThreshold,
            tempoGateCapMin: coachSTempoGateCapMin,
            tempoGateCapMax: coachSTempoGateCapMax,
          },
        });
        setSoundApplyQualityPenalty(soundCompareSettings.applyQualityPenalty);
      } else {
        setSoundDeliveryParams(undefined);
        setSoundFingerprintParams(undefined);
        setSoundCoachSParams(undefined);
        setSoundApplyQualityPenalty(true);
      }

      if (selectedModule === 'motion') {
        setMotionAnglesParams({
          weights: motionAnglesParams.weights,
          enabledMetrics: motionAnglesParams.enabled,
          powerCurve: motionAnglesParams.powerCurve,
        });
        setMotionModuleApplyQualityPenalty(motionCompareSettings.applyQualityPenalty);
      } else {
        setMotionAnglesParams(undefined);
        setMotionModuleApplyQualityPenalty(true);
      }

      if (selectedModule === 'eyes') {
        setEyesGazeParams({
          weights: eyesGazeParams.weights,
          enabledMetrics: eyesGazeParams.enabled,
        });
        setEyesModuleApplyQualityPenalty(eyesCompareSettings.applyQualityPenalty);
      } else {
        setEyesGazeParams(undefined);
        setEyesModuleApplyQualityPenalty(true);
      }

      // Step 1: Extract reference pattern
      let referencePattern: any;
      let referenceSoundV2: SoundPatternV2 | null = null;

      if (referenceSource === 'lesson' && selectedLesson?.reference_pattern) {
        // Use existing pattern from lesson
        const patternData = selectedLesson.reference_pattern as any;
        // Extract module-specific pattern from lesson's reference_pattern
        if (selectedModule === 'motion' && patternData.motion) {
          referencePattern = patternData.motion;
        } else if (selectedModule === 'sound' && patternData.sound) {
          referencePattern = patternData.sound;
        } else if (selectedModule === 'eyes' && patternData.eyes) {
          referencePattern = patternData.eyes;
        } else {
          // Fallback: use the whole pattern
          referencePattern = patternData;
        }
        referenceSoundV2 = selectedModule === 'sound'
          ? ensureAdvancedAnalysis(coerceSoundPatternForViz(referencePattern))
          : null;
        setProcessingStatus('Reference pattern loaded from lesson');
      } else if (referenceFile) {
        setProcessingStatus('🎯 Analyzing reference file...');

        if (selectedModule === 'sound') {
          const { frames, duration, clipping, measureSFeatures } = await processAudioFileToV2(referenceFile, (p) => setProgress(p));
          if (frames.length === 0) {
            throw new Error('Could not extract any sound frames from reference file');
          }
          const v2Pattern = ensureAdvancedAnalysis(extractSoundPatternV2(frames, duration, clipping, measureSFeatures));
          referenceSoundV2 = v2Pattern;
          referencePattern = {
            pitchContour: [],
            volumeContour: [],
            rhythmPattern: [],
            avgPitch: 0,
            avgVolume: 0,
            syllableRate: v2Pattern.speechRate,
            _v2: v2Pattern,
          } as any;
          setProcessingStatus(`Reference: ${frames.length} sound frames (V2)`);
        } else {
          const refFrames = await extractFrames(referenceFile, selectedModule);
          if (refFrames.length === 0) {
            throw new Error('Could not extract any frames from reference file');
          }
          referencePattern = method.extract(refFrames);
          setProcessingStatus(`Reference: ${refFrames.length} frames extracted`);
        }
      } else {
        throw new Error('No reference source');
      }

      // Step 2: Process each compare file
      const testResults: TestResult[] = [];
      const soundPairs: SoundVizPair[] = [];
      const totalFiles = compareFiles.length;

      for (let i = 0; i < totalFiles; i++) {
        const cf = compareFiles[i];
        setProcessingStatus(`📊 Processing file ${i + 1}/${totalFiles}: ${cf.name}`);
        setProgress(0);

        let comparePattern: any;

        if (selectedModule === 'sound') {
          const { frames, duration, clipping, measureSFeatures } = await processAudioFileToV2(cf.file, (p) => setProgress(p));
          if (frames.length === 0) {
            testResults.push({
              fileName: cf.name,
              score: 0,
              breakdown: {},
              feedback: ['Could not extract sound frames from this file'],
            });
            continue;
          }

          const v2Pattern = ensureAdvancedAnalysis(extractSoundPatternV2(frames, duration, clipping, measureSFeatures));
          comparePattern = {
            pitchContour: [],
            volumeContour: [],
            rhythmPattern: [],
            avgPitch: 0,
            avgVolume: 0,
            syllableRate: v2Pattern.speechRate,
            _v2: v2Pattern,
          } as any;
        } else {
          const compareFrames = await extractFrames(cf.file, selectedModule);
          if (compareFrames.length === 0) {
            testResults.push({
              fileName: cf.name,
              score: 0,
              breakdown: {},
              feedback: ['Could not extract frames from this file'],
            });
            continue;
          }
          comparePattern = method.extract(compareFrames);
        }

        // Use the real module comparer (sync or async)
        const result: ComparisonResult = await Promise.resolve(comparer.compare(referencePattern, comparePattern));

        const comparePatternV2 = selectedModule === 'sound'
          ? ensureAdvancedAnalysis(coerceSoundPatternForViz(comparePattern))
          : null;

        testResults.push({
          fileName: cf.name,
          score: Math.round(result.score),
          breakdown: Object.fromEntries(
            Object.entries(result.breakdown).map(([k, v]) => [k, Math.round(v)])
          ),
          feedback: result.feedback,
          debug: (result as any).debug ?? undefined,
          comparePattern: comparePatternV2,
        });

        if (selectedModule === 'sound') {
          soundPairs.push({
            fileName: cf.name,
            referencePattern: referenceSoundV2,
            attemptPattern: comparePatternV2,
          });
        }

        setProcessingStatus(`✅ File ${i + 1}/${totalFiles} done — Score: ${Math.round(result.score)}%`);
      }

      setResults(testResults);
      setSoundVizPairs(selectedModule === 'sound' ? soundPairs : []);
      setProgress(100);
      setProcessingStatus('');

      // Save to database + storage
      const uploadedReferenceUrl = referenceSource === 'upload' && referenceFile
        ? await uploadTestFile(referenceFile, 'reference')
        : null;

      const refUrl = referenceSource === 'lesson'
        ? selectedLesson?.video_url || 'lesson-reference'
        : uploadedReferenceUrl || referenceFile?.name || '';

      const uploadedCompareUrls = await Promise.all(compareFiles.map((cf) => uploadTestFile(cf.file, 'compare')));
      const compareUrlByFileName = new Map(compareFiles.map((cf, index) => [cf.name, uploadedCompareUrls[index] || cf.name]));

      const { data: testRow, error: testErr } = await supabase
        .from('module_tests')
        .insert({
          user_id: user.id,
          module_id: selectedModule,
          method_id: selectedMethod || method.id,
          reference_file_url: refUrl,
          reference_source: referenceSource,
          lesson_id: referenceSource === 'lesson' ? selectedLesson?.id : null,
        })
        .select('id')
        .single();

      if (testErr) throw testErr;

      const referencePatternForSave = selectedModule === 'sound'
        ? referenceSoundV2
        : null;

       const resultInserts = testResults.map(r => ({
         test_id: testRow.id,
         compare_file_url: compareUrlByFileName.get(r.fileName) || r.fileName,
         file_name: r.fileName,
         score: r.score,
         breakdown: r.breakdown,
         feedback: r.feedback,
         reference_pattern: selectedModule === 'sound' ? referencePatternForSave : null,
         compare_pattern: selectedModule === 'sound' ? r.comparePattern : null,
       }));

      const { data: insertedResults, error: resultsErr } = await supabase
        .from('module_test_results')
        .insert(resultInserts)
        .select('id, file_name');

      if (resultsErr) throw resultsErr;

      if (selectedModule === 'sound' && insertedResults?.length) {
        const resultIdByFileName = new Map(insertedResults.map((row) => [row.file_name, row.id]));
        const advancedRows = testResults.flatMap((result) => {
          const testResultId = resultIdByFileName.get(result.fileName);
          if (!testResultId) return [] as any[];

          const rows: Array<Record<string, any>> = [];
          const referenceAdvanced = referencePatternForSave?.advanced;
          const attemptAdvanced = result.comparePattern?.advanced;

          const toRow = (referenceOrAttempt: 'reference' | 'attempt', fileUrl: string, advanced: AdvancedSoundAnalysis | undefined | null) => {
            if (!advanced) return null;
            return {
              test_result_id: testResultId,
              reference_or_attempt: referenceOrAttempt,
              file_url: fileUrl,
              analysis_version: advanced.version,
              label: advanced.summary.label,
              summary: advanced.summary,
              pauses: advanced.pauses,
              phrasing: advanced.phrasing,
              elongation: advanced.elongation,
              intonation: advanced.intonation,
              rhythm: advanced.rhythm,
              llm_payload: advanced.llmPayload,
              visualization: {
                evidence: advanced.summary.evidence,
                pauseCount: advanced.pauses.total,
                chunkCount: advanced.phrasing.chunkCount,
                elongationCount: advanced.elongation.count,
              },
            };
          };

          const referenceRow = toRow('reference', refUrl, referenceAdvanced);
          if (referenceRow) rows.push(referenceRow);
          const attemptRow = toRow('attempt', compareUrlByFileName.get(result.fileName) || result.fileName, attemptAdvanced);
          if (attemptRow) rows.push(attemptRow);
          return rows;
        });

        if (advancedRows.length > 0) {
          const { error: advancedErr } = await supabase
            .from('sound_advanced_analyses')
            .insert(advancedRows);
          if (advancedErr) throw advancedErr;
        }
      }

      toast.success(`So sánh hoàn tất! ${testResults.length} kết quả đã lưu`);
    } catch (err: any) {
      console.error('Module test error:', err);
      toast.error(err.message || 'Lỗi khi xử lý file');
    } finally {
      setProcessing(false);
      setProcessingStatus('');
    }
  };

  // Chart data
  const barChartData = results.map(r => ({
    name: r.fileName.length > 15 ? r.fileName.slice(0, 12) + '...' : r.fileName,
    score: r.score,
  }));

  const referenceName = referenceSource === 'lesson'
    ? `📌 ${selectedLesson?.title || 'Lesson'}`
    : `📌 ${referenceFile?.name || 'Reference'}`;

  const radarData = results.length > 0
    ? Object.keys(results[0].breakdown).map(key => {
        const entry: Record<string, any> = { metric: getBreakdownLabel(key) };
        entry['Reference'] = 100; // Captain's reference is always the baseline (100%)
        results.forEach((r, i) => {
          const label = r.fileName.length > 20 ? r.fileName.slice(0, 17) + '...' : r.fileName;
          entry[label] = r.breakdown[key] || 0;
        });
        return entry;
      })
    : [];

  const radarColors = ['hsl(var(--primary))', 'hsl(var(--mse-motion))', 'hsl(var(--mse-sound))', 'hsl(var(--mse-eyes))', 'hsl(var(--accent-foreground))'];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">🧪 Module Test Lab</h2>
      <p className="text-xs text-muted-foreground">
        Test từng module riêng lẻ. Upload file reference + nhiều file compare → so sánh điểm 1-1 dùng real engine.
      </p>

      <Accordion type="single" collapsible defaultValue="setup" className="space-y-3">
        <AccordionItem value="setup" className="glass overflow-hidden rounded-[1.5rem] border border-white/70 px-0">
          <AccordionTrigger className="px-6 py-5 hover:no-underline">
            <div className="text-left">
              <p className="text-sm font-semibold">1. Chọn Module & Method</p>
              <p className="mt-1 text-xs text-muted-foreground capitalize">{selectedModule} · {currentComparer.name}</p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <div className="space-y-3">
              <div className="flex gap-2">
                {(['motion', 'sound', 'eyes'] as MSEModuleId[]).map(moduleId => (
                  <motion.button
                    key={moduleId}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleModuleChange(moduleId)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border text-xs font-medium transition-all ${
                      selectedModule === moduleId
                        ? `${moduleBorderClass[moduleId]} bg-secondary text-foreground shadow-sm`
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                    }`}
                  >
                    {moduleIcons[moduleId]}
                    <span className="capitalize">{moduleId}</span>
                  </motion.button>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Detection Method</Label>
                <Select value={selectedMethod} onValueChange={setSelectedMethod}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Chọn method..." />
                  </SelectTrigger>
                  <SelectContent>
                    {currentMethods.map(m => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {currentModule.comparers.length > 1 && (
                <div className="space-y-1.5">
                  <TooltipProvider delayDuration={200}>
                    <Label className="text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        Comparer
                        <RadixTooltip>
                          <TooltipTrigger asChild>
                            <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[340px] text-[11px] leading-relaxed">
                            {currentComparerTooltip}
                          </TooltipContent>
                        </RadixTooltip>
                      </span>
                    </Label>
                  </TooltipProvider>
                  <Select value={selectedComparer} onValueChange={setSelectedComparer}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Chọn comparer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {currentModule.comparers.map(c => (
                        <SelectItem
                          key={c.id}
                          value={c.id}
                          className="text-xs"
                          title={[c.description, comparerTooltips[c.id]].filter(Boolean).join(' ')}
                        >
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                Active Comparer: <span className="font-medium text-foreground">{currentComparer.name}</span> ({currentComparer.id})
                <RadixTooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[340px] text-[11px] leading-relaxed">
                    {currentComparerTooltip}
                  </TooltipContent>
                </RadixTooltip>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="scoring" className="glass overflow-hidden rounded-[1.5rem] border border-white/70 px-0">
          <AccordionTrigger className="px-6 py-5 hover:no-underline">
            <div className="text-left">
              <p className="text-sm font-semibold">Scoring Settings</p>
              <p className="mt-1 text-xs text-muted-foreground">Fine-tune weights, thresholds, and quality penalties for the current module.</p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <AnimatePresence>
              {selectedModule === 'sound' && selectedComparer === 'style-delivery' && (
                <motion.div key="delivery-params" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Card className="glass border-mse-sound/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4" />
                        Delivery Params
                        <span className="text-[10px] text-muted-foreground font-normal">(adjust weights & threshold)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <TooltipProvider delayDuration={200}>
                        {(Object.keys(deliveryParams.weights) as DeliveryMetricId[]).map((metricId) => {
                          const weight = deliveryParams.weights[metricId];
                          const enabled = deliveryParams.enabled[metricId];
                          const totalWeight = (Object.keys(deliveryParams.weights) as DeliveryMetricId[]).filter((id) => deliveryParams.enabled[id]).reduce((s, id) => s + deliveryParams.weights[id], 0);
                          const normalizedPct = enabled && totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0;

                          return (
                            <div key={metricId} className={`flex items-center gap-3 transition-opacity ${enabled ? '' : 'opacity-40'}`}>
                              <Switch checked={enabled} onCheckedChange={() => toggleDeliveryMetric(metricId)} className="scale-75" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium flex items-center gap-1">
                                    {deliveryMetricLabels[metricId]}
                                    <RadixTooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[260px] text-[11px] leading-relaxed">{deliveryMetricTooltips[metricId]}</TooltipContent>
                                    </RadixTooltip>
                                  </span>
                                  <span className="text-[10px] font-mono text-muted-foreground">{enabled ? `${normalizedPct}%` : 'OFF'}</span>
                                </div>
                                {enabled && <Slider value={[weight * 100]} onValueChange={([v]) => setDeliveryWeight(metricId, v / 100)} min={0} max={100} step={5} className="h-1" />}
                              </div>
                            </div>
                          );
                        })}

                        <div className="pt-2 border-t border-border/50">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium flex items-center gap-1">
                              Elongation Threshold
                              <RadixTooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[280px] text-[11px] leading-relaxed">Rule: segment elongated khi duration ≥ threshold × medianDuration. Range 1.0–3.0, default 1.5x. Below 1.3 = sensitive, 1.3–2.0 = balanced, above 2.0 = strict.</TooltipContent>
                              </RadixTooltip>
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">{deliveryParams.elongationThreshold.toFixed(1)}x</span>
                          </div>
                          <Slider value={[deliveryParams.elongationThreshold * 10]} onValueChange={([v]) => setElongationThreshold(v / 10)} min={10} max={30} step={1} className="h-1" />
                          <p className="mt-1 text-[10px] text-muted-foreground">Segments {'>'}= {deliveryParams.elongationThreshold.toFixed(1)}x median duration count as "elongated"</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">{deliveryParams.elongationThreshold < 1.3 ? 'Mode: Sensitive (dễ bắt nhầm kéo dài nhẹ)' : deliveryParams.elongationThreshold > 2.0 ? 'Mode: Strict (chỉ bắt kéo dài rõ rệt)' : 'Mode: Balanced (khuyến nghị)'}</p>
                        </div>
                      </TooltipProvider>

                      <p className="text-[10px] text-muted-foreground">Weights are auto-normalized across enabled metrics. Disabled metrics won't affect score or breakdown.</p>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {selectedModule === 'sound' && selectedComparer === 'style-fingerprint' && (
                <motion.div key="fingerprint-params" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Card className="glass border-mse-sound/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4" />
                        Fingerprint Params
                        <span className="text-[10px] text-muted-foreground font-normal">(adjust style dimension weights)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <TooltipProvider delayDuration={200}>
                        {(Object.keys(fingerprintParams.weights) as FingerprintMetricId[]).map((metricId) => {
                          const weight = fingerprintParams.weights[metricId];
                          const enabled = fingerprintParams.enabled[metricId];
                          const totalWeight = (Object.keys(fingerprintParams.weights) as FingerprintMetricId[]).filter((id) => fingerprintParams.enabled[id]).reduce((s, id) => s + fingerprintParams.weights[id], 0);
                          const normalizedPct = enabled && totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0;

                          return (
                            <div key={metricId} className={`flex items-center gap-3 transition-opacity ${enabled ? '' : 'opacity-40'}`}>
                              <Switch checked={enabled} onCheckedChange={() => toggleFingerprintMetric(metricId)} className="scale-75" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium flex items-center gap-1">
                                    {fingerprintMetricLabels[metricId]}
                                    <RadixTooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[260px] text-[11px] leading-relaxed">{fingerprintMetricTooltips[metricId]}</TooltipContent>
                                    </RadixTooltip>
                                  </span>
                                  <span className="text-[10px] font-mono text-muted-foreground">{enabled ? `${normalizedPct}%` : 'OFF'}</span>
                                </div>
                                {enabled && <Slider value={[weight * 100]} onValueChange={([v]) => setFingerprintWeight(metricId, v / 100)} min={0} max={100} step={5} className="h-1" />}
                              </div>
                            </div>
                          );
                        })}
                      </TooltipProvider>
                      <p className="text-[10px] text-muted-foreground">Weights are auto-normalized across enabled metrics. OFF metrics won't affect score/breakdown.</p>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {selectedModule === 'sound' && selectedComparer === 'style-coach-s' && (
                <motion.div key="coach-s-config" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Card className="glass border-mse-sound/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4" />
                        Vocal Coach S (Measure S)
                        <span className="text-[10px] text-muted-foreground font-normal">(dynamic score settings)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-[11px] text-muted-foreground">Overall mặc định = base (tempo×0.5 + energy×0.5). Nếu tempo thấp hơn tempo gate, score sẽ bị cap trong dải thấp (mặc định 20–40) theo energy.</p>
                      <div className="rounded-md border border-border/60 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium">Tempo Gate for energy_floor</p>
                            <p className="text-[10px] text-muted-foreground">Khi bật, nếu tempo score thấp hơn ngưỡng này thì overall sẽ giữ theo base thay vì để energy cứu điểm bằng energy_floor.</p>
                          </div>
                          <Switch checked={coachSTempoGateEnabled} onCheckedChange={setCoachSTempoGateEnabled} className="scale-90" />
                        </div>
                        <div className={`space-y-2 ${coachSTempoGateEnabled ? '' : 'opacity-50'}`}>
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">Tempo gate threshold</Label>
                            <span className="text-[10px] font-mono text-muted-foreground">{coachSTempoGateThreshold.toFixed(0)}</span>
                          </div>
                          <Slider value={[coachSTempoGateThreshold]} onValueChange={([v]) => setCoachSTempoGateThreshold(v)} min={20} max={70} step={1} disabled={!coachSTempoGateEnabled} className="h-1" />
                          <p className="text-[10px] text-muted-foreground">Nếu tempo score {'<'} {coachSTempoGateThreshold.toFixed(0)}, rule energy_floor sẽ không được áp dụng.</p>
                          <div className="grid grid-cols-1 gap-3 pt-1 md:grid-cols-2">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs text-muted-foreground">Low-tempo cap min</Label>
                                <span className="text-[10px] font-mono text-muted-foreground">{coachSTempoGateCapMin.toFixed(0)}</span>
                              </div>
                              <Slider value={[coachSTempoGateCapMin]} onValueChange={([v]) => setCoachSTempoGateCapMin(Math.min(v, coachSTempoGateCapMax - 1))} min={10} max={45} step={1} disabled={!coachSTempoGateEnabled} className="h-1" />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs text-muted-foreground">Low-tempo cap max</Label>
                                <span className="text-[10px] font-mono text-muted-foreground">{coachSTempoGateCapMax.toFixed(0)}</span>
                              </div>
                              <Slider value={[coachSTempoGateCapMax]} onValueChange={([v]) => setCoachSTempoGateCapMax(Math.max(v, coachSTempoGateCapMin + 1))} min={15} max={49} step={1} disabled={!coachSTempoGateEnabled} className="h-1" />
                            </div>
                          </div>
                          <p className="text-[10px] text-muted-foreground">Khi tempo thấp: cap = min + (max - min) × (energy/100). Mặc định khuyến nghị: 20–40.</p>
                        </div>
                      </div>
                      <div className="space-y-1 rounded-md border border-border/60 p-2 font-mono text-[10px]">
                        <p>energy_cap: energy {'<'} 20 → overall = min(base, energy × 2.5)</p>
                        <p>energy_floor trigger: tempo {'<'} energy × 0.6</p>
                        <p>energy_floor result: overall = max(base, energy × 1.05)</p>
                        <p>tempo_gate_cap: tempo {'<'} threshold → overall = min(base, cap[energy])</p>
                        <p>current tempo gate: {coachSTempoGateEnabled ? `ON (threshold ${coachSTempoGateThreshold.toFixed(0)}, cap ${coachSTempoGateCapMin.toFixed(0)}-${coachSTempoGateCapMax.toFixed(0)})` : 'OFF'}</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {selectedModule === 'sound' && (
                <motion.div key="sound-quality-toggle" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Card className="glass border-dashed border-mse-sound/30">
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium flex items-center gap-1">
                            Apply Quality Penalty
                            <RadixTooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[320px] text-[11px] leading-relaxed">ON: Final = Raw × QualityFactor. Sound thresholds: SNR below 12 / below 6, clipping above 1% / above 5%, confidence below 0.5 / below 0.3, voicedRatio below 0.2 / below 0.1, duration below 2s / below 1s. Floor QualityFactor = 0.4.</TooltipContent>
                            </RadixTooltip>
                          </p>
                          <p className="text-[10px] text-muted-foreground">ON: final score = raw score × quality factor (noise/clipping sẽ bị trừ điểm).</p>
                        </div>
                        <Switch checked={soundCompareSettings.applyQualityPenalty} onCheckedChange={setApplyQualityPenalty} />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {selectedModule === 'motion' && selectedComparer === 'pose-angles' && (
                <motion.div key="motion-angles-params" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Card className="glass border-mse-motion/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4" />
                        Motion Angle Params
                        <span className="text-[10px] text-muted-foreground font-normal">(weights + power curve)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <TooltipProvider delayDuration={200}>
                        {(Object.keys(motionAnglesParams.weights) as MotionAnglesMetricId[]).map((metricId) => {
                          const weight = motionAnglesParams.weights[metricId];
                          const enabled = motionAnglesParams.enabled[metricId];
                          const totalWeight = (Object.keys(motionAnglesParams.weights) as MotionAnglesMetricId[]).filter((id) => motionAnglesParams.enabled[id]).reduce((s, id) => s + motionAnglesParams.weights[id], 0);
                          const normalizedPct = enabled && totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0;
                          return (
                            <div key={metricId} className={`flex items-center gap-3 transition-opacity ${enabled ? '' : 'opacity-40'}`}>
                              <Switch checked={enabled} onCheckedChange={() => toggleMotionAnglesMetric(metricId)} className="scale-75" />
                              <div className="flex-1 min-w-0">
                                <div className="mb-1 flex items-center justify-between">
                                  <span className="text-xs font-medium flex items-center gap-1">
                                    {motionAnglesMetricLabels[metricId]}
                                    <RadixTooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[260px] text-[11px] leading-relaxed">{motionAnglesMetricTooltips[metricId]}</TooltipContent>
                                    </RadixTooltip>
                                  </span>
                                  <span className="text-[10px] font-mono text-muted-foreground">{enabled ? `${normalizedPct}%` : 'OFF'}</span>
                                </div>
                                {enabled && <Slider value={[weight * 100]} onValueChange={([v]) => setMotionAnglesWeight(metricId, v / 100)} min={0} max={100} step={5} className="h-1" />}
                              </div>
                            </div>
                          );
                        })}
                        <div className="pt-2 border-t border-border/50">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs font-medium flex items-center gap-1">
                              Power Curve
                              <RadixTooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[320px] text-[11px] leading-relaxed">Công thức: scoreOut = (scoreRaw/100) ^ powerCurve × 100. Range hiện tại 1.0–2.0 (default 1.5). Cao hơn = phạt mạnh lỗi lớn, tách bạch tốt nhưng khó điểm cao.</TooltipContent>
                              </RadixTooltip>
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">{motionAnglesParams.powerCurve.toFixed(1)}x</span>
                          </div>
                          <Slider value={[motionAnglesParams.powerCurve * 10]} onValueChange={([v]) => setMotionPowerCurve(v / 10)} min={10} max={20} step={1} className="h-1" />
                        </div>
                      </TooltipProvider>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {selectedModule === 'motion' && (
                <motion.div key="motion-quality-toggle" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Card className="glass border-dashed border-mse-motion/30">
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium flex items-center gap-1">
                            Apply Quality Penalty
                            <RadixTooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[320px] text-[11px] leading-relaxed">ON: Final = Raw × QualityFactor. Motion qualityFactor = max(0.5, 1 - missingFrameRatio). Ví dụ missing 30% → factor 0.7; missing 70% → factor vẫn 0.5 (floor).</TooltipContent>
                            </RadixTooltip>
                          </p>
                          <p className="text-[10px] text-muted-foreground">Penalize scores when many frames are missing/low-confidence.</p>
                        </div>
                        <Switch checked={motionCompareSettings.applyQualityPenalty} onCheckedChange={setMotionApplyQualityPenalty} />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {selectedModule === 'eyes' && selectedComparer === 'gaze-pattern' && (
                <motion.div key="eyes-gaze-params" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Card className="glass border-mse-eyes/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4" />
                        Eyes Gaze Params
                        <span className="text-[10px] text-muted-foreground font-normal">(toggle & adjust weights)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <TooltipProvider delayDuration={200}>
                        {(Object.keys(eyesGazeParams.weights) as EyesGazeMetricId[]).map((metricId) => {
                          const weight = eyesGazeParams.weights[metricId];
                          const enabled = eyesGazeParams.enabled[metricId];
                          const totalWeight = (Object.keys(eyesGazeParams.weights) as EyesGazeMetricId[]).filter((id) => eyesGazeParams.enabled[id]).reduce((s, id) => s + eyesGazeParams.weights[id], 0);
                          const normalizedPct = enabled && totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0;
                          return (
                            <div key={metricId} className={`flex items-center gap-3 transition-opacity ${enabled ? '' : 'opacity-40'}`}>
                              <Switch checked={enabled} onCheckedChange={() => toggleEyesGazeMetric(metricId)} className="scale-75" />
                              <div className="flex-1 min-w-0">
                                <div className="mb-1 flex items-center justify-between">
                                  <span className="text-xs font-medium flex items-center gap-1">
                                    {eyesGazeMetricLabels[metricId]}
                                    <RadixTooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[260px] text-[11px] leading-relaxed">{eyesGazeMetricTooltips[metricId]}</TooltipContent>
                                    </RadixTooltip>
                                  </span>
                                  <span className="text-[10px] font-mono text-muted-foreground">{enabled ? `${normalizedPct}%` : 'OFF'}</span>
                                </div>
                                {enabled && <Slider value={[weight * 100]} onValueChange={([v]) => setEyesGazeWeight(metricId, v / 100)} min={0} max={100} step={5} className="h-1" />}
                              </div>
                            </div>
                          );
                        })}
                      </TooltipProvider>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {selectedModule === 'eyes' && (
                <motion.div key="eyes-quality-toggle" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Card className="glass border-dashed border-mse-eyes/30">
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium flex items-center gap-1">
                            Apply Quality Penalty
                            <RadixTooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[320px] text-[11px] leading-relaxed">ON: Final = Raw × QualityFactor. Eyes qualityFactor = max(0.5, faceDetectedRatio). Ví dụ detect face 62% frame → factor 0.62; dưới 50% vẫn giữ floor 0.5.</TooltipContent>
                            </RadixTooltip>
                          </p>
                          <p className="text-[10px] text-muted-foreground">Penalize scores when face detection quality is weak.</p>
                        </div>
                        <Switch checked={eyesCompareSettings.applyQualityPenalty} onCheckedChange={setEyesApplyQualityPenalty} />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {!((selectedModule === 'sound') || (selectedModule === 'motion') || (selectedModule === 'eyes')) && (
                <p className="text-xs text-muted-foreground">No advanced scoring settings for this selection.</p>
              )}
            </AnimatePresence>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="reference" className="glass overflow-hidden rounded-[1.5rem] border border-white/70 px-0">
          <AccordionTrigger className="px-6 py-5 hover:no-underline">
            <div className="text-left">
              <p className="text-sm font-semibold">2. Reference (Captain Sample)</p>
              <p className="mt-1 text-xs text-muted-foreground">{referenceSource === 'lesson' ? selectedLesson?.title || 'Choose a lesson reference' : referenceFile?.name || 'Choose or record a reference file'}</p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button variant={referenceSource === 'upload' ? 'default' : 'outline'} size="sm" className="gap-1.5 text-xs" onClick={() => handleReferenceSourceChange('upload')}><Upload className="w-3.5 h-3.5" /> Upload</Button>
                <Button variant={referenceSource === 'record' ? 'default' : 'outline'} size="sm" className="gap-1.5 text-xs" onClick={() => handleReferenceSourceChange('record')}>
                  {selectedModule === 'sound' ? <Mic className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />} Record
                </Button>
                <Button variant={referenceSource === 'lesson' ? 'default' : 'outline'} size="sm" className="gap-1.5 text-xs" onClick={() => handleReferenceSourceChange('lesson')}><Database className="w-3.5 h-3.5" /> Từ Lesson</Button>
              </div>

              <AnimatePresence mode="wait">
                {referenceSource === 'record' ? (
                  <FileRecorder key="ref-recorder" moduleId={selectedModule} onRecorded={handleReferenceRecorded} onCancel={() => setReferenceSource('upload')} />
                ) : referenceSource === 'upload' ? (
                  <div key="ref-upload">
                    <input ref={refInputRef} type="file" accept={getAcceptType()} onChange={handleReferenceUpload} className="hidden" />
                    <Button variant="outline" className="w-full h-20 border-dashed gap-2 text-xs text-muted-foreground" onClick={() => refInputRef.current?.click()}>
                      {referenceFile ? (
                        <span className="flex items-center gap-2 text-foreground">{selectedModule === 'sound' ? <FileAudio className="w-4 h-4" /> : <FileVideo className="w-4 h-4" />}{referenceFile.name}</span>
                      ) : (
                        <span className="flex flex-col items-center gap-1"><Upload className="w-5 h-5" />Upload file reference</span>
                      )}
                    </Button>
                  </div>
                ) : (
                  <Select key="ref-lesson" value={selectedLesson?.id || ''} onValueChange={(id) => setSelectedLesson(lessons.find(l => l.id === id) || null)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={loadingLessons ? 'Đang tải...' : 'Chọn lesson...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {lessons.map(l => (
                        <SelectItem key={l.id} value={l.id} className="text-xs">{l.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </AnimatePresence>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="compare" className="glass overflow-hidden rounded-[1.5rem] border border-white/70 px-0">
          <AccordionTrigger className="px-6 py-5 hover:no-underline">
            <div className="text-left">
              <p className="text-sm font-semibold">3. Compare Files (Crew)</p>
              <p className="mt-1 text-xs text-muted-foreground">{compareFiles.length > 0 ? `${compareFiles.length} file(s) ready` : 'Upload or record the files you want to compare.'}</p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <input ref={compareInputRef} type="file" accept={getAcceptType()} multiple onChange={handleCompareUpload} className="hidden" />
                  <Button variant="outline" className="w-full h-12 border-dashed gap-2 text-xs text-muted-foreground" onClick={() => compareInputRef.current?.click()}>
                    <Upload className="w-4 h-4" />Upload files
                  </Button>
                </div>
                <Button variant={showCompareRecorder ? 'default' : 'outline'} className="h-12 gap-1.5 text-xs" onClick={() => setShowCompareRecorder(!showCompareRecorder)}>
                  {selectedModule === 'sound' ? <Mic className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}Record
                </Button>
              </div>

              <AnimatePresence>
                {showCompareRecorder && <FileRecorder moduleId={selectedModule} onRecorded={handleCompareRecorded} onCancel={() => setShowCompareRecorder(false)} />}
              </AnimatePresence>

              {compareFiles.length > 0 && (
                <div className="space-y-1.5">
                  {compareFiles.map((cf, i) => (
                    <motion.div key={`${cf.name}-${i}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-xs">
                      <span className="flex items-center gap-2 truncate">{selectedModule === 'sound' ? <FileAudio className="w-3.5 h-3.5 text-muted-foreground" /> : <FileVideo className="w-3.5 h-3.5 text-muted-foreground" />}{cf.name}</span>
                      <button onClick={() => removeCompareFile(i)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Run Button */}
      <Button
        onClick={runComparison}
        disabled={processing || compareFiles.length === 0}
        className="w-full gap-2"
        size="lg"
      >
        {processing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Đang xử lý...
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            Chạy so sánh ({compareFiles.length} file{compareFiles.length > 1 ? 's' : ''})
          </>
        )}
      </Button>

      {processing && (
        <div className="space-y-2">
          <Progress value={progress} className="h-1.5" />
          {processingStatus && (
            <p className="text-[10px] text-muted-foreground text-center animate-pulse">
              {processingStatus}
            </p>
          )}
        </div>
      )}

      {/* Results */}
      <AnimatePresence>
        {results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {/* Scores Table */}
            <Card className={`glass border-l-2 ${moduleBorderClass[selectedModule]}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  <BarChart3 className="w-4 h-4" />
                  Kết quả so sánh
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {currentComparer.name}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">File</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                      {results[0] && Object.keys(results[0].breakdown).slice(0, 4).map(key => (
                        <TableHead key={key} className="text-xs text-right hidden sm:table-cell">
                          {getBreakdownLabel(key)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium truncate max-w-[120px]">{r.fileName}</TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="secondary"
                            className="font-mono text-xs"
                            style={{ borderColor: moduleColors[selectedModule] + '40' }}
                          >
                            {r.score}%
                          </Badge>
                        </TableCell>
                        {Object.values(r.breakdown).slice(0, 4).map((v, j) => (
                          <TableCell key={j} className="text-xs text-right font-mono text-muted-foreground hidden sm:table-cell">
                            {v}%
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Charts */}
            <Tabs defaultValue="bar" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="bar" className="flex-1 text-xs">Score Chart</TabsTrigger>
                <TabsTrigger value="radar" className="flex-1 text-xs">Breakdown Radar</TabsTrigger>
              </TabsList>

              <TabsContent value="bar">
                <Card className="glass">
                  <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={barChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                        />
                        <Bar dataKey="score" fill={moduleColors[selectedModule]} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="radar">
                <Card className="glass">
                  <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={280}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                        <Radar
                          key="reference"
                          name={referenceName}
                          dataKey="Reference"
                          stroke="hsl(var(--primary))"
                          fill="hsl(var(--primary))"
                          fillOpacity={0.08}
                          strokeDasharray="4 3"
                          strokeWidth={2}
                        />
                        {results.map((r, i) => {
                          const label = r.fileName.length > 20 ? r.fileName.slice(0, 17) + '...' : r.fileName;
                          return (
                            <Radar
                              key={i}
                              name={label}
                              dataKey={label}
                              stroke={radarColors[(i + 1) % radarColors.length]}
                              fill={radarColors[(i + 1) % radarColors.length]}
                              fillOpacity={0.15}
                            />
                          );
                        })}
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Feedback */}
            {results.some(r => r.feedback.length > 0) && (
              <Card className="glass">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">💡 Feedback</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {results.map((r, i) => (
                    r.feedback.length > 0 && (
                      <div key={i} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{r.fileName}</p>
                        <ul className="text-xs space-y-0.5 pl-4 list-disc text-muted-foreground">
                          {r.feedback.map((fb, j) => (
                            <li key={j}>{fb}</li>
                          ))}
                        </ul>
                      </div>
                    )
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Sound Visualization Panel */}
            {selectedModule === 'sound' && results.some(r => Object.keys(r.breakdown || {}).length > 0) && (
              <SoundVisualizationPanel results={results} pairs={soundVizPairs} />
            )}

            {/* Prosody Debug Panel (Sound module only) */}
            {selectedModule === 'sound' && results.some(r => r.debug) && (
              <ProsodyDebugPanel results={results} />
            )}

            {/* Motion Debug Panel */}
            {selectedModule === 'motion' && results.some(r => Object.keys(r.breakdown || {}).length > 0) && (
              <MotionDebugPanel results={results} />
            )}

            {/* Eyes Debug Panel */}
            {selectedModule === 'eyes' && results.some(r => Object.keys(r.breakdown || {}).length > 0) && (
              <EyesDebugPanel results={results} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
