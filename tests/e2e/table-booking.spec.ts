/**
 * Vertical slice: open the seeded event, reserve a 6-person table, pay with the
 * simulator, see six passes, check two of them in at the door (by code).
 * Picks whichever 6-person table is still free so it can be re-run.
 */
import { expect, test } from "@playwright/test";

const EVENT = "/c/velvet-fox/e/midnight-frequencies";
const EVENT_ID = "00000000-0000-4000-8000-000000000003";

test("guest books a six-person table and door staff admit guests individually", async ({ page, browser }) => {
  await page.goto(EVENT);
  await page.getByRole("tab", { name: "List" }).click();
  const add = page.getByRole("button", { name: /^Add T[12]$/ }).first();
  test.skip(!(await add.isVisible()), "Both seeded 6-person tables are already booked; reseed a fresh database.");
  await add.click();
  await expect(page.getByText("6 admissions")).toBeVisible();
  await page.getByRole("button", { name: "Reserve" }).click();

  await expect(page.getByRole("heading", { name: "Your basket" })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("Held for you");
  await page.getByLabel("Full name").fill("E2E Guest");
  await page.getByLabel("Email").fill("e2e@example.test");
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect(page.getByText("Payment simulator")).toBeVisible();
  await page.getByRole("button", { name: "Payment succeeds" }).click();

  await expect(page.getByText("Booking confirmed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "6 guest passes" })).toBeVisible();
  const passLinks = await page.getByRole("link", { name: "Open this pass" }).evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
  expect(new Set(passLinks).size).toBe(6);

  // Door staff (separate browser context = separate device).
  const door = await browser.newContext();
  const dp = await door.newPage();
  await dp.goto("/staff/login");
  await dp.getByLabel("Email").fill("door1@velvetfox.test");
  await dp.getByLabel("Password").fill(process.env.SEED_STAFF_PASSWORD ?? "");
  await dp.getByRole("button", { name: "Sign in" }).click();
  await expect(dp.getByRole("heading", { name: "Choose an event" })).toBeVisible();
  await dp.goto(`/staff/events/${EVENT_ID}/door`);
  await dp.getByRole("button", { name: "Enter code" }).click();

  for (const [i, link] of passLinks.slice(0, 2).entries()) {
    await dp.getByPlaceholder("Paste or type the code").fill(link);
    await dp.getByRole("button", { name: "Check pass" }).click();
    await expect(dp.getByRole("alert")).toContainText("ADMIT");
    await expect(dp.getByRole("alert")).toContainText(`${i + 1} of 6 in`);
    await dp.getByRole("alert").click();
  }
  // Repeat scan shows already used, count unchanged.
  await dp.getByPlaceholder("Paste or type the code").fill(passLinks[0]);
  await dp.getByRole("button", { name: "Check pass" }).click();
  await expect(dp.getByRole("alert")).toContainText("ALREADY USED");
  await expect(dp.getByRole("alert")).toContainText("2 of 6 in");
  await door.close();
});
