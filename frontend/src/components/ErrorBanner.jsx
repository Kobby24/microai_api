import { AlertCircle } from 'lucide-react'

export default function ErrorBanner({ message }) {
  if (!message) return null

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      <div>
        <p className="font-semibold">Prediction request failed</p>
        <p className="mt-0.5 leading-relaxed">{message}</p>
      </div>
    </div>
  )
}
