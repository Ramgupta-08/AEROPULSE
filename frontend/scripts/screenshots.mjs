// Captures every page at desktop + phone sizes in both themes, and fails on console errors.
// Usage: node frontend/scripts/screenshots.mjs [--smoke] [--only=/path] [--theme=dark|light]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AEROPULSE_URL ?? "http://127.0.0.1:5173";
const args = process.argv.slice(2);
const smoke = args.includes("--smoke");
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const themeArg = args.find((a) => a.startsWith("--theme="))?.slice(8);
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "screenshots");

const PAGES = [
  ["overview", "/", "engineering_officer"],
  ["fleet", "/fleet", "engineering_officer"],
  ["aircraft", "/aircraft/AP-112", "engineering_officer"],
  ["health", "/health", "engineering_officer"],
  ["planner", "/planner", "engineering_officer"],
  ["whatif", "/whatif", "engineering_officer"],
  ["missions", "/missions", "engineering_officer"],
  ["spares", "/spares", "engineering_officer"],
  ["agencies", "/agencies", "engineering_officer"],
  ["copilot", "/copilot", "technician"],
  ["records", "/records", "engineering_officer"],
  ["datahub", "/datahub", "engineering_officer"],
  ["reports", "/reports", "engineering_officer"],
  ["settings", "/settings", "engineering_officer"],
  // Secondary states: tabs and drawers
  ["health-model", "/health?tab=model", "engineering_officer"],
  ["health-anomalies", "/health?tab=anomalies", "engineering_officer"],
  ["aircraft-drawer", "/aircraft/AP-112", "engineering_officer", async (p) => p.getByRole("button", { name: /^Engine 2:/ }).first().click()],
  ["whatif-run", "/whatif", "engineering_officer", async (p) => { await p.locator('[data-tour="preset-seal"]').click(); await p.waitForResponse((r) => r.url().includes("/api/whatif/run"), { timeout: 30000 }); }],
  ["missions-coverage", "/missions?focus=M01", "engineering_officer"],
  ["spares-batch", "/spares?tab=batch", "engineering_officer"],
  ["spares-cannibalisation", "/spares?tab=cannibalisation", "engineering_officer"],
  ["spares-transfers", "/spares?tab=transfers", "engineering_officer"],
  ["fleet-grid", "/fleet", "engineering_officer", async (p) => p.getByRole("radio", { name: "Grid view" }).click()],
].filter(([, p]) => !only || p.split("?")[0] === only);

const VIEWPORTS = smoke
  ? [["desktop", 1440, 900]]
  : [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
    ];
const THEMES = smoke ? ["dark"] : themeArg ? [themeArg] : ["dark", "light"];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const failures = [];
for (const theme of THEMES) {
  for (const [vp, w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    for (const [name, route, role, act] of PAGES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript(
        ([t, r]) => localStorage.setItem("aeropulse-ui", JSON.stringify({ state: { theme: t, role: r, baseFilter: null, sidebarCollapsed: false, density: "comfortable" }, version: 0 })),
        [theme, role],
      );
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(900);
      if (act) {
        await act(page);
        await page.waitForTimeout(1200);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) errors.push(`horizontal overflow ${overflow}px`);
      if (!smoke) {
        // The app scrolls inside <main>; unlock it so the full page is captured.
        await page.addStyleTag({ content: "html,body,#root,#root>div{height:auto!important} main{overflow:visible!important}" });
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT, `${name}-${vp}-${theme}.png`), fullPage: true });
      }
      if (errors.length) failures.push(`${name} [${vp}/${theme}]: ${errors.join(" | ")}`);
      console.log(`${errors.length ? "✗" : "✓"} ${name.padEnd(9)} ${vp}/${theme}`);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
if (failures.length) {
  console.error("\nIssues:\n" + failures.join("\n"));
  process.exit(1);
}
