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
    await page.getByRole('button', { name: screen.label, exact: true }).click()
    await page.locator('.main-surface').waitFor({ state: 'visible' })
    await page.waitForTimeout(screen.id === 'market' ? 1_500 : 700)

    await expect(page).toHaveScreenshot(`${testInfo.project.name}-${screen.id}.png`)
  })
}
