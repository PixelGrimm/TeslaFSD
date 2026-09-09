import type { SpeedLimitValue } from '../vision/speedLimit'

interface StatusBarProps {
  speedLimit: SpeedLimitValue | null
}

/** EU circular numeric limit, or UK national speed-limit disc. */
export function StatusBar({ speedLimit }: StatusBarProps) {
  const national = speedLimit === 'national'
  const label =
    speedLimit == null
      ? 'Speed limit'
      : national
        ? 'National speed limit'
        : `Speed limit ${speedLimit}`

  return (
    <header className="status-bar status-bar-minimal">
      <div
        className={`limit-circle${national ? ' national' : ''}`}
        aria-label={label}
      >
        {national ? (
          <span className="limit-slash" aria-hidden />
        ) : (
          <span className="limit-circle-num">{speedLimit ?? '—'}</span>
        )}
      </div>
    </header>
  )
}
