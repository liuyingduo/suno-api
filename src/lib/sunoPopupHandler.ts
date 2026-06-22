import { Page } from 'playwright';

export async function closeKnownPopups(page: Page): Promise<void> {
  const popupButtons = [
    page.locator('#onetrust-reject-all-handler'),
    page.locator('#onetrust-accept-btn-handler'),
    page.locator('#onetrust-close-btn-container button')
  ];

  for (const button of popupButtons) {
    const visible = await button.first().isVisible({ timeout: 1_000 }).catch(() => false);
    if (!visible) {
      continue;
    }

    const clicked = await button.first().click({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) {
      continue;
    }

    await page.waitForTimeout(300);
    return;
  }
}
