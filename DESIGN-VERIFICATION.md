# Design verification — 2026-09-14

Published web app: https://batabitoo-mail-2026.web.app

## Browser checks

Command: `node scripts/verify-design.cjs` (exit 0).
Repeated against the published URL with `DESIGN_URL=https://batabitoo-mail-2026.web.app` (exit 0).

- Chromium viewport widths: 320, 390, 1440. No horizontal overflow or JavaScript page errors.
- Real Three.js/WebGL renderer reached its ready state at all three widths.
- Inbox lists render in batches of 40; load-more and search checked.
- Delete confirmation, cancellation, create sheet, message detail, and navigation checked without modifying inbox data.
- Animation stops when its panel is hidden. Reduced-motion mode uses the static illustration.
- Screenshots: `web-preview-final-320.png`, `web-preview-final-390.png`, `web-preview-final-1440.png`, and message-screen variants.

## Native Android

Commands from `android/`:

```powershell
.\gradlew.bat "-Dkotlin.compiler.execution.strategy=in-process" testDebugUnitTest assembleRelease
# Exit 0: BUILD SUCCESSFUL
.\gradlew.bat "-Dkotlin.compiler.execution.strategy=in-process" assembleRelease
# Exit 0 after final decorative canvas sizing correction
```

Artifact: `Batabitoo-Mail-Center-1.0.0.apk` (1,306,546 bytes).
SHA256: `6D78298F162B2F823EAD95CDF5C51583E411176ACDD6727A7C5FA1180DFFBE2C`.
APK signature verification: exit 0, v2 verified. Signed with the existing personal/debug certificate, not a store distribution certificate.
Application ID: `com.batabitoo.mailcenter`; version 1 / 1.0.0; minimum SDK 24; target SDK 36.

Independent source review covered back navigation, menu/delete behavior, long-message scrolling, keyboard access in the create sheet, bottom navigation overlap, and flexible hero sizing. Its remaining canvas-sizing suggestion was applied and rebuilt.

No Android device was connected (`adb devices` returned an empty device list). Native on-device animation smoothness and visual layout have not been verified; browser screenshots are of the web app, not the APK.
