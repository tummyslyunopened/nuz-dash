---
name: release
description: Cut a nuz-dash release - commit, tag, push, build source zip, publish GitHub release
---

# Cut a release (vX.Y.Z)

Only when the user asks for a release. All commands need the PATH refresh
prefix (see CLAUDE.md).

1. Run `npm test` and `npm run build` — both must pass.
2. Commit pending work with a descriptive message ending in the
   Co-Authored-By Claude trailer.
3. Tag + push:
   ```
   git tag vX.Y.Z
   git push -q origin main --tags
   ```
   (Pre-push hook auto-deploys the onboarding site IF the push touches site/.)
4. Build the source zip (`.gitattributes` export-ignore automatically excludes
   site/ — do not add exclusions manually):
   ```
   git archive --format=zip -o <scratchpad>\nuz-dash-vX.Y.Z-source.zip vX.Y.Z
   ```
5. Publish:
   ```
   gh release create vX.Y.Z <zip> --title "nuz-dash vX.Y.Z — <headline>" --notes "<bullet summary>"
   ```
   If gh returns a transient 401, retry once.
6. Verify anonymously (no auth): `releases/latest` resolves to the new tag and
   the asset downloads. The onboarding site links to `releases/latest`, so no
   site changes are needed per release.
