# Web Playbook

Use this playbook for tasks that touch the Next.js product surface.

## Current stack

- Next.js App Router under `src/app`
- React 18
- Tailwind CSS
- TypeScript across UI, server routes, and orchestration support code

## Working rules

- Prefer the existing app-router boundary model: keep server work in server routes or server components and keep client components focused on interaction.
- Preserve established file ownership. Product UI belongs in `src/app` and `src/components`; orchestration code belongs in `src/lib/mastra` and `src/lib/orchestration`.
- Treat workflow and helper integrations as backend concerns even if the user-facing symptom appears in the UI.
- Do not move product orchestration into `src/mastra`.

## Verification expectations

- UI-only changes: `lint`, `typecheck`, focused tests when available
- Cross-stack web changes: `lint`, `typecheck`, tests, `build`
- Routing or data-path changes: include reviewer validation for boundary mistakes and missing error handling

## Common risk triggers

- auth/session/cookie changes
- API route contract changes
- schema or query changes backing a UI flow
- helper-bridge or git operation changes surfaced through the app

Any of the above should be treated as high-risk or at least premium-review candidates.
