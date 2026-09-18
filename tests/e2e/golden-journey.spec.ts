import { expect, test } from "@playwright/test";

/**
 * W01's slice of the RC1 golden journey:
 *   join -> profile provisioned -> onboarding (4 steps) -> dashboard shows the
 *   learner's own persisted goal, audit trail and notification.
 *
 * It needs a live Supabase project (auth is not something we can stub without
 * lying about what was certified), so it skips when the project is not
 * configured and the run reports that honestly.
 */
const supabaseConfigured =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

test.describe("golden journey — W01", () => {
  test.skip(!supabaseConfigured, "Requires NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");

  test("a new learner can join, onboard and land on a real dashboard", async ({ page }) => {
    const email = `e2e-${Date.now()}@btg.test`;

    await page.goto("/join");
    await page.getByLabel("Name").fill("E2E Learner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("btg-e2e-password");
    await page.getByRole("button", { name: "Create account" }).click();

    // Step 1 — profile
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Who you are" })).toBeVisible();
    await page.getByLabel("Display name").fill("E2E Learner");
    await page.getByLabel("Country").fill("NG");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2 — persona
    await expect(page.getByRole("heading", { name: "How you'll use BTG" })).toBeVisible();
    await page.getByRole("radio", { name: /Learner/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3 — goals
    await expect(page.getByRole("heading", { name: "What you're working towards" })).toBeVisible();
    await page.getByLabel("Your main goal").fill("Land a backend engineering internship");
    await page.getByLabel("Hours per week").fill("12");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 4 — consent. The optional ones stay unchecked on purpose.
    await expect(page.getByRole("heading", { name: "Your data and AI" })).toBeVisible();
    await page.getByRole("button", { name: /Finish/ }).click();

    // Dashboard renders persisted state, not placeholders.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Land a backend engineering internship")).toBeVisible();
    await expect(page.getByText("Your BTG pathway is ready to start")).toBeVisible();
    await expect(page.getByText("identity.onboarding.completed")).toBeVisible();
  });

  test("an unauthenticated visitor cannot reach the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);
  });
});
