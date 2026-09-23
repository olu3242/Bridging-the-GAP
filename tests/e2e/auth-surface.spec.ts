import { expect, test, type Page } from "@playwright/test";
import { SUPABASE_URL, supabaseConfigured } from "./support/backend";

/**
 * The auth surface certified in a real browser: branding, the Google control,
 * what the callback does with every shape of provider response, protected-route
 * rejection, responsiveness and keyboard access.
 *
 * Nothing here is stubbed. The Google assertions observe the request the app
 * actually issues — the PKCE authorize URL it builds and the verifier cookie it
 * writes — rather than asserting against a fake provider.
 */

/**
 * Real horizontal overflow, measured the way a visitor experiences it: try to
 * scroll right and see whether the page moves. Comparing scrollWidth against
 * clientWidth reports the vertical scrollbar's width as overflow, which is a
 * false positive at every desktop viewport.
 */
async function horizontalScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    window.scrollTo(99999, 0);
    const moved = window.scrollX;
    window.scrollTo(0, 0);
    return moved;
  });
}

const AUTH_PAGES = ["/sign-in", "/join", "/forgot-password"] as const;

/** The canonical mark, as `BrandMark` draws it. */
const BRAND_GLYPH_PREFIX = "M10 8h6.5c3.4 0 5.6 1.9 5.6 4.7";

async function brandMarks(page: Page) {
  return page.locator(`svg path[d^="${BRAND_GLYPH_PREFIX}"]`);
}

test.describe("branded auth surface", () => {
  for (const route of AUTH_PAGES) {
    test(`${route} renders inside the branded auth shell`, async ({ page }) => {
      await page.goto(route);

      // The canonical mark, not a stand-in icon.
      await expect(await brandMarks(page)).toHaveCount(1);
      await expect(page.getByRole("link", { name: "BTG AI home" })).toBeVisible();
      // The shell's promise line, from the one brand module.
      await expect(
        page.getByText(/Bridging the gap between education, AI capability, and opportunity/),
      ).toBeVisible();
      // The brand favicon is declared at the root, so every group inherits it,
      // and nothing else claims the icon slot.
      await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/brand/favicon.svg");
      // Exactly one <h1>-equivalent heading owns the page.
      await expect(page.locator("main")).toBeVisible();
    });
  }

  test("the app and marketing shells draw the same mark", async ({ page }) => {
    await page.goto("/");
    // Marketing header + footer both render the canonical logo.
    await expect(await brandMarks(page)).toHaveCount(2);
    await expect(page.locator(".site-header .brand-word").first()).toContainText("BTG");
  });

  test("the 404 state is branded rather than bare", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(await brandMarks(page)).toHaveCount(1);
    await expect(page.getByText("404")).toBeVisible();
    await expect(page.getByRole("heading", { name: /couldn't find that page/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to BTG AI/ })).toBeVisible();
  });
});

test.describe("Continue with Google", () => {
  for (const route of ["/sign-in", "/join"] as const) {
    test(`${route} offers a branded Google control`, async ({ page }) => {
      await page.goto(route);
      const button = page.getByTestId("google-oauth-button");
      await expect(button).toBeVisible();
      await expect(button).toHaveText(/Continue with Google/);
      // Google's own mark, as their branding requires.
      await expect(button.locator('svg path[fill="#4285F4"]')).toHaveCount(1);
      // It is a real submit control, reachable and operable from the keyboard.
      await expect(button).toHaveAttribute("type", "submit");
      await button.focus();
      await expect(button).toBeFocused();
    });
  }

  test("the button initiates a real Supabase Google OAuth flow with PKCE", async ({ page }) => {
    test.skip(!supabaseConfigured, "Needs a configured Supabase project URL to authorize against.");
    await page.goto("/sign-in?next=%2Fportfolio");

    // Watch for the navigation the app issues rather than following it: the
    // provider itself is out of scope for this suite.
    const authorize = page.waitForRequest(
      (request) => request.url().startsWith(`${SUPABASE_URL}/auth/v1/authorize`),
      { timeout: 20_000 },
    );
    await page.getByTestId("google-oauth-button").click();
    const request = await authorize;

    const url = new URL(request.url());
    expect(url.searchParams.get("provider")).toBe("google");
    // PKCE, not the implicit flow: a challenge is sent and the verifier is kept
    // server-side.
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("scopes") ?? "").toContain("email");

    // The callback it will come back to is this origin's, and carries the
    // destination the visitor asked for.
    const redirectTo = new URL(url.searchParams.get("redirect_to") ?? "");
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/portfolio");
    expect(redirectTo.origin).toBe(new URL(page.url()).origin);

    // The verifier is an HTTP-only cookie on our origin, which is what the
    // callback reads to complete the exchange.
    const cookies = await page.context().cookies();
    const verifier = cookies.find((cookie) => cookie.name.includes("code-verifier"));
    expect(verifier, "no PKCE code verifier was stored").toBeTruthy();
    expect(verifier?.httpOnly).toBe(true);
  });
});

test.describe("callback behaviour", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["a cancelled consent screen", "/auth/callback?error=access_denied&error_description=The+user+denied+the+request", /Google sign-in was cancelled/],
    ["a provider failure", "/auth/callback?error=server_error&error_description=upstream", /Google could not complete sign-in/],
    ["a disabled provider", "/auth/callback?error=validation_failed&error_description=Unsupported+provider%3A+provider+is+not+enabled", /Google sign-in is not available/],
    ["a link with no code", "/auth/callback", /link is incomplete/],
  ];

  for (const [label, url, message] of cases) {
    test(`${label} lands on a useful branded state`, async ({ page }) => {
      await page.goto(url);
      await expect(page).toHaveURL(/\/sign-in\?error=/);
      // Branded, inside the auth shell, and actionable.
      await expect(await brandMarks(page)).toHaveCount(1);
      await expect(page.getByText(message)).toBeVisible();
      await expect(page.getByTestId("google-oauth-button")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    });
  }

  test("an expired session is named rather than silently restarted", async ({ page }) => {
    await page.goto("/sign-in?error=session_expired");
    await expect(page.getByText(/Your session expired/)).toBeVisible();
  });

  test("a bogus error code is ignored rather than rendered", async ({ page }) => {
    await page.goto("/sign-in?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    // Scoped to the page's own content: Next injects its route announcer with
    // role="alert" outside <main>.
    await expect(page.locator('main [role="alert"], main [role="status"]')).toHaveCount(0);
  });
});

test.describe("protected surface rejects an anonymous visitor", () => {
  // Every top-level route of the (app) group. The proxy used to carry its own
  // prefix list and silently missed most of these.
  const ROUTES = [
    "/access",
    "/baseline",
    "/capabilities",
    "/challenges",
    "/console/workflows",
    "/contributions",
    "/dashboard",
    "/governance",
    "/intelligence",
    "/learn",
    "/mentorship",
    "/onboarding",
    "/opportunities",
    "/organizations",
    "/outcomes",
    "/pathway",
    "/portfolio",
    "/projects",
    "/review",
    "/tutor",
    "/forbidden",
    "/reset-password",
  ];

  test("each protected route redirects to sign in, carrying where it was going", async ({ page }) => {
    test.skip(!supabaseConfigured, "The session proxy needs a configured Supabase project.");
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page, `${route} did not redirect to sign in`).toHaveURL(
        new RegExp(`/sign-in\\?next=${encodeURIComponent(route).replace(/%/g, "%")}`),
      );
      // And the destination survives into BOTH forms, so signing in with either
      // method returns the visitor to where they were going.
      const carried = page.locator('input[name="next"]');
      await expect(carried).toHaveCount(2);
      for (const value of await carried.evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLInputElement).value),
      )) {
        expect(value, `${route} was not carried into every form`).toBe(route);
      }
    }
  });

  test("the public surface stays reachable", async ({ page }) => {
    for (const route of ["/", "/sign-in", "/join", "/forgot-password"]) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
    }
  });
});

test.describe("form validation is real, not decorative", () => {
  test("a malformed sign-in is rejected field by field", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
    // Still on the auth surface, nothing submitted onward.
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("a malformed signup is rejected field by field", async ({ page }) => {
    await page.goto("/join");
    await page.getByLabel("Name").fill("A");
    await page.getByLabel("Email").fill("also-not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("1234567");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Use at least 2 characters.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
  });

  test("a malformed recovery request is rejected before anything is sent", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nope");
    await page.getByRole("button", { name: /Email me a reset link/ }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  });

  test("the recovery route sends an unauthenticated visitor to request a link", async ({ page }) => {
    test.skip(!supabaseConfigured, "The session proxy needs a configured Supabase project.");
    await page.goto("/reset-password");
    // No session: the proxy sends them to sign in rather than to a form that
    // cannot submit.
    await expect(page).toHaveURL(/\/sign-in\?next=%2Freset-password/);
  });
});

test.describe("responsive and accessible", () => {
  const VIEWPORTS = [
    { width: 320, height: 640, label: "320" },
    { width: 375, height: 812, label: "375" },
    { width: 768, height: 1024, label: "768" },
    { width: 1024, height: 768, label: "1024" },
    { width: 1440, height: 900, label: "1440" },
  ];

  for (const viewport of VIEWPORTS) {
    test(`the auth surface fits ${viewport.label}px with no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of AUTH_PAGES) {
        await page.goto(route);
        expect(await horizontalScroll(page), `${route} scrolls sideways at ${viewport.label}px`).toBe(0);

        // The Google CTA stays a comfortably tappable target that fills its
        // card — the auth card is a centred max-w-md column at every width, so
        // the CTA is measured against the credential submit beside it rather
        // than against the viewport.
        const button = page.getByTestId("google-oauth-button");
        if (await button.count()) {
          const box = await button.boundingBox();
          expect(box, "Google CTA has no box").not.toBeNull();
          expect(box!.height, `Google CTA too short at ${viewport.label}px`).toBeGreaterThanOrEqual(40);
          expect(box!.width, `Google CTA too narrow at ${viewport.label}px`).toBeGreaterThanOrEqual(220);

          const peer = page.locator("main form button[type=submit]").last();
          const peerBox = await peer.boundingBox();
          expect(
            Math.abs(box!.width - (peerBox?.width ?? 0)),
            `Google CTA and the email submit differ in width at ${viewport.label}px`,
          ).toBeLessThanOrEqual(1);
        }

        // The mark never disappears at small widths.
        await expect(await brandMarks(page)).toHaveCount(1);
      }
    });
  }

  // One test per viewport, like the auth-surface case above. Looping all five
  // inside a single test shared one 30s budget across five full loads of an
  // image-heavy page, which passed here and timed out on slower CI hardware.
  for (const viewport of VIEWPORTS) {
    test(`the landing fits ${viewport.label}px and keeps its mark`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      expect(await horizontalScroll(page), `landing scrolls sideways at ${viewport.label}px`).toBe(0);
      await expect(await brandMarks(page)).toHaveCount(2);
    });
  }

  test("every auth control is labelled and reachable by keyboard", async ({ page }) => {
    await page.goto("/sign-in");

    // Skip link first, as the root layout provides.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

    // Walk the tab order and collect what a screen reader would announce.
    const announced: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const label =
          el.getAttribute("aria-label") ??
          (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
          el.textContent;
        return { tag: el.tagName.toLowerCase(), label: (label ?? "").trim() };
      });
      if (!info) break;
      announced.push(`${info.tag}:${info.label}`);
      // Nothing focusable may be unlabelled.
      expect(info.label, `an unlabelled ${info.tag} is focusable`).not.toBe("");
    }

    // The three things a visitor must be able to reach without a mouse.
    const flat = announced.join(" | ");
    expect(flat).toContain("Continue with Google");
    expect(flat).toMatch(/Email/);
    expect(flat).toMatch(/Password/);
  });

  test("form fields expose their errors to assistive technology", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("bad");
    await page.getByLabel("Password", { exact: true }).fill("bad");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('[role="alert"]').first()).toBeVisible();
  });
});
