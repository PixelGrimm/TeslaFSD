interface StatusBarProps {
  speedLimit: number | null
}

/** EU-style circular speed-limit HUD (top-right). */
export function StatusBar({ speedLimit }: StatusBarProps) {
  return (
    <header className="status-bar status-bar-minimal">
      <div
        className="limit-circle"
        aria-label={speedLimit != null ? `Speed limit ${speedLimit}` : 'Speed limit'}
      >
        <span className="limit-circle-num">{speedLimit ?? '—'}</span>
      </div>
    </header>
  )
}
