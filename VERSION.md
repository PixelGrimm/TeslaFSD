# Version Management

Current version: **1.0.0**

## How to Update Version

The version number is displayed on:
- Onboarding screen (top)
- Bottom chrome bar (center)

### To increment the version:

1. Edit `package.json` and update the `version` field:
   ```json
   "version": "1.1.0"
   ```

2. Commit and push:
   ```bash
   git add package.json
   git commit -m "Bump version to 1.1.0"
   git push origin main
   ```

3. Netlify will automatically deploy with the new version

### Version Numbering

- **Major changes**: 1.0.0 → 2.0.0
- **New features**: 1.0.0 → 1.1.0
- **Bug fixes/tweaks**: 1.0.0 → 1.0.1

### Examples

- `1.0.0` - Initial release with lane hiding
- `1.1.0` - Added map integration
- `1.0.1` - Fixed camera overlay bug
- `2.0.0` - Complete UI redesign

The version is automatically imported from `package.json` and displayed in the UI.
