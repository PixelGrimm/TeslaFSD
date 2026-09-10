import type { ReactNode } from 'react'
import type { SpeedLimitValue } from '../vision/speedLimit'
import { StatusBar } from './StatusBar'
import packageJson from '../../package.json'

interface DashboardShellProps {
  children: ReactNode
  speedLimit: SpeedLimitValue | null
  showPip: boolean
  onTogglePip: () => void
  showLanes: boolean
  onToggleLanes: () => void
}

export function DashboardShell({
  children,
  speedLimit,
  showPip,
  onTogglePip,
  showLanes,
  onToggleLanes,
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
          <button type="button" className="chrome-btn" onClick={onToggleLanes}>
            {showLanes ? 'Hide lanes' : 'Show lanes'}
          </button>
        </div>
        <div className="chrome-center">
          <span className="version-label">v{packageJson.version}</span>
        </div>
        <div className="chrome-group right" />
      </footer>
    </div>
  )
}
