const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let linkCalls = 0, batchCalls = 0, summaryCalls = 0;
  let allowFailure = true;
  const reference = { role: '指定参考', product_id: 'test-ref', url: 'https://example.com/product', title: 'Test product', brand: 'Test', price: '12', features: ['Visible product feature'], specifications: [], image_urls: Array.from({ length: 5 }, (_, i) => `https://example.com/${i + 1}.jpg`), field_status: { brand: '已返回', price: '已返回' }, fetch_method: 'direct', status: '直采读取成功' };
  const suggestions = [1, 2].map(i => ({ title: `方案 ${i}`, direction: `可编辑建议 ${i}`, buyer_focus_zh: '产品展示', copy_zh: '', copy_en: '', prompt_zh: '', prompt_en: '' }));
  const analysis = { reference_product: reference, reference_products: [reference], our_product: null, product_summary_zh: '测试摘要', core_benefits: [], summary_points: ['共性一', '共性二', '共性三', '共性四'], overall_structure: { style: '明亮' }, image_count: 5, image_groups: [{ type: '卖点图', image_count: 5, shared_patterns: '清晰展示', suggestions, reference_sources: [reference.url], example_images: [] }] };
  await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="gray"/></svg>' }));
  await page.route('**/api/research/link', async route => { linkCalls++; await route.fulfill({ json: { item: reference } }); });
  await page.route('**/api/analyze/batch', async route => {
    batchCalls++;
    const data = route.request().postDataJSON();
    if (data.source_image_start === 5 && allowFailure) {
      return route.fulfill({ status: 504, contentType: 'text/html', body: '<html>Gateway Timeout</html>' });
    }
    await route.fulfill({ json: { result: { images: data.reference.image_urls.map((url, i) => ({ source_image_index: data.source_image_start + i, image_url: url, type: '卖点图', visual_observation: '可见产品' })), core_benefits: [] } } });
  });
  await page.route('**/api/analyze/summary', async route => { summaryCalls++; await route.fulfill({ json: { result: analysis } }); });
  await page.goto('http://127.0.0.1:18766/');
  await page.evaluate(() => {
    sessionStorage.setItem('imageBriefUserAISettings', JSON.stringify({ apiKey: 'test-only-personal-key', apiBaseUrl: 'https://example.com/v1', useProviderDefault: true }));
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#openai-key').value === 'test-only-personal-key');
  await page.locator('#reference-urls').fill(reference.url);
  await page.locator('#research-button').click();
  await page.waitForFunction(() => document.querySelector('#research-message').textContent.includes('读取结束'));
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => document.querySelector('#analysis-message').textContent.includes('已保留成功批次'));
  assert.equal(batchCalls, 2);
  assert.equal(summaryCalls, 0);
  const draft = await page.evaluate(() => sessionStorage.getItem('imageBriefDraft.v2'));
  assert(!draft.includes('test-only-personal-key'));
  assert.equal(Object.keys(JSON.parse(draft).analysisResume.batches).length, 1);
  allowFailure = false;
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#research-message').textContent.includes('已恢复'));
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => document.querySelector('#analysis-message').textContent.includes('套图归纳完成'));
  assert.equal(batchCalls, 3, 'completed batch must not run again after reload');
  assert.equal(summaryCalls, 1);
  const direction = page.locator('[data-group-field="direction"]').first();
  await direction.fill('人工编辑并保存');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-group-field="direction"]')?.value === '人工编辑并保存');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null);
  await download.saveAs('outputs/reliability-browser-export.xlsx');
  await page.screenshot({ path: 'outputs/reliability-browser.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(linkCalls, 1);
  console.log(JSON.stringify({ browser: 'passed', linkCalls, batchCalls, summaryCalls, refreshResume: true, editedDraftRestored: true, actualExcelDownload: true, pageErrors: errors }));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
