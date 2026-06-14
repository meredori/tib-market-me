# Tibia HuntLens / HuntOps Roadmap

## Product Direction

This app is a local-first Tibia operations cockpit.

Its purpose is to turn personal hunt history, market data, character context, and public Tibia reference data into practical decisions:

- What should I sell, hold, NPC, or watch?
- Which tasks are worth doing, buying, farming, rerolling, or skipping?
- Which bestiary/charm goals are close or efficient?
- Which hunting places are actually good for my character, playstyle, and current market?
- What should I do next?

The roadmap is feature-focused. Testing, migrations, build checks, and regression coverage are expected as part of every phase rather than treated as separate product phases.

---

## Completed / Baseline Functionality

The following functionality already exists and should not be rebuilt as future roadmap work.

### Hunt Tracking And Analysis

- Hunt analyser paste/import flow.
- Saved hunt records.
- Hunt result tracking for profit, XP, loot, supplies, damage, healing, and related metrics.
- Character context association on saved hunts.
- Loot enrichment with known pricing where available.
- Item-level price overrides.
- Hunt History / Previous Hunts screen with edit, delete, search, sort, and filtering.
- New hunt creation separated from historical hunt management.

### Dashboard

- Home dashboard focused on personal hunt activity.
- Recent hunt access.
- Core hunt metrics.
- Profit and XP trend visuals.
- Personal hunt dashboard remains separate from market operations.

### Market Operations

- Dedicated Market section.
- Item search / lookup.
- Item detail modal.
- Market favorites / watchlist support.
- Market opportunity summaries.
- Labels such as below historical band, high looted value, low recent volume.
- Stale / lower-confidence market data warnings.
- Recent notable movers.
- General market activity / quietness signals.

### Item Detail Modal

- Item identity and image.
- Current value.
- Sale strategy.
- Historical price range.
- Market activity / liquidity.
- Loot relevance from saved hunts where available.
- Manual price overrides under Advanced.

### Public Tibia Reference Data

- Public reference catalog sync foundation.
- Local normalized SQLite storage for creatures, creature loot, hunting places, hunting-place creatures, hunting-place area summaries, and sync run history.
- Catalog-first public reference staging.
- Public reference status endpoint.
- Settings controls for catalog sync and sync status.

### Character Lookup

- Public Tibia character lookup.
- Local character cache.
- Character context on saved hunts.

### Hunt-To-Hunting-Place Matching

- Matching infrastructure exists.
- Match confidence, reasons, alternate candidates, and manual corrections are structurally supported.
- Practical matching is not reliable yet and must be repaired after public detail enrichment.

### Shared Intelligence Foundation

- Shared backend intelligence types and helpers for entity references, provenance, confidence, freshness, explanations, and job status.
- Unified long-running intelligence job tables and lifecycle helpers.
- Public reference status, data health, market dashboard, item details, and hunt matching expose shared metadata instead of one-off status shapes.
- Shared UI primitives for entity links, confidence, freshness, provenance, decision labels, job status, compact metrics, empty states, and advanced disclosure.
- Public reference rows persist lightweight intelligence metadata.
- Existing market, item detail, public reference, hunt matching, and hunt loot surfaces have been migrated onto the shared intelligence language.
- Item value strategy now consistently separates market, NPC, and ignored values: ignored loot uses NPC value when available, otherwise 0 gp.
- Hunt Overview and Loot tab layouts have been refined so overview remains compact while the dedicated Loot tab keeps the fuller audit view.

---

## Roadmap Principles

1. Build around user decisions, not isolated data tables.
2. Keep personal hunt data separate from public/imported/reference data.
3. Preserve source, freshness, confidence, and manual override information wherever derived decisions are shown.
4. Prefer narrow high-value workflows before broad recommendation systems.
5. Avoid bolting features onto the outside of the app. Shared libraries, shared UI primitives, and shared job/sync infrastructure should be created before repeated one-off implementations.
6. Treat tests, migrations, build checks, and regression coverage as part of each feature's definition of done.
7. Keep local-first behavior intact.
8. Do not let external public imports affect personal totals, streaks, progress summaries, or character-specific performance unless explicitly designed and labelled.

---

# Phase 1: Shared Intelligence Foundation

## Goal

Create the common product and technical foundation that prevents future features from becoming disconnected screens.

This phase should introduce reusable concepts for entity identity, provenance, confidence, freshness, sync jobs, and explanation metadata.

**Status: Completed.**

Phase 1 has been implemented app-wide rather than as a parallel "new framework." Existing market, item detail, public reference, hunt matching, settings/status, and hunt loot workflows now use the shared intelligence foundation where applicable.

## Build

### 1. Shared Entity Model

Create or formalize common identity patterns for:

- Item
- Creature
- Hunting place
- Character
- Hunt
- Market observation
- Task
- Future quest/access requirement

Entities should be linkable across screens and features.

Example relationships:

- Item -> dropped by creatures -> found in hunting places -> market value -> looted in hunts -> used in tasks.
- Creature -> loot -> bestiary -> taskboard -> hunting places.
- Hunting place -> creatures -> expected loot -> personal hunt history -> access requirements.
- Character -> level/vocation -> viable hunts -> tasks -> access profile.

### 2. Shared Provenance Model

Add a consistent way to represent where data came from.

Possible source types:

- Personal hunt
- Manual user input
- Manual override
- Market sync
- Public Tibia reference API
- Public website/reference import
- Imported public hunt session
- Derived calculation

Each derived insight should be able to explain its source.

### 3. Shared Confidence And Freshness Model

Add common fields and helpers for:

- Confidence level
- Confidence score where useful
- Last updated
- Last verified
- Stale threshold
- Missing data reason
- Manual versus automatic status
- Estimated versus confirmed status

Use these consistently in market signals, matching, recommendations, task guidance, and future imported data.

### 4. Shared Explanation Model

Create a reusable explanation structure for decision cards.

Examples:

- "Recommended because this item is below its historical band and appeared in your last three hunts."
- "Low confidence because the hunting place is missing enriched creature data."
- "Buy may be better than farm because the market cost is low compared with likely farming time."
- "Suggestion blocked because access requirements are unknown."

### 5. Shared Job / Sync Framework

Create a common backend job framework for long-running or resumable local operations.

It should support:

- Job type
- Entity type
- Cursor / resumable state
- Total count
- Completed count
- Failed count
- Current entity name/id
- Last success
- Last error
- Failure count
- Retry state
- Backoff state
- Started/finished timestamps
- Cancel/pause/retry hooks if practical
- Status endpoint shape reusable by UI

Future users of this system:

- Public reference enrichment
- Hunt matching recalculation
- Market sync status
- Public hunt import
- Recommendation cache rebuild
- Bestiary/reference import
- Access data import

### 6. Shared UI Primitives

Create reusable UI components for:

- Entity link pill
- Confidence badge
- Stale data warning
- Source/provenance badge
- Manual/automatic/suggested marker
- Compact metric row
- Empty state with missing-data explanation
- Job progress/status panel
- Advanced disclosure section
- Decision reason labels

## Acceptance Criteria

- New shared types/helpers exist for provenance, confidence, freshness, and explanation metadata.
- A shared job/status model exists and can be used by future sync/enrichment operations.
- At least one existing area, such as market data warnings or item details, uses the shared badge/explanation primitives.
- No major user-facing workflow should regress.
- Backend tests and UI build checks are updated where affected.

---

# Phase 2: Public Reference Enrichment And Data Health

## Goal

Turn staged public reference catalog data into usable detail data for creatures, items, and hunting places.

Settings should evolve into a clearer Data Health area that shows what is staged, enriched, stale, failed, or missing.

**Status: Completed.**

Phase 2 now keeps catalog sync and detail enrichment as separate operations. Catalog sync stages public reference rows only, while detail enrichment runs as an in-process background job with explicit per-entity enrichment state, retry/backoff visibility, and Data Health reporting.

## Build

### 1. Enrichment Operation

Add a public reference enrichment operation separate from catalog sync.

Catalog sync means:

- The app knows the entity exists.

Detail enrichment means:

- The app has enough detail to use the entity in matching, taskboard, recommendations, and item/creature/place details.

The enrichment operation should use the shared job framework from Phase 1.

### 2. Enrichment Targets

Support enrichment for staged:

- Creatures
- Creature loot
- Hunting places
- Hunting-place creatures
- Items where item identity/detail can be resolved

### 3. Resumable Enrichment

The enrichment worker should:

- Select the next non-enriched or stale row.
- Store enrichment timestamps separately from catalog last-seen timestamps.
- Store source payload JSON.
- Store failure count.
- Store last error details.
- Continue from where it left off when restarted.

### 4. Rate Limit And Backoff Handling

The enrichment process should:

- Detect rate-limit or temporary failure responses.
- Back off before retrying.
- Expose backoff state to the UI.
- Keep the UI active during delays.
- Show current entity type, current entity, completed count, total count, failed count, and retry state.

### 5. Data Health Screen

Expand Settings or create a dedicated Data Health section showing:

- Staged creatures
- Enriched creatures
- Pending creatures
- Failed creatures
- Staged hunting places
- Enriched hunting places
- Pending hunting places
- Failed hunting places
- Staged/enriched/resolved items where available
- Last catalog sync
- Last enrichment run
- Current job status
- Stale data warnings
- Retry failed enrichment action

### 6. Data Quality Diagnostics

Add diagnostics for:

- Creatures missing loot detail
- Hunting places missing creature composition
- Loot rows with unresolved item identities
- Entities with repeated enrichment failures
- Duplicate or fuzzy item names
- Entity details too stale for recommendation use

## Acceptance Criteria

- Catalog sync and detail enrichment are separate user-visible operations.
- Data Health clearly shows staged versus enriched counts.
- Enrichment is resumable and failure-aware.
- Rate-limit/backoff state is visible.
- Enriched data can be consumed by hunt matching and later phases.
- Backend tests cover resumable ordering, detail writes, failure state, and count/status reporting.
- Server and UI builds pass.

---

# Phase 3: Hunt Location Repair And Retroactive Matching

**Status: Completed.**

## Goal

Make hunt-to-hunting-place matching practical, explainable, and trustworthy.

Matching should not silently fail. It should explain whether failure is due to missing reference data, low confidence, mixed hunt data, or a logic/persistence/UI issue.

## Build

### 1. Match Readiness Diagnostics

For a saved hunt, expose whether automatic matching can be attempted.

Possible states:

- Ready to match.
- Missing enriched creature data.
- Missing enriched hunting-place data.
- Too few distinctive monsters.
- Too many travel/noise kills.
- Candidate matches exist but confidence is low.
- Existing manual correction should be preserved.
- Matching failed unexpectedly.

### 2. Matching Repair

After enrichment exists, re-test and repair existing matcher behavior.

Investigate:

- Scoring logic.
- Creature lookup.
- Hunting-place lookup.
- Alias handling.
- Travel/noise kill handling.
- Persistence.
- API response shape.
- UI surface.
- Manual correction interaction.

### 3. Retroactive Matching Action

Add an action to re-run matching over previous hunts.

Rules:

- Apply only to unmatched or free-text/manual-location hunts by default.
- Preserve existing manual corrections.
- Allow "suggest but do not replace."
- Allow explicit replacement if the user chooses.
- Store match attempt timestamp and result metadata.

### 4. Manual Correction UX

Improve hunt detail/edit workflow with:

- A single Location text field for the saved display name.
- A hunting spot dropdown where `None` keeps a custom location and selecting an imported hunting spot links the hunt.
- Suggested/imported hunting spots in the same dropdown, with confidence shown only as option text where useful.
- Search-as-you-type results feeding the same dropdown.
- Mark as mixed route/travel hunt.
- Reverting the dropdown to `None` to remove the linked hunting spot while keeping custom text.

### 5. UI Markers

Clearly distinguish:

- `Custom` when the hunt has only `location_name` text.
- `Linked` when the hunt has a `public_hunting_place_id` for an imported hunting spot.

Do not surface automatic/review/unmatched/confidence states as hunt-history location type pills.

### 6. Hunting Place Match Summary

For matched hunts, show:

- Matched hunting place.
- Confidence.
- Reasons.
- Main matching creatures.
- Ignored/noise creatures if available.
- Alternate candidates.

## Acceptance Criteria

- Matching explains why it did or did not run.
- Retroactive matching can process old hunts safely.
- Manual corrections are preserved unless explicitly replaced.
- UI clearly distinguishes custom text entries from linked imported hunting spots.
- Regression tests cover exact matches, partial matches, aliases, noisy/travel kills, missing enrichment, low confidence, and manual-preservation rules.
- Server and UI builds pass.

---

# Phase 4: Loot Selling Workflow

## Goal

Turn market intelligence and saved hunt loot into a practical post-hunt workflow.

The app should help decide what to sell, hold, NPC, watch, or review.

**Status: Completed.**

Phase 4 has been implemented as a dedicated Loot Inbox workflow backed by reusable server-side loot-selling guidance. Recent saved-hunt loot is classified into sell, hold, NPC/vendor, watch, review, and unknown-price actions with shared freshness, confidence, provenance, and explanation metadata. The workflow is accessible from the main navigation, Dashboard loot summary, Market loot listing panel, Hunt loot tables, and Item Details.

## Build

### 1. Loot Inbox

Add a Loot Inbox or equivalent workflow that aggregates recently looted items from saved hunts.

Show:

- Item
- Quantity looted
- Hunts where it appeared
- Current market value
- Historical value band
- NPC/vendor value where known
- Manual override value where applicable
- Total estimated value
- Market freshness
- Liquidity/activity
- Confidence/source badges

### 2. Action Labels

For each item, classify into practical actions:

- Sell now
- Hold
- NPC/vendor
- Watch
- Review price
- Unknown price
- Low liquidity
- Stale data
- Delivery/task premium candidate

### 3. Listing Checklist

Create a checklist view for:

- Items worth listing now.
- Items likely better held.
- Items likely better NPC sold.
- Items with stale/unknown prices.
- Items with manual overrides needing review.
- Items that recently moved significantly.

### 4. Override Review

Add a focused override review workflow:

- Overrides older than threshold.
- Overrides that disagree strongly with recent market data.
- Overrides affecting high-value loot.
- Itemprices export impact preview if practical.

### 5. Integration Points

Loot selling workflow should be accessible from:

- Recent hunt save confirmation.
- Hunt detail loot table.
- Market section.
- Item detail modal.
- Dashboard summary card if useful.

## Acceptance Criteria

- User can review recently looted items and get clear sell/hold/NPC/watch guidance.
- Guidance uses shared provenance/confidence/freshness badges.
- Unknown and stale data are visible, not hidden.
- Manual overrides remain supported.
- Existing item lookup and item modal behavior do not regress.
- Backend tests cover item classification and stale/override logic.
- UI build passes.

---

# Phase 5: Taskboard Helper MVP

## Goal

Help the user decide whether current Tibia taskboard tasks are worth doing, buying, farming, rerolling, or skipping.

This should become one of the first major decision workflows because it connects character context, market prices, creature drops, hunting places, and personal hunt performance.

**Status: Completed.**

Phase 5 is implemented as a first-class weekly Taskboard helper for the in-game boosted task offer system. It stores the offered creature names and item quantities for the current week, then uses public reference data, market prices, drop rates, and personal hunt performance to suggest where to hunt creatures, whether to buy or farm item requirements, rough kills needed, break-even price hints, and useful overlap between the weekly offers.

## Build

### 1. Manual Task Entry

Allow the user to enter current tasks manually.

Support:

- Creature task
- Delivery item task
- Desired quantity
- Difficulty/category where useful
- Character
- Optional level/vocation override
- Preferred/unwanted creature note if useful
- Completion status

### 2. Creature Task Helper

For creature kill tasks, show:

- Known hunting places containing the creature.
- Safest plausible hunting spot.
- Best personal historical hunting spot if available.
- Estimated kills per hour from personal data where available.
- Expected completion time range.
- Expected XP/profit from related personal or reference data where available.
- Confidence and missing-data labels.

### 3. Delivery Item Helper

For delivery item tasks, show:

- Required quantity.
- Current market buy cost.
- NPC/vendor value where known.
- Creatures that drop the item.
- Hunting places containing those creatures.
- Estimated farm difficulty.
- Buy versus farm recommendation.
- Confidence and missing-data labels.

### 4. Reroll / Skip Guidance

Add labels such as:

- Good task.
- Easy completion.
- Good because you already hunt this spawn.
- Buy item instead of farming.
- Farm item instead of buying.
- Skip/reroll due to low density.
- Skip/reroll due to access blocker.
- Skip/reroll due to weak reward/value.
- Unknown due to missing data.

### 5. Weekly Offer Tracking

Track only what the weekly system needs:

- Creature names offered by the weekly taskboard.
- Delivery item names and required quantities.
- Typed creature/item offer text matched to local public reference data.
- No slot, manual id, status, history, or notes bookkeeping in the weekly taskboard helper.

### 6. Integration Points

Taskboard should link to:

- Creature detail.
- Item detail.
- Hunting-place detail.
- Market lookup.
- Hunt history.
- Character profile.

## Acceptance Criteria

- User can enter weekly creature offers and delivery item offers and receive practical guidance.
- Buy-vs-farm logic works for delivery items where market and drop data exist.
- Creature tasks can suggest plausible hunting places.
- Personal hunt data is used where available but not required.
- Missing data is clearly labelled.
- Weekly offers persist locally without affecting personal hunt totals.
- Backend tests cover task classification, buy-vs-farm, personal KPH use, and missing-data states.
- UI build passes.

---

# Phase 6: Bestiary And Charm Progress From Hunts

## Goal

Provide a practical bestiary checklist based on local public creature reference data.

**Status: Completed.**

Phase 6 is implemented as a checklist-first Bestiary workflow. It lists public bestiary creatures sorted by practical completion order, lets the user check off completed creatures, and removes completed creatures from the active list while keeping them restorable. Saved hunt data and public hunting-place data can add context such as a known spawn or observed pace, but the core value is the checklist rather than a full progression planner.

## Build

### 1. Manual Bestiary State

Allow user to manually check off bestiary creatures.

Core state:

- Active / not checked off.
- Completed / hidden from the active checklist.
- Character/account scope where useful.

### 2. Checklist Ordering

Sort active entries by:

- Difficulty, easy before medium before hard.
- Charm points, higher before lower inside the same difficulty.
- Creature name as tie-break.

### 3. Suggested Spawn Context

Show lightweight context where local data exists:

- Suggested hunting place from public reference data.
- Personal observed pace only when saved hunt data exists.
- No fake session or kills/hour estimates when hunt data is absent.

### 4. Integration Points

Bestiary/charm information may appear on:

- Hunting-place detail.
- Creature detail.
- Taskboard helper.
- Recommendation cards later.

## Acceptance Criteria

- User can check off a creature and it leaves the active checklist.
- Completed creatures are restorable.
- Active checklist is sorted by difficulty then charm points.
- Suggested spawns are clickable where reference data exists.
- Backend tests cover checklist sorting and completed-state hiding.
- UI build passes.

---

# Phase 7: Hunting Place Intelligence Pages

## Goal

Make each hunting place a reusable knowledge object before building broad recommendations.

A hunting-place page should answer: what do we know about this place, how has the user performed here, what is it good for, and how reliable is the data?

**Status: Completed.**

Phase 7 is implemented as canonical hunting-place intelligence pages backed by public hunting-place references, enriched creatures/loot, market-weighted loot estimates, and linked personal hunts. The page separates personal observed performance from public/reference expectations, exposes confidence/freshness/provenance labels, excludes custom and mixed-route hunts from canonical metrics, and includes Bestiary and Taskboard relevance hooks populated from the new Phase 5/6 local data where available.

## Build

### 1. Hunting Place Detail Page

For each hunting place, show:

- Name.
- Known creatures.
- Creature composition where available.
- Expected/common loot.
- Current market-weighted loot value.
- User's personal hunts at this place.
- Best/median/recent XP.
- Best/median/recent profit.
- Supply cost trends.
- Safety notes derived from waste/deaths/manual notes where available.
- Bestiary relevance.
- Taskboard relevance.
- Access warnings where known.
- Data freshness and confidence.

### 2. Personal Performance Summary

For matched personal hunts at the place, show:

- Number of sessions.
- Total time.
- Average XP/hour.
- Average profit/hour.
- Best run.
- Recent trend.
- Character/vocation used.
- Notes.

### 3. Expected Loot Intelligence

Combine:

- Public creature loot.
- Hunting-place creature composition.
- Market prices.
- User's actual loot results.

Label clearly:

- Personal observed.
- Public/reference expected.
- Market-weighted estimate.
- Low confidence.

### 4. Safety And Suitability Signals

Start with simple rules:

- Waste-heavy.
- Supply-heavy.
- Low healing pressure.
- High healing pressure.
- Good for short sessions.
- Unknown safety.
- Requires manual review.

Do not overfit safety ratings too early.

### 5. Integration Points

Hunting-place pages should be linked from:

- Hunt detail.
- Hunt history.
- Taskboard.
- Creature detail.
- Recommendations later.
- Search/global entity lookup if available.

## Acceptance Criteria

- Matched hunting places have useful detail pages.
- Personal performance is clearly separated from public/reference estimates.
- Market-weighted loot estimates show confidence/freshness.
- Hunting-place pages become reusable by later recommendation features.
- Backend tests cover personal performance aggregation and mixed source labelling.
- UI build passes.

---

# Phase 8: Market-Weighted Hunt Recommendations

## Goal

Recommend hunting areas based on character context, personal hunt history, public reference data, and current market prices.

Recommendations should be explainable and confidence-aware, not black-box rankings.

## Build

### 1. Recommendation Modes

Support:

- Profit
- XP
- Balanced
- Bestiary
- Taskboard
- Low-risk / safe
- Short session
- Revisit previous good hunt
- Try something new

### 2. Recommendation Inputs

Use:

- Character level.
- Character vocation.
- Personal hunt history.
- Hunting-place intelligence.
- Market prices.
- Loot value.
- Bestiary state.
- Taskboard entries.
- Access state when available.
- User risk preference where available.
- Data freshness.

### 3. Recommendation Cards

Each recommendation should show:

- Hunting place.
- Mode/reason.
- Expected XP range.
- Expected profit range.
- Confidence.
- Main valuable drops.
- Relevant creatures.
- Bestiary/task relevance.
- Known risks.
- Missing data.
- Access warning.
- Personal history comparison.

### 4. Recommendation Explanations

Examples:

- "Recommended for profit because several common drops are above recent median and you have profitable past hunts here."
- "Recommended for taskboard because this place contains your current task creature and has safer density than alternatives."
- "Low confidence because the hunting-place creature list is not fully enriched."
- "Blocked because access is unknown."

### 5. Feedback Loop

Allow user to:

- Save/reject recommendation.
- Mark as not interested.
- Mark access unavailable.
- Mark too risky.
- Start a hunt from recommendation.
- Compare actual outcome later.

## Acceptance Criteria

- User can request recommendations by mode.
- Recommendations explain why they appear.
- Expected values are ranges or labelled estimates, not false precision.
- Missing data and confidence are visible.
- Recommendation feedback is stored for future tuning.
- Backend tests cover ranking, filtering, missing data, and explanation output.
- UI build passes.

---

# Phase 9: Access And Unlock Tracking

## Goal

Prevent bad recommendations by modelling whether the character/account can access suggested content.

This phase should focus on access blockers, not a full quest database.

## Build

### 1. Access Requirement Model

Support requirements such as:

- Quest required.
- Questline stage required.
- Key/item required.
- Premium required.
- Level recommended or required.
- Team recommended or required.
- Boss access required.
- Area access required.
- Manual/unknown requirement.

### 2. Manual Unlock Profile

Allow user to track access state:

- Have access.
- Do not have access.
- Unknown.
- Not relevant.
- Notes.

Scope should support:

- Character-specific access.
- Account-wide access where appropriate.
- Manual override.

### 3. Recommendation Warnings

Recommendation cards and hunting-place pages should show:

- Likely locked.
- Access unknown.
- Requires quest.
- Requires team.
- Requires item/key.
- User marked unavailable.
- User marked available.

### 4. Unlock Checklist

Show relevant unlocks for:

- Recommended hunts.
- Watched hunting places.
- Taskboard targets.
- Boss/bosstiary targets later.

Do not attempt to stage every quest before this has targeted value.

### 5. Integration Points

Access state should integrate with:

- Hunting-place pages.
- Recommendations.
- Taskboard helper.
- Character profile.
- Future quest/progression planner.

## Acceptance Criteria

- Hunting places and recommendations can display access warnings.
- User can manually track unlock/access state.
- Manual access state affects recommendation ranking/filtering.
- Access unknown is clearly different from access blocked.
- Backend tests cover access-state filtering and warning generation.
- UI build passes.

---

# Phase 10: Character And Vocation Planner

## Goal

Make recommendations aware of the actual character, not just generic level ranges.

Start with practical character context rather than a full equipment/Wheel simulator.

## Build

### 1. Character Profile Expansion

For cached characters, support:

- Level.
- Vocation.
- Skills/magic level where available.
- World.
- Notes.
- Preferred risk profile.
- Preferred hunt style.
- Solo/duo/team preference.
- Short-walk preference.
- Manual equipment notes.
- Manual charm notes.
- Manual unlock notes from Phase 9.

### 2. Vocation-Aware Filters

Recommendations and hunting-place pages should account for:

- Vocation suitability.
- Level range.
- Damage type notes where known.
- Healing/supply pressure.
- Solo viability.
- Known risky places.

### 3. Basic Gear / Imbue Reminders

Add lightweight notes, not a full simulator:

- Important supplies.
- Suggested damage/protection types where known.
- Imbue reminder notes.
- Missing data warning.

### 4. Future Build Hooks

Design data structures so later Wheel of Destiny, spell, and equipment data can be added without replacing the character model.

## Acceptance Criteria

- User can configure practical character preferences.
- Recommendation ranking can use vocation and preference data.
- Character profile does not require complete external data to be useful.
- Backend tests cover character-aware filtering.
- UI build passes.

---

# Phase 11: Advanced Market Operations

## Goal

Expand market functionality after personal loot and recommendation workflows are strong.

## Build

### 1. Alerts And Watch Rules

Allow watchlist rules such as:

- Price below threshold.
- Price above threshold.
- Price outside historical band.
- Low volume warning.
- Stale data warning.
- Recently moved significantly.

### 2. Trade Log

Allow user to record:

- Listed item.
- Quantity.
- Listed price.
- Sold price.
- Sale date.
- Notes.
- Linked hunt source if known.

### 3. Realized Profit Tracking

Where trade log data exists, compare:

- Estimated value at hunt save time.
- Listed value.
- Actual sale value.
- Difference from override/market estimate.

### 4. Liquidity And Spread Scores

Add stronger market quality signals:

- Recent volume.
- Price spread.
- Median versus current.
- Volatility.
- Confidence.
- Commodity treatment for Tibia Coins / gold / common high-volume items where applicable.

### 5. Market Review Dashboard

Show:

- Watchlist alerts.
- Items to list.
- Items to hold.
- Items with stale data.
- Items with large price movement.
- Realized sale performance.

## Acceptance Criteria

- User can create useful market watch rules.
- Trade log persists realized sales.
- Realized sale data does not overwrite market data unless explicitly used as manual override.
- Market signals use shared confidence/freshness badges.
- Backend tests cover watch rules, trade log, and realized profit calculations.
- UI build passes.

---

# Phase 12: External Public Hunt Intelligence

Status: Completed.

## Goal

Import public Hunt Analyser session data to improve hunting-place intelligence only.

Public imported sessions must remain separate from personal hunt history.

Implemented as a manual, resumable public Hunt Analyser import. The source is server-rendered at `/hunt_sessions?hunt_sessions_by=is_public`, currently paginated at 20 sessions per page and observed with 3,390 public sessions during implementation research. Detail pages expose core summary metrics and monster kills in HTML. `robots.txt` allows `User-agent: *` while marking `ai-train=no`, so the app treats this as a polite, manual, factual import only and not as training data or bulk content republishing.

## Build

### 1. Source Research

Hunt Analyser public sessions were imported responsibly as the v1 source.

Document:

- Source URL shape: listing at `/hunt_sessions?hunt_sessions_by=is_public`, detail pages at `/hunt_sessions/:id`.
- Available v1 fields: title, public author label, observed date, duration, party vocations/levels, XP, raw XP rate, XP rate, balance/profit, and monster kill counts.
- Raw detail pages are stored as raw HTML with a payload fingerprint for audit, dedupe, and future reparse.
- Import is manual, batch-capped, rate-limited, and resumable through intelligence jobs.
- Practical concern: `ai-train=no` is respected; imported facts are local app intelligence only.

### 2. Public Session Storage

Imported sessions are stored separately from personal hunts.

Required metadata:

- Source.
- Source URL/id.
- Import timestamp.
- Raw payload.
- Payload fingerprint.
- Provenance labels.
- Parsed confidence.
- Linked hunting place if matched.

### 3. Data Separation Rules

Imported public sessions must not affect:

- Personal hunt totals.
- Character totals.
- Personal XP/profit trends.
- Streaks.
- Dashboard personal metrics.
- Character performance summaries.

Imported sessions may contribute only to:

- Hunting-place intelligence.
- Rough public XP/profit ranges.
- Spawn loot expectations.
- Recommendation estimates where explicitly labelled.

### 4. Review And Deduplication

Add:

- Deduplication by source id or payload fingerprint.
- Review queue if confidence is low.
- Reprocess action when matching/pricing rules improve.

### 5. Hunting-Place Intelligence

Add a separate public sessions section to hunting-place pages.

Show:

- Accepted public import count.
- Median and range XP/profit rates.
- Rough kills-per-hour from imported monster counts.
- Common level bands and vocations.
- Top observed creatures.

Suspicious or unreviewed imports are excluded from trusted public aggregates.

### 6. Settings Import Controls

Add Public Hunt Import controls in Settings/Data Health.

Include:

- Manual Check Public Hunts action.
- Batch size control.
- Public import job status.
- Review queue for low-confidence or suspicious sessions.
- Reprocess action after matching/reference improvements.

## Acceptance Criteria

- Public import is documented before implementation.
- Imported data is provenance-labelled and separated from personal data.
- Data-separation tests prove personal stats are unaffected.
- Public sessions only appear in allowed hunting-place intelligence paths.
- UI labels public/imported data clearly.
- Server and UI builds pass.
- Manual import, review, reprocess, and parser tests pass.

---

# Phase 13: Route, Location, NPC, And Experience Layer

## Goal

Improve the practical usability of recommendations and hunting-place pages once core intelligence is reliable.

This phase is an experience layer, not a prerequisite for earlier taskboard/recommendation value.

## Build

### 1. Route And Convenience Notes

Support:

- City/depot proximity.
- Travel method notes.
- Boat/carpet/teleport notes.
- Short-walk score.
- Dangerous route warning.
- Manual user notes.

### 2. NPC And Vendor Context

Link:

- NPC buyers.
- NPC sellers.
- Relevant vendors.
- Quest/access NPCs where known.
- Item sale alternatives.

### 3. Location Grouping

Group content by:

- City.
- Region.
- Island.
- Spawn cluster.
- Hunting-place family.
- User-defined labels.

### 4. User Notes

Allow user notes on:

- Hunting places.
- Routes.
- Access.
- Safety.
- Supplies.
- Loot handling.
- Preferred path.

## Acceptance Criteria

- Hunting-place pages can show practical route/location/NPC notes.
- Recommendations can account for short-walk/convenience preference where data exists.
- User notes are preserved and source-labelled.
- Existing recommendation and taskboard workflows do not depend on this data being complete.
- Server and UI builds pass.

---

# Phase 14: Stabilization And Smoke Test Expansion

## Goal

Add broader end-to-end smoke coverage once major product surfaces have settled.

This is not a product feature phase. It is a hardening phase after the main workflows exist.

## Build

Add Playwright or equivalent smoke coverage for:

- Add new hunt.
- Paste/import hunt analyser text.
- Parse preview.
- Save hunt.
- Open previous hunt.
- Edit previous hunt.
- Delete previous hunt.
- Open item detail from hunt loot.
- Save item override.
- Use Loot Inbox.
- Enter taskboard task.
- Open hunting-place detail.
- Request recommendation.
- Review Data Health/enrichment status.

## Acceptance Criteria

- Critical user journeys have smoke tests.
- Tests are stable enough to run in local development and CI.
- Existing unit/integration tests remain in place.
- UI and server builds pass.

---

# Backlog / Later Ideas

These are useful but should not interrupt the main roadmap unless they directly support a phase.

## Full Quest And Progression Roadmap

Only expand after access tracking proves useful.

Possible future work:

- Quest database.
- Achievement tracking.
- Mount/outfit tracking.
- Questline planning.
- Boss access roadmap.
- Account-wide progression checklist.

## Full Vocation Build System

Only expand after character-aware recommendations exist.

Possible future work:

- Spell data.
- Wheel of Destiny data.
- Equipment database.
- Imbue planning.
- Damage/protection optimizer.
- Build comparison.

## Public Data Source Expansion

Potential sources:

- Additional public APIs.
- TibiaWiki-derived structured data where permissible.
- Community-maintained reference data.
- Manual import/export packs.

Any source expansion must preserve provenance and source reliability labels.

## Advanced Analytics

Possible future work:

- Normalized hunt rates.
- Downtime-adjusted rates.
- Confidence-smoothed profit/hour.
- Safety rating.
- Supply pressure scoring.
- Waste-heavy intentional hunt handling.
- Character-specific baseline comparison.

These should be introduced only when they directly improve taskboard, hunting-place intelligence, or recommendations.

---

# Definition Of Done For Every Phase

Every phase should include:

- Database migrations where needed.
- Backend implementation.
- Frontend implementation.
- Shared type updates.
- Data provenance/freshness/confidence handling where derived insights are shown.
- Meaningful unit/integration tests.
- UI build check.
- Server build check.
- Migration check.
- Manual smoke test notes for the affected workflow.
- No regression to existing hunt import, hunt history, item lookup, item overrides, market watchlist, or dashboard flows.

---

# Agent Guidance

When an AI coding agent works this roadmap phase by phase:

1. Do not rebuild completed baseline features.
2. Prefer extending shared systems over creating one-off feature-specific logic.
3. Keep personal, public, imported, manual, and derived data clearly separated.
4. Add source/confidence/freshness metadata to new derived decisions.
5. Make missing data visible to the user.
6. Avoid false precision in estimates.
7. Use ranges, labels, and explanations for uncertain recommendations.
8. Preserve manual corrections and overrides.
9. Keep UI workflows practical and decision-focused.
10. Each phase should leave the app in a shippable state.
