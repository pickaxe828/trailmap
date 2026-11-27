import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import type { CompanionStatus } from '../../companion/client';
import { SETUP_INSTRUCTIONS_PATH } from '../../companion/status';

export function CompanionAttention({ status }: { status: CompanionStatus }) {
  if (status.state === 'connecting' || status.state === 'connected') return null;
  return (
    <Banner status="warning" title="Companion not connected"
      description="Trails still work. AI notes and Obsidian sync need the companion."
      endContent={<Button label="Fix connection" variant="secondary" size="sm" href={SETUP_INSTRUCTIONS_PATH}
        target="_blank" rel="noopener noreferrer" />} />
  );
}
