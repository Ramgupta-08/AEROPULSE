// Every role visits every page: allowed pages must render without console errors, restricted pages must show
// the role gate (and trigger no failing API calls).
import { chromium } from "playwright";

const BASE = process.env.AEROPULSE_URL ?? "http://127.0.0.1:5173";
const ROUTES = ["/", "/fleet", "/aircraft/AP-112", "/health", "/planner", "/whatif", "/missions", "/spares", "/agencies", "/copilot", "/records", "/datahub", "/reports", "/settings"];
const ROLES = process.env.ROLES ? process.env.ROLES.split(",") : ["commander", "engineering_officer", "technician", "logistics", "auditor"];
const browser = await chromium.launch();
const failures = [];
for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await ctx.addInitScript((r) => localStorage.setItem("aeropulse-ui", JSON.stringify({ state: { theme: "dark", role: r }, version: 0 })), role);
  const counts = { allowed: 0, gated: 0 };
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const gated = await page.getByText(/^Not available to /).count();
    gated ? counts.gated++ : counts.allowed++;
    if (!gated && (await page.locator("h1").count()) === 0) errors.push("no page title rendered");
    if (errors.length) failures.push(`${role} ${route}: ${errors.join(" | ")}`);
    if (process.env.VERBOSE) console.log(`  ${role} ${route} ${Date.now() - t0} ms${gated ? " (gated)" : ""}`);
    await page.close();
  }
  console.log(`${role.padEnd(20)} ${counts.allowed} pages allowed, ${counts.gated} gated`);
  await ctx.close();
}
await browser.close();
if (failures.length) {
  console.error("\n" + failures.join("\n"));
  process.exit(1);
}
console.log("All roles OK");
