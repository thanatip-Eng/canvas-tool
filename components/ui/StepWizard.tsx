'use client';

interface StepConfig {
  label: string;
}

interface StepWizardProps {
  steps: StepConfig[];
  currentStep: number;
  children: React.ReactNode[];
}

export default function StepWizard({ steps, currentStep, children }: StepWizardProps) {
  return (
    <div>
      {/* Step dots */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {steps.map((step, idx) => {
          const stepNum = idx + 1;
          let dotClass = 'step-dot pending';
          if (stepNum < currentStep) dotClass = 'step-dot completed';
          else if (stepNum === currentStep) dotClass = 'step-dot active';

          return (
            <div key={idx} className="flex items-center gap-2">
              {idx > 0 && (
                <div className={`h-px w-8 ${stepNum <= currentStep ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`} />
              )}
              <div className={dotClass} title={step.label}>
                {stepNum < currentStep ? '✓' : stepNum}
              </div>
            </div>
          );
        })}
      </div>

      {/* Step label */}
      <p className="text-center text-sm text-[var(--color-text-muted)] mb-4">
        {steps[currentStep - 1]?.label}
      </p>

      {/* Step content */}
      <div>
        {children[currentStep - 1]}
      </div>
    </div>
  );
}
