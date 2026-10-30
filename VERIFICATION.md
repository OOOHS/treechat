# Verification

Target host: DSH 0.2.1-alpha.2, macOS ARM64. TreeChat is a development release.

Run `npm run build` and `DSH_TEST_ROOT=/path/to/dsh-runtime npm test`.
The current suite passes 29 tests with the target runtime available. Host contract tests are skipped when that runtime is absent.

Coverage includes anchors and ambiguous matches, completed-message fork boundaries, branch metadata persistence and renaming, workspace filtering, model selection before first send, keyboard composition, tree layout and zoom handlers.

Manual integration checks covered real-model parent/child/nested conversations, isolated follow-up history, promotion, reload recovery, inline rename, context disclosure and tree navigation. Browser-local metadata and version-specific host integration remain compatibility constraints. Credentials and conversation histories are excluded from this repository.
