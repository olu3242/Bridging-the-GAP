import { expect, test } from "@playwright/test";

/**
 * The implemented slice of the RC1 golden journey, plus the returning-user
 * state resolution the journey resolver owns.
 *
 * Auth cannot be stubbed without misrepresenting what was certified, so these
 * skip unless a Supabase project is configured.
 */
const supabaseConfigured =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

test.describe("golden journey", () => {
  test.skip(!supabaseConfigured, "Requires NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");

  test("landing → join → onboarding → dashboard on real persisted state", async ({ page }) => {
    const email = `e2e-${Date.now()}@btg.test`;

    // Entry is the landing CTA, not a direct URL.
    await page.goto("/");
    await page.getByRole("link", { name: /Start learning free/ }).click();
    await expect(page).toHaveURL(/\/join$/);

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

    // Step 4 — consent. Optional consents deliberately left unchecked.
    await expect(page.getByRole("heading", { name: "Your data and AI" })).toBeVisible();
    await page.getByRole("button", { name: /Finish/ }).click();

    // The baseline gate is now the next stage of the canonical lifecycle.
    await expect(page).toHaveURL(/\/baseline$/);
    await page.goto("/baseline");
    await expect(page.getByRole("heading", { name: "Where you stand with AI" })).toBeVisible();
  });

  test("baseline: onboarding hands over to the diagnostic, which writes a real profile", async ({ page }) => {
    const email = `e2e-baseline-${Date.now()}@btg.test`;

    await page.goto("/join");
    await page.getByLabel("Name").fill("Baseline Learner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("btg-e2e-password");
    await page.getByRole("button", { name: "Create account" }).click();

    // Onboarding
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByLabel("Display name").fill("Baseline Learner");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /Learner/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Your main goal").fill("Understand applied AI");
    await page.getByLabel("Hours per week").fill("6");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Finish/ }).click();

    // The baseline gate now owns the journey, not the dashboard.
    await expect(page).toHaveURL(/\/baseline$/);
    await expect(page.getByRole("heading", { name: "Where you stand with AI" })).toBeVisible();
    await page.getByRole("button", { name: /Start the baseline/ }).click();

    // Answer every question the adaptive walk serves.
    for (let i = 0; i < 20; i += 1) {
      if (!page.url().includes("/baseline") || page.url().includes("/results")) break;
      const options = page.locator('input[name="option"]');
      if ((await options.count()) === 0) break;
      await options.first().check();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForLoadState("networkidle");
    }

    await expect(page).toHaveURL(/\/baseline\/results/);
    await expect(page.getByRole("heading", { name: "Where you stand" })).toBeVisible();
    await expect(page.getByText("Baseline recorded")).toBeVisible();
    // Levels shown are measured, not placeholders.
    await expect(page.getByText(/competencies at target/)).toBeVisible();

    // The gate is satisfied, so the product opens up.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Your baseline" })).toBeVisible();
  });

  test("a learner who has not sat the baseline cannot reach the dashboard", async ({ page }) => {
    const email = `e2e-gate-${Date.now()}@btg.test`;

    await page.goto("/join");
    await page.getByLabel("Name").fill("Gated Learner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("btg-e2e-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await page.getByLabel("Display name").fill("Gated Learner");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /Learner/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Your main goal").fill("Get started");
    await page.getByLabel("Hours per week").fill("4");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Finish/ }).click();

    await expect(page).toHaveURL(/\/baseline$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/baseline$/);
    await page.goto("/organizations");
    await expect(page).toHaveURL(/\/baseline$/);
  });

  test("outcomes report measured records, never a projection", async ({ page }) => {
    const email = `e2e-outcomes-${Date.now()}@btg.test`;

    await page.goto("/join");
    await page.getByLabel("Name").fill("Outcome Learner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("btg-e2e-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await page.getByLabel("Display name").fill("Outcome Learner");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /Learner/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Your main goal").fill("Prove what I can do");
    await page.getByLabel("Hours per week").fill("8");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Finish/ }).click();

    // Sit the baseline so there is something real to report.
    await expect(page).toHaveURL(/\/baseline$/);
    await page.getByRole("button", { name: /Start the baseline/ }).click();
    for (let i = 0; i < 20; i += 1) {
      if (!page.url().includes("/baseline") || page.url().includes("/results")) break;
      const options = page.locator('input[name="option"]');
      if ((await options.count()) === 0) break;
      await options.first().check();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForLoadState("networkidle");
    }

    await page.goto("/outcomes");
    await expect(page.getByRole("heading", { name: "Your outcomes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Skill to opportunity/ })).toBeVisible();
    // The milestone list is read from the ledger, so a just-measured baseline
    // must already appear in it.
    await expect(page.getByText("Baseline measured").first()).toBeVisible();
    // Nothing is claimed that has not happened: no credential yet.
    await expect(page.getByText("Earned a credential")).toHaveCount(0);
  });

  test("a partner CTA pre-selects that persona in onboarding", async ({ page }) => {
    const email = `e2e-partner-${Date.now()}@btg.test`;

    await page.goto("/");
    await page.getByRole("link", { name: /Partner with BTG AI/ }).click();
    await expect(page).toHaveURL(/intent=employer/);

    await page.getByLabel("Name").fill("E2E Employer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("btg-e2e-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("radio", { name: /Employer/ })).toBeChecked();
  });

  test("a part-onboarded learner is returned to onboarding, not the dashboard", async ({ page }) => {
    const email = `e2e-partial-${Date.now()}@btg.test`;

    await page.goto("/join");
    await page.getByLabel("Name").fill("Partial Learner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("btg-e2e-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    // Asking for the dashboard mid-onboarding must not grant it.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.goto("/organizations");
    await expect(page).toHaveURL(/\/onboarding$/);

    // And the landing's log-in CTA resolves to the outstanding gate.
    await page.goto("/sign-in");
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});

test.describe("route regression", () => {
  // The proxy is intentionally inert without a Supabase project: there is no
  // session to read, so it cannot decide anything.
  test("protected routes redirect an anonymous visitor to sign in", async ({ page }) => {
    test.skip(!supabaseConfigured, "The session proxy needs a configured Supabase project.");
    for (const route of ["/dashboard", "/onboarding", "/organizations", "/outcomes", "/access", "/contributions", "/challenges", "/capabilities", "/governance", "/intelligence"]) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=%2F${route.slice(1)}`));
    }
  });

  test("public routes stay reachable", async ({ page }) => {
    for (const [route, heading] of [
      ["/", "Learn AI. Build with AI.Prove what you can do."],
      ["/join", "Create your BTG account"],
      ["/sign-in", "Welcome back"],
    ] as const) {
      await page.goto(route);
      await expect(page.locator("h1, h3").filter({ hasText: heading }).first()).toBeVisible();
    }
  });
});
