import type { ReactNode } from 'react'
import type { SpeedLimitValue } from '../vision/speedLimit'
import { StatusBar } from './StatusBar'

interface DashboardShellProps {
  children: ReactNode
  speedLimit: SpeedLimitValue | null
  showPip: boolean
  onTogglePip: () => void
}

export function DashboardShell({
  children,
  speedLimit,
  showPip,
  onTogglePip,
}: DashboardShellProps) {
  return (
    <div className="dashboard">
      <StatusBar speedLimit={speedLimit} />

      <main className="viz-stage">{children}</main>

      <footer className="bottom-chrome">
        <div className="chrome-group">
          <button type="button" className="chrome-btn" onClick={onTogglePip}>
            {showPip ? 'Hide camera' : 'Show camera'}
          </button>
        </div>
        <div className="chrome-center" />
        <div className="chrome-group right" />
      </footer>
    </div>
  )
}
