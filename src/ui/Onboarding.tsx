import packageJson from '../../package.json'

interface OnboardingProps {
  modelReady: boolean
  modelError: string | null
  cameraError: string | null
  onStart: () => void
  starting: boolean
}

export function Onboarding({
  modelReady,
  modelError,
  cameraError,
  onStart,
  starting,
}: OnboardingProps) {
  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <p className="eyebrow">Visualization v{packageJson.version}</p>
        <h1>TESLA</h1>
        <p className="lede">
          Mount your iPad landscape with the rear camera facing the road. Detected cars, people, and
          lights appear in a live FSD-style 3D view.
        </p>
        <p className="disclaimer">
          Demo only — not a driving aid. Do not use for vehicle control or navigation decisions.
        </p>

        {!modelReady && !modelError && <p className="loading-line">Loading perception model…</p>}
        {modelError && <p className="error-line">{modelError}</p>}
        {cameraError && <p className="error-line">{cameraError}</p>}

        <button
          type="button"
          className="start-btn"
          disabled={!modelReady || starting}
          onClick={onStart}
        >
          {starting ? 'Starting camera…' : 'Enable camera'}
        </button>

        <button
          type="button"
          className="refresh-btn"
          onClick={() => window.location.reload()}
          title="Refresh app"
        >
          Refresh
        </button>

        <ol className="setup-steps">
          <li>Add to Home Screen for fullscreen</li>
          <li>Use HTTPS (or a tunnel) so Safari allows the camera</li>
          <li>Grant camera permission when prompted</li>
        </ol>
      </div>
    </div>
  )
}
