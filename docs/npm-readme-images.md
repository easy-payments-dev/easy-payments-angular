# npm README screenshots

## GitHub (current)

README uses **repository-relative** image paths:

```html
<img src="docs/assets/easy-payments-desktop.png" width="640" alt="..." />
```

These resolve correctly on GitHub for whatever branch/tag the viewer opens (`release/1.0.0`, later `v1.0.0`, etc.).

## npm (before publish)

npm does **not** reliably resolve relative GitHub paths for images in the published README.

**Before `npm publish`**, update README screenshot `src` values to stable absolute URLs on the **`v1.0.0` tag** (create the tag first):

```text
https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-desktop.png
```

Repeat for every screenshot file under `docs/assets/`.

Do **not** use `/master/` for npm packaging once the release tag exists.

Do **not** invent owner/repo names — use `easy-payments-dev/easy-payments-angular` (Angular library repository).

### Historical note

Published npm READMEs for **1.0.x / 1.1.x** still reference the pre-rename path
`raw.githubusercontent.com/easy-payments-dev/easy-payments/v1.0.0/...`.
Those URLs continue to redirect while the old repository name is vacant.
Do **not** reclaim `easy-payments-dev/easy-payments` for the central ecosystem hub
until historical screenshot assets are protected (seed the hub with the same
`v1.0.0` asset paths, or migrate to a rename-proof host). Do not rewrite
historical tags or republish old package versions to “fix” image URLs.

## Checklist before npm publish

1. Tag `v1.0.0` exists and includes `docs/assets/*`
2. README absolute image URLs point at `.../easy-payments-angular/v1.0.0/docs/assets/...`
3. Spot-check the tarball README / npm preview
4. Then publish
