import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Volume2, Eye, Upload, Database, Play, Trash2, FileVideo, FileAudio, BarChart3, X, Loader2, Mic, Video, SlidersHorizontal } from 'lucide-react';
import FileRecorder from '@/components/config/FileRecorder';
import ProsodyDebugPanel from '@/components/config/ProsodyDebugPanel';
import { getAllModules } from '@/engine/modules/registry';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useModuleStore, type SoundMetricId } from '@/stores/moduleStore';
import { setSoundMetricWeights } from '@/engine/modules/soundModule';
import { toast } from 'sonner';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  processAudioFile,
  processVideoForMotion,
  processVideoForPose,
  processVideoForEyes,
  processVideoForSound,
} from '@/engine/processing/fileProcessor';
import type { MSEModuleId, ComparisonResult, SoundFrame, EyesFrame, MotionFrame } from '@/types/modules';

const metricLabels: Record<SoundMetricId, string> = {
  intonation: 'Intonation',
  rhythmPause: 'Rhythm & Pause',
  energy: 'Energy',
  timbre: 'Timbre',
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
  debug?: Record<string, number>;
}

interface LessonOption {
  id: string;
  title: string;
  reference_pattern: any;
  video_url: string | null;
}

export default function ModuleTestLab() {
  const { user } = useAuthStore();
  const { soundMetrics, toggleSoundMetric, setSoundMetricWeight } = useModuleStore();
  const modules = getAllModules();

  const [selectedModule, setSelectedModule] = useState<MSEModuleId>('motion');
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const [referenceSource, setReferenceSource] = useState<'upload' | 'lesson' | 'record'>('upload');
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<LessonOption | null>(null);
  const [lessons, setLessons] = useState<LessonOption[]>([]);
  const [compareFiles, setCompareFiles] = useState<CompareFile[]>([]);
  const [showCompareRecorder, setShowCompareRecorder] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [loadingLessons, setLoadingLessons] = useState(false);

  const refInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);

  const currentModule = modules.find(m => m.id === selectedModule)!;
  const currentMethods = currentModule.methods;

  const handleModuleChange = (moduleId: MSEModuleId) => {
    setSelectedModule(moduleId);
    const mod = modules.find(m => m.id === moduleId)!;
    const defaultMethod = mod.methods.find(m => m.isDefault) || mod.methods[0];
    setSelectedMethod(defaultMethod?.id || '');
    setResults([]);
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

    try {
      const comparer = currentModule.comparers[0];
      const method = currentModule.methods.find(m => m.id === selectedMethod) || currentModule.methods[0];

      // Inject dynamic metric weights for sound module
      if (selectedModule === 'sound') {
        setSoundMetricWeights(soundMetrics);
      } else {
        setSoundMetricWeights(undefined);
      }

      // Step 1: Extract reference pattern
      let referencePattern: any;

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
        setProcessingStatus('Reference pattern loaded from lesson');
      } else if (referenceFile) {
        setProcessingStatus('🎯 Analyzing reference file...');
        const refFrames = await extractFrames(referenceFile, selectedModule);
        if (refFrames.length === 0) {
          throw new Error('Could not extract any frames from reference file');
        }
        referencePattern = method.extract(refFrames);
        setProcessingStatus(`Reference: ${refFrames.length} frames extracted`);
      } else {
        throw new Error('No reference source');
      }

      // Step 2: Process each compare file
      const testResults: TestResult[] = [];
      const totalFiles = compareFiles.length;

      for (let i = 0; i < totalFiles; i++) {
        const cf = compareFiles[i];
        setProcessingStatus(`📊 Processing file ${i + 1}/${totalFiles}: ${cf.name}`);
        setProgress(0);

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

        const comparePattern = method.extract(compareFrames);

        // Use the real module comparer
        const result: ComparisonResult = comparer.compare(referencePattern, comparePattern);

        testResults.push({
          fileName: cf.name,
          score: Math.round(result.score),
          breakdown: Object.fromEntries(
            Object.entries(result.breakdown).map(([k, v]) => [k, Math.round(v)])
          ),
          feedback: result.feedback,
          debug: (result as any).debug ?? undefined,
        });

        setProcessingStatus(`✅ File ${i + 1}/${totalFiles} done — Score: ${Math.round(result.score)}%`);
      }

      setResults(testResults);
      setProgress(100);
      setProcessingStatus('');

      // Save to database
      const refUrl = referenceSource === 'lesson'
        ? selectedLesson?.video_url || 'lesson-reference'
        : referenceFile?.name || '';

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

      const resultInserts = testResults.map(r => ({
        test_id: testRow.id,
        compare_file_url: r.fileName,
        file_name: r.fileName,
        score: r.score,
        breakdown: r.breakdown,
        feedback: r.feedback,
      }));

      await supabase.from('module_test_results').insert(resultInserts);
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
        const entry: Record<string, any> = { metric: key };
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

      {/* Module Selection */}
      <Card className="glass">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">1. Chọn Module & Method</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
        </CardContent>
      </Card>

      {/* Score Metrics Config (Sound module only) */}
      <AnimatePresence>
        {selectedModule === 'sound' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card className="glass border-mse-sound/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4" />
                  Score Metrics
                  <span className="text-[10px] text-muted-foreground font-normal">
                    (toggle & adjust weights)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(Object.keys(soundMetrics) as SoundMetricId[]).map((metricId) => {
                  const metric = soundMetrics[metricId];
                  const totalEnabled = Object.values(soundMetrics).filter(m => m.enabled).reduce((s, m) => s + m.weight, 0);
                  const normalizedPct = metric.enabled && totalEnabled > 0
                    ? Math.round((metric.weight / totalEnabled) * 100)
                    : 0;

                  return (
                    <div key={metricId} className={`flex items-center gap-3 transition-opacity ${metric.enabled ? '' : 'opacity-40'}`}>
                      <Switch
                        checked={metric.enabled}
                        onCheckedChange={() => toggleSoundMetric(metricId)}
                        className="scale-75"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">{metricLabels[metricId]}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {metric.enabled ? `${normalizedPct}%` : 'OFF'}
                          </span>
                        </div>
                        {metric.enabled && (
                          <Slider
                            value={[metric.weight * 100]}
                            onValueChange={([v]) => setSoundMetricWeight(metricId, v / 100)}
                            min={5}
                            max={100}
                            step={5}
                            className="h-1"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] text-muted-foreground">
                  Weights are auto-normalized. Disabled metrics won't appear in results.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="glass">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">2. Reference (Captain Sample)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={referenceSource === 'upload' ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => handleReferenceSourceChange('upload')}
            >
              <Upload className="w-3.5 h-3.5" /> Upload
            </Button>
            <Button
              variant={referenceSource === 'record' ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => handleReferenceSourceChange('record')}
            >
              {selectedModule === 'sound' ? <Mic className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
              Record
            </Button>
            <Button
              variant={referenceSource === 'lesson' ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => handleReferenceSourceChange('lesson')}
            >
              <Database className="w-3.5 h-3.5" /> Từ Lesson
            </Button>
          </div>

          <AnimatePresence mode="wait">
            {referenceSource === 'record' ? (
              <FileRecorder
                key="ref-recorder"
                moduleId={selectedModule}
                onRecorded={handleReferenceRecorded}
                onCancel={() => setReferenceSource('upload')}
              />
            ) : referenceSource === 'upload' ? (
              <div key="ref-upload">
                <input
                  ref={refInputRef}
                  type="file"
                  accept={getAcceptType()}
                  onChange={handleReferenceUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  className="w-full h-20 border-dashed gap-2 text-xs text-muted-foreground"
                  onClick={() => refInputRef.current?.click()}
                >
                  {referenceFile ? (
                    <span className="flex items-center gap-2 text-foreground">
                      {selectedModule === 'sound' ? <FileAudio className="w-4 h-4" /> : <FileVideo className="w-4 h-4" />}
                      {referenceFile.name}
                    </span>
                  ) : (
                    <span className="flex flex-col items-center gap-1">
                      <Upload className="w-5 h-5" />
                      Upload file reference
                    </span>
                  )}
                </Button>
              </div>
            ) : (
              <Select
                key="ref-lesson"
                value={selectedLesson?.id || ''}
                onValueChange={(id) => setSelectedLesson(lessons.find(l => l.id === id) || null)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={loadingLessons ? 'Đang tải...' : 'Chọn lesson...'} />
                </SelectTrigger>
                <SelectContent>
                  {lessons.map(l => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">
                      {l.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Compare Files */}
      <Card className="glass">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>3. Compare Files (Crew)</span>
            {compareFiles.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{compareFiles.length} files</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                ref={compareInputRef}
                type="file"
                accept={getAcceptType()}
                multiple
                onChange={handleCompareUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full h-12 border-dashed gap-2 text-xs text-muted-foreground"
                onClick={() => compareInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" />
                Upload files
              </Button>
            </div>
            <Button
              variant={showCompareRecorder ? 'default' : 'outline'}
              className="h-12 gap-1.5 text-xs"
              onClick={() => setShowCompareRecorder(!showCompareRecorder)}
            >
              {selectedModule === 'sound' ? <Mic className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
              Record
            </Button>
          </div>

          <AnimatePresence>
            {showCompareRecorder && (
              <FileRecorder
                moduleId={selectedModule}
                onRecorded={handleCompareRecorded}
                onCancel={() => setShowCompareRecorder(false)}
              />
            )}
          </AnimatePresence>

          {compareFiles.length > 0 && (
            <div className="space-y-1.5">
              {compareFiles.map((cf, i) => (
                <motion.div
                  key={`${cf.name}-${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary text-xs"
                >
                  <span className="flex items-center gap-2 truncate">
                    {selectedModule === 'sound' ? <FileAudio className="w-3.5 h-3.5 text-muted-foreground" /> : <FileVideo className="w-3.5 h-3.5 text-muted-foreground" />}
                    {cf.name}
                  </span>
                  <button onClick={() => removeCompareFile(i)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Kết quả so sánh
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">File</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                      {results[0] && Object.keys(results[0].breakdown).slice(0, 4).map(key => (
                        <TableHead key={key} className="text-xs text-right capitalize hidden sm:table-cell">
                          {key}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
