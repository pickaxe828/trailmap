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
import { VaultSettings } from '../../vault/VaultSettings';

const steps = ['privacy', 'companion', 'providers', 'extras'] as const;
type Step = typeof steps[number];

/** The flow edits the same preferences as Settings. Finishing is never required for recording. */
export function App() {
  const companion = useCompanionStatus();
  const [step, setStep] = useState<Step>('privacy');
  const progress = useRef<HTMLElement>(null);
  const stepIndex = steps.indexOf(step);
  useEffect(() => {
    progress.current?.focus();
  }, [step]);

  return (
    <VStack as="main" gap={4} padding={8} maxWidth="44rem" className="mx-auto">
      <VStack gap={1}>
        <Heading level={1}>Welcome to Trailmap</Heading>
        <Text as="p">Trailmap turns your browsing into trails, field notes, and a concept map.</Text>
        <Text as="p">Recording starts straight away.</Text>
      </VStack>
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
      <HStack gap={2} align="center" wrap="wrap">
        {stepIndex > 0 && <Button label="Back" variant="ghost" onClick={() => setStep(steps[stepIndex - 1]!)} />}
        {step === 'privacy' && <Button label="Next: AI notes" onClick={() => setStep('companion')} />}
        {step === 'companion' && companion.state === 'connected' && (
          <Button label="Next: Model providers" onClick={() => setStep('providers')} />
        )}
        {step === 'companion' && <Button label="Skip AI setup" variant="secondary" onClick={() => setStep('extras')} />}
        {step === 'providers' && <Button label="Next: Optional extras" onClick={() => setStep('extras')} />}
        {step === 'extras' && <Button label="Finish setup" href="/journal.html" />}
        <Link href="/settings.html">Open Settings</Link>
      </HStack>
    </VStack>
  );
}
