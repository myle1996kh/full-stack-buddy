import type { MSEModule } from '@/types/modules';
import { motionModule } from './motionModule';
import { soundModule } from './soundModule';
import { eyesModule } from './eyesModule';

export interface MSEModuleRegistry {
  motion: MSEModule;
  sound: MSEModule;
  eyes: MSEModule;
}

export const moduleRegistry: MSEModuleRegistry = {
  motion: motionModule,
  sound: soundModule,
  eyes: eyesModule,
};

export function getModule(id: string): MSEModule | undefined {
  return moduleRegistry[id as keyof MSEModuleRegistry];
}

export function getAllModules(): MSEModule[] {
  return [moduleRegistry.motion, moduleRegistry.sound, moduleRegistry.eyes];
}
