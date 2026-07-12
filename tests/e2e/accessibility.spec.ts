import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicRoutes = ["/", "/demo", "/login", "/share"] as const;

for (const route of publicRoutes) {
  test(`${route} has no automatically detectable accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("#main-content")).toBeVisible();
    if (route === "/share") {
      await expect(page.getByRole("heading", { name: "공유 내용을 열 수 없습니다" })).toBeVisible();
    }

    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations,
      results.violations
        .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
        .join("\n"),
    ).toEqual([]);
  });
}

for (const width of [375, 768, 1024, 1440]) {
  test(`/demo remains operable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/demo");
    await expect(page.getByText("샘플 데이터", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "지식맵", exact: true }).click();
    const brainCanvas = page.getByTestId("brain-canvas");
    await expect(brainCanvas).toBeVisible();
    if (width <= 720) {
      await expect(page.getByRole("button", { name: "의미 목록" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "그래프 보기" }).click();
    }

    const canvasBox = await brainCanvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.x).toBeGreaterThanOrEqual(0);
    expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(width + 1);

    const firstNode = brainCanvas.locator(".brain-node").first();
    const firstNodeId = await firstNode.getAttribute("data-testid");
    await firstNode.focus();
    await page.keyboard.press("ArrowRight");
    const focusedNode = brainCanvas.locator(".brain-node:focus");
    await expect(focusedNode).toHaveCount(1);
    expect(await focusedNode.getAttribute("data-testid")).not.toBe(firstNodeId);
    await page.keyboard.press("Enter");
    await expect(focusedNode).toHaveAttribute("aria-pressed", "true");

    const brainResults = await new AxeBuilder({ page })
      .include('[data-testid="brain-canvas"]')
      .analyze();
    expect(
      brainResults.violations,
      brainResults.violations
        .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
        .join("\n"),
    ).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const undersizedControls = await page
      .locator("a[href]:visible, button:visible, input:visible, textarea:visible, select:visible, [role='tab']:visible, [role='button']:visible")
      .evaluateAll((elements) => elements
        .map((element) => {
          const input = element instanceof HTMLInputElement ? element : null;
          const target = input && ["checkbox", "radio"].includes(input.type)
            ? input.closest("label") || input
            : element;
          const rect = target.getBoundingClientRect();
          return {
            label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .filter(({ width: controlWidth, height }) => controlWidth < 44 || height < 44));
    expect(undersizedControls, JSON.stringify(undersizedControls, null, 2)).toEqual([]);

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeAttached();
  });
}

test("skip link moves keyboard focus to the main content", async ({ page }) => {
  await page.goto("/demo");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "본문으로 건너뛰기" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("mobile navigation exposes state and closes with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const menu = page.getByRole("button", { name: "메뉴" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();

  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
});
