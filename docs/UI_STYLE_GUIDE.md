# Tibia Market UI Style Guide

This guide is the source of truth for shared UI conventions in the Vue app. New screens should start from these primitives before adding local markup.

## Foundations

- Use the CSS tokens in `ui-app/src/style.css` for color, spacing, radius, borders, and type. Add a token when a value becomes a repeated convention.
- Keep operational screens compact. Prefer dense, readable panels and tables over large decorative sections.
- Use `rem` font sizes from the shared scale: label `0.72rem`, caption `0.76rem`, body `0.86rem`, panel heading `0.95rem`, compact value `1.05rem`, metric value `1.28rem`.
- Use the spacing scale: `4`, `6`, `8`, `10`, `12`, `14`, and `16px`. Avoid one-off gaps unless the layout truly needs it.

## Layout

- `Panel` is the default framed surface for screen sections. Use `variant="table"` for table-heavy panels and `variant="analysis"` inside hunt analysis layouts.
- `SectionHeader` owns panel titles, subtitles, and action slots. Avoid hand-rolled panel title rows.
- `Toolbar` owns search/filter/action rows. Use `variant="filters"` for form-like controls and `variant="inline"` for compact controls.
- Use `dashboard-grid`, `page-stack`, and `metric-strip` only when the screen-level layout already matches those patterns.

## Screen Priority

- Start each screen from its intent: what decision or action should the user complete here?
- The first viewport should contain the primary job, usually the main table, form, or review workflow plus the controls that operate it.
- Keep status, freshness, and diagnostics close to the data they qualify, but do not let them become the first thing on operational screens unless status is the screen's purpose.
- Put secondary context after the primary workflow or behind tabs when it would push the main task below the fold.
- Before adding a visible field, ask whether it helps this screen's intent, whether the format preserves its importance, and whether it belongs on a detail screen instead.

## Metrics

- Use `MetricGrid` for groups of stat cards. Each metric item should have `label`, `value`, and optional `tone`.
- Use `CompactMetricRow` for label/value facts in status panels where cards would be too heavy.
- Tones should stay semantic: `positive`, `danger`, `blue`, `teal`, `loot`, and `xp`.
- Use decision strips only when each card answers an action question, such as best XP hunt, best profit hunt, repeat route, or loot work queue. Put the table or workflow that supports those decisions directly below the strip.

## Tables

- Use `DataTable` for standard data tables. It provides the scroll wrapper, loading row, empty row, and error row.
- Prefer the shared prop vocabulary: `columns`, `items`, `loading`, `emptyTitle`, `emptyReason`, and `error`.
- Keep table headings short and uppercase through the global table style.
- Put entity names in the first column and numeric/action columns to the right. Use `action-col` for icon-only command columns.
- Set `minWidth` only when the table genuinely needs horizontal scrolling.
- For long local collections, use `DataTable` pagination with a screen-appropriate `pageSize` rather than rendering hundreds of rows at once. Use lazy "show more" cards for mobile-only card lists.

## Labels And Empty States

- Use `EmptyState` with `title` and `reason`. Do not use `subtitle`.
- Use badge components (`ConfidenceBadge`, `FreshnessBadge`, `ProvenanceBadge`, `DecisionLabels`) instead of new local pill styles.
- Use `InlineLink` for text-like buttons and `EntityLinkPill` for navigable entities with optional icons/images.

## Forms And Actions

- Labels sit above controls and use the shared label size.
- Primary submit or run actions use `primary-action`; secondary actions use `ghost-action`; icon-only actions use `icon-btn`.
- Toolbars should keep filters left and commands right when space allows, collapsing naturally on narrow screens.

## Component Rules

- Create or reuse a component when a pattern appears on two or more screens, contains state-specific behavior, or encodes a user-facing convention.
- Keep view-local styles for genuinely screen-specific layout only.
- When a new component sets a standard for a pattern, update this guide in the same change.
- Prefer direct consistency rewrites over compatibility aliases. Fix call sites to the current API.

## Maintenance Notes

- When touching an existing screen, run the Screen Priority checklist before visual polish.
- Continue moving repeated table, metric, panel, toolbar, badge, and empty-state patterns into shared primitives.
- Modals should keep using the shared badges, section headers, entity links, and table rules; avoid modal-specific copies of those primitives.
