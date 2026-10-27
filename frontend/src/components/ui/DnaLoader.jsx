const RUNG_COUNT = 12

export default function DnaLoader({ size = 'medium', label = 'Loading' }) {
  return (
    <span className={`dna-loader dna-loader--${size}`} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: RUNG_COUNT }, (_, index) => (
        <span
          key={index}
          className="dna-loader__rung"
          style={{ '--dna-index': index }}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}