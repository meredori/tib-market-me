import { api } from '../../lib/api'

export function useLootLogic(state, helpers) {
  function shouldLoadHistoryForItem(item) {
    if (!item?.item_id || item.history || state.historyByItemId[item.item_id]) {
      return false
    }
    const totalValue = Number(item.total_value || 0)
    const unitValue = Number(item.unit_value || 0)
    const confidence = Number(item.lookup?.confidence || 0)
    return totalValue >= 50000
      || item.loot_logic?.strategy === 'ignore'
      || item.loot_logic?.market_allowed === false
      || (unitValue >= 1000 && unitValue <= 15000 && confidence < 0.7)
  }

  function applyHistoryToPreview(preview, itemId, history) {
    if (!preview) {
      return
    }
    for (const item of preview.loot_items || []) {
      if (Number(item.item_id) === Number(itemId)) {
        item.history = history
      }
    }
  }

  function applyItemDetailToPreview(preview, normalizedName, itemDetail) {
    if (!preview) {
      return
    }
    for (const item of preview.loot_items || []) {
      if ((item.normalized_name || item.name) === normalizedName) {
        item.item_detail = itemDetail
        item.item_detail_status = itemDetail ? 'cached' : 'unavailable'
        if (!item.item_id && itemDetail?.item_ids?.length) {
          item.item_id = itemDetail.item_ids[0]
          item.resolved_name = itemDetail.actual_name || item.resolved_name || item.name
          loadItemHistory(item.item_id)
        }
        if (itemDetail?.weight_oz && !item.weight_oz) {
          item.weight_oz = itemDetail.weight_oz
          if (item.unit_value && itemDetail.weight_oz > 0) {
            item.gp_per_oz = Number((Number(item.unit_value) / Number(itemDetail.weight_oz)).toFixed(2))
          }
        }
      }
    }
  }

  function normalizeLootName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/^an?\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function applyAssignedItemToPreview(preview, rawName, alias) {
    if (!preview || !alias?.item_id) {
      return
    }
    const normalizedName = normalizeLootName(rawName)
    const itemDetail = alias.item || null
    for (const item of preview.loot_items || []) {
      const itemName = normalizeLootName(item.normalized_name || item.name)
      if (itemName !== normalizedName) {
        continue
      }
      item.item_id = alias.item_id
      item.resolved_name = itemDetail?.name || item.resolved_name || item.name
      item.item_detail = itemDetail || item.item_detail
      item.item_detail_status = itemDetail ? 'cached' : (item.item_detail_status || 'unavailable')
      if (itemDetail?.weight_oz && !item.weight_oz) {
        item.weight_oz = itemDetail.weight_oz
      }
      if (itemDetail?.loot_logic && !item.loot_logic) {
        item.loot_logic = itemDetail.loot_logic
      }
    }
  }

  function applyAssignedItemAlias(rawName, alias) {
    applyAssignedItemToPreview(state.huntPreview.value, rawName, alias)
    applyAssignedItemToPreview(state.previousHuntPreview.value, rawName, alias)
    applyAssignedItemToPreview(state.importHuntPreview.value, rawName, alias)
    if (alias?.item_id) {
      loadItemHistory(alias.item_id)
    }
    state.markUnsavedHuntChanges()
  }

  async function hydratePreviewItemDetails(preview) {
    const names = Array.from(new Set((preview?.loot_items || [])
      .filter((item) => item.item_detail_status === 'missing')
      .map((item) => item.name)
      .filter(Boolean)))

    if (!names.length) {
      return
    }

    try {
      const out = await api('/api/hunts/hydrate-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_names: names }),
      })
      for (const item of out.items || []) {
        applyItemDetailToPreview(state.huntPreview.value, item.normalized_name, item.item_detail)
        applyItemDetailToPreview(state.previousHuntPreview.value, item.normalized_name, item.item_detail)
        applyItemDetailToPreview(state.importHuntPreview.value, item.normalized_name, item.item_detail)
      }
      state.hydrationInfo.value = ''
    } catch (error) {
      state.hydrationInfo.value = `Item detail hydration failed: ${error.message}`
    }
  }

  async function loadItemHistory(itemId) {
    if (!itemId || state.historyByItemId[itemId] || state.historyLoadingByItemId[itemId]) {
      return
    }
    state.historyLoadingByItemId[itemId] = true
    try {
      const out = await api(`/api/item/${itemId}/history?start_days_ago=30`)
      state.historyByItemId[itemId] = out.history || null
      applyHistoryToPreview(state.huntPreview.value, itemId, state.historyByItemId[itemId])
      applyHistoryToPreview(state.previousHuntPreview.value, itemId, state.historyByItemId[itemId])
      applyHistoryToPreview(state.importHuntPreview.value, itemId, state.historyByItemId[itemId])
    } catch {
      state.historyByItemId[itemId] = null
    } finally {
      state.historyLoadingByItemId[itemId] = false
    }
  }

  function loadHistoryForPreview(preview) {
    const items = (preview?.loot_items || []).filter((item) => item.item_id)
    let candidates = items.filter(shouldLoadHistoryForItem)
    if (!candidates.length) {
      candidates = [...items]
        .filter((item) => !item.history && !state.historyByItemId[item.item_id])
        .sort((a, b) => Number(b.total_value || 0) - Number(a.total_value || 0))
        .slice(0, 4)
    } else {
      candidates = candidates
        .sort((a, b) => Number(b.total_value || 0) - Number(a.total_value || 0))
        .slice(0, 4)
    }
    for (const item of candidates) {
      loadItemHistory(item.item_id)
    }
  }

  async function setHuntItemExcluded(item, checked) {
    const normalizedName = item.normalized_name || item.name
    const next = new Set(state.excludedHuntItems.value)
    if (checked) {
      next.add(normalizedName)
    } else {
      next.delete(normalizedName)
    }
    state.excludedHuntItems.value = Array.from(next)
    state.markUnsavedHuntChanges()
    if (state.previousHuntPreview.value) {
      for (const lootItem of state.previousHuntPreview.value.loot_items || []) {
        if ((lootItem.normalized_name || lootItem.name) === normalizedName) {
          lootItem.excluded = checked
        }
      }
      return
    }
    if (state.importHuntPreview.value) {
      for (const lootItem of state.importHuntPreview.value.loot_items || []) {
        if ((lootItem.normalized_name || lootItem.name) === normalizedName) {
          lootItem.excluded = checked
        }
      }
      return
    }
    if (helpers.parseHuntText) {
      await helpers.parseHuntText(state.excludedHuntItems.value)
    }
  }

  function hideLootItem(item) {
    return setHuntItemExcluded(item, true)
  }

  function restoreLootItem(item) {
    return setHuntItemExcluded(item, false)
  }

  return {
    shouldLoadHistoryForItem,
    applyHistoryToPreview,
    applyItemDetailToPreview,
    normalizeLootName,
    applyAssignedItemToPreview,
    applyAssignedItemAlias,
    hydratePreviewItemDetails,
    loadItemHistory,
    loadHistoryForPreview,
    setHuntItemExcluded,
    hideLootItem,
    restoreLootItem,
  }
}
