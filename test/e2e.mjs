// End-to-end test on phone + desktop viewports.
// Usage: BASE=http://localhost:3100 OUT=/tmp/shots ASSETS=/tmp/assets node test/e2e.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.OUT || '/tmp/shots';
const ASSETS = process.env.ASSETS || '/tmp/assets';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
const ok = (name) => { results.push(['✔', name]); console.log('✔', name); };
const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

const browser = await chromium.launch();

// ───────────── Phone ─────────────
const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar', acceptDownloads: true, timezoneId: 'Europe/Berlin' });
const p = await phone.newPage();
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

try {
  await p.goto(BASE);
  await p.getByRole('heading', { name: 'إنشاء الحساب' }).waitFor();
  await shot(p, '01_setup');
  await p.getByLabel('الاسم').fill('Ahmad Hammoudi');
  await p.getByLabel('الإيميل').fill('ahmad@go-trend-marketing.de');
  await p.getByLabel('كلمة السر', { exact: true }).fill('Sicher2026!');
  await p.getByLabel('أعد كلمة السر').fill('Sicher2026!');
  await p.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await p.getByText('الصافي لهالشهر').waitFor();
  ok('setup + login lands on month page');
  await shot(p, '02_month_empty');

  // Subscription
  await p.getByRole('link', { name: '+ أضف اشتراك' }).click();
  await p.getByRole('button', { name: 'اشتراك جديد' }).click();
  await p.getByLabel('الاسم').fill('Google Cloud');
  await p.getByLabel('الشركة').fill('Google');
  await p.getByLabel('المبلغ التقريبي €').fill('30');
  await shot(p, '03_subscription_form');
  await p.getByRole('button', { name: 'حفظ' }).click();
  await p.getByText('المصاريف الشهرية الثابتة').waitFor();
  ok('subscription created');

  // Client
  await p.getByRole('link', { name: 'العملاء' }).click();
  await p.getByRole('button', { name: 'عميل جديد' }).click();
  await p.getByLabel('اسم الشركة').fill('Elite Trade GmbH');
  await p.getByLabel('الشخص المسؤول').fill('Herr Tarek Mansour');
  await p.getByLabel('الشارع ورقم البناية').fill('Kettwiger Str. 18');
  await p.getByLabel('الرمز البريدي').fill('45127');
  await p.getByLabel('المدينة').fill('Essen');
  await p.getByLabel('الإيميل').fill('buchhaltung@elitetrade.de');
  await shot(p, '04_client_form');
  await p.getByRole('button', { name: 'إضافة العميل' }).click();
  await p.getByText('Elite Trade GmbH').first().waitFor();
  ok('client created');
  await shot(p, '05_clients');

  // Invoice from client page
  await p.getByText('Elite Trade GmbH').first().click();
  await p.getByRole('button', { name: 'فاتورة جديدة' }).click();
  await p.getByPlaceholder(/الوصف/).first().fill('Social Media Betreuung Oktober 2026\nInstagram & Facebook: 12 Beiträge, Stories, Community Management');
  await p.getByLabel('السعر €').first().fill('1200');
  await p.getByRole('button', { name: 'بند جديد' }).click();
  await p.getByPlaceholder(/الوصف/).nth(1).fill('Meta Ads Kampagnenmanagement');
  await p.getByLabel('الكمية').nth(1).fill('1');
  await p.getByLabel('السعر €').nth(1).fill('650,00');
  await p.getByRole('button', { name: 'هالشهر' }).click();
  await p.getByLabel('العنوان (اختياري)').fill('Marketing-Leistungen Oktober 2026');
  await p.getByText('1.850,00 €').first().waitFor();
  ok('invoice totals computed live (1.850,00 €)');
  await shot(p, '06_invoice_editor');
  await p.getByRole('button', { name: 'معاينة' }).click();
  await p.locator('canvas').first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, '07_invoice_preview_mobile.png') });
  ok('mobile invoice preview renders PDF');
  await p.getByRole('button', { name: 'إغلاق' }).click();
  await p.getByRole('button', { name: 'إصدار' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'إصدار' }).click();
  await p.getByText('RE-2026-0001').first().waitFor();
  await p.locator('canvas').first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(500);
  ok('invoice issued with number RE-2026-0001');
  await shot(p, '08_invoice_view', false);

  // Download PDF
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'تحميل PDF' }).click()]);
  const pdfPath = path.join(OUT, await dl.suggestedFilename());
  await dl.saveAs(pdfPath);
  assert(fs.readFileSync(pdfPath).subarray(0, 4).toString() === '%PDF', 'pdf download');
  ok(`invoice PDF downloaded (${path.basename(pdfPath)})`);

  // Mark paid
  await p.getByRole('button', { name: 'تم الدفع' }).click();
  await p.getByRole('button', { name: 'تأكيد' }).click();
  await p.getByText('مدفوعة').first().waitFor();
  ok('invoice marked paid');

  // Receipt via FAB camera
  await p.getByRole('link', { name: 'الشهر' }).click();
  await p.getByText('الصافي لهالشهر').waitFor();
  await p.getByRole('button', { name: 'إضافة' }).click();
  await p.waitForTimeout(400);
  await shot(p, '09_add_sheet', false);
  await p.locator('#gt-cam').setInputFiles(path.join(ASSETS, 'receipt.jpg'));
  await p.getByRole('heading', { name: 'إيصال جديد' }).waitFor();
  await p.getByPlaceholder('0,00').fill('389,00');
  await p.getByPlaceholder(/Amazon/).fill('MediaMarkt');
  await shot(p, '10_receipt_form');
  await p.getByRole('button', { name: 'حفظ', exact: true }).click();
  await p.getByText('الصافي لهالشهر').waitFor();
  ok('receipt captured and saved into the month');

  // Subscription receipt from checklist
  await p.locator('#subs').scrollIntoViewIfNeeded();
  await p.getByRole('button', { name: 'ارفع' }).click();
  await p.getByRole('heading', { name: 'إيصال جديد' }).waitFor();
  assert((await p.getByPlaceholder('0,00').inputValue()) === '30,00', 'subscription amount prefilled');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'ملف / PDF' }).click()]);
  await fc.setFiles(path.join(ASSETS, 'kontoauszug.pdf'));
  await p.getByRole('button', { name: 'حفظ', exact: true }).click();
  await p.getByText('الصافي لهالشهر').waitFor();
  ok('subscription receipt uploaded from monthly checklist');

  // Bank statement via checklist link
  await p.getByText('كشف حساب البنك لسا ما انرفع').click();
  await p.getByRole('heading', { name: 'إيصال جديد' }).waitFor();
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'ملف / PDF' }).click()]);
  await fc2.setFiles(path.join(ASSETS, 'kontoauszug.pdf'));
  await p.getByRole('button', { name: 'حفظ', exact: true }).click();
  await p.getByText('الصافي لهالشهر').waitFor();
  await p.waitForTimeout(400);
  ok('bank statement uploaded');
  await shot(p, '11_month_full');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(3200);
  await shot(p, '11b_month_viewport', false);

  // Manual expense without file
  await p.getByRole('button', { name: 'إضافة' }).click();
  await p.getByRole('button', { name: /مصروف بدون ملف/ }).click();
  await p.getByPlaceholder('0,00').fill('45,50');
  await p.getByRole('button', { name: 'مصروف آخر' }).click();
  await p.getByPlaceholder(/Amazon/).fill('Aral Tankstelle');
  await p.getByRole('button', { name: 'حفظ', exact: true }).click();
  await p.getByText('الصافي لهالشهر').waitFor();
  await p.getByText('1 مصروف بدون إيصال').waitFor();
  ok('manual expense saved, flagged as missing receipt');

  // Folder view
  await p.getByRole('link', { name: /المشتريات/ }).click();
  await p.getByText('MediaMarkt').waitFor();
  await shot(p, '12_folder_purchases');
  await p.getByText('MediaMarkt').click();
  await p.getByRole('heading', { name: 'تفاصيل الإيصال' }).waitFor();
  await p.waitForTimeout(300);
  await shot(p, '13_entry_detail');
  ok('entry detail opens with image');

  // Export
  await p.getByRole('link', { name: 'الشهر' }).click();
  await p.getByRole('button', { name: 'تصدير للمحاسب' }).click();
  await p.waitForTimeout(400);
  await shot(p, '14_export_sheet', false);
  const [zdl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'تحميل الملف' }).click()]);
  const zipPath = path.join(OUT, await zdl.suggestedFilename());
  await zdl.saveAs(zipPath);
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  console.log(names.join('\n'));
  assert(names.some((n) => n.includes('01_Ausgangsrechnungen/RE-2026-0001')), 'zip has invoice');
  assert(names.some((n) => n.includes('02_Einkaeufe/') && n.includes('MediaMarkt')), 'zip has receipt');
  assert(names.some((n) => n.includes('03_Abonnements_Fixkosten/')), 'zip has subscription');
  assert(names.some((n) => n.includes('05_Kontoauszug/')), 'zip has bank statement');
  ok(`month export ZIP downloaded with ${names.length} files`);
} catch (e) {
  await shot(p, 'zz_phone_failure').catch(() => null);
  console.error('PHONE FAILURE:', e.message);
  errors.push('PHONE: ' + e.message);
}

// ───────────── Desktop ─────────────
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar', acceptDownloads: true, timezoneId: 'Europe/Berlin', storageState: await phone.storageState() });
const d = await desk.newPage();
d.on('pageerror', (e) => errors.push(`desk pageerror: ${e.message}`));
d.on('console', (m) => { if (m.type() === 'error') errors.push(`desk console: ${m.text()}`); });
try {
  await d.goto(BASE + '/month');
  await d.getByText('الصافي لهالشهر').waitFor();
  await d.waitForTimeout(400);
  await shot(d, '20_desktop_month');
  ok('desktop month view');

  // Design settings with logo
  await d.goto(BASE + '/settings/design');
  await d.getByText('القالب').waitFor();
  const [lc] = await Promise.all([d.waitForEvent('filechooser'), d.getByRole('button', { name: 'رفع اللوغو' }).click()]);
  await lc.setFiles(path.join(ASSETS, 'logo.svg'));
  await d.getByText('انرفع اللوغو').waitFor();
  await d.getByRole('button', { name: 'كلاسيكي', exact: true }).click();
  await d.getByRole('button', { name: '#0f766e' }).click();
  await d.waitForTimeout(2500);
  await shot(d, '21_desktop_design_classic');
  await d.getByRole('button', { name: 'عصري', exact: true }).click();
  await d.getByRole('button', { name: '#4f46e5' }).click();
  await d.waitForTimeout(2500);
  ok('logo uploaded and invoice design changed');

  // Quote with live preview on desktop
  await d.goto(BASE + '/invoices/new?kind=quote');
  await d.getByRole('button', { name: 'اختار عميل' }).click();
  await d.getByRole('dialog').getByText('Elite Trade GmbH').click();
  await d.getByPlaceholder(/الوصف/).first().fill('Website Relaunch inkl. SEO\nResponsive Design, 8 Unterseiten, Onpage-SEO, DSGVO-konform');
  await d.getByLabel('السعر €').first().fill('3200');
  await d.waitForTimeout(2500);
  await shot(d, '22_desktop_quote_editor');
  await d.getByRole('button', { name: 'إصدار' }).click();
  await d.getByRole('dialog').getByRole('button', { name: 'إصدار' }).click();
  await d.getByText('AN-2026-0001').first().waitFor();
  ok('quote issued AN-2026-0001');
  await d.getByRole('button', { name: 'حوّل لفاتورة' }).click();
  await d.getByText('من عرض السعر').waitFor();
  await d.getByRole('button', { name: 'إصدار' }).click();
  await d.getByRole('dialog').getByRole('button', { name: 'إصدار' }).click();
  await d.getByText('RE-2026-0002').first().waitFor();
  ok('quote converted into invoice RE-2026-0002');

  // Correct invoice
  await d.getByRole('button', { name: /تصحيح الفاتورة/ }).click();
  await d.getByRole('dialog').getByRole('textbox').fill('Preis angepasst');
  await d.getByRole('dialog').getByRole('button', { name: 'تصحيح' }).click();
  await d.getByText('تصحيح للفاتورة').waitFor();
  await d.getByLabel('السعر €').first().fill('2900');
  await d.getByRole('button', { name: 'إصدار' }).click();
  await d.getByRole('dialog').getByRole('button', { name: 'إصدار' }).click();
  await d.getByText('RE-2026-0003').first().waitFor();
  await d.waitForTimeout(1200);
  await shot(d, '23_desktop_invoice_view');
  ok('correction: storno + new invoice RE-2026-0003');

  await d.goto(BASE + '/invoices');
  await d.getByText('ST-2026-0001').waitFor();
  await shot(d, '24_desktop_invoices');
  ok('invoice list shows storno');

  // Cancel last invoice → storno
  await d.getByText('RE-2026-0003').click();
  await d.getByRole('button', { name: /إلغاء الفاتورة/ }).click();
  await d.getByRole('dialog').getByRole('textbox').fill('Auftrag storniert');
  await d.getByRole('dialog').getByRole('button', { name: 'إلغاء الفاتورة' }).click();
  await d.getByText('ST-2026-0002').first().waitFor();
  ok('cancel creates ST-2026-0002');

  await d.goto(BASE + '/settings/tax');
  await d.getByText('ترقيم الفواتير').waitFor();
  await shot(d, '25_desktop_tax');
  await d.goto(BASE + '/settings/audit');
  await d.waitForTimeout(500);
  await shot(d, '26_desktop_audit');
  ok('settings pages render');
} catch (e) {
  await shot(d, 'zz_desktop_failure').catch(() => null);
  console.error('DESKTOP FAILURE:', e.message);
  errors.push('DESKTOP: ' + e.message);
}

await browser.close();
console.log('\n──────── RESULT ────────');
console.log(`${results.length} steps passed`);
if (errors.length) {
  console.log('Errors:');
  for (const e of errors) console.log(' ✘', e);
  process.exit(1);
}
console.log('No errors.');
