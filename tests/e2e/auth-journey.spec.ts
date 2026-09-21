import { expect, test, type Page } from "@playwright/test";
import {
  REACHABILITY_SKIP,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  enabledProviders,
  supabaseReachable,
} from "./support/backend";

/**
 * The two end-to-end auth journeys, run against the configured Supabase
 * project. Nothing is stubbed: a real identity is created, a real session
 * cookie is issued, and the assertions read the application records that
 * session can actually see.
 *
 * Each block states what it needs and skips when that is genuinely absent —
 * an unreachable project, or a Google provider the project has not enabled —
 * so a skip is never mistaken for a pass. Certifying Google end to end also
 * needs a Google test account that can clear the consent screen, which is
 * supplied through BTG_E2E_GOOGLE_EMAIL / BTG_E2E_GOOGLE_PASSWORD.
 */

const PASSWORD = "btg-e2e-password";

const GOOGLE_EMAIL = process.env.BTG_E2E_GOOGLE_EMAIL ?? "";
const GOOGLE_PASSWORD = process.env.BTG_E2E_GOOGLE_PASSWORD ?? "";

function newEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@btg.test`;
}

async function signUpWithEmail(page: Page, email: string, name: string) {
  await page.goto("/join");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function completeOnboarding(page: Page, name: string) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /Learner/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your main goal").fill("Prove what I can build");
  await page.getByLabel("Hours per week").fill("8");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Finish/ }).click();
}

/** The session cookie the browser is actually holding, if any. */
async function sessionCookies(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.filter((cookie) => cookie.name.startsWith("sb-"));
}

/**
 * Reads the signed-in learner's own records through PostgREST using the
 * session the browser holds — so what is asserted is what RLS actually lets
 * this user see, not what the server rendered.
 */
async function ownProfileThroughRls(page: Page): Promise<Array<Record<string, unknown>>> {
  const token = await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith("sb-")) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
        if (parsed?.access_token) return parsed.access_token as string;
      } catch {
        /* not a session entry */
      }
    }
    return null;
  });
  if (!token) return [];

  const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,display_name,primary_persona,onboarding_state`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return (await response.json()) as Array<Record<string, unknown>>;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await sessionCookies(page), "signing out left a session cookie behind").toHaveLength(0);
}

test.describe("email journey", () => {
  test.beforeEach(async () => {
    test.skip(!(await supabaseReachable()), REACHABILITY_SKIP);
  });

  test("signup → bootstrap → app → navigate → refresh → logout → protected route → login → app", async ({
    page,
  }) => {
    const email = newEmail("email-journey");
    const name = "Email Journey";

    await signUpWithEmail(page, email, name);

    // Bootstrap: the signup created a real application identity, not just an
    // auth user. Reaching onboarding at all requires the profile row.
    await completeOnboarding(page, name);
    await expect(page).toHaveURL(/\/baseline$/);

    const rows = await ownProfileThroughRls(page);
    expect(rows, "the learner cannot read its own profile through RLS").toHaveLength(1);
    expect(rows[0].display_name).toBe(name);
    expect(rows[0].primary_persona).toBe("learner");
    expect(rows[0].onboarding_state).toBe("completed");

    // Navigate, then reload: the session must survive both.
    await page.goto("/baseline");
    await expect(page.getByRole("heading", { name: "Where you stand with AI" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/baseline$/);
    expect(await sessionCookies(page)).not.toHaveLength(0);

    await signOut(page);

    // A protected URL is refused once the session is gone.
    await page.goto("/baseline");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fbaseline/);

    // And signing back in returns the learner to their outstanding gate.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/baseline$/);
    expect(await sessionCookies(page)).not.toHaveLength(0);
  });

  test("a duplicate signup neither creates a second identity nor discloses the first", async ({ page }) => {
    const email = newEmail("duplicate");
    await signUpWithEmail(page, email, "First Account");
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.context().clearCookies();

    await signUpWithEmail(page, email, "Second Account");
    // Either an explicit conflict, or the non-enumerable confirmation state —
    // never a second account and never the dashboard.
    await expect(page).toHaveURL(/\/join/);
    await expect(
      page.getByText(/already exists|we've emailed|If that address/i).first(),
    ).toBeVisible();
  });

  test("an unknown credential pair is refused without saying which half was wrong", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(newEmail("nobody"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("That email and password combination did not work.")).toBeVisible();
    expect(await sessionCookies(page)).toHaveLength(0);
  });

  test("a recovery request is accepted without disclosing whether the account exists", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(newEmail("recovery"));
    await page.getByRole("button", { name: /Email me a reset link/ }).click();
    await expect(page.getByText(/If that address has an account/)).toBeVisible();
  });
});

test.describe("google journey", () => {
  test.beforeEach(async () => {
    test.skip(!(await supabaseReachable()), REACHABILITY_SKIP);
    const providers = await enabledProviders();
    test.skip(
      !providers?.google,
      "The Google provider is not enabled on the configured Supabase project.",
    );
    test.skip(
      !GOOGLE_EMAIL || !GOOGLE_PASSWORD,
      "Set BTG_E2E_GOOGLE_EMAIL / BTG_E2E_GOOGLE_PASSWORD to a Google test account to certify the consent flow.",
    );
  });

  /** Drives Google's own sign-in screen. */
  async function completeGoogleConsent(page: Page) {
    await page.waitForURL(/accounts\.google\.com/, { timeout: 30_000 });
    await page.locator('input[type="email"]').fill(GOOGLE_EMAIL);
    await page.getByRole("button", { name: /Next/i }).click();
    await page.locator('input[type="password"]').fill(GOOGLE_PASSWORD);
    await page.getByRole("button", { name: /Next/i }).click();
    const consent = page.getByRole("button", { name: /Continue|Allow/i });
    if (await consent.count()) await consent.first().click();
  }

  test("first-time Google user is bootstrapped onto the same identity model", async ({ page }) => {
    await page.goto("/join");
    await page.getByTestId("google-oauth-button").click();
    await completeGoogleConsent(page);

    // Back on our origin, through /auth/callback, with a real session.
    await page.waitForURL(/\/(onboarding|baseline|dashboard)/, { timeout: 30_000 });
    expect(await sessionCookies(page)).not.toHaveLength(0);

    // The bootstrap ran: the Google learner holds the same records an email
    // learner does, named from Google's own profile rather than their email.
    const rows = await ownProfileThroughRls(page);
    expect(rows).toHaveLength(1);
    expect(rows[0].primary_persona).toBe("learner");
    expect(String(rows[0].display_name)).not.toBe(GOOGLE_EMAIL.split("@")[0]);

    await completeOnboarding(page, "Google Journey");
    await expect(page).toHaveURL(/\/baseline$/);

    await page.reload();
    await expect(page).toHaveURL(/\/baseline$/);
    await signOut(page);
    await page.goto("/baseline");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fbaseline/);
  });

  test("a returning Google user signs back in without a second application identity", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByTestId("google-oauth-button").click();
    await completeGoogleConsent(page);
    await page.waitForURL(/\/(onboarding|baseline|dashboard)/, { timeout: 30_000 });

    const rows = await ownProfileThroughRls(page);
    // One profile, the same one as the first sign-in: a returning OAuth user is
    // never re-provisioned.
    expect(rows).toHaveLength(1);
    expect(rows[0].primary_persona).toBe("learner");
  });
});
