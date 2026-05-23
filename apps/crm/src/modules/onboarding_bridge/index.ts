import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'onboarding_bridge',
  title: 'Onboarding Bridge',
  version: '0.1.0',
  description:
    'Forwards subscription access changes from this CRM tenant to the sandbox onboarding app so it can provision OpenRouter keys and Coder secrets.',
  author: 'Open Mercato Sandboxes',
  license: 'MIT',
  ejectable: false,
}
