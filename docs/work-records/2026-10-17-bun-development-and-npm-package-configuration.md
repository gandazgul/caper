---
kind: "work_record"
recordId: "4549d337-5550-4c42-9e25-82f89688add5"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-10-17T22:57:04.848Z"
provenance:
    sourcePlans:
        - "d77784f2-4709-46a5-b7a1-6e0343ba677b"
---
# Bun development and npm package configuration

## Summary

Caper uses Bun for dependency management, scripts and tests, with Oxlint, Oxfmt and TypeScript for code checks. The npm package definition exposes `@gandazgul/caper-engine` as an ES module with typed exports and Phaser 3 as a peer dependency; documentation and starter imports use this name. CI uses frozen installs, and the release workflow requires a matching version tag before publishing through npm Trusted Publishing. The engine retains its source behavior, public exports and type declarations, so this migration changes development and distribution rather than the game API.

## Out of Scope

This work does not include deprecation of the existing JSR package.

## Future Planning Notes

- Keep one shared Phaser instance between the game and engine. Phaser remains a peer dependency, and the starter retains Phaser deduplication.
- Preserve assertion strength when changing test tools: deep equality must remain strict, and error checks must retain both class and message checks where present. Test files receive the same JavaScript type-checking strictness as source files.
- npm Trusted Publishing requires an initial manual publication and trusted-publisher configuration. Keep the package repository URL aligned with the publishing GitHub repository, public package access, and the release-tag check against `package.json`.