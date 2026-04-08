# iOS Playbook

This repository does not currently ship a native iOS application, but iOS-related work is still a supported planning target for Vela.

## Current repo expectation

- Keep iOS-specific guidance isolated from the web and embedded-runtime paths.
- Do not mix iOS implementation details into `src/lib/mastra` unless the work is about orchestration or routing for iOS tasks.
- If a native iOS target is added later, document its workspace path, build command, simulator flow, and integration boundary here before routing real tasks into it.

## Routing expectations

- iOS UI work should prefer SwiftUI patterns and explicit state/data-flow boundaries.
- Entitlements, auth, sync, offline state, and release configuration changes should be treated as high-risk.
- Performance-sensitive SwiftUI work should trigger the performance template during review.

## Verification expectations

- Build the app or package target relevant to the changed code.
- Run the narrowest simulator or unit-test path that exercises the change.
- Treat signing, entitlement, and production capability changes as approval-gated.

## Until a native target exists

- Use this playbook as policy, not as evidence that the repo already contains an iOS app.
- Keep workflow routing conservative and require explicit human direction before assuming an iOS build surface exists.
