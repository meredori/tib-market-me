const { expect, test } = require('@playwright/test')

const screens = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'hunts', label: 'Hunt Details' },
  { id: 'history', label: 'Hunt History' },
  { id: 'place', label: 'Places' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'market', label: 'Market' },
  { id: 'loot', label: 'Loot Inbox' },
  { id: 'taskboard', label: 'Taskboard' },
  { id: 'bestiary', label: 'Bestiary' },
  { id: 'settings', label: 'Settings' },
]

async function expectedHuntCount(page) {
  return await expectedItemCount(page, '/api/hunts')
}

async function expectedPlaceTotal(page) {
  const total = await page.evaluate(async () => {
    const response = await fetch('/api/hunting-places?limit=300')
    if (!response.ok) {
      throw new Error(`Unable to load visual wait data from /api/hunting-places: HTTP ${response.status}`)
    }
    const payload = await response.json()
    return payload.summary?.total ?? payload.items?.length ?? 0
  })
  return Number(total || 0)
}

async function expectedRecommendationCount(page) {
  return await expectedItemCount(page, '/api/hunt-recommendations?mode=balanced&limit=12')
}

async function expectedBestiaryChecklistCount(page) {
  const total = await page.evaluate(async () => {
    const response = await fetch('/api/bestiary')
    if (!response.ok) {
      throw new Error(`Unable to load visual wait data from /api/bestiary: HTTP ${response.status}`)
    }
    const payload = await response.json()
    return payload.summary?.checklist ?? 0
  })
  return Number(total || 0).toLocaleString()
}

async function expectedItemCount(page, url) {
  const rows = await page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint)
    if (!response.ok) {
      throw new Error(`Unable to load visual wait data from ${endpoint}: HTTP ${response.status}`)
    }
    const payload = await response.json()
    return payload.items || []
  }, url)
  return Array.isArray(rows) ? rows.length : 0
}

async function waitForScreenData(page, screen) {
  if (screen.id === 'history') {
    const huntCount = await expectedHuntCount(page)
    await expect(page.getByText(`${huntCount} of ${huntCount} hunt(s)`)).toBeVisible()
  }

  if (screen.id === 'place') {
    const placeCount = await expectedPlaceTotal(page)
    await expect(page.getByText('Loading...')).toHaveCount(0)
    await expect(page.getByText(`${placeCount} hunting spots`)).toBeVisible()
  }

  if (screen.id === 'recommendations') {
    const recommendationCount = await expectedRecommendationCount(page)
    await expect(page.getByText(`${recommendationCount} explainable pick(s)`)).toBeVisible()
  }

  if (screen.id === 'bestiary') {
    const checklistCount = await expectedBestiaryChecklistCount(page)
    await expect(page.getByText(`${checklistCount} left to check off`)).toBeVisible()
  }
}

async function openHuntDetails(page) {
  const huntCount = await expectedHuntCount(page)
  if (huntCount <= 0) {
    throw new Error('Hunt Details visual baseline requires at least one saved hunt.')
  }

  await page.getByRole('button', { name: 'Hunt History', exact: true }).click()
  await page.locator('.main-surface').waitFor({ state: 'visible' })
  await waitForScreenData(page, { id: 'history' })
  await page.locator('.history-leaders .leader-row').first().click()
  await page.getByRole('heading', { name: 'Hunt Details', exact: true }).waitFor({ state: 'visible' })
  await page.locator('.hunt-intelligence').waitFor({ state: 'visible' })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'visible' })
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }

      .tiny-spinner,
      .spin-icon {
        animation: none !important;
      }
    `,
  })
})

for (const screen of screens) {
  test(`${screen.label} visual baseline`, async ({ page }, testInfo) => {
    if (screen.id === 'hunts') {
      await openHuntDetails(page)
    } else {
      await page.getByRole('button', { name: screen.label, exact: true }).click()
    }
    await page.locator('.main-surface').waitFor({ state: 'visible' })
    await page.waitForTimeout(screen.id === 'market' ? 1_500 : 700)
    await waitForScreenData(page, screen)

    await expect(page).toHaveScreenshot(`${testInfo.project.name}-${screen.id}.png`)
  })
}
