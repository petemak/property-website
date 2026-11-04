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
let chromium, webkit, devices;
for (const c of PW_CANDIDATES) { try { ({ chromium, webkit, devices } = require(c)); break; } catch {} }
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

// Every request the page makes — used to assert the home first paint stays lean.
const requests = [];
page.on("request", (r) => requests.push(r.url()));
const requestsSince = (mark) => requests.slice(mark);

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

  await check("Booking widget: Check-in / Check-out sit side-by-side with a gap + equal bottoms at every width (mobile included); widget stays a compact fraction of the phone viewport", async () => {
    const measure = () => page.evaluate(() => {
      const w = document.querySelector("#hero-widget .booking-widget");
      const cs = getComputedStyle(w);
      const wr = w.getBoundingClientRect();
      const innerRight = wr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      const a = w.querySelector("input[name=checkIn]").getBoundingClientRect();
      const b = w.querySelector("input[name=checkOut]").getBoundingClientRect();
      return {
        ax: a.x, bx: b.x, ay: a.y, by: b.y, ah: a.height, bh: b.height,
        aright: a.right, bright: b.right, bbot: b.bottom, abot: a.bottom, atop: a.top, btop: b.top,
        innerRight, widgetH: w.getBoundingClientRect().height,
      };
    });

    // ---- mobile: side-by-side (same row), horizontal gap, within the card ----
    // The owner prefers the compact two-column arrangement; `appearance: none`
    // on the native date inputs keeps them inside their grid track at 360-390px.
    for (const [label, width, height] of [["360px", 360, 780], ["390px", 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.waitForSelector("#hero-widget .booking-widget input[name=checkIn]");
      const m = await measure();
      if (Math.abs(m.ay - m.by) > 1) throw new Error(`${label}: date inputs not on the same row — checkIn y ${m.ay.toFixed(1)} vs checkOut y ${m.by.toFixed(1)}`);
      const gap = m.bx - m.aright;
      if (gap < 6) throw new Error(`${label}: horizontal gap between side-by-side date inputs is only ${gap.toFixed(1)}px (want >= 6)`);
      if (m.bx <= m.ax) throw new Error(`${label}: checkOut is not to the right of checkIn`);
      if (m.aright > m.innerRight + 1 || m.bright > m.innerRight + 1) throw new Error(`${label}: a date input overruns the card inner edge (checkIn +${(m.aright - m.innerRight).toFixed(1)}px / checkOut +${(m.bright - m.innerRight).toFixed(1)}px)`);
      if (Math.abs(m.ah - m.bh) > 1) throw new Error(`${label}: input heights differ — checkIn ${m.ah.toFixed(2)} vs checkOut ${m.bh.toFixed(2)}`);
      if (Math.abs(m.abot - m.bbot) > 1) throw new Error(`${label}: input bottom edges not aligned — checkIn ${m.abot.toFixed(2)} vs checkOut ${m.bbot.toFixed(2)}`);
      // Reads as a compact card, not a full-screen form: on a stock iPhone
      // viewport (390x844) the widget should stay under ~55% of the height.
      if (height === 844) {
        const frac = m.widgetH / 844;
        if (frac > 0.55) throw new Error(`${label}: booking widget is ${(frac * 100).toFixed(0)}% of the 844px viewport (want < 55%)`);
      }
      if (SHOT_DIR) await page.locator("#hero-widget .booking-widget").screenshot({ path: `${SHOT_DIR}/booking-widget-${label}.png` });
    }

    // ---- >=768px: side-by-side, horizontal gap, equal heights + bottoms ----
    for (const [label, width, height] of [["768px", 768, 900], ["desktop", 1280, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.waitForSelector("#hero-widget .booking-widget input[name=checkIn]");
      const m = await measure();
      if (Math.abs(m.ay - m.by) > 1) throw new Error(`${label}: date inputs not on the same row — checkIn y ${m.ay.toFixed(1)} vs checkOut y ${m.by.toFixed(1)}`);
      const horizontalGap = m.bx - m.aright;
      if (horizontalGap < 4) throw new Error(`${label}: no horizontal gap between side-by-side date inputs (gap ${horizontalGap.toFixed(1)}px)`);
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

  // ---- Performance discipline (engineering-standards "Performance & delivery") ----
  await check("preconnect to the API origin is present in every public page <head>", async () => {
    for (const route of ["/", "/gallery", "/book", "/the-car", "/location", "/contact"]) {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
      const n = await page.locator('head link[rel="preconnect"][href*="fly.dev"]').count();
      const dns = await page.locator('head link[rel="dns-prefetch"][href*="fly.dev"]').count();
      if (!n) throw new Error(`${route}: no <link rel=preconnect> to the backend origin in <head>`);
      if (!dns) throw new Error(`${route}: no <link rel=dns-prefetch> fallback in <head>`);
    }
  });

  await check("Home first paint makes the minimum API calls — no GET /api/availability", async () => {
    const mark = requests.length;
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const apiCalls = requestsSince(mark).filter((u) => /\/api\//.test(u)).map((u) => u.replace(BASE, ""));
    if (apiCalls.some((u) => /\/api\/availability/.test(u))) {
      throw new Error("home fired GET /api/availability on load (defer it until the date picker opens): " + apiCalls.join(", "));
    }
    // property + gallery, nothing heavier. (quote only fires with ?checkIn in the URL.)
    const unexpected = apiCalls.filter((u) => !/\/api\/(property|gallery)(\?|$)/.test(u));
    if (unexpected.length) throw new Error("unexpected first-paint API calls on home: " + unexpected.join(", "));
  });

  await check("Gallery grid <img> use the thumbnail URL and loading=lazy", async () => {
    await page.goto(BASE + "/gallery", { waitUntil: "networkidle" });
    await page.waitForSelector(".gallery-justified img");
    const imgs = await page.locator(".gallery-justified img").evaluateAll((els) =>
      els.map((el) => ({ src: el.getAttribute("src"), loading: el.getAttribute("loading"), decoding: el.getAttribute("decoding") })));
    if (imgs.length < 20) throw new Error("expected the full grid, got " + imgs.length);
    for (const im of imgs) {
      if (!/_thumb\.jpg(\?|$)/.test(im.src || "")) throw new Error("grid image is not the *_thumb URL: " + im.src);
      if (im.loading !== "lazy") throw new Error("grid image missing loading=lazy: " + im.src);
      if (im.decoding !== "async") throw new Error("grid image missing decoding=async: " + im.src);
    }
  });

  await check("Lightbox loads the full-size URL (not the thumbnail) on open", async () => {
    await page.goto(BASE + "/gallery", { waitUntil: "networkidle" });
    const firstThumbSrc = await page.locator(".gallery-justified img").first().getAttribute("src");
    const mark = requests.length;
    await page.locator(".gallery-justified button").first().click();
    await page.waitForSelector(".lightbox", { state: "visible" });
    const bigSrc = await page.locator(".lightbox__img img").getAttribute("src");
    if (/_thumb\.jpg(\?|$)/.test(bigSrc || "")) throw new Error("lightbox is showing the thumbnail, not the full image: " + bigSrc);
    const stem = (firstThumbSrc || "").split("/").pop().replace(/_thumb\.jpg.*$/, "");
    if (!bigSrc.includes(stem)) throw new Error(`lightbox image ${bigSrc} is not the full-size of ${firstThumbSrc}`);
    const full = await page.locator(".lightbox__img img").evaluate((el) => el.complete && el.naturalWidth > 0);
    if (!full) throw new Error("lightbox full-size image did not load");
    // neighbour preload: opening image 0 warms image 1's full URL, but not all 25.
    const fullReqs = requestsSince(mark).filter((u) => /\/media\/gallery\/.*\.(jpe?g)(\?|$)/.test(u) && !/_thumb/.test(u));
    if (fullReqs.length > 4) throw new Error("lightbox pulled too many full-size images at once (expected current + neighbours): " + fullReqs.length);
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

  await check("Admin gallery upload form collects category + required alt, and shows a visible error without it", async () => {
    await page.goto(BASE + "/admin/gallery", { waitUntil: "networkidle" });
    await page.waitForSelector("#up-alt");
    const cats = await page.locator("#up-cat option").allTextContents();
    if (!cats.includes("The car")) throw new Error("upload category select lacks 'The car': " + cats.join(","));
    // no file chosen -> visible prompt, not a silent no-op
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.waitForSelector(".inline-alert--error");
    // file chosen but no alt -> visible alt-required error (backend would 422)
    await page.setInputFiles("#up", { name: "car.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.waitForSelector("text=alt text");
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

    // status badge: 'stored' shows a neutral 'Stored' label with helptext
    if (!(await page.locator(".admin-table tbody .status-badge--neutral", { hasText: "Stored" }).count())) throw new Error("no neutral 'Stored' status badge");
  });

  // ---- A9 Sent log — 'sent' / 'failed' status badges render with distinct styling ----
  await check("A9 Sent log — Sent + Failed badges render with distinct success / danger styling", async () => {
    await page.goto(BASE + "/admin/emails?tab=sent", { waitUntil: "networkidle" });
    await page.waitForSelector(".admin-table tbody tr");

    const sent = page.locator(".admin-table tbody .status-badge--sent", { hasText: "Sent" });
    const failed = page.locator(".admin-table tbody .status-badge--failed", { hasText: "Failed" });
    const stored = page.locator(".admin-table tbody .status-badge--neutral", { hasText: "Stored" });
    if (!(await sent.count())) throw new Error("no 'Sent' success badge in the sent log (fixture missing a status:sent row?)");
    if (!(await failed.count())) throw new Error("no 'Failed' danger badge in the sent log (fixture missing a status:failed row?)");

    const colOf = (loc) => loc.first().evaluate((el) => getComputedStyle(el).color);
    const rgb = (s) => (s.match(/\d+/g) || []).map(Number);
    const sentCol = rgb(await colOf(sent));
    const failedCol = rgb(await colOf(failed));
    const storedCol = rgb(await colOf(stored));

    const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    if (same(sentCol, failedCol)) throw new Error("Sent and Failed badges use the same colour: " + sentCol.join(","));
    if (same(failedCol, storedCol)) throw new Error("Failed badge is not visually distinct from the neutral Stored badge");
    // danger = red-dominant, success = green-dominant
    if (!(failedCol[0] > failedCol[1] && failedCol[0] > failedCol[2])) throw new Error("Failed badge is not a red/danger colour: rgb(" + failedCol.join(",") + ")");
    if (!(sentCol[1] >= sentCol[0])) throw new Error("Sent badge is not a green/success colour: rgb(" + sentCol.join(",") + ")");

    // the row-detail modal uses the same badge component
    await page.locator(".admin-table tbody tr", { has: page.locator(".status-badge--failed") }).first().click();
    await page.waitForSelector(".modal .detail-list");
    if (!(await page.locator(".modal .detail-list .status-badge--failed", { hasText: "Failed" }).count())) throw new Error("row-detail modal does not show the Failed danger badge");
    await page.locator(".modal button:has-text('Close')").click();
    await page.waitForSelector(".modal", { state: "detached" });
  });

  // ---- A9 Templates — 'Send test to me' surfaces the transport result inline ----
  await check("A9 Templates — 'Send test to me' surfaces sent / stored / failed inline near the button", async () => {
    // default template (bookingReceived) -> mock reports the outbox 'stored' result
    await page.goto(BASE + "/admin/emails?key=bookingReceived", { waitUntil: "networkidle" });
    await page.waitForSelector("button:has-text('Send test to me')");
    await page.locator("button:has-text('Send test to me')").click();
    await page.waitForSelector(".test-email-result .inline-alert--warning");
    if (!/outbox|doesn't send/i.test(await page.locator(".test-email-result").textContent())) throw new Error("stored result did not explain the email was not actually sent");

    // bookingApproved -> mock reports 'sent'
    await page.goto(BASE + "/admin/emails?key=bookingApproved", { waitUntil: "networkidle" });
    await page.locator("button:has-text('Send test to me')").click();
    await page.waitForSelector(".test-email-result .inline-alert--success");
    if (!/sent to .+@/i.test(await page.locator(".test-email-result").textContent())) throw new Error("'sent' result did not name the recipient address");

    // adminInvite -> mock reports 'failed' with an error string
    await page.goto(BASE + "/admin/emails?key=adminInvite", { waitUntil: "networkidle" });
    await page.locator("button:has-text('Send test to me')").click();
    await page.waitForSelector(".test-email-result .inline-alert--error");
    if (!/Send failed:/i.test(await page.locator(".test-email-result").textContent())) throw new Error("'failed' result did not show the error message");
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

  // ---- Booking widget on a real mobile engine (device emulation) ----
  // Chromium desktop renders <input type="date"> as a compact inline control,
  // so a bare viewport resize never exercises the mobile native form-control
  // path that overflows the card / renders taller than the <select> on
  // Android Chrome and iOS Safari. Emulate actual devices instead. WebKit is
  // an optional Playwright browser; if it isn't installed this check is
  // reported as skipped rather than failing the suite.
  const dateWidgetProbe = async (browserType, device, tag) => {
    const b = await browserType.launch();
    try {
      const c = await b.newContext({ ...device });
      const pg = await c.newPage();
      await pg.goto(BASE + "/", { waitUntil: "networkidle" });
      await pg.waitForSelector("#hero-widget .booking-widget input[name=checkIn]");
      await pg.evaluate(() => {
        const w = document.querySelector("#hero-widget .booking-widget");
        for (const [n, v] of [["checkIn", "2026-09-04"], ["checkOut", "2026-09-11"]]) {
          const el = w.querySelector(`input[name=${n}]`);
          el.value = v; el.dispatchEvent(new window.Event("change", { bubbles: true }));
        }
      });
      const m = await pg.evaluate(() => {
        const w = document.querySelector("#hero-widget .booking-widget");
        const cs = getComputedStyle(w);
        const wr = w.getBoundingClientRect();
        const innerRight = wr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const ci = w.querySelector("input[name=checkIn]").getBoundingClientRect();
        const co = w.querySelector("input[name=checkOut]").getBoundingClientRect();
        const sel = w.querySelector("select[name=guests]").getBoundingClientRect();
        const de = document.documentElement;
        return { innerRight, ciRight: ci.right, coRight: co.right, ciH: ci.height, coH: co.height, selH: sel.height, docOverflow: de.scrollWidth - de.clientWidth };
      });
      if (m.ciRight > m.innerRight + 1 || m.coRight > m.innerRight + 1)
        throw new Error(`${tag}: date input overflows the card (in ${(m.ciRight - m.innerRight).toFixed(1)}px / out ${(m.coRight - m.innerRight).toFixed(1)}px past inner right edge)`);
      if (Math.abs(m.ciH - m.selH) > 3 || Math.abs(m.coH - m.selH) > 3)
        throw new Error(`${tag}: date input height off from the Guests <select> by >3px (date ${m.ciH.toFixed(1)} vs select ${m.selH.toFixed(1)})`);
      if (m.docOverflow > 0) throw new Error(`${tag}: horizontal document overflow +${m.docOverflow}px`);
      await pg.locator("#hero-widget .booking-widget input[name=checkIn]").click(); // picker still opens on tap
      await c.close();
    } finally {
      await b.close();
    }
  };

  await check("Booking widget date inputs fit the card + match the Guests select — Android Chrome (Pixel 7 emulation)", async () => {
    await dateWidgetProbe(chromium, devices["Pixel 7"], "Pixel 7 / Blink");
  });

  await check("Booking widget date inputs fit the card + match the Guests select — iOS Safari (iPhone 13 / WebKit)", async () => {
    if (!webkit) { console.log("      (skipped — Playwright webkit browser not installed; run `npx playwright install webkit`)"); return; }
    try {
      await dateWidgetProbe(webkit, devices["iPhone 13"], "iPhone 13 / WebKit");
    } catch (e) {
      if (/Executable doesn't exist|Host system is missing dependencies|libevent|browserType\.launch/i.test(e.message)) {
        console.log("      (skipped — webkit present but not runnable on this host: " + e.message.split("\n")[0] + ")");
        return;
      }
      throw e;
    }
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
