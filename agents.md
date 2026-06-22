# AGENTS.md

## Purpose

This file gives AI coding agents the minimum project rules needed to work safely and accurately.

Prefer small, targeted changes over broad rewrites. The user often provides visual mocks, implementation notes, or task lists. Treat those as the source of truth for the current task.

## Operating Rules

1. Read the user request carefully and restate the intended change in 3–6 bullets before editing.
2. Identify the exact files likely to change before making changes.
3. Do not change unrelated layout, alignment, styling, copy, data structures, or behavior.
4. Do not “improve” nearby code unless it is required for the requested change.
5. If the task has multiple requested items, track each item and verify each one before finishing.
6. If data is unavailable, do not show fake values, placeholder values, or `N/A` unless explicitly requested.
7. Preserve existing working behavior unless the user specifically asks to change it.
8. Prefer existing components, styles, utilities, and patterns already used in the codebase.
9. Keep changes easy to review. Avoid large refactors unless the task explicitly asks for one.
10. Before final response, compare the completed work against the original request item by item.

## Scope Control

When implementing a request:

* Change only what is needed.
* Do not add extra cards, panels, fields, routes, pages, animations, abstractions, dependencies, or mock data unless requested.
* Do not rename files, components, functions, CSS classes, or data fields unless required.
* Do not move existing UI elements unless the requested design or behavior requires it.
* Do not replace an existing design system pattern with a new one.

If the request is ambiguous, choose the smallest reasonable interpretation and mention the assumption in the final response.

## Planning Mode

Before editing, produce a brief implementation plan with:

* Files/components to inspect
* Files/components likely to change
* The requested outcomes
* Any risks or assumptions

The plan should be specific enough to check later. Avoid vague steps like “update UI” or “improve styling”.

## UI / Mock Implementation Rules

When given a mock, screenshot, or design direction:

1. Match the structure, content hierarchy, information density, iconography, and interaction intent.
2. Do not chase exact pixels unless explicitly requested.
3. Preserve functional app behavior unless the mock clearly replaces it.
4. If the mock shows a field only when data exists, render that field conditionally.
5. Do not display unavailable values as `N/A` unless the existing product pattern requires it.
6. Use existing visual tokens and components where possible.
7. After implementation, review the result against the mock and list any known differences.

## Multi-Item Task Rules

For any request containing more than one change:

* Create a checklist from the user’s request.
* Complete every checklist item.
* Before finishing, re-read the checklist and verify each item.
* If an item could not be completed, say exactly why.

Do not report “done” if only some requested items were completed.

## Testing and Validation

Use the project’s normal validation commands.

If available, run the most relevant checks after changes:

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Tests
npm test

# Build
npm run build
```

If a command is unavailable, do not invent one. Check `package.json` first.

When changing UI, also do a quick manual review in the running app if the environment supports it.

## Final Response Format

End with:

1. Summary of what changed
2. Files changed
3. Validation performed
4. Any known limitations or follow-up work

For multi-item tasks, include a completed checklist.

## Safety and Secrets

* Do not read, print, copy, or expose secrets.
* Do not modify `.env` files unless explicitly requested.
* Do not commit credentials, tokens, private keys, or local machine paths.
* Do not install new dependencies without explaining why they are needed.

## Git Rules

* Do not create commits unless explicitly asked.
* Do not force-push, rebase, reset, or discard user changes unless explicitly asked.
* Before editing, avoid overwriting uncommitted user work.
* If unexpected unrelated changes are present, leave them alone and mention them.

## Dependency Rules

Do not add a dependency for small UI, formatting, date, icon, or utility work if the project already has a reasonable way to do it.

Only add a dependency when:

* the task clearly requires it,
* the project has no existing equivalent,
* and the benefit outweighs the maintenance cost.

## Code Style

Follow the style already present in the nearest relevant files.

Prefer:

* clear names over clever abstractions
* simple components over deeply generic ones
* explicit conditional rendering over fake placeholder data
* small functions over large mixed-responsibility functions

Avoid:

* broad refactors during feature work
* speculative abstractions
* duplicate business logic
* changing public interfaces unnecessarily
