# TODO

- [x] Update `vite.config.ts` to clone/import manifest, delete `background` key before passing to `crx({ manifest })`.
- [x] Update `vite.background.config.ts` to inject background block into `dist/manifest.json` via Rollup `closeBundle`.
- [ ] Run sequential build to verify no `[UNRESOLVED_ENTRY]` crash and confirm `dist/manifest.json` has correct `background`.


