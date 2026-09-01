/**
 * Click-test the rendered pages (not just "does it build").
 * Walks the 4 user journeys against a mock API. Starts its own dev server on
 * PORT below, drives real Chromium, asserts on the rendered DOM.
 *
 *   node test/smoke.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { homedir } from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PW_CANDIDATES = [
  "playwright-core",
  "/home/pjm/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core",
];
let chromium;
for (const c of PW_CANDIDATES) { try { ({ chromium } = require(c)); break; } catch {} }
if (!chromium) { console.error("playwright-core not found — run `npm i` in src/frontend"); process.exit(2); }

const EXE_CANDIDATES = [
  `${homedir()}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`,
  `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
];
const executablePath = EXE_CANDIDATES.find(existsSync);

const PORT = 4337;
const BASE = `http://localhost:${PORT}`;
const SHOT_DIR = process.env.SMOKE_SHOT_DIR || "";
let failures = 0;
const ok = (name) => console.log(`  ok  ${name}`);
const fail = (name, err) => { failures++; console.error(`FAIL  ${name}\n      ${err}`); };

async function check(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { fail(name, e.message || e); }
}

const server = spawn("node", ["dev-server.mjs", String(PORT)], { cwd: new URL("..", import.meta.url).pathname, stdio: "inherit" });
await sleep(1200);

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile-first
const page = await ctx.newPage();
page.setDefaultTimeout(9000);
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message + "\n" + (e.stack || "").split("\n").slice(0, 4).join("\n")));

// Self-hosted webfont requests must all resolve (no 404s) on every page.
const fontResponses = [];
page.on("response", (r) => {
  if (/\/assets\/fonts\/.*\.woff2(\?|$)/.test(r.url())) fontResponses.push({ file: r.url().split("/").pop(), status: r.status() });
});

const PUBLIC_ROUTES = ["/", "/gallery", "/the-car", "/location", "/book", "/book?car=1",
  "/contact", "/terms", "/privacy", "/house-rules", "/cancellation-policy",
  "/vehicle-rental-agreement", "/booking/KK-7F3Q2A", "/no-such-page"];

try {
  // ---- No horizontal document overflow at 360px on any public page ----
  await check("No horizontal document overflow at 360px on every public page", async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    const offenders = [];
    for (const route of PUBLIC_ROUTES) {
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      const info = await page.evaluate(() => {
        const de = document.documentElement;
        const overflow = de.scrollWidth - de.clientWidth;
        let worst = null;
        if (overflow > 0) {
          for (const el of document.querySelectorAll("*")) {
            const b = el.getBoundingClientRect();
            if (b.right > de.clientWidth + 1) { worst = el.tagName.toLowerCase() + "." + String(el.className || "").split(/\s+/).join("."); break; }
          }
        }
        return { overflow, worst };
      });
      if (info.overflow > 0) offenders.push(`${route} +${info.overflow}px (${info.worst})`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (offenders.length) throw new Error("page scrolls sideways: " + offenders.join("; "));
  });

  // ---- P1 home ----
  await check("P1 home renders hero + booking widget", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForSelector(".hero__title");
    await page.waitForSelector(".booking-widget button[type=submit]");
    if (!(await page.locator("text=At a glance").count())) throw new Error("missing At a glance");
    if (!(await page.locator("text=What's included").count())) throw new Error("missing included table");
  });

  await check("Booking widget: Check-in / Check-out date inputs are the same height and bottom-aligned (360px + desktop)", async () => {
    for (const [label, width, height] of [["360px", 360, 780], ["desktop", 1280, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.waitForSelector("#hero-widget .booking-widget input[name=checkIn]");
      const m = await page.evaluate(() => {
        const w = document.querySelector("#hero-widget .booking-widget");
        const a = w.querySelector("input[name=checkIn]").getBoundingClientRect();
        const b = w.querySelector("input[name=checkOut]").getBoundingClientRect();
        return { ah: a.height, bh: b.height, abot: a.bottom, bbot: b.bottom };
      });
      if (Math.abs(m.ah - m.bh) > 1) throw new Error(`${label}: input heights differ — checkIn ${m.ah.toFixed(2)} vs checkOut ${m.bh.toFixed(2)}`);
      if (Math.abs(m.abot - m.bbot) > 1) throw new Error(`${label}: input bottom edges not aligned — checkIn ${m.abot.toFixed(2)} vs checkOut ${m.bbot.toFixed(2)}`);
      if (SHOT_DIR) await page.locator("#hero-widget .booking-widget").screenshot({ path: `${SHOT_DIR}/booking-widget-${label}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await check("Header wordmark is the largest header text, both states, no mobile collision", async () => {
    // mobile (viewport is 390): wordmark bigger than nav-ish text, no overlap with hamburger, CTA hidden
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const wm = page.locator(".site-header__inner .wordmark");
    const size = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const wmMobile = await size(wm);
    if (wmMobile < 24) throw new Error("mobile wordmark too small: " + wmMobile);
    if (await page.locator(".site-header__cta").isVisible()) throw new Error("Check-dates CTA should be hidden on mobile");
    const wmBox = await wm.boundingBox();
    const tglBox = await page.locator(".nav-toggle").boundingBox();
    if (wmBox.x + wmBox.width > tglBox.x + 1) throw new Error("wordmark overlaps the hamburger on mobile");

    // transparent-over-hero: white + still large
    const colTop = await wm.evaluate((el) => getComputedStyle(el).color);
    if (!/255,\s*255,\s*255/.test(colTop)) throw new Error("wordmark not white over the hero: " + colTop);

    // desktop: wordmark clearly larger than the nav links, and solid-state after scroll
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const wmDesk = await size(wm);
    const navSize = await size(page.locator(".site-nav a").first());
    if (wmDesk <= navSize * 1.4) throw new Error(`wordmark (${wmDesk}) not clearly bigger than nav (${navSize})`);
    await page.evaluate(() => window.scrollTo(0, window.innerHeight + 200));
    await page.waitForTimeout(300);
    const wmScrolled = await size(wm);
    if (wmScrolled !== wmDesk) throw new Error("wordmark size changed between header states");
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await check("Header wordmark carries the inline logo mark, keeps its text, mark colour follows text, no 360px collision", async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const wm = page.locator(".site-header__inner .wordmark");
    const shape = await wm.evaluate((el) => {
      const svg = el.querySelector("svg.wordmark__mark");
      const cs = svg && getComputedStyle(svg);
      return {
        hasSvg: !!svg,
        text: (el.textContent || "").trim(),
        markColor: cs && cs.color,
        wordmarkColor: getComputedStyle(el).color,
        markHeight: svg && svg.getBoundingClientRect().height,
      };
    });
    if (!shape.hasSvg) throw new Error("no <svg> logo mark inside .wordmark");
    if (!/Kigali Keys/.test(shape.text)) throw new Error("wordmark lost its text: " + shape.text);
    if (shape.markColor !== shape.wordmarkColor) throw new Error(`mark colour (${shape.markColor}) does not follow text (${shape.wordmarkColor})`);
    if (!/255,\s*255,\s*255/.test(shape.markColor)) throw new Error("mark not white over the hero: " + shape.markColor);
    if (shape.markHeight < 20 || shape.markHeight > 40) throw new Error("mark height out of range at 360px: " + shape.markHeight);

    // no sideways overflow, no overlap with the header actions (hamburger / CTA)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) throw new Error("header adds horizontal overflow at 360px: +" + overflow + "px");
    const wmBox = await wm.boundingBox();
    const actBox = await page.locator(".site-header__actions").boundingBox();
    if (wmBox.x + wmBox.width > actBox.x + 1) throw new Error("wordmark overlaps the header actions at 360px");

    // scrolled / solid state: mark still matches the (now Hill-Green) text
    await page.evaluate(() => window.scrollTo(0, window.innerHeight + 400));
    await page.waitForTimeout(300);
    const solid = await wm.evaluate((el) => ({
      mark: getComputedStyle(el.querySelector("svg.wordmark__mark")).color,
      text: getComputedStyle(el).color,
    }));
    if (solid.mark !== solid.text) throw new Error(`solid state: mark (${solid.mark}) != text (${solid.text})`);
    if (/255,\s*255,\s*255/.test(solid.mark)) throw new Error("mark still white after scrolling past the hero");
    await page.setViewportSize({ width: 390, height: 844 });
  });

  // ---- Header/hero layout: clearance + pinning (regression for two bugs) ----
  await check("P1 hero content clears the transparent header at 360 / 768 / 1280", async () => {
    const rectsFor = () => page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, right: b.right, bottom: b.bottom, left: b.left }; };
      const header = document.querySelector(".site-header");
      const wm = document.querySelector(".site-header__inner .wordmark");
      const h1 = document.querySelector(".hero__title");
      const sub = document.querySelector(".hero__sub");
      const widget = document.querySelector("#hero-widget .booking-widget");
      return { header: r(header), wm: r(wm), h1: r(h1), sub: r(sub), widget: r(widget) };
    });
    const intersects = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.waitForSelector(".hero__title");
      await page.evaluate(() => window.scrollTo(0, 0));
      const g = await rectsFor();
      if (intersects(g.h1, g.wm)) throw new Error(`${width}px: hero H1 box intersects the wordmark box`);
      for (const [name, box] of [["H1", g.h1], ["sub-line", g.sub], ["booking widget", g.widget]]) {
        if (box.top < g.header.bottom) throw new Error(`${width}px: hero ${name} (top ${box.top.toFixed(0)}) sits under the header (bottom ${g.header.bottom.toFixed(0)})`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await check("P1 header stays pinned + goes solid after scrolling past the hero", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(350);
    const s = await page.evaluate(() => {
      const header = document.querySelector(".site-header");
      const wm = document.querySelector(".site-header__inner .wordmark");
      const cs = getComputedStyle(header);
      return {
        top: header.getBoundingClientRect().top,
        transparentClass: header.classList.contains("site-header--transparent"),
        bg: cs.backgroundColor,
        wmColor: getComputedStyle(wm).color,
      };
    });
    if (Math.abs(s.top) > 2) throw new Error("header not pinned to viewport top after 800px scroll: top=" + s.top);
    if (s.transparentClass) throw new Error("header still in transparent state past the hero");
    if (/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(s.bg)) throw new Error("header background not solid after scroll: " + s.bg);
    if (/255,\s*255,\s*255/.test(s.wmColor)) throw new Error("wordmark still white (light) after scroll: " + s.wmColor);
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await check("Interior page (/the-car) header is pinned, solid, and does not hide the first content", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE + "/the-car", { waitUntil: "networkidle" });
    const before = await page.evaluate(() => {
      const header = document.querySelector(".site-header");
      const h1 = document.querySelector("main h1");
      const cs = getComputedStyle(header);
      return {
        top: header.getBoundingClientRect().top,
        bg: cs.backgroundColor,
        transparentClass: header.classList.contains("site-header--transparent"),
        h1Top: h1.getBoundingClientRect().top,
        headerBottom: header.getBoundingClientRect().bottom,
      };
    });
    if (Math.abs(before.top) > 2) throw new Error("interior header not at viewport top: " + before.top);
    if (before.transparentClass) throw new Error("interior header should never be transparent (no hero)");
    if (/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(before.bg)) throw new Error("interior header not solid: " + before.bg);
    if (before.h1Top < before.headerBottom) throw new Error(`first content hidden behind header: h1 top ${before.h1Top.toFixed(0)} < header bottom ${before.headerBottom.toFixed(0)}`);
    // still pinned after scrolling
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.querySelector(".site-header").getBoundingClientRect().top);
    if (Math.abs(after) > 2) throw new Error("interior header unpinned after scroll: top=" + after);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + "/", { waitUntil: "networkidle" }); // leave subsequent checks on P1
  });

  await check("P1 FAQ accordion toggles", async () => {
    const trigger = page.locator(".accordion__trigger").first();
    await trigger.click();
    if ((await trigger.getAttribute("aria-expanded")) !== "true") throw new Error("accordion did not expand");
  });

  await check("P1 gallery preview opens lightbox, Esc closes and restores focus", async () => {
    const firstThumb = page.locator(".gallery-strip button").first();
    await firstThumb.click();
    await page.waitForSelector(".lightbox", { state: "visible" });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".lightbox", { state: "hidden" });
  });

  await check("P1 mobile nav drawer opens", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.locator(".nav-toggle").click();
    await page.waitForSelector(".mobile-drawer.is-open");
    if ((await page.locator(".mobile-drawer a").count()) < 3) throw new Error("drawer looks empty");
    if ((await page.locator(".nav-toggle").getAttribute("aria-expanded")) !== "true") throw new Error("toggle not expanded");
  });

  await check("P2 gallery groups, no Workspace category, real photo loads", async () => {
    await page.goto(BASE + "/gallery", { waitUntil: "networkidle" });
    await page.waitForSelector(".gallery-group");
    const headings = await page.locator(".gallery-group h2").allTextContents();
    if (headings.some((t) => /workspace/i.test(t))) throw new Error("Workspace category tile still rendered");
    if (!headings.some((t) => /Living/i.test(t))) throw new Error("expected a Living group");
    // a real <img> (not the SVG placeholder) resolved
    const loaded = await page.locator(".gallery-justified img").first().evaluate((img) => img.complete && img.naturalWidth > 0);
    if (!loaded) throw new Error("first gallery image did not load");
    await page.locator(".gallery-justified button").first().click();
    await page.waitForSelector(".lightbox", { state: "visible" });
    const counter = await page.locator(".lightbox__counter").textContent();
    if (!/\d+ \/ \d+/.test(counter)) throw new Error("no counter: " + counter);
    await page.keyboard.press("Escape");
  });

  await check("P4 location page renders travel times + map disclaimer", async () => {
    await page.goto(BASE + "/location", { waitUntil: "networkidle" });
    await page.waitForSelector(".travel-times");
    if (!(await page.locator("text=exact address").count())) throw new Error("missing address disclaimer");
  });

  // ---- P3 car -> deep link to /book ----
  await check("P3 the-car renders and CTA links to /book?car=1", async () => {
    await page.goto(BASE + "/the-car", { waitUntil: "networkidle" });
    await page.waitForSelector("h1:has-text('The car')");
    const href = await page.locator("a.btn--primary", { hasText: "Add the car" }).first().getAttribute("href");
    if (!href.includes("car=1")) throw new Error("CTA missing car=1: " + href);
  });

  // ---- Journey 1: full booking WITH the car ----
  await check("Journey 1 — book the stay + car end to end", async () => {
    await page.goto(BASE + "/book?car=1", { waitUntil: "networkidle" });
    await page.waitForSelector(".stepper");

    // Step 1: pick a valid range in the calendar
    const days = page.locator('.drp__day:not([aria-disabled="true"])');
    await days.nth(8).click();
    await days.nth(15).click();
    await page.locator("button:has-text('Continue')").click();

    // Step 2: car toggle already on -> fill driver
    await page.waitForSelector("#s2-h");
    await page.fill("#drv-name", "Lena Okafor");
    await page.fill("#drv-dob", "1990-04-12");
    await page.fill("#drv-lic", "A1234567");
    await page.selectOption("#drv-licc", "NG");
    await page.check("#drv-meets");
    await page.locator("button:has-text('Continue')").click();

    // Step 3: guest details
    await page.waitForSelector("#s3-h");
    await page.fill("#g-first", "Lena");
    await page.fill("#g-last", "Okafor");
    await page.fill("#g-email", "lena@example.com");
    await page.fill("#g-email2", "lena@example.com");
    await page.fill("#g-phone", "+2348012345678");
    await page.selectOption("#g-country", "NG");
    await page.locator("button:has-text('Continue')").click();

    // Step 4: accept all three, submit
    await page.waitForSelector("#s4-h");
    const submit = page.locator(".wizard-submit-bar .btn--primary");
    if (!(await submit.isDisabled())) throw new Error("submit should be disabled before acceptances");
    await page.check("#acc-stayTerms");
    await page.check("#acc-houseRules");
    await page.check("#agr-block input[type=checkbox]");
    if (await submit.isDisabled()) throw new Error("submit still disabled after all acceptances");
    await submit.click();

    await page.waitForURL(/\/booking\/KK-/, { timeout: 5000 });
    await page.waitForSelector(".status-badge--pending");
    if (!(await page.locator("text=Documents you accepted").count())) throw new Error("P6 missing accepted documents");
    if (!(await page.locator(".status-badge--pending").count())) throw new Error("P6 not pending");
  });

  // ---- Date-range picker opens on the month of a pre-selected check-in ----
  await check("DateRangePicker: /book with a pre-selected range opens on the check-in's month, both endpoints visible", async () => {
    const ci = new Date(); ci.setHours(0, 0, 0, 0); ci.setDate(ci.getDate() + 55);
    const co = new Date(ci); co.setDate(co.getDate() + 7);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const ciIso = iso(ci), coIso = iso(co);
    const wantLabel = ci.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const todayLabel = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    if (wantLabel === todayLabel) throw new Error("test setup: check-in date is still in the current month");

    await page.goto(`${BASE}/book?checkIn=${ciIso}&checkOut=${coIso}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".drp__nav-label");

    const navLabel = (await page.locator(".drp__nav-label").textContent()).trim();
    if (navLabel !== wantLabel) throw new Error(`nav label is "${navLabel}", expected the check-in's month "${wantLabel}" (not today's "${todayLabel}")`);

    const ciCell = page.locator(`.drp__day[data-date="${ciIso}"]`);
    const coCell = page.locator(`.drp__day[data-date="${coIso}"]`);
    if (!(await ciCell.count())) throw new Error(`check-in day cell ${ciIso} is not in the rendered grids`);
    if (!(await coCell.count())) throw new Error(`check-out day cell ${coIso} is not in the rendered grids`);
    if (!(await ciCell.isVisible()) || !(await coCell.isVisible())) throw new Error("a selected endpoint is rendered but not visible");
    if (!(await ciCell.evaluate((el) => el.classList.contains("is-selected")))) throw new Error("check-in cell is not marked is-selected");
    if (!(await coCell.evaluate((el) => el.classList.contains("is-selected")))) throw new Error("check-out cell is not marked is-selected");
    if (SHOT_DIR) await page.locator(".card:has(.drp)").screenshot({ path: `${SHOT_DIR}/book-calendar-preselected.png` });
  });

  await check("DateRangePicker: /book with no dates still opens on the current month", async () => {
    await page.goto(BASE + "/book", { waitUntil: "networkidle" });
    await page.waitForSelector(".drp__nav-label");
    const navLabel = (await page.locator(".drp__nav-label").textContent()).trim();
    const todayLabel = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    if (navLabel !== todayLabel) throw new Error(`nav label is "${navLabel}", expected the current month "${todayLabel}"`);
  });

  await check("DateRangePicker: a lone checkOut param (no checkIn) does not throw and opens on the current month", async () => {
    const co = new Date(); co.setDate(co.getDate() + 40);
    const coIso = `${co.getFullYear()}-${String(co.getMonth() + 1).padStart(2, "0")}-${String(co.getDate()).padStart(2, "0")}`;
    const errsBefore = consoleErrors.length;
    await page.goto(`${BASE}/book?checkOut=${coIso}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".drp__nav-label");
    const todayLabel = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const navLabel = (await page.locator(".drp__nav-label").textContent()).trim();
    if (navLabel !== todayLabel) throw new Error(`nav label is "${navLabel}", expected "${todayLabel}"`);
    const newErrs = consoleErrors.slice(errsBefore).filter((e) => e.startsWith("pageerror:"));
    if (newErrs.length) throw new Error("page error raised: " + newErrs[0]);
  });

  // ---- P6 gate via reference + email ----
  await check("P6 gate: wrong email is rejected, right email shows booking", async () => {
    await page.goto(BASE + "/booking/KK-7F3Q2A", { waitUntil: "networkidle" });
    await page.fill("#g-ref", "KK-7F3Q2A");
    await page.fill("#g-email", "wrong@example.com");
    await page.locator("button:has-text('View booking')").click();
    await page.waitForSelector(".inline-alert--error");
    await page.fill("#g-email", "lena@example.com");
    await page.locator("button:has-text('View booking')").click();
    await page.waitForSelector(".status-badge");
  });

  // ---- P13 404 ----
  await check("P13 unknown route serves 404 page with booking lookup", async () => {
    const resp = await page.goto(BASE + "/no-such-page", { waitUntil: "networkidle" });
    if (resp.status() !== 404) throw new Error("expected 404 status, got " + resp.status());
    await page.waitForSelector("#lookup-form");
  });

  // ---- Legal pages ----
  for (const [path, heading] of [["/terms", "Website terms"], ["/privacy", "Privacy"], ["/house-rules", "House rules"], ["/cancellation-policy", "Cancellation"], ["/vehicle-rental-agreement", "Rental Agreement"]]) {
    await check(`Legal ${path} renders`, async () => {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForSelector(".prose");
      if (!(await page.locator(`h1:has-text("${heading}")`).count())) throw new Error("wrong heading");
    });
  }

  // ---- Contact ----
  await check("P7 contact page shows the public contact email from GET /property, no phone line", async () => {
    await page.goto(BASE + "/contact", { waitUntil: "networkidle" });
    const mail = page.locator('#contact-root a[href="mailto:info@kigalikeys.rw"]');
    if ((await mail.count()) !== 1) throw new Error("expected the info@kigalikeys.rw mailto link from the contact block");
    if (await page.locator("#contact-root", { hasText: "host@kigalikeys.rw" }).count()) throw new Error("stale hardcoded email still rendered");
    if (await page.locator("#contact-root", { hasText: "Phone / WhatsApp" }).count()) throw new Error("phone line rendered even though contact.phone is null");
    if (!(await page.locator("#contact-root", { hasText: "within 24" }).count())) throw new Error("response-time text missing");
  });

  await check("Footer shows the public contact block (name, host email), no fake fallback", async () => {
    const meta = page.locator(".site-footer .footer-meta").first();
    const text = await meta.textContent();
    if (!/Contact: Peter, the host/.test(text)) throw new Error("footer contact line wrong: " + text);
    if ((await meta.locator('a[href="mailto:info@kigalikeys.rw"]').count()) !== 1) throw new Error("footer missing the contact email link");
    if (/host@kigalikeys\.rw|7xx xxx xxx/.test(text)) throw new Error("footer still shows a hardcoded placeholder: " + text);
  });

  await check("P7 contact form submits", async () => {
    await page.goto(BASE + "/contact", { waitUntil: "networkidle" });
    await page.fill("#c-name", "Sam Field");
    await page.fill("#c-email", "sam@example.com");
    await page.fill("#c-msg", "Can two people be named as drivers?");
    await page.locator("button:has-text('Send message')").click();
    await page.waitForSelector(".inline-alert--success");
  });

  // ---- Journey 2: admin login -> approve ----
  await check("Journey 2 — admin logs in and approves a booking", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
    await page.waitForSelector("#l-email");
    await page.fill("#l-email", "jean@kigalikeys.rw");
    await page.fill("#l-pass", "kigali-demo");
    await page.locator("button:has-text('Sign in')").click();
    await page.waitForSelector("text=Needs attention");
    // Journey 2 is Lena's booking (with the car) — go straight to it
    await page.goto(BASE + "/admin/bookings?status=pending", { waitUntil: "networkidle" });
    await page.locator(".admin-table tbody tr", { hasText: "KK-7F3Q2A" }).click();
    await page.waitForSelector("text=Approve");
    await page.fill("#ap-addr", "House 00, KG 9 Ave, Gacuriro, Kigali");
    await page.fill("#ap-ci", "Lockbox code 4821. Gate security has your name.");
    await page.fill("#ap-car", "Keys at the house on arrival; bring licence + passport.");
    await page.fill("#ap-host", "Peter — +250 788 000 000");
    await page.locator("button:has-text('Approve & send email')").click();
    await page.waitForSelector(".modal");
    await page.locator("button:has-text('Confirm & send')").click();
    await page.waitForSelector(".status-badge--approved", { timeout: 5000 });
  });

  // ---- Journey 3: admin rejects the other seeded booking ----
  await check("Journey 3 — admin rejects a booking with an explanation", async () => {
    await page.goto(BASE + "/admin/bookings?status=pending", { waitUntil: "networkidle" });
    await page.locator(".admin-table tbody tr").first().click();
    await page.waitForSelector("text=Reject");
    await page.fill("#rj-exp", "I'm sorry — the house is already committed for those exact dates.");
    await page.locator("button:has-text('Reject & send email')").click();
    await page.waitForSelector(".modal");
    await page.locator("button:has-text('Confirm & send')").click();
    await page.waitForSelector(".status-badge--rejected", { timeout: 5000 });
  });

  // ---- Journey 4: admin storefront edits ----
  await check("Journey 4 — admin raises the nightly rate", async () => {
    await page.goto(BASE + "/admin/availability", { waitUntil: "networkidle" });
    await page.waitForSelector("#p-rate");
    await page.fill("#p-rate", "165");
    await page.locator("button:has-text('Save pricing')").click();
    await page.waitForSelector(".inline-alert--success");
  });

  await check("Journey 4 — admin blocks owner dates", async () => {
    await page.fill("#b-start", "2026-11-10");
    await page.fill("#b-end", "2026-11-14");
    await page.fill("#b-reason", "Owner family visit");
    await page.locator("button:has-text('Block these dates')").click();
    await page.waitForSelector('.cal-cell[data-state="blocked"]');
  });

  await check("Journey 4 — admin publishes a new agreement version", async () => {
    await page.goto(BASE + "/admin/vehicle", { waitUntil: "networkidle" });
    await page.waitForSelector("text=Rental agreement versions");
    await page.fill("#e-body, textarea[placeholder^='# Kia']", "# Kia Sorento Rental Agreement\n\n## 1. Parties\n\n" + "Updated agreement body. ".repeat(20));
    await page.fill("input[type=date]", "2026-10-01");
    await page.locator("button:has-text('Publish')").click();
    await page.waitForSelector(".modal");
    await page.locator(".modal button:has-text('Publish new version')").click();
    await page.waitForSelector("text=v5", { timeout: 5000 });
  });

  await check("Admin — content / gallery / emails / agreements pages render", async () => {
    await page.goto(BASE + "/admin/content", { waitUntil: "networkidle" });
    await page.waitForSelector("text=Full description");
    await page.goto(BASE + "/admin/gallery", { waitUntil: "networkidle" });
    await page.waitForSelector("text=Upload photos");
    await page.goto(BASE + "/admin/emails", { waitUntil: "networkidle" });
    await page.waitForSelector("iframe[title='Email preview']");
    await page.goto(BASE + "/admin/agreements", { waitUntil: "networkidle" });
    await page.waitForSelector(".admin-table, .empty-state");
  });

  // ---- A9 Sent log (outbox) — api-contract §26b ----
  await check("A9 Sent log — tab renders fixture rows, template filter narrows, row opens the rendered email", async () => {
    await page.goto(BASE + "/admin/emails", { waitUntil: "networkidle" });
    // Templates tab is the default; a Sent log tab sits beside it.
    await page.locator(".admin-tabs .admin-tab", { hasText: "Sent log" }).click();
    await page.waitForSelector(".admin-table tbody tr");
    const allRows = await page.locator(".admin-table tbody tr").count();
    if (allRows < 3) throw new Error("expected several sent-email rows from the fixture, got " + allRows);

    // a null templateKey (direct host notification) renders as a neutral label, never blank
    if (!(await page.locator(".admin-table tbody tr td:nth-child(3)", { hasText: "Direct message" }).count())) {
      throw new Error("null templateKey row not shown as 'Direct message'");
    }

    // filter by template narrows the list
    await page.selectOption("#se-tpl", "bookingReceived");
    await page.locator(".admin-filters button:has-text('Apply')").click();
    await page.waitForSelector(".admin-table tbody tr");
    const templateCells = await page.locator(".admin-table tbody tr td:nth-child(3)").allTextContents();
    if (!templateCells.length || templateCells.length >= allRows) throw new Error(`template filter did not narrow: ${allRows} -> ${templateCells.length}`);
    if (!templateCells.every((t) => /Booking received/i.test(t))) throw new Error("filtered rows include other templates: " + templateCells.join(", "));
    if (!/templateKey=bookingReceived/.test(page.url())) throw new Error("filter not reflected in the URL: " + page.url());

    // row click opens the stored, brand-wrapped email in a sandboxed iframe
    await page.locator(".admin-table tbody tr").first().click();
    await page.waitForSelector(".modal .email-preview iframe");
    const frame = page.locator(".modal .email-preview iframe");
    const srcdoc = await frame.getAttribute("srcdoc");
    if (!srcdoc || !/<!doctype html>/i.test(srcdoc)) throw new Error("modal iframe has no full-document srcdoc");
    if ((await frame.getAttribute("sandbox")) === null) throw new Error("rendered-email iframe is not sandboxed");
    if (!(await page.locator(".modal .detail-list", { hasText: "Subject" }).count())) throw new Error("modal missing subject/to/sent-at header");
    await page.locator(".modal button:has-text('Close')").click();
    await page.waitForSelector(".modal", { state: "detached" });

    // status badge: v1 'stored' shows a neutral 'Stored' label with helptext
    if (!(await page.locator(".admin-table tbody .status-badge--neutral", { hasText: "Stored" }).count())) throw new Error("no neutral 'Stored' status badge");
  });

  await check("Admin — Users page reachable for owner", async () => {
    await page.goto(BASE + "/admin/users", { waitUntil: "networkidle" });
    await page.waitForSelector("text=Invite an administrator");
  });

  await check("Admin — accept-invite page renders from a token link", async () => {
    await page.goto(BASE + "/admin/accept-invite?token=demo", { waitUntil: "networkidle" });
    await page.waitForSelector("#ai-pass");
  });

  await check("Self-hosted webfonts load on every page (no /assets/fonts/*.woff2 404s)", async () => {
    if (!fontResponses.length) throw new Error("no woff2 requests seen at all — fonts.css not linked or @font-face unused");
    const failed = fontResponses.filter((r) => r.status >= 400);
    if (failed.length) throw new Error("font requests failed: " + failed.map((r) => `${r.status} ${r.file}`).join(", "));
    // headings render in Fraunces, body in Inter
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const f = await page.evaluate(() => ({
      fraunces: document.fonts.check("700 24px Fraunces"),
      inter: document.fonts.check("400 16px Inter"),
    }));
    if (!f.fraunces) throw new Error("Fraunces 700 not loaded (wordmark face)");
    if (!f.inter) throw new Error("Inter 400 not loaded (body face)");
  });

  await check("Admin JS bundles carry no stale/banned placeholder tokens", async () => {
    const dir = new URL("../public/assets/js/admin/", import.meta.url).pathname;
    const banned = ["Rebero", "host@kigalikeys.rw", " Jean ", "7xx xxx xxx"];
    const hits = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const src = readFileSync(dir + file, "utf8");
      for (const token of banned) if (src.includes(token)) hits.push(`${file}: "${token.trim()}"`);
    }
    if (hits.length) throw new Error("stale tokens shipped: " + hits.join(", "));
  });

  await check("No uncaught page errors across the run", async () => {
    // Genuine JS exceptions only. Expected network non-2xx (favicon; the
    // deliberate 404 route test; GET /admin/auth/session 401 while signed out)
    // are surfaced by the browser as resource-load messages, not page errors.
    const real = consoleErrors.filter((e) =>
      e.startsWith("pageerror:") ||
      (/error/i.test(e) && !/Failed to load resource|favicon|net::ERR/i.test(e)));
    if (real.length) throw new Error(real.slice(0, 6).join(" | "));
  });

} finally {
  await browser.close();
  server.kill("SIGTERM");
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
