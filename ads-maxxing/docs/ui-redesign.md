# Workspace visual foundation

The workspace is a compact creative studio. White work surfaces sit on a cool, pale canvas; charcoal carries content and deep blue identifies primary actions. Sky blue is reserved for the ads-maxxing mark and selected or assistant states. The interface uses the bundled Geist font, 12px or larger labels, visible focus, native controls, and one decorative motion that stops with reduced motion.

`app/globals.css` owns shared tokens and legacy workspace classes. Feature views can use `--surface`, `--canvas`, `--surface-muted`, `--text`, `--muted`, `--border`, `--action`, `--action-hover`, `--focus`, `--success`, `--warning`, `--radius`, and `--shadow`. Feature-local styles should use those tokens so the shell remains consistent.

The balloon logo at `public/brand/balloon-a.png` was generated with built-in Imagegen. Prompt direction: a single lowercase single-storey **a** as a light sky-blue mylar foil balloon, studio reflections, subtle seams, transparent background, no string or other text. `BrandMark` serves it through Next Image and animates a slow breath; reduced-motion users see the same static mark.

The saved-brand recovery view is intentionally narrow. It appears when a brand has campaigns but no completed brand context snapshot. It lets the user open saved campaign work or retry an existing setup. The in-progress setup screen remains available while research is running.

## Visual QA

A temporary local fixture route exercised shared progress with active research and image creation, paused input, duplicate-risk retry, error, and complete states. Desktop and mobile review checked that the balloon animates only while working, the elapsed timer stops when paused, retry requires its acknowledgement, the input action remains reachable on mobile, and ad detail plus mattGPT chat do not overflow. The fixture used explicit placeholder art and local handlers; no store research, image generation, provider billing, or backend writes occurred. The temporary route was removed after review. TypeScript, ESLint on changed UI files, and `git diff --check` passed.
