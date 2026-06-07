# Follow-Up Tasks

1. Complete the deeper hunt analyser module split beyond the extracted shared types:
   - Move parser helpers into `server/src/lib/hunts/parser.ts`.
   - Move item detail cache fetch/save logic into `server/src/lib/hunts/itemDetailCache.ts`.
   - Move loot lookup/enrichment/suggestions into `server/src/lib/hunts/lootEnrichment.ts`.
   - Move hunt upload persistence into `server/src/lib/hunts/repository.ts`.

2. Add focused backend tests for hunt preview behavior:
   - Cache-first parse should not call remote item detail fetches.
   - Missing item details should return `item_detail_status: "missing"`.
   - Hydration should fetch/cache details and return normalized names.
   - Unknown-value suggestions should stay visible.

3. Add frontend coverage or a lightweight smoke harness for the Hunt Analyser flow:
   - Parse preview.
   - Hydrate missing item details.
   - Hide/restore loot rows.
   - Open, edit, save, and delete previous hunts.

4. Consider showing item-detail hydration state in the UI:
   - Distinguish cached, missing, and unavailable details in loot rows.
   - Avoid overwriting the main hunt status message for background hydration failures.

5. Decide whether internal JSON parity exports are still needed:
   - If not, remove `itemsprices.json`, `itemsprices.detailed.json`, and `itemsprices.meta.json` generation from `exportJsonFiles`.
   - Update `getStatus.files` and docs after that decision.

6. Continue reducing `ui-app/src/App.vue`:
   - Extract item lookup state into `useItemLookup`.
   - Extract hunt state into `useHunts`.
   - Split tab bodies into dedicated components once the composables are stable.
