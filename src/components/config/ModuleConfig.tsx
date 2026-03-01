import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useModuleStore } from '@/stores/moduleStore';
import { getAllModules } from '@/engine/modules/registry';
import { Activity, Volume2, Eye, RotateCcw } from 'lucide-react';
import type { MSEModuleId } from '@/types/modules';

const iconMap: Record<string, React.ReactNode> = {
  Activity: <Activity className="w-4 h-4" />,
  Volume2: <Volume2 className="w-4 h-4" />,
  Eye: <Eye className="w-4 h-4" />,
};

const colorMap: Record<MSEModuleId, string> = {
  motion: 'border-mse-motion/30',
  sound: 'border-mse-sound/30',
  eyes: 'border-mse-eyes/30',
};

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.1, duration: 0.35, ease: "easeOut" as const },
  }),
};

export default function ModuleConfig() {
  const { configs, setActiveMethod, toggleChart, setActiveComparer, setWeight, resetDefaults } = useModuleStore();
  const modules = getAllModules();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">⚙ MSE Module Config</h2>
        <Button variant="ghost" size="sm" onClick={resetDefaults} className="text-xs gap-1">
          <RotateCcw className="w-3 h-3" /> Reset
        </Button>
      </div>

      {modules.map((mod, idx) => {
        const moduleId = mod.id as MSEModuleId;
        const config = configs[moduleId];

        return (
          <motion.div
            key={mod.id}
            custom={idx}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
          >
            <Card className={`glass border-l-2 ${colorMap[moduleId]}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  {iconMap[mod.icon]}
                  <span>{mod.name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Detection Method */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Detection Method</Label>
                  <Select value={config.activeMethodId} onValueChange={(v) => setActiveMethod(moduleId, v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {mod.methods.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-xs">
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Charts */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Active Charts</Label>
                  <div className="flex flex-wrap gap-2">
                    {mod.charts.map((chart) => (
                      <motion.button
                        key={chart.id}
                        onClick={() => toggleChart(moduleId, chart.id)}
                        whileTap={{ scale: 0.93 }}
                        className={`text-[10px] px-2 py-1 rounded-full border transition-all ${
                          config.enabledChartIds.includes(chart.id)
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/30'
                        }`}
                      >
                        {config.enabledChartIds.includes(chart.id) ? '✓ ' : ''}{chart.name}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Comparer */}
                {mod.comparers.length > 1 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Comparer</Label>
                    <Select value={config.activeComparerId} onValueChange={(v) => setActiveComparer(moduleId, v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {mod.comparers.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Weight */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground">Weight</Label>
                    <span className="text-xs font-mono">{config.weight.toFixed(1)}</span>
                  </div>
                  <Slider
                    value={[config.weight]}
                    onValueChange={([v]) => setWeight(moduleId, v)}
                    min={0}
                    max={2}
                    step={0.1}
                    className="w-full"
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
