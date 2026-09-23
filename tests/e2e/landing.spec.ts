import { expect, test } from "@playwright/test";

/**
 * Certifies the native landing against btg-ai-landing/index.html: canonical
 * copy and section order, real assets that actually resolve, live CTAs, and
 * the two interactive behaviours ported out of js/script.js.
 */
test.describe("canonical landing", () => {
  test("renders the canonical hero and section order", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Learn AI\. Build with AI\. Prove what you can do\./);
    await expect(page.locator("h1")).toHaveText("Learn AI. Build with AI.Prove what you can do.");
    await expect(page.getByText("For learners everywhere — built for global opportunity")).toBeVisible();

    const headings = await page.locator("main h2").allTextContents();
    expect(headings).toEqual([
      "A clear path from curious to career-ready",
      "Everything you need, none of the clutter",
      "One home base. Any device.",
      "More than learning.A bolder future.",
      "Built for the whole ecosystem",
      "Questions, answered",
    ]);
  });

  test("renders all five steps and all eight modules", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".steps .step")).toHaveCount(5);
    await expect(page.locator(".card-grid .feature-card")).toHaveCount(8);
    await expect(page.locator(".partner-grid .partner-card")).toHaveCount(3);
  });

  test("every canonical image actually loads", async ({ page }) => {
    await page.goto("/");
    // Scroll the full page so lazily-loaded imagery is requested.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");

    const broken = await page.evaluate(() =>
      Array.from(document.images)
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src),
    );
    expect(broken).toEqual([]);
    expect(await page.locator("img").count()).toBeGreaterThanOrEqual(11);
  });

  test("hero, header and banner CTAs enter the product", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/sign-in");
    await expect(page.getByRole("link", { name: /^Get started/ }).first()).toHaveAttribute(
      "href",
      "/join",
    );

    await page.getByRole("link", { name: /Start learning free/ }).click();
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByRole("heading", { name: "Create your BTG account" })).toBeVisible();
  });

  test("partner CTAs carry their persona intent into join", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Partner with BTG AI/ }).click();
    await expect(page).toHaveURL(/\/join\?intent=employer$/);
    await expect(page.locator('input[name="intent"]')).toHaveValue("employer");
  });

  test("no CTA is dead: every href resolves to a real route or section", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator("a[href]").evaluateAll((links) =>
      Array.from(new Set(links.map((link) => link.getAttribute("href") ?? ""))),
    );

    const sectionIds = await page.locator("[id]").evaluateAll((nodes) =>
      nodes.map((node) => node.id),
    );
    const realRoutes = ["/", "/join", "/sign-in"];

    const dead = hrefs.filter((href) => {
      if (href.startsWith("#")) return !sectionIds.includes(href.slice(1));
      const [path] = href.split("?");
      return !realRoutes.includes(path);
    });
    expect(dead).toEqual([]);
  });

  test("FAQ accordion opens one item at a time", async ({ page }) => {
    await page.goto("/");
    const first = page.getByRole("button", { name: /Who is BTG AI actually for/ });
    const second = page.getByRole("button", { name: /Do I need to know how to code/ });

    await expect(first).toHaveAttribute("aria-expanded", "false");
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/You don't need a computer science background/)).toBeVisible();

    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(first).toHaveAttribute("aria-expanded", "false");

    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "false");
  });

  test("mobile navigation opens, navigates and closes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const nav = page.locator("#main-nav");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(nav).toBeHidden();

    await toggle.click();
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await nav.getByRole("link", { name: "How it works" }).click();
    await expect(nav).toBeHidden();
    await expect(page).toHaveURL(/#how-it-works$/);
  });

  test("footer renders the current year server-side", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".footer-bottom")).toContainText(String(new Date().getFullYear()));
  });

  test("exposes a skip link and exactly one h1", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
    await expect(page.locator("h1")).toHaveCount(1);
  });
});

test.describe("auth surface", () => {
  test("join and sign-in reach each other", async ({ page }) => {
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

    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });

  test("unknown routes render the not-found page", async ({ page }) => {
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /couldn't find that page/i })).toBeVisible();
  });
});
