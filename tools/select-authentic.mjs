// Select through the real chooser, then wait for its reload to finish.
export async function selectAuthentic(page) {
  await page.locator('#asset-mode-authentic').waitFor({ state: 'visible', timeout: 20000 });
  await Promise.all([
    page.waitForEvent('load', { timeout: 20000 }),
    page.locator('#asset-mode-authentic').click(),
  ]);
  await page.waitForFunction(() =>
    localStorage.getItem('assetMode') === 'authentic' &&
    document.documentElement.dataset.assetMode === 'authentic' &&
    document.getElementById('asset-mode-screen')?.hidden &&
    window.__state?.manifest,
    null, { timeout: 20000 });
}
