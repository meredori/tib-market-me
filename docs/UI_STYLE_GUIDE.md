# Tibia Market UI Style Guide & Design System

This guide is the source of truth for UI conventions, design tokens, and component patterns across the Tibia Market application. It is written *from the ground up* around the three canonical reference implementations that define what production quality looks like:

- **Loot Analysis** — `HuntIntelligence.vue` (the richest data-display panel; the primary reference)
- **Hunt Verdict** — `HuntIntelligence.vue` (tone-based status card with lockup and tags)
- **Hunt Hero** — `HuntsWorkspaceView.vue` (the page-level hero strip)

All new screens and component refactors must match the density, visual language, and structure demonstrated by these three. When in doubt, look at the source.

> **Source files**
> - Global tokens: `ui-app/src/style.css`
> - Loot Analysis & Hunt Verdict: `ui-app/src/components/hunts/HuntIntelligence.vue`
> - Hunt Hero: `ui-app/src/components/views/HuntsWorkspaceView.vue`

---

## 1. Design Tokens

All tokens are defined in `:root` inside `style.css`. Never use raw hex values or pixel sizes in component CSS — always reference a token.

### 1.1 Color Palette

| Token | Value | Role |
|:---|:---|:---|
| `--bg` | `#07111b` | Application background (rendered as a `145deg` gradient) |
| `--bg-2` | `#0d1722` | Secondary workspace/sidebar background |
| `--surface` | `#111c27` | Default panel surface |
| `--surface-2` | `#0c1722` | Secondary panel container |
| `--surface-3` | `#132334` | Hover/active surface state |
| `--line` | `#243346` | Hard borders, form dividers, rule lines |
| `--line-soft` | `rgba(120, 146, 176, 0.18)` | Default soft border — used on virtually every card |
| `--ink` | `#dbe7f4` | Primary text — headings, key values |
| `--muted` | `#8fa1b6` | Secondary text — labels, units, subtexts |
| `--green` | `#53d86a` | Profit, gains, success, positive deltas |
| `--amber` | `#f5a510` | Loot values, gold, warnings |
| `--red` | `#ff4f4f` | Supplies cost, losses, damage, errors |
| `--purple` | `#a855f7` | XP indicators, level badges |
| `--blue` | `#3b82f6` | Secondary accent, interactive elements |
| `--cyan` | `#2dd4bf` | Auxiliary teal accent, location status |

**Semantic aliases** (use these in preference to the raw colors):

| Alias | Resolves to |
|:---|:---|
| `--text` | `var(--ink)` |
| `--text-muted` | `var(--muted)` |
| `--border` | `var(--line)` |
| `--border-soft` | `var(--line-soft)` |
| `--accent` | `var(--blue)` |
| `--danger` | `var(--red)` |
| `--success` | `var(--green)` |
| `--warning` | `var(--amber)` |

**One-off values** — used in specific contexts, not for general use:

| Value | Context |
|:---|:---|
| `#58b7ff` | XP metric tile value color (`.metric-xp strong`) |
| `#7c3aed` | Second loot segment, monster progress bar fill |
| `#0a1622` | Donut chart hole background (`.loot-donut::after`) |
| `['#f5a510', '#7c3aed', '#ef4444', '#2dd4bf', '#8fa1b6']` | Loot segment color scale (index 0–4) |

### 1.2 Typography Scale

Never use arbitrary `font-size` values. Use the predefined scale tokens:

| Token | Value | When to use |
|:---|:---|:---|
| `--font-label` | `0.72rem` | Table column headers, smallest badge text, uppercase section sub-labels |
| `--font-caption` | `0.76rem` | Units, chart subtexts, timestamps, metric tile labels |
| `--font-small` | `0.82rem` | Helper text, hero stat labels, table body secondary text |
| `--font-body` | `0.86rem` | Standard reading text, table cells, form inputs |
| `--font-heading` | `0.95rem` | Panel titles, list headers |
| `--font-value` | `1.05rem` | Sub-metric highlights, hero stat values |
| *(tile value)* | `1.22rem` | Metric tile primary values (no token — use literal) |
| `--font-metric` | `1.28rem` | Main metric summaries (MetricCard) |
| *(verdict h2)* | `1.55rem` | Verdict label heading (no token — use literal) |

**Rules:**
- Table `th` elements: always `text-transform: uppercase; letter-spacing: 0.05em;`
- Numeric table columns: `text-align: right; font-variant-numeric: tabular-nums;` via `.num-col`
- `font-weight: 650` for panel headings; `font-weight: 800` for uppercase section sub-labels

### 1.3 Spacing Scale

| Token | Value | Typical use |
|:---|:---|:---|
| `--space-1` | `4px` | Icon-to-text gap, legend marker gap |
| `--space-2` | `6px` | Badge internal padding, tight row gaps |
| `--space-3` | `8px` | Component internal padding, standard grid gaps |
| `--space-4` | `10px` | Small card padding, inter-card gaps |
| `--space-5` | `12px` | Panel section gaps |
| `--space-6` | `14px` | Primary panel padding, analysis grid gaps |
| `--space-7` | `16px` | Large section margins, hero cell padding |

### 1.4 Radius

| Token | Value | Use |
|:---|:---|:---|
| `--radius-panel` | `8px` | Panels, cards, modal containers |
| `--radius-control` | `6px` | Buttons, inputs, badges |

---

## 2. Structural Layout

### 2.1 App Shell

```css
.app-shell {
  grid-template-columns: 244px minmax(0, 1fr);
}
.main-surface {
  padding: 12px 18px 24px;
}
.page-stack {
  display: grid;
  gap: 12px;
}
```

### 2.2 Hunt Intelligence Layout

```css
.hunt-intelligence {
  display: grid;
  gap: 14px;
}

/* Narrow-wide: e.g. Verdict + Key Metrics */
.hunt-command-grid {
  grid-template-columns: minmax(280px, 0.78fr) minmax(0, 1.42fr);
  gap: 14px;
}

/* Equal halves: e.g. Combat + Monster Analysis */
.analysis-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
```

**Responsive collapses** (scoped to HuntIntelligence):
- `<=1180px`: Both grids collapse to `1fr`; metric tile grid goes to 3 columns
- `<=720px`: Metric tiles/reason grid/combat metrics go to 2 columns; loot layout goes single column
- `<=480px`: All grids go single column

---

## 3. Reusable Component: Hunt Hero

> **Source**: [HuntHero.vue](file:///c:/code/Tibia%20market/ui-app/src/components/hunts/HuntHero.vue) (CSS classes globally in `style.css`)

The Hunt Hero is the page-level identity strip, modularized into `<HuntHero>`. It combines location identity on the left with five scannable stat cells on the right. It is a `.panel` that overrides the default panel padding to `0` and manages its own internal cell spacing.

### Usage

```vue
<HuntHero
  v-if="activePreview"
  :active-preview="activePreview"
  :active-saved-hunt="activeSavedHunt"
  :clean-display-text="hunts.cleanDisplayText"
  :format-value="formatValue"
  :format-signed="formatSigned"
/>
```

### Props

- `activePreview`: `Object` (required) — The current hunt preview data containing `parsed`, `saved_hunt`, etc.
- `activeSavedHunt`: `Object` (default: `null`) — The active saved hunt from parent database state.
- `cleanDisplayText`: `Function` (required) — Parent utility to clean location/spot names.
- `formatValue`: `Function` (required) — Utility to format generic numbers.
- `formatSigned`: `Function` (required) — Utility to format signed numbers (profit/loss).

### Global CSS Rules in `style.css` used by `<HuntHero>`

```css
.hunt-detail-hero {
  display: grid;
  grid-template-columns: minmax(260px, 1.8fr) repeat(5, minmax(130px, 1fr));
  gap: 0;
  padding: 0;
  overflow: hidden;
}

.hero-stat {
  border-left: 1px solid var(--line-soft);
}

.place-avatar {
  flex: 0 0 64px;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(145deg, rgba(59, 130, 246, 0.22), rgba(168, 85, 247, 0.22));
  border: 1px solid rgba(120, 146, 176, 0.28);
  color: #c7d7ff;
}

.hero-stat div    { display: grid; gap: 4px; min-width: 0; }
.hero-stat strong { font-size: var(--font-value); }
.hero-stat span   { color: var(--muted); font-size: var(--font-small); }
.hero-stat.profit strong { color: var(--green); }

.hero-token {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.xp-token {
  background: #245c9d;
  color: #d8ebff;
  font-weight: 800;
}

@media (max-width: 820px) {
  .hunt-detail-hero {
    grid-template-columns: 1fr 1fr;
  }
  .hunt-place-summary {
    grid-column: 1 / -1;
  }
}
```

---

## 4. Reusable Component: Hunt Verdict

> **Source**: [HuntVerdict.vue](file:///c:/code/Tibia%20market/ui-app/src/components/hunts/HuntVerdict.vue)

The Hunt Verdict card is a tone-driven status panel, modularized into `<HuntVerdict>`. The border color, heading color, and recommendation block all shift together based on a single verdict tone. This is the canonical pattern for any card that represents a qualitative outcome.

### Usage

```vue
<HuntVerdict
  :verdict="verdict"
  :recommendation="verdictRecommendation"
/>
```

### Props

- `verdict`: `Object` (required) — Verdict object containing `label`, `summary`, `tone`, and `tags`.
- `recommendation`: `Object` (default: `null`) — Recommendation details containing `label`, `reason`, and `tone`.

### Scoped CSS Rules inside `<HuntVerdict>`

```css
.verdict-panel {
  display: grid;
  gap: 12px;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
}

.verdict-panel              { border-color: rgba(83, 216, 106, 0.32); }
.verdict-warning,
.verdict-danger             { border-color: rgba(245, 165, 16, 0.42); }

.verdict-lockup {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.verdict-lockup h2 { font-size: 1.55rem; line-height: 1.08; color: var(--green); }

.verdict-warning .verdict-lockup h2,
.verdict-danger  .verdict-lockup h2 { color: var(--amber); }

.recommendation-hero {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(7, 17, 29, 0.46);
  padding: 10px;
}

.tone-positive { border-color: rgba(83, 216, 106, 0.30); background: rgba(83, 216, 106, 0.08); }
.tone-warning  { border-color: rgba(245, 165, 16, 0.32);  background: rgba(245, 165, 16, 0.08); }
.tone-neutral  { border-color: var(--line-soft);           background: rgba(120, 146, 176, 0.08); }

.recommendation-heading {
  color: var(--muted);
  font-size: var(--font-label);
  font-weight: 800;
  text-transform: uppercase;
}

.verdict-tags {
  align-self: end;
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.verdict-tags span {
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 5px 8px;
  font-size: var(--font-caption);
  font-weight: 700;
}

.tag-good    { border-color: rgba(83, 216, 106, 0.34); color: var(--green); }
.tag-neutral { border-color: rgba(245, 165, 16, 0.34); color: var(--amber); }
.tag-bad     { border-color: rgba(255, 79, 79, 0.34);  color: var(--red);   }
```

---

## 5. Reusable Component: Loot Analysis

> **Source**: [LootAnalysis.vue](file:///c:/code/Tibia%20market/ui-app/src/components/hunts/LootAnalysis.vue)

Loot Analysis is the most structurally complete panel in the app, modularized into `<LootAnalysis>`. It defines the standards for: panel variant usage, section header composition, two-column data layouts, item row structure, progress bars, donut charts, legends, and modal overflow.

### Usage

```vue
<LootAnalysis
  :loot-analysis="lootAnalysis"
  :loot-items="preview.loot_items || []"
  :adjusted-loot-gold="parsed.adjusted_loot_gold"
  :total-loot-gold="parsed.total_loot_gold"
  :format-value="formatValue"
  :item-image-path="itemImagePath"
  @open-item="$emit('open-item', $event)"
/>
```

### Props

- `lootAnalysis`: `Object` (required) — Main loot analysis metadata.
- `lootItems`: `Array` (required) — Raw list of loot items (`preview.loot_items`).
- `adjustedLootGold`: `Number` (default: `0`) — Net adjusted gold value.
- `totalLootGold`: `Number` (default: `0`) — Falling back total gold value.
- `formatValue`: `Function` (required) — Number formatter utility.
- `itemImagePath`: `Function` (required) — Image URL resolver utility.

### Events

- `@open-item`: Emits the `itemId` (string) of the clicked loot item to parent modals/dialog controllers.

### Scoped CSS Rules inside `<LootAnalysis>`

```css
.loot-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(260px, 0.78fr);
  gap: 14px;
  align-items: start;
}

.loot-summary-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.loot-summary-tiles > div {
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.46);
  padding: 10px;
}

.loot-summary-tiles strong { font-size: 1.18rem; }

.loot-chart-title {
  color: var(--muted);
  font-size: var(--font-label);
  text-transform: uppercase;
}

.loot-breakdown-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) auto 54px;
  gap: 8px;
  align-items: center;
  width: 100%;
  min-height: 46px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.34);
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
}

.loot-breakdown-row .bar-track {
  grid-column: 1 / -1;
}

.bar-track {
  display: block;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(120, 146, 176, 0.18);
}

.bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.loot-item-image        { width: 24px; height: 24px; object-fit: contain; }
.loot-image-placeholder { width: 24px; height: 24px; border-radius: 4px; background: var(--surface-3); }
.loot-value             { color: var(--amber); }

.donut-wrap {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.loot-donut {
  position: relative;
  display: grid;
  place-items: center;
  width: 126px;
  height: 126px;
  border-radius: 50%;
}

.loot-donut::after {
  content: "";
  position: absolute;
  inset: 24px;
  border-radius: 50%;
  background: #0a1622;
  border: 1px solid var(--line-soft);
}

.loot-donut span  { z-index: 1; align-self: end;  font-weight: 800; }
.loot-donut small { z-index: 1; align-self: start; color: var(--muted); }

.loot-legend {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.legend-row i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.rarity-highlights b {
  color: var(--muted);
  font-size: var(--font-label);
  text-transform: uppercase;
}

.rarity-row em {
  font-style: normal;
  font-size: var(--font-label);
  padding: 2px 5px;
  border-radius: 5px;
  border: 1px solid rgba(83, 216, 106, 0.26);
  background: rgba(83, 216, 106, 0.08);
  color: var(--green);
}

.loot-breakdown-card {
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.34);
  padding: 12px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 10, 18, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.full-loot-list {
  max-height: 68vh;
  overflow-y: auto;
}
```

---

## 6. Shared Components

These components are pre-built and must be used directly. Do not re-implement their visual behaviour inline.

### 6.1 Panel

```vue
<Panel />                   <!-- default panel -->
<Panel variant="analysis">  <!-- gradient bg + shadow -->
<Panel variant="table">     <!-- compact -->
```

Default panel CSS:
```css
.panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(21,32,45,0.96), rgba(12,23,34,0.96));
  box-shadow: 0 16px 40px rgba(0,0,0,0.18);
  padding: 14px;
}
```

### 6.2 SectionHeader

```vue
<SectionHeader
  title="Loot Analysis"
  subtitle="Optional sub-label"
  :icon="IconCoins"
  iconColor="var(--amber)"
>
  <ConfidenceBadge :confidence="..." />
</SectionHeader>
```

**Canonical icon/color pairings:**

| Icon | Color | Used for |
|:---|:---|:---|
| `IconCoins` | `var(--amber)` | Loot / gold |
| `IconSwords` | `var(--red)` | Combat / kills |
| `IconShield` | `var(--blue)` | Defence / safety |
| `IconTrophy` | `var(--amber)` | Verdict / results |
| `IconChartBar` | `var(--cyan)` | Statistics |
| `IconPaw` | `var(--muted)` | Monster analysis |
| `IconTrendingUp` | `var(--green)` | XP / progression |

### 6.3 MetricCard / MetricGrid

```vue
<MetricGrid :columns="6">
  <MetricCard label="Profit" :value="12500" tone="positive" />
  <MetricCard label="XP"     :value="820000" tone="xp" />
  <MetricCard label="Loot"   :value="67000"  tone="loot" />
</MetricGrid>
```

Tone to color mapping:

| Tone | Color |
|:---|:---|
| `positive` | `var(--green)` |
| `xp` | `#58b7ff` |
| `loot` | `var(--amber)` |
| `danger` | `var(--red)` |
| `blue` | `var(--blue)` |
| `teal` | `var(--cyan)` |

### 6.4 ConfidenceBadge

```vue
<ConfidenceBadge :confidence="lootAnalysis.confidence" />
```

| Level | Appearance |
|:---|:---|
| `high` | Green border/bg |
| `medium` | Amber border/bg |
| `low` / `unknown` | Red border/bg |

### 6.5 TablerIcon

```vue
<TablerIcon :name="IconCoins" :size="18" :stroke="2" color="var(--amber)" />
```

Default size: `18`. Default stroke: `2`.

### 6.6 DataTable

```vue
<DataTable :columns="cols" :items="rows" :page-size="20" emptyTitle="No items found">
  <template #row="{ item }"> ... </template>
</DataTable>
```

Table styling rules:
- `th`: `text-transform: uppercase; letter-spacing: 0.05em;`
- Numeric columns: add `.num-col` for `text-align: right; font-variant-numeric: tabular-nums;`
- `tr:hover`: `background: rgba(255, 255, 255, 0.02)`

### 6.7 EntityLinkPill

```vue
<EntityLinkPill :name="item.name" :image="itemImagePath(item)" @click="openItem(item)" />
<span class="pill entity-pill">{{ item.name }}</span>
```

### 6.8 DecisionLabels

```vue
<DecisionLabels :reasons="['Strong profit']" :warnings="['High supply cost']" :limit="4" />
```

Reasons render as `.pill`; warnings render as `.pill.warning-pill` with `IconAlertTriangle`.

---

## 7. Metric Tiles (Inline Pattern)

Used when a Panel needs its own metric tile grid rather than using `MetricCard`.

```html
<div class="metric-tile-grid">
  <div class="metric-tile metric-good">
    <span>Profit</span>
    <strong>+12,500 <small>gp</small></strong>
    <em>+8,300 <small>gp/hr</small></em>
    <b class="good">+15% vs avg</b>
  </div>
</div>
```

```css
.metric-tile-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.metric-tile {
  display: grid;
  gap: 6px;
  min-width: 0;
  min-height: 118px;
  justify-items: center;
  align-content: center;
  text-align: center;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.58);
  padding: 10px 8px;
}

.metric-tile span   { color: var(--muted); font-size: var(--font-caption); }
.metric-tile strong { font-size: 1.22rem; line-height: 1.1; }
.metric-tile em,
.metric-tile b      { color: var(--muted); font-size: var(--font-caption); font-style: normal; }

.metric-good  strong { color: var(--green); }
.metric-bad   strong { color: var(--red);   }
.metric-xp    strong { color: #58b7ff;      }
.metric-loot  strong { color: var(--amber); }

.good { color: var(--green); }
.bad  { color: var(--red);   }
```

---

## 8. Reason / Why-Scored Cards

Used in "Why This Hunt Scored This Way" and any context where a grid of contextual reasons is needed. Uses the same base structure as `.recommendation-hero`.

```html
<div class="reason-grid">
  <div class="reason-card severity-positive">
    <TablerIcon :name="IconCircleCheck" :size="18" />
    <div>
      <strong>High Kill Rate</strong>
      <span>Above average kills per hour for this location.</span>
    </div>
  </div>
</div>
```

```css
.reason-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.reason-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(7, 17, 29, 0.46);
  padding: 10px;
}

.severity-positive { border-color: rgba(83, 216, 106, 0.30); background: rgba(83, 216, 106, 0.08); }
.severity-warning  { border-color: rgba(245, 165, 16, 0.32);  background: rgba(245, 165, 16, 0.08); }
```

---

## 9. Status Badges

```css
.status-badge {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 8px;
  background: #0a1825;
  font-size: 0.78rem;
}
```

| Class | Color system | Used for |
|:---|:---|:---|
| `.confidence-high` / `.freshness-fresh` / `.job-success` | Green | Good / fresh / success |
| `.confidence-medium` / `.freshness-aging` / `.job-running` | Amber | Warning / aging / in-progress |
| `.confidence-low` / `.confidence-unknown` / `.freshness-stale` / `.job-error` | Red | Error / stale / unknown |
| `.location-linked` | Teal | Linked bestiary location |
| `.location-custom` | Amber | Custom location |

---

## 10. Empty & Alert States

When data is missing, use a dashed-border placeholder rather than blank space or plain text.

```html
<div class="incoming-damage-placeholder">
  <TablerIcon :name="IconAlertTriangle" :size="18" />
  <div>
    <strong>Incoming Damage Unavailable</strong>
    <span>Paste damage analyser text to enable this section.</span>
  </div>
</div>
```

```css
.incoming-damage-placeholder {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border: 1px dashed var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.24);
  padding: 14px 16px;
  color: var(--muted);
}
```

---

## 11. Animations & Transitions

The design is primarily state-based. Avoid gratuitous transitions.

```css
@keyframes spin { to { transform: rotate(360deg); } }

.tiny-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--line);
  border-top-color: var(--blue);
  border-radius: 50%;
  animation: spin 800ms linear infinite;
}

.spin-icon { animation: spin 800ms linear infinite; }

.nav-group-chevron { transition: transform 140ms ease; }
.nav-group.collapsed .nav-group-chevron { transform: rotate(-90deg); }
```

Button hover is instant (no transition):
```css
button:hover { border-color: #3b82f6; background: #1d3857; }
```

---

## 12. Modernisation Checklist

When updating an existing screen to match this design system:

1. **Borders** — Replace hard `--line` borders with `--line-soft` on card edges.
2. **Panel backgrounds** — Apply `variant="analysis"` to major data panels.
3. **Stat cards** — Replace legacy stat cards with the `.metric-tile` structure (centered, `min-height: 118px`, `rgba(8,18,30,0.58)` background).
4. **Contributor lists** — Replace simple `<ul>` lists with `.loot-breakdown-row` buttons that include inline progress bars.
5. **Empty states** — Replace blank sections with the dashed-border placeholder pattern (section 10).
6. **Numeric columns** — Ensure all numeric table columns use `font-variant-numeric: tabular-nums` via `.num-col`.
7. **Section labels** — Use `.loot-chart-title` (uppercase, `--font-label`, `--muted`) for all in-panel chart or sub-section headings.
8. **Qualitative outcomes** — Any panel representing a result or recommendation must use the tone system (`tone-positive`, `tone-warning`, `tone-neutral`) from the Verdict card.
