// Runs the Guided Demo end-to-end at 1440x900, screenshots every step and fails on console errors.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AEROPULSE_URL ?? "http://127.0.0.1:5173";
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "screenshots");
fs.mkdirSync(OUT, { recursive: true });
const theme = process.argv.find((a) => a.startsWith("--theme="))?.slice(8) ?? "dark";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript((t) => localStorage.setItem("aeropulse-ui", JSON.stringify({ state: { theme: t, role: "engineering_officer" }, version: 0 })), theme);
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.getByTestId("demo-start").click();
const dialog = page.getByTestId("demo-panel");
for (let i = 1; i <= 8; i++) {
  await dialog.locator('[aria-busy="true"]').waitFor({ state: "detached", timeout: 45000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(i === 7 ? 6000 : 1800);
  const title = await page.getByTestId("demo-title").innerText();
  console.log(`step ${i}: ${title}`);
  await page.screenshot({ path: path.join(OUT, `demo-${i}-${theme}.png`) });
  if (i < 8) await page.getByTestId("demo-next").click();
  else await page.getByTestId("demo-finish").click();
}
await page.waitForTimeout(800);
await browser.close();
if (errors.length) {
  console.error("Console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("Guided demo completed without console errors");
