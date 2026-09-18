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

    // The dashboard renders persisted state, not placeholders.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Land a backend engineering internship")).toBeVisible();
    await expect(page.getByText("Your BTG pathway is ready to start")).toBeVisible();
    await expect(page.getByText("identity.onboarding.completed")).toBeVisible();
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
    for (const route of ["/dashboard", "/onboarding", "/organizations"]) {
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
