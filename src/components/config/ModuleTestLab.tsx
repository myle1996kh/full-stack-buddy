import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Volume2, Eye, Upload, Database, Play, Trash2, FileVideo, FileAudio, BarChart3, X } from 'lucide-react';
import { getAllModules } from '@/engine/modules/registry';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { MSEModuleId, ComparisonResult } from '@/types/modules';

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
  url?: string;
  name: string;
}

interface TestResult {
  fileName: string;
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
}

interface LessonOption {
  id: string;
  title: string;
  reference_pattern: any;
  video_url: string | null;
}

export default function ModuleTestLab() {
  const { user } = useAuthStore();
  const modules = getAllModules();

  const [selectedModule, setSelectedModule] = useState<MSEModuleId>('motion');
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const [referenceSource, setReferenceSource] = useState<'upload' | 'lesson'>('upload');
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<LessonOption | null>(null);
  const [lessons, setLessons] = useState<LessonOption[]>([]);
  const [compareFiles, setCompareFiles] = useState<CompareFile[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingLessons, setLoadingLessons] = useState(false);

  const refInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);

  const currentModule = modules.find(m => m.id === selectedModule)!;
  const currentMethods = currentModule.methods;

  // Set default method when module changes
  const handleModuleChange = (moduleId: MSEModuleId) => {
    setSelectedModule(moduleId);
    const mod = modules.find(m => m.id === moduleId)!;
    const defaultMethod = mod.methods.find(m => m.isDefault) || mod.methods[0];
    setSelectedMethod(defaultMethod?.id || '');
    setResults([]);
  };

  // Load lessons from database
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

  const handleReferenceSourceChange = (source: 'upload' | 'lesson') => {
    setReferenceSource(source);
    if (source === 'lesson') loadLessons();
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

  // Run comparison using module comparers
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
      // Get the active comparer from module
      const comparer = currentModule.comparers[0];
      const method = currentModule.methods.find(m => m.id === selectedMethod) || currentModule.methods[0];

      const testResults: TestResult[] = [];

      for (let i = 0; i < compareFiles.length; i++) {
        setProgress(((i) / compareFiles.length) * 100);

        // Generate mock frames and patterns for comparison
        // In production, this would process the actual uploaded files through
        // MediaPipe (for video) or Web Audio API (for audio)
        const refPattern = generateMockPattern(selectedModule);
        const comparePattern = generateMockPattern(selectedModule);

        // Use the real module comparer
        const result: ComparisonResult = comparer.compare(refPattern, comparePattern);

        testResults.push({
          fileName: compareFiles[i].name,
          score: Math.round(result.score * 100),
          breakdown: Object.fromEntries(
            Object.entries(result.breakdown).map(([k, v]) => [k, Math.round(v * 100)])
          ),
          feedback: result.feedback,
        });
      }

      setResults(testResults);
      setProgress(100);

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

      // Save individual results
      const resultInserts = testResults.map(r => ({
        test_id: testRow.id,
        compare_file_url: r.fileName,
        file_name: r.fileName,
        score: r.score,
        breakdown: r.breakdown,
        feedback: r.feedback,
      }));

      await supabase.from('module_test_results').insert(resultInserts);

      toast.success(`So sánh hoàn tất! ${testResults.length} kết quả`);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi so sánh');
    } finally {
      setProcessing(false);
    }
  };

  // Build chart data for results
  const barChartData = results.map(r => ({
    name: r.fileName.length > 15 ? r.fileName.slice(0, 12) + '...' : r.fileName,
    score: r.score,
  }));

  const radarData = results.length > 0
    ? Object.keys(results[0].breakdown).map(key => {
        const entry: Record<string, any> = { metric: key };
        results.forEach((r, i) => {
          entry[`File ${i + 1}`] = r.breakdown[key] || 0;
        });
        return entry;
      })
    : [];

  const radarColors = ['hsl(var(--mse-motion))', 'hsl(var(--mse-sound))', 'hsl(var(--mse-eyes))', 'hsl(var(--primary))'];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">🧪 Module Test Lab</h2>
      <p className="text-xs text-muted-foreground">
        Test từng module riêng lẻ. Upload file reference + nhiều file compare để so sánh điểm 1-1.
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

      {/* Reference File */}
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
              variant={referenceSource === 'lesson' ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => handleReferenceSourceChange('lesson')}
            >
              <Database className="w-3.5 h-3.5" /> Từ Lesson
            </Button>
          </div>

          {referenceSource === 'upload' ? (
            <div>
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
            className="w-full h-16 border-dashed gap-2 text-xs text-muted-foreground"
            onClick={() => compareInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" />
            Upload files để so sánh (có thể chọn nhiều)
          </Button>

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
            <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            Đang xử lý...
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            Chạy so sánh ({compareFiles.length} file{compareFiles.length > 1 ? 's' : ''})
          </>
        )}
      </Button>

      {processing && <Progress value={progress} className="h-1.5" />}

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
                        {results.map((_, i) => (
                          <Radar
                            key={i}
                            name={`File ${i + 1}`}
                            dataKey={`File ${i + 1}`}
                            stroke={radarColors[i % radarColors.length]}
                            fill={radarColors[i % radarColors.length]}
                            fillOpacity={0.15}
                          />
                        ))}
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

// Mock pattern generator — will be replaced with real file processing
function generateMockPattern(moduleId: MSEModuleId) {
  const rand = () => Math.random();
  const randArr = (len: number) => Array.from({ length: len }, () => rand());

  switch (moduleId) {
    case 'motion':
      return {
        segments: [{ type: 'gesture', duration: 2, landmarks: [[rand(), rand()]] }],
        avgVelocity: rand() * 5,
        gestureSequence: ['wave', 'point', 'rest'].slice(0, Math.ceil(rand() * 3)),
      };
    case 'sound':
      return {
        pitchContour: randArr(20),
        volumeContour: randArr(20),
        rhythmPattern: randArr(10),
        avgPitch: 100 + rand() * 200,
        avgVolume: rand() * 0.8,
        syllableRate: 2 + rand() * 4,
      };
    case 'eyes':
      return {
        zoneDwellTimes: { 'center': rand(), 'top-left': rand(), 'top-right': rand(), 'bottom-left': rand(), 'bottom-right': rand() },
        zoneSequence: ['center', 'top-left', 'center', 'bottom-right'],
        avgFixationDuration: 200 + rand() * 400,
        blinkRate: 10 + rand() * 20,
        primaryZone: 'center',
      };
    default:
      return {};
  }
}
