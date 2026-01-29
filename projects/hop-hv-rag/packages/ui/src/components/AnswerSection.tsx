import { Streamdown } from 'streamdown';

interface AnswerSectionProps {
  answer: string;
}

export function AnswerSection({ answer }: AnswerSectionProps) {
  return (
    <div className="space-y-4">
      {/* Section Label */}
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
        ANSWER
      </h2>

      {/* Answer Content */}
      <div className="prose prose-lg max-w-none">
        <div className="text-text-primary leading-relaxed">
          <Streamdown>{answer}</Streamdown>
        </div>
      </div>
    </div>
  );
}
