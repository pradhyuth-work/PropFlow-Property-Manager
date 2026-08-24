---
name: OpenAPI and Zod compatibility
description: Compatibility constraint between the workspace's generated validation code and the installed Zod version.
---

The current codegen setup emits Zod 3-compatible validators; OpenAPI UUID and integer formats can cause it to generate Zod 4-only helpers. Keep generated schemas compatible with the installed validator version unless the workspace Zod dependency is deliberately upgraded.

**Why:** Codegen can succeed while the chained library typecheck fails, leaving the app with stale or unusable generated declarations.

**How to apply:** When adding OpenAPI schemas, verify generated validators with the library typecheck before building routes or UI around them.