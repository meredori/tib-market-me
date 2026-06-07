export function formatValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 'n/a'
  }
  return new Intl.NumberFormat('en-US').format(numeric)
}

export function formatSigned(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  const rendered = new Intl.NumberFormat('en-US').format(Math.abs(Math.round(numeric)))
  return `${numeric >= 0 ? '+' : '-'}${rendered}`
}

export function formatPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  return `${numeric.toFixed(2)}%`
}

export function itemImagePath(itemId) {
  return itemId ? `/items/${itemId}.png` : ''
}
