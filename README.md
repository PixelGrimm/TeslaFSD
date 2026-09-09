# Tesla Vision (iPad)

Tesla-style dashboard + live rear-camera perception on iPad. Detected cars, people, and traffic lights are projected into an FSD-like 3D view.

**Demo only — not a driving aid.**

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL on your iPad (same Wi‑Fi). Safari requires a secure context for the camera — use `localhost` on the Mac, or tunnel HTTPS (e.g. ngrok / Cloudflare Tunnel) for a physical iPad.

## iPad setup

1. Open the app in Safari (landscape).
2. Share → **Add to Home Screen** for fullscreen.
3. Tap **Enable camera** and allow access.
4. Mount the iPad with the **rear camera** aimed at the road.
5. Optional: **Show camera** in the bottom bar to verify the feed.

## Stack

- Vite + React + TypeScript
- Three.js (`@react-three/fiber`) for the 3D scene
- MediaPipe Tasks Vision (EfficientDet Lite0, CPU/WASM) for detection
- PWA manifest for fullscreen landscape install
