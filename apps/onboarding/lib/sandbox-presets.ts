export const ACTIVE_SANDBOX_PRESET_IDS = ['crm', 'empty', 'classic'] as const;
export const ALL_SANDBOX_PRESET_IDS = [...ACTIVE_SANDBOX_PRESET_IDS] as const;

export type CreatableSandboxPresetId = (typeof ACTIVE_SANDBOX_PRESET_IDS)[number];
export type SandboxPresetId = (typeof ALL_SANDBOX_PRESET_IDS)[number];

export interface SandboxPresetDefinition {
  id: SandboxPresetId;
  displayName: string;
  description: string;
  commandPreview: string;
  workspaceTemplate: 'mercato';
  bootstrapKind: 'open-mercato';
}

export const DEFAULT_SANDBOX_PRESET: CreatableSandboxPresetId = 'crm';

export const SANDBOX_PRESETS: readonly SandboxPresetDefinition[] = [
  {
    id: 'crm',
    displayName: 'CRM Open Mercato',
    description: 'Pełny starter Open Mercato z presetem CRM.',
    commandPreview: 'npx -y create-mercato-app app --preset crm --skip-agentic-setup',
    workspaceTemplate: 'mercato',
    bootstrapKind: 'open-mercato',
  },
  {
    id: 'empty',
    displayName: 'Empty Open Mercato',
    description: 'Minimalny starter Open Mercato bez domenowego scaffoldu CRM.',
    commandPreview: 'npx -y create-mercato-app app --preset empty --skip-agentic-setup',
    workspaceTemplate: 'mercato',
    bootstrapKind: 'open-mercato',
  },
  {
    id: 'classic',
    displayName: 'Classic Open Mercato',
    description: 'Klasyczny starter Open Mercato jako alternatywny punkt startowy.',
    commandPreview: 'npx -y create-mercato-app app --preset classic --skip-agentic-setup',
    workspaceTemplate: 'mercato',
    bootstrapKind: 'open-mercato',
  },
] as const;

export function listCreatableSandboxPresets(): SandboxPresetDefinition[] {
  return [...SANDBOX_PRESETS];
}

export function getSandboxPreset(id: string): SandboxPresetDefinition | null {
  return SANDBOX_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function isCreatableSandboxPresetId(value: string): value is CreatableSandboxPresetId {
  return (ACTIVE_SANDBOX_PRESET_IDS as readonly string[]).includes(value);
}
