# Supabase Playbook

Use this playbook for tasks involving Supabase concepts, especially auth, RLS, storage, Postgres policy design, and edge-function style workflows.

## Repo posture

- Supabase-sensitive work is treated as high-risk by default because it usually overlaps with auth, schema, secrets, or production data access.
- Database and policy changes must stay explicit and reviewable. Avoid hidden runtime side effects.
- When the task is really generic Postgres or schema work, keep the implementation in the repo’s existing database layer and still apply the same safety bar.

## Mandatory review triggers

- auth/session changes
- row-level security or permission model updates
- schema or migration changes
- secret, service-role, or environment wiring changes
- storage bucket permissions

These should route through premium planning or premium review, and approval gates should remain available where the workflow flags them.

## Verification expectations

- typecheck and tests for calling code
- migration or query verification where applicable
- security-aware review for permission changes
- build verification if the application boot path is affected

## Documentation rule

If a task introduces a new Supabase integration path or policy convention, update this playbook so future prompt loading reflects the new local standard.
