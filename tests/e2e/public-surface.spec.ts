import { expect, test } from "@playwright/test";

/**
 * The public surface must work with no session and no Supabase round-trip:
 * it is the only page a first-time visitor sees.
 */
test.describe("public surface", () => {
  test("landing page explains the lifecycle and routes into the product", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("proof");
    for (const step of ["Diagnose", "Learn", "Build", "Prove", "Connect"]) {
      await expect(page.getByRole("heading", { name: step, exact: true })).toBeVisible();
    }

    await page.getByRole("link", { name: "Join BTG", exact: true }).click();
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByRole("heading", { name: "Create your BTG account" })).toBeVisible();
  });

  test("sign-in and join are reachable from each other", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/join$/);
  });

  test("the join form reports validation failures accessibly", async ({ page }) => {
    await page.goto("/join");
    await page.getByLabel("Name").fill("A");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    const alerts = page.getByRole("alert");
    await expect(alerts.first()).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });

  test("every page exposes a skip link and a single h1", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("unknown routes render the not-found page", async ({ page }) => {
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /couldn't find that page/i })).toBeVisible();
  });
});
