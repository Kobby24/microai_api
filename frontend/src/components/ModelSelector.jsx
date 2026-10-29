import { ArrowRight, CheckCircle2 } from 'lucide-react'
import DnaLoader from './ui/DnaLoader'

function questionInfo(model) {
  const label = model?.predicts_label || model?.display_name || model?.name || 'Question'
  const name = /relapse/i.test(label) ? 'Disease Relapse' : /er|estrogen/i.test(label) ? 'ER Status' : 'Question'

  if (name === 'Disease Relapse') {
    return {
      heading: 'Disease Relapse',
      question: 'Is the breast cancer associated with relapse?',
      description: 'Find out whether this patient’s breast cancer is associated with disease relapse or no disease relapse.',
      action: 'Explore Disease Relapse',
    }
  }

  return {
    heading: 'ER Status',
    question: 'Is the breast cancer ER positive or ER negative?',
    description: 'Find out whether this patient’s breast cancer is associated with ER-positive or ER-negative status.',
    action: 'Explore ER Status',
  }
}

export default function ModelSelector({
  models,
  selectedModel,
  onChange,
  loading,
  disabled,
}) {
  const cards = (models || []).map((model) => ({ ...model, ...questionInfo(model) }))
  const selected = models.find((model) => model.name === selectedModel)

  return (
    <section className="surface-panel p-6">
      <div className="mb-5">
        <p className="eyebrow">01 / Choose a question</p>
        <h3 className="mt-2 text-2xl font-semibold text-slate-950">What would you like to find out?</h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <DnaLoader size="small" label="Loading available questions" />
          <span>Loading questions...</span>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => {
            const isSelected = selectedModel === card.name
            return (
              <button
                key={card.name}
                type="button"
                onClick={() => onChange(card.name)}
                disabled={disabled}
                className={`group rounded-2xl border p-5 text-left transition ${isSelected ? 'border-[#123b5d] bg-[#f2f7fb] shadow-sm' : 'border-slate-200 bg-white hover:border-[#2f7b78] hover:bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold text-slate-950">{card.heading}</p>
                    <p className="mt-3 text-base font-medium text-slate-700">{card.question}</p>
                  </div>
                  {isSelected && <CheckCircle2 className="h-5 w-5 shrink-0 text-[#123b5d]" />}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{card.description}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#123b5d]">
                  {card.action}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Selected question:</span> {selected.predicts_label || selected.display_name || selected.name}
        </div>
      )}
    </section>
  )
}
