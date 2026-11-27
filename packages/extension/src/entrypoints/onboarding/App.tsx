import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useRef, useState } from 'react';
import { CompanionSetup } from '../../companion/CompanionSetup';
import { useCompanionStatus } from '../../companion/useCompanionStatus';
import { ProviderSettings } from '../../llm/ProviderSettings';
import { PrivacySettings } from '../../privacy/PrivacySettings';
import { HistoryImportSettings } from '../../ui/HistoryImportSettings';
import { JOURNAL_PATH } from '../../ui/TrailmapNavigation';
import { TrailmapShell } from '../../ui/TrailmapShell';
import { VaultSettings } from '../../vault/VaultSettings';

const steps = ['privacy', 'companion', 'providers', 'extras'] as const;
type Step = typeof steps[number];

/** The flow edits the same preferences as Settings. Finishing is never required for recording. */
export function App() {
  const companion = useCompanionStatus();
  const [step, setStep] = useState<Step>('privacy');
  const progress = useRef<HTMLElement>(null);
  const stepIndex = steps.indexOf(step);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) progress.current?.focus();
    previousStep.current = step;
  }, [step]);

  return (
    <TrailmapShell title="Welcome to Trailmap" description="Trailmap turns your browsing into trails, field notes, and a concept map."
      actions={<Link hasUnderline isStandalone href="/settings.html">Open Settings</Link>}>
      <Text as="p">Recording starts straight away.</Text>
      <VStack gap={1} tabIndex={-1} ref={progress} aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
        <Text type="label">Step {stepIndex + 1} of {steps.length}</Text>
      </VStack>
      {step === 'privacy' && <PrivacySettings />}
      {step === 'companion' && (
        <VStack as="section" gap={2}>
          <Heading level={2}>Turn on AI notes</Heading>
          <CompanionSetup companion={companion} />
        </VStack>
      )}
      {step === 'providers' && <ProviderSettings companion={companion} />}
      {step === 'extras' && (
        <VStack as="section" gap={4}>
          <Heading level={2}>Optional extras</Heading>
          <VaultSettings companion={companion} />
          <HistoryImportSettings headingLevel={3} />
        </VStack>
      )}
      <HStack as="footer" gap={2} align="center" wrap="wrap">
        {stepIndex > 0 && <Button label="Back" variant="secondary" size="sm" onClick={() => setStep(steps[stepIndex - 1]!)} />}
        {step === 'privacy' && <Button label="Next: AI notes" variant="primary" size="sm" onClick={() => setStep('companion')} />}
        {step === 'companion' && (
          <>
            <Button label="Skip AI setup" variant={companion.state === 'connected' ? 'secondary' : 'primary'} size="sm"
              onClick={() => setStep('extras')} />
            {companion.state === 'connected' && <Button label="Next: Model providers" variant="primary" size="sm"
              onClick={() => setStep('providers')} />}
          </>
        )}
        {step === 'providers' && <Button label="Next: Optional extras" variant="primary" size="sm" onClick={() => setStep('extras')} />}
        {step === 'extras' && <Button label="Finish setup" variant="primary" size="sm" onClick={() => window.location.assign(JOURNAL_PATH)} />}
      </HStack>
    </TrailmapShell>
  );
}
