/** 通过真实菜单入口执行操作，兼容仍位于面板内的按钮。 */
export async function clickAction(page, selector) {
  const action = page.locator(selector);
  const triggerId = await action.evaluate(node => node.closest('[role="menu"]')?.getAttribute('aria-labelledby'));
  if (triggerId && await action.isHidden()) await page.locator(`#${triggerId}`).click();
  await action.click();
}
