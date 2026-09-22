# Base UI integration notes

This branch replaces the workflow console with the Studio workspace. It keeps the existing local workflow APIs and server approval rules. It does not add Supabase or change provider integrations.

## Structure

- `app/workflow-console.tsx`: selected session, persistent chat hook, shell, section navigation, and action orchestration.
- `components/workspace`: shared primitives and research, campaign brief, ads, assets, brand, and conversation views.
- `lib/workspace/api.ts`: typed adapter to local session endpoints, display status labels, and version ancestry grouping.
- `app/globals.css`: semantic colors, responsive shell, independent panel scrolling, focus and reduced-motion styles.

The approval button first calls `approveBrief` and only calls `generateAd` if approval succeeded. Both requests use the exact saved brief ID; the existing server rejects stale or repeated generation attempts. Feedback holds an explicit variant ID independently of the selected preview. Structured edits save a new proposed brief through `reviseBrief`.

## Current integration boundaries

The campaign selector uses existing sessions, with the most recently updated session restored on page load. Initial research and the first campaign share that session. A full brand-to-many-campaign data model, creating another campaign with cloned research, and durable campaign metadata need a later backend connection. The campaign name is requested as a remembered preference, not a new database field. Stores from separate sessions are not combined.

Research-first behavior is requested in the onboarding message. The existing concierge still owns workflow policy; enforcing that stage server-side is a follow-up. Research currently exposes source pages/photos rather than normalized catalog products. Users must select and confirm an exact product reference before generating.

The chat uses the installed AI SDK and custom UI primitives. Adoption of AI Elements is still pending; no new component dependency was added in this base pass. Tool events are rendered as readable activity cards; the current brief has one live review card rather than actionable historical approval cards.

Brand logo/value proposition editing is marked unavailable. Source images are remote references; generated outputs retain their local file URLs. Assets are scoped to the selected session. There are no fabricated product images, saved brand fields, or placeholder ads.

The worktree has its own ignored local-output directory and no copied credentials. Configure the existing provider environment variables to exercise live research/generation.

## Validation

- Type generation and TypeScript check passed.
- ESLint passed.
- Production build passed with Node 24.
- All 19 existing workflow tests passed, including approval, duplicate generation, version ancestry, persistence, and streaming checks.
- Browser checked desktop onboarding, Assets empty state, chat draft persistence across navigation, and mobile workspace/chat switching at 390px width.
- Live provider calls and paid generation were not run during the base UI pass.

Run locally with Node 24: `npm run dev -- --port 3100`.
