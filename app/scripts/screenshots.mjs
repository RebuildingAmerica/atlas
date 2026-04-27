/**
 * Screenshot capture script for all Atlas pages.
 *
 * Usage:
 *   node scripts/screenshots.mjs
 *   ATLAS_APP_URL=http://localhost:3100 node scripts/screenshots.mjs
 *
 * Requires the dev server to be running (pnpm dev).
 * Screenshots are saved to screenshots/ at the repo root.
 */

import { chromium } from '@playwright/test';
import { mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const BASE_URL = process.env.ATLAS_APP_URL ?? 'http://localhost:3000';
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../screenshots');

/** @type {{ url: string; name: string }[]} */
const PAGES = [
  // Public pages
  { url: '/', name: 'home' },
  { url: '/browse', name: 'browse' },
  { url: '/pricing', name: 'pricing' },
  { url: '/request-discount', name: 'request-discount' },
  { url: '/profiles', name: 'profiles' },
  { url: '/profiles/people', name: 'profiles-people' },
  { url: '/profiles/organizations', name: 'profiles-organizations' },
  { url: '/profiles/people/maya-thompson', name: 'profiles-person-detail' },
  { url: '/profiles/organizations/eastside-housing-network', name: 'profiles-organization-detail' },
  { url: '/terms', name: 'terms' },
  { url: '/privacy', name: 'privacy' },
  { url: '/security', name: 'security' },
  { url: '/docs', name: 'docs' },
  // Auth flow pages
  { url: '/sign-in', name: 'sign-in' },
  { url: '/sign-up', name: 'sign-up' },
  // Authenticated pages — captures the unauthenticated redirect state
  { url: '/account', name: 'account-unauthenticated' },
  { url: '/organization', name: 'organization-unauthenticated' },
  { url: '/discovery', name: 'discovery-unauthenticated' },
  { url: '/dashboard', name: 'dashboard-unauthenticated' },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Output:   ${OUT_DIR}\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  let passed = 0;
  let failed = 0;

  for (const { url, name } of PAGES) {
    const fullUrl = `${BASE_URL}${url}`;
    const outPath = `${OUT_DIR}/${name}.png`;
    process.stdout.write(`  ${url.padEnd(40)} → ${name}.png … `);
    try {
      await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.screenshot({ path: outPath, fullPage: true });
      console.log('ok');
      passed++;
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      failed++;
    }
  }

  await browser.close();
  console.log(`\n${passed} captured, ${failed} failed → ${OUT_DIR}`);

  if (failed > 0) process.exit(1);
}

main();
