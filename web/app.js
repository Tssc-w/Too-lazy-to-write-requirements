(() => {
  const state = { research: null, researchJobId: '', selectedProductIds: [], analysis: null, analysisJobId: '', busy: false, analysisBusy: false, aiApiKey: '', brightdataConfigured: false };
  const AI_SETTINGS_KEY = 'imageBriefUserAISettings';
  const BRIGHTDATA_SETTINGS_KEY = 'imageBriefUserBrightDataSettings';
  const $ = (selector, root = document) => root.querySelector(selector);
  const STRUCTURE = [
    ['顺序与结构', 'sequence'], ['视觉风格', 'style'], ['构图', 'composition'],
    ['色彩', 'color'], ['材质表现', 'material_presentation'], ['文案安排', 'copy_strategy'],
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const redactSecrets = value => String(value ?? '').replace(/\bsk-[A-Za-z0-9_*.-]{4,}/gi, '[API Key 已隐藏]');
  const lines = value => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const jsonFetch = (url, options = {}) => fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });

  function message(selector, text, kind = '') {
    const node = $(selector);
    node.textContent = redactSecrets(text || '');
    node.className = `message${kind ? ` ${kind}` : ''}`;
  }
  function asinFromUrl(url) { return String(url || '').match(/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() || ''; }
  function productPayload() {
    return {
      product_name: $('#product-name').value.trim(), product_url: $('#product-url').value.trim(),
      sku: $('#sku').value.trim(), due_date: $('#due-date').value,
      reference_urls: lines($('#reference-urls').value),
    };
  }

  async function loadConfig() {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      const config = await response.json();
      loadAISettings(config.api_base_url);
      loadBrightDataSettings();
      updateServiceStatus();
    } catch (_) {
      loadAISettings('');
      loadBrightDataSettings();
      $('#service-status').textContent = '服务暂未连接';
    }
  }
  function loadAISettings(defaultBaseUrl = '') {
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(AI_SETTINGS_KEY) || '{}'); } catch (_) { }
    state.aiApiKey = String(saved.apiKey || '');
    $('#openai-key').value = state.aiApiKey;
    $('#api-base-url').value = saved.apiBaseUrl || defaultBaseUrl || '';
    $('#vision-model-input').value = saved.visionModel || '';
    $('#use-provider-default').checked = saved.useProviderDefault !== false;
    $('#vision-model-input').disabled = $('#use-provider-default').checked;
    $('#relay-model-select').disabled = $('#use-provider-default').checked || $('#relay-model-select').options.length < 2;
  }
  function loadBrightDataSettings() {
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(BRIGHTDATA_SETTINGS_KEY) || '{}'); } catch (_) { }
    $('#brightdata-api-token').value = String(saved.apiToken || '');
    $('#brightdata-zone').value = String(saved.zone || '');
    state.brightdataConfigured = Boolean(saved.apiToken && saved.zone);
  }
  function updateServiceStatus() {
    const aiStatus = state.aiApiKey ? '个人 AI Key 已保存' : '请填写个人 AI Key';
    const collectorStatus = state.brightdataConfigured ? '个人 Bright Data 已保存' : '个人 Bright Data 未设置（可选）';
    $('#service-status').textContent = `${aiStatus} · ${collectorStatus}`;
    $('#service-status').style.color = state.aiApiKey || state.brightdataConfigured ? '#23746a' : '';
  }
  function aiSettingsPayload() {
    return {
      api_base_url: $('#api-base-url').value.trim(),
      vision_model: $('#vision-model-input').value.trim(),
      use_provider_default: $('#use-provider-default').checked,
    };
  }
  function saveAISettings() {
    const apiKey = $('#openai-key').value.trim();
    if (!apiKey) { message('#research-message', '请填写你自己的 AI API Key。', 'error'); return; }
    const apiBaseUrl = $('#api-base-url').value.trim();
    if (!apiBaseUrl.startsWith('https://')) { message('#research-message', 'AI API Base URL 必须使用 HTTPS。', 'error'); return; }
    const settings = { apiKey, apiBaseUrl, visionModel: $('#vision-model-input').value.trim(), useProviderDefault: $('#use-provider-default').checked };
    try { sessionStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings)); }
    catch (_) { message('#research-message', '浏览器无法保存当前标签页设置，请检查浏览器存储权限。', 'error'); return; }
    state.aiApiKey = apiKey;
    updateServiceStatus();
    message('#research-message', '个人 AI 设置已保存在此浏览器标签页；关闭标签页后会清除。', 'success');
  }
  function saveCollectorSettings() {
    const apiToken = $('#brightdata-api-token').value.trim();
    const zone = $('#brightdata-zone').value.trim();
    if (Boolean(apiToken) !== Boolean(zone)) { message('#research-message', '请同时填写 Bright Data API Key 和 Web Unlocker Zone，或两项都留空。', 'error'); return; }
    try {
      if (apiToken && zone) sessionStorage.setItem(BRIGHTDATA_SETTINGS_KEY, JSON.stringify({ apiToken, zone }));
      else sessionStorage.removeItem(BRIGHTDATA_SETTINGS_KEY);
      state.brightdataConfigured = Boolean(apiToken && zone);
      updateServiceStatus();
      message('#research-message', state.brightdataConfigured
        ? '个人 Bright Data 设置已保存到此浏览器标签页；只会随你的商品采集请求发送。'
        : '已清除此标签页保存的个人 Bright Data 设置。', 'success');
    } catch (_) {
      message('#research-message', '浏览器无法保存当前标签页设置，请检查浏览器存储权限。', 'error');
    }
  }

  async function loadRelayModels() {
    const button = $('#load-models');
    button.disabled = true;
    button.textContent = '正在读取…';
    try {
      if (!state.aiApiKey) throw new Error('请先填写并保存你自己的 AI API Key。');
      const response = await jsonFetch('/api/models', { method: 'POST', headers: { 'X-User-AI-Key': state.aiApiKey }, body: JSON.stringify(aiSettingsPayload()) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '无法读取 AI 模型列表');
      const select = $('#relay-model-select');
      const currentModel = $('#vision-model-input').value.trim();
      select.innerHTML = '<option value="">请选择一个模型</option>' + result.models.map(model => `<option value="${esc(model)}">${esc(model)}</option>`).join('');
      select.disabled = false;
      if (result.models.includes(currentModel)) select.value = currentModel;
      $('#use-provider-default').checked = false;
      $('#vision-model-input').disabled = false;
      message('#research-message', `已读取 ${result.models.length} 个模型。请选择支持图片输入的模型，并重新保存个人设置。`, 'success');
    } catch (error) { message('#research-message', error.message, 'error'); }
    finally { button.disabled = false; button.textContent = '读取 API 模型列表'; }
  }

  async function pollJob(initial, messageSelector = '#research-message') {
    let job = initial;
    while (!job.done) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.job_id)}`, { cache: 'no-store' });
      job = await response.json();
      if (!response.ok) throw new Error(job.error || '任务状态查询失败');
      if (!job.done) message(messageSelector, `${job.status}。${job.progress || ''}`);
    }
    if (job.status === 'failed' || job.status === '分析失败') throw new Error(job.error || job.progress || '任务失败');
    return job;
  }

  async function startResearch() {
    const payload = productPayload();
    const brightdataApiToken = $('#brightdata-api-token').value.trim();
    const brightdataZone = $('#brightdata-zone').value.trim();
    if (Boolean(brightdataApiToken) !== Boolean(brightdataZone)) {
      message('#research-message', '请同时填写 Bright Data API Key 和 Web Unlocker Zone，或两项都留空。', 'error'); return;
    }
    payload.brightdata_api_token = brightdataApiToken;
    payload.brightdata_zone = brightdataZone;
    if (!payload.product_url && !payload.reference_urls.length) {
      message('#research-message', '请填写我方商品链接或至少一条参考商品链接。', 'error'); return;
    }
    if (payload.reference_urls.length > 20) {
      message('#research-message', '参考商品链接最多支持 20 条。', 'error'); return;
    }
    state.busy = true; state.research = null; state.analysis = null; state.selectedProductIds = [];
    $('#research-section').classList.remove('hidden'); $('#analysis-section').classList.add('hidden');
    $('#product-list').innerHTML = '<div class="empty-state">正在读取商品网页；直连失败时会尝试使用你自己的 Bright Data（如已填写）…</div>';
    $('#warnings').classList.add('hidden'); $('#analyze-button').disabled = true;
    $('#research-button').disabled = true; $('#research-button').textContent = '读取中…';
    message('#research-message', '开始读取商品链接；直连失败的链接会尝试使用你提供的 Bright Data（如已填写）。');
    $('#research-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const response = await jsonFetch('/api/research', { method: 'POST', body: JSON.stringify(payload) });
      const initial = await response.json();
      if (!response.ok) throw new Error(initial.error || '无法开始采集');
      const job = await pollJob(initial);
      if (!job.result) throw new Error(job.error || '采集任务没有返回结果');
      state.research = job.result; state.researchJobId = job.job_id;
      if (!state.research.product_name) state.research.product_name = payload.product_name;
      state.selectedProductIds = (state.research.items || []).filter(item => item.role !== '我方商品' && item.image_urls?.length).map(item => item.product_id || item.asin || item.url).filter(Boolean);
      renderResearch();
      const items = state.research.items || [];
      const directCount = items.filter(item => item.fetch_method === 'direct').length;
      const brightdataCount = items.filter(item => item.fetch_method === 'brightdata').length;
      const hasFacts = item => Boolean(item.title || item.brand || item.price || item.features?.length || item.description || item.specifications?.length || item.image_urls?.length);
      const count = items.filter(hasFacts).length;
      const unread = [];
      const unreadSources = new Set();
      for (const warning of (state.research.warnings || [])) {
        const source = warning.source || '未识别的来源';
        unread.push(`${source}\n原因：${warning.message || '未返回可读取内容'}`);
        unreadSources.add(source);
      }
      for (const item of items.filter(row => !hasFacts(row))) {
        const source = item.url || item.asin || '未识别的链接';
        if (unreadSources.has(source)) continue;
        unread.push(`${source}\n原因：${item.status || '页面未返回可确认的商品字段'}`);
      }
      const summary = `读取结束：${count} 个商品页有实际字段返回（直采 ${directCount} 条，Bright Data 回退 ${brightdataCount} 条）；已默认选择 ${state.selectedProductIds.length} 条有图参考链接。`;
      const failureDetails = unread.length ? `\n未读取链接及原因（${unread.length}）：\n${unread.map((row, index) => `${index + 1}. ${row}`).join('\n')}` : '';
      message('#research-message', summary + failureDetails, unread.length ? 'error' : count ? 'success' : 'error');
    } catch (error) {
      $('#product-list').innerHTML = '<div class="empty-state">商品读取未完成。请查看提示并确认商品页当前可从本机访问。</div>';
      message('#research-message', error.message, 'error');
    } finally {
      state.busy = false; $('#research-button').disabled = false; $('#research-button').innerHTML = '<span class="search-glyph">⌕</span> 读取商品信息与图片';
      updateSelectedReference();
    }
  }

  function fieldLine(label, value, exists = Boolean(value)) {
    return `<div class="fact-line"><strong>${esc(label)}</strong><span class="${exists ? '' : 'missing-fact'}">${exists ? esc(value) : '未返回'}</span></div>`;
  }
  function renderSpecs(specs) {
    if (!specs?.length) return '<div class="spec-empty">参数表未返回</div>';
    return `<div class="spec-list">${specs.map(row => `<div><strong>${esc(row.name)}</strong><span>${esc(row.value)}</span></div>`).join('')}</div>`;
  }
  function renderProduct(item) {
    const productId = item.product_id || item.asin || item.url;
    const selected = state.selectedProductIds.includes(productId);
    const hasData = Boolean(item.title || item.image_urls?.length || item.features?.length || item.specifications?.length);
    const image = item.image_url || item.image_urls?.[0] || '';
    const features = item.features || [];
    const methodLabel = item.fetch_method === 'brightdata' ? 'Bright Data 回退' : item.fetch_method === 'direct' ? '本机直采' : '未读取';
    return `<article class="product-card${selected ? ' selected' : ''}" data-product-id="${esc(productId)}">
      <header class="product-head">
        ${image ? `<img class="product-main-image" src="${esc(image)}" alt="${esc(item.title || item.asin)}" loading="lazy">` : '<div class="product-main-missing">暂无主图</div>'}
        <div class="product-head-copy"><div class="product-title">${esc(item.title || '商品标题未返回')}</div><div class="product-meta"><span>${esc(item.role || '指定参考')}</span><span>${esc(item.platform || '网页')}${item.asin ? ` · ASIN ${esc(item.asin)}` : ''}</span><span>${esc(item.price || '价格未返回')}</span><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">打开商品页 ↗</a></div></div>
        <label class="reference-select"><input type="checkbox" name="reference-product" value="${esc(productId)}" ${selected ? 'checked' : ''} ${item.image_urls?.length && item.role !== '我方商品' ? '' : 'disabled'}><span>加入联合分析</span></label>
      </header>
      <div class="source-status ${hasData ? 'source-ok' : 'source-error'}"><strong>采集方式：${esc(methodLabel)} · 来源状态：</strong>${esc(item.status || '未返回')} <span>${item.field_status ? '· 页面实际返回字段如下' : ''}</span></div>
      <div class="product-fact-grid">
        <div class="fact-group"><h3>商品页事实</h3>${fieldLine('品牌', item.brand, item.field_status?.brand === '已返回')}${fieldLine('价格', item.price, item.field_status?.price === '已返回')}
          <div class="fact-long"><strong>主图卖点</strong>${features.length ? `<ul>${features.map(feature => `<li>${esc(feature)}</li>`).join('')}</ul>` : '<span class="missing-fact">未返回</span>'}</div>
          <details class="spec-details"><summary>商品描述</summary><div class="description-text ${item.description ? '' : 'missing-fact'}">${item.description ? esc(item.description) : '未返回'}</div></details>
          <details class="spec-details"><summary>商品参数表 · ${item.specifications?.length || 0} 项</summary>${renderSpecs(item.specifications)}</details>
        </div>
        <div class="fact-group image-fact-group"><h3>商品详情图 <span>${item.image_urls?.length || 0} 张返回</span></h3>
          ${item.image_urls?.length ? `<div class="source-gallery">${item.image_urls.map((url, index) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="商品图 ${index + 1}" loading="lazy"><b>${index + 1}</b></a>`).join('')}</div>` : '<div class="spec-empty">页面没有返回可用图片链接</div>'}
        </div>
      </div>
    </article>`;
  }
  function renderResearch() {
    const items = state.research?.items || [];
    const warnings = state.research?.warnings || [];
    const images = items.reduce((sum, item) => sum + (item.image_urls?.length || 0), 0);
    $('#research-stats').innerHTML = `<div class="stat"><strong>${items.length}</strong><span>商品页链接</span></div><div class="stat"><strong>${images}</strong><span>返回图片</span></div><div class="stat"><strong>${items.filter(item => item.title || item.features?.length).length}</strong><span>含商品字段</span></div>`;
    if (warnings.length) {
      $('#warnings').innerHTML = warnings.map(item => `<div><strong>${esc(item.source || '采集提醒')}：</strong>${esc(item.message || '')}</div>`).join('');
      $('#warnings').classList.remove('hidden');
    } else $('#warnings').classList.add('hidden');
    $('#product-list').innerHTML = items.length ? items.map(renderProduct).join('') : '<div class="empty-state">没有读取到有效商品页；请查看上方失败原因。</div>';
    updateSelectedReference();
  }
  function updateSelectedReference() {
    const selected = (state.research?.items || []).filter(item => state.selectedProductIds.includes(item.product_id || item.asin || item.url));
    const imageCount = selected.reduce((sum, item) => sum + Math.min(item.image_urls?.length || 0, 30), 0);
    const button = $('#analyze-button');
    const disabled = !selected.length || imageCount > 180 || state.analysisBusy;
    button.disabled = disabled;
    $('#selected-reference-title').textContent = selected.length ? `已选择 ${selected.length} 条参考链接` : '尚未选择参考商品';
    $('#selected-reference-hint').textContent = state.analysisBusy
      ? 'AI 正在分析，请等待当前任务完成。'
      : imageCount > 180
      ? `所选链接共有 ${imageCount} 张图，超过单次 180 张上限，请取消部分链接。`
      : selected.length ? `共 ${imageCount} 张图，将分批识别后归纳共性；产品展示/场景图总结四条并给两项建议，其余类型各给两项建议。`
        : '默认选择所有有图参考链接；也可在商品卡片中勾选多条。单次最多联合分析 180 张图。';
  }

  async function startAnalysis() {
    if (!state.selectedProductIds.length || !state.researchJobId || state.analysisBusy) return;
    if (!state.aiApiKey) { message('#analysis-message', '请先在 AI 设置中填写并保存你自己的 API Key。', 'error'); return; }
    state.analysisBusy = true;
    state.busy = true; $('#analyze-button').disabled = true; $('#analyze-button').textContent = 'AI 分析中…';
    $('#analysis-section').classList.add('hidden');
    message('#analysis-message', '正在将图片按每批 10 张并行分析；遇到不支持的图片时会拆分批次并跳过问题图片。');
    const productUrl = $('#product-url').value.trim();
    const productAsin = asinFromUrl(productUrl);
    const ourItem = (state.research?.items || []).find(item => String(item.role || '').startsWith('我方商品'));
    const productId = ourItem?.product_id || (productAsin ? `amazon:${productAsin}` : '');
    const sameProduct = $('#same-product').checked || Boolean(state.selectedProductIds.length === 1 && productId && productId === state.selectedProductIds[0]);
    try {
      const response = await jsonFetch('/api/analyze', { method: 'POST', headers: { 'X-User-AI-Key': state.aiApiKey }, body: JSON.stringify({
        research_job_id: state.researchJobId, research_result: state.research, selected_product_ids: state.selectedProductIds,
        our_product_id: productId, our_asin: productAsin, same_product: sameProduct, purpose: $('#purpose').value.trim(),
        ...aiSettingsPayload(),
      }) });
      const initial = await response.json();
      if (!response.ok) throw new Error(initial.error || '无法启动 AI 分析');
      const job = await pollJob(initial, '#analysis-message');
      if (!job.result) throw new Error(job.error || 'AI 没有返回分析内容');
      state.analysis = job.result;
      renderAnalysis();
      $('#analysis-section').classList.remove('hidden');
      $('#analysis-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      const imageWarnings = state.analysis.image_warnings || [];
      const warningDetails = imageWarnings.length
        ? `\n有 ${imageWarnings.length} 张图片被 AI 服务拒绝并跳过：${imageWarnings.slice(0, 5).map(item => `${item.source_title || '参考商品'}第 ${item.source_image_index} 张`).join('、')}${imageWarnings.length > 5 ? '等' : ''}。其余图片已继续分析。`
        : '';
      message('#analysis-message', `套图归纳完成：${state.analysis.reference_products?.length || 1} 条链接、${state.analysis.image_count || 0} 张图片已形成四条共性总结和 ${state.analysis.image_groups?.length || 0} 类建议（含产品展示/场景图）。${warningDetails}`, imageWarnings.length ? '' : 'success');
    } catch (error) { message('#analysis-message', error.message, 'error'); }
    finally { state.busy = false; state.analysisBusy = false; $('#analyze-button').textContent = '联合分析所选套图'; updateSelectedReference(); }
  }

  function renderAnalysis() {
    const analysis = state.analysis;
    if (!analysis) return;
    const ref = analysis.reference_product || {};
    const references = analysis.reference_products?.length ? analysis.reference_products : (ref.url ? [ref] : []);
    const our = analysis.our_product || {};
    const benefits = analysis.core_benefits || [];
    $('#product-summary').innerHTML = `<div class="summary-card"><span>商品分析 · ${references.length} 条参考链接</span><strong>${esc(analysis.product_summary_zh || references.map(item => item.title || item.asin).join('；') || '参考商品摘要未返回')}</strong><p>${esc(analysis.source_basis_zh || '依据商品页实际返回字段和所选商品图片')}</p><div class="benefit-tags">${benefits.map(value => `<em>${esc(value)}</em>`).join('') || '<em>商品卖点未返回</em>'}</div></div><div class="summary-card diff-card"><span>我方与参考商品</span><strong>${esc(analysis.differentiation_zh || (analysis.same_product ? '同款页面未支持差异化结论' : '暂无差异结论'))}</strong><p>${esc(our.title ? `我方：${our.title}` : '未提供我方商品页信息')}</p><div class="reference-source-links">${references.map((item, index) => `<a href="${esc(item.url || '#')}" target="_blank" rel="noopener noreferrer">参考 ${index + 1}：${esc(item.title || item.asin || '打开商品页')} ↗</a>`).join('')}</div></div>`;
    const structure = analysis.overall_structure || {};
    $('#summary-heading').textContent = `四条${analysis.summary_scope || '套图'}总结（${analysis.summary_image_count || analysis.image_count || 0} 张参考图）`;
    $('#summary-points').innerHTML = (analysis.summary_points || []).slice(0, 4).map((point, index) => `<article><span>共性总结 ${index + 1}</span><p>${esc(point)}</p></article>`).join('');
    $('#structure-summary').innerHTML = STRUCTURE.map(([label, key]) => `<article><span>${esc(label)}</span><p>${esc(structure[key] || '未返回，建议人工补充')}</p></article>`).join('');
    const groups = analysis.image_groups || [];
    const suggestionCount = groups.reduce((total, group) => total + (group.suggestions || []).length, 0);
    $('#analysis-count').textContent = ` · ${references.length} 条链接 · ${analysis.image_count || 0} 张图片 · ${groups.length} 类提供方案`;
    $('#row-count').textContent = `${suggestionCount} 项类型建议`;
    $('#copy-all-prompts').disabled = suggestionCount === 0;
    $('#image-groups').innerHTML = groups.map((group, groupIndex) => renderSuggestionGroup(group, groupIndex)).join('');
    updateExportStatus();
  }
  function renderSuggestionGroup(group, groupIndex) {
    const suggestions = group.suggestions || [];
    const sources = group.reference_sources || [];
    const examples = group.example_images || [];
    return `<section class="image-group-card">
      <header><div><span>图片类型 · ${esc(group.image_count || 0)} 张作为参考</span><h3>${esc(group.type)}</h3></div><span class="editable-pill">${suggestions.length} 项建议</span></header>
      <p class="group-common-pattern"><strong>同类图片共性</strong>${esc(group.shared_patterns || '未返回共性描述，请结合下方建议复核。')}</p>
      ${sources.length ? `<div class="group-sources">参考来源：${sources.map((url, index) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">链接 ${index + 1} ↗</a>`).join(' ')}</div>` : ''}
      <div class="example-gallery"><strong>对应竞品例图</strong><small>以下为本类型实际采集的参考图片，供理解方案方向；不是生成后的我方成图。</small><div class="example-gallery-grid">${examples.map(example => `<a class="example-image" href="${esc(example.image_url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(example.image_url)}" alt="${esc(example.reference_title || group.type)} 参考例图" loading="lazy" referrerpolicy="no-referrer"><span>${esc(example.reference_title || '参考竞品')}${example.sequence_position ? ` · 第 ${esc(example.sequence_position)} 张` : ''}</span></a>`).join('') || '<span class="example-empty">本类型未返回可展示的图片地址，可从上方商品来源链接查看。</span>'}</div></div>
      <div class="suggestion-grid">${suggestions.map((suggestion, suggestionIndex) => `<article class="suggestion-card">
        <div class="suggestion-title"><span>方案 ${suggestionIndex + 1}</span><label class="suggestion-export-choice"><input type="checkbox" data-export-select data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}" ${suggestion.export_selected ? 'checked' : ''}><span>导出此方案</span></label><input aria-label="方案名称" value="${esc(suggestion.title || '')}" data-group-field="title" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}" placeholder="方案名称"></div>
        <label class="edit-field"><span>设计建议</span><textarea data-group-field="direction" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}">${esc(suggestion.direction || '')}</textarea></label>
        <label class="edit-field"><span>对应买家关注点</span><textarea data-group-field="buyer_focus_zh" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}">${esc(suggestion.buyer_focus_zh || '')}</textarea></label>
        <div class="copy-pair">
          <label class="edit-field"><span>画面文案 / 卖点文字</span><textarea data-group-field="copy_zh" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}" placeholder="可直接展示在图片上的短句">${esc(suggestion.copy_zh || '')}</textarea></label>
          <label class="edit-field"><span>English on-image copy</span><textarea data-group-field="copy_en" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}" placeholder="Short phrase for the image">${esc(suggestion.copy_en || '')}</textarea></label>
        </div>
        <label class="edit-field"><span>中文生图指令</span><textarea class="prompt-area" data-group-field="prompt_zh" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}">${esc(suggestion.prompt_zh || '')}</textarea><button class="copy-button" type="button" data-copy-field="prompt_zh" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}">复制中文指令</button></label>
        <label class="edit-field"><span>English image-generation prompt</span><textarea class="prompt-area" data-group-field="prompt_en" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}">${esc(suggestion.prompt_en || '')}</textarea><button class="copy-button" type="button" data-copy-field="prompt_en" data-group-index="${groupIndex}" data-suggestion-index="${suggestionIndex}">Copy English prompt</button></label>
      </article>`).join('')}</div>
    </section>`;
  }

  function exportSelection() {
    const analysis = state.analysis || {};
    const allSuggestions = (analysis.image_groups || []).flatMap(group => group.suggestions || []);
    const hasExplicitSelection = allSuggestions.some(suggestion => suggestion.export_selected === true);
    const groups = (analysis.image_groups || []).map(group => {
      const groupHasSelection = (group.suggestions || []).some(suggestion => suggestion.export_selected === true);
      return {
        ...group,
        suggestions: (group.suggestions || []).filter(suggestion => !groupHasSelection || suggestion.export_selected === true),
      };
    }).filter(group => group.suggestions.length);
    return { hasExplicitSelection, groups, analysis: { ...analysis, image_groups: groups } };
  }
  function exportRows(analysis = state.analysis || {}) {
    const structure = analysis.overall_structure || {};
    const style = [structure.style, structure.composition, structure.color, structure.material_presentation].filter(Boolean).join('；');
    return (analysis.image_groups || []).flatMap(group => (group.suggestions || []).map((suggestion, index) => ({
      position: `${group.type} · 方案 ${index + 1}`, type: group.type, quantity: '1',
      size: $('#image-size').value.trim() || '2000*2000',
      content: [group.shared_patterns, suggestion.direction, suggestion.prompt_zh].filter(Boolean).join('；'),
      buyer_focus: suggestion.buyer_focus_zh || suggestion.direction || (analysis.core_benefits || []).join('；') || '依据参考图共性填写',
      copy: [suggestion.copy_en, suggestion.copy_zh].filter(Boolean).join(' / ') || '待补充',
      reference: (group.reference_sources || []).join('\n') || analysis.reference_product?.url || '无', style: style || '依据四条套图共性总结及类型建议',
      delivery: $('#delivery-requirement').value.trim() || '高清',
      notes: '',
    })));
  }
  function updateExportStatus() {
    const selection = exportSelection();
    const groups = selection.groups;
    const suggestions = groups.flatMap(group => (group.suggestions || []).map(item => ({ type: group.type, ...item })));
    const totalCount = (state.analysis?.image_groups || []).reduce((total, group) => total + (group.suggestions || []).length, 0);
    $('#row-count').textContent = selection.hasExplicitSelection
      ? `本次导出 ${suggestions.length}/${totalCount} 项建议`
      : `${totalCount} 项建议（全部导出）`;
    if (!suggestions.length) {
      $('#export-button').disabled = !(state.analysis?.summary_points?.length);
      $('#export-message').textContent = state.analysis?.summary_points?.length ? '四条共性总结已就绪，可将总结和整体视觉规律导出到模板。' : '完成套图共性归纳后，可导出到模板。';
      $('#export-message').className = `validation-message${state.analysis?.summary_points?.length ? ' ready' : ''}`;
      return;
    }
    const needsCopy = Boolean(state.analysis?.our_product);
    const issues = suggestions.flatMap(item => [
      !item.direction.trim() ? `${item.type}有建议内容待补充` : '',
      needsCopy && !item.copy_zh.trim() ? `${item.type}缺少画面文案/卖点文字` : '',
    ].filter(Boolean));
    $('#export-button').disabled = Boolean(issues.length);
    const hasOurFacts = Boolean(state.analysis?.our_product);
    $('#export-message').textContent = issues.length ? issues.slice(0, 3).join('；') : (hasOurFacts
      ? '分类方案已就绪。画面文案、设计建议和中英文指令会按类型写入模板。'
      : '目前只有参考商品事实。可导出参考分析；我方商品文案与生图指令留空，补充我方商品链接后可生成定制内容。');
    $('#export-message').className = `validation-message${issues.length ? '' : ' ready'}`;
  }
  async function copyText(text) {
    if (!text) throw new Error('没有可复制内容');
    await navigator.clipboard.writeText(text);
  }
  async function copyAllPrompts() {
    const groups = state.analysis?.image_groups || [];
    const text = groups.flatMap(group => (group.suggestions || []).map((suggestion, index) => `${group.type} · 方案 ${index + 1}\n画面文案：${suggestion.copy_zh || ''}\n中文指令：${suggestion.prompt_zh || ''}\nEnglish copy: ${suggestion.copy_en || ''}\nEnglish prompt: ${suggestion.prompt_en || ''}`)).join('\n\n');
    try { await copyText(text); message('#analysis-message', '已复制全部类型建议、画面文案和中英文生图指令。', 'success'); }
    catch (error) { message('#analysis-message', error.message || '复制失败，请逐条复制。', 'error'); }
  }
  async function exportWorkbook() {
    if (!state.analysis) return;
    const selection = exportSelection();
    const rows = exportRows(selection.analysis);
    const button = $('#export-button'); button.disabled = true; button.textContent = '正在填写模板…';
    const our = state.analysis.our_product || {};
    const ref = state.analysis.reference_product || {};
    const product = {
      name: $('#product-name').value.trim() || our.title || (state.analysis.same_product ? ref.title : '参考竞品分析'),
      sku: $('#sku').value.trim() || asinFromUrl($('#product-url').value),
      asin: asinFromUrl($('#product-url').value) || (state.analysis.same_product ? ref.asin : ''), due_date: $('#due-date').value,
      submitter: $('#submitter').value.trim(), priority: $('#priority').value, purpose: $('#purpose').value.trim(), status: '待提交',
    };
    try {
      const response = await jsonFetch('/api/export', { method: 'POST', body: JSON.stringify({ product, rows, research: state.research || { items: [], warnings: [] }, analysis: selection.analysis }) });
      if (!response.ok) {
        let error = {}; try { error = await response.json(); } catch (_) { }
        throw new Error(error.error || '导出失败');
      }
      const blob = await response.blob();
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
      link.download = `做图需求表_${product.sku || '商品'}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
      $('#export-message').textContent = '已根据当前编辑内容生成并下载 Excel 图需表。';
      $('#export-message').className = 'validation-message ready';
    } catch (error) { $('#export-message').textContent = redactSecrets(error.message); $('#export-message').className = 'validation-message'; }
    finally { button.textContent = '填写模板并下载 Excel'; updateExportStatus(); }
  }

  $('#save-ai-settings').addEventListener('click', saveAISettings);
  $('#save-collector-settings').addEventListener('click', saveCollectorSettings);
  $('#load-models').addEventListener('click', loadRelayModels);
  $('#use-provider-default').addEventListener('change', event => {
    $('#vision-model-input').disabled = event.target.checked;
    $('#relay-model-select').disabled = event.target.checked || $('#relay-model-select').options.length < 2;
  });
  $('#relay-model-select').addEventListener('change', event => {
    if (!event.target.value) return;
    $('#vision-model-input').value = event.target.value;
    $('#use-provider-default').checked = false;
    $('#vision-model-input').disabled = false;
  });
  $('#vision-model-input').addEventListener('input', event => {
    const option = Array.from($('#relay-model-select').options).find(item => item.value === event.target.value);
    $('#relay-model-select').value = option ? option.value : '';
  });
  $('#research-button').addEventListener('click', startResearch);
  $('#analyze-button').addEventListener('click', startAnalysis);
  $('#export-button').addEventListener('click', exportWorkbook);
  $('#copy-all-prompts').addEventListener('click', copyAllPrompts);
  $('#product-list').addEventListener('change', event => {
    if (event.target.matches('input[name="reference-product"]')) {
      state.selectedProductIds = event.target.checked
        ? [...new Set([...state.selectedProductIds, event.target.value])]
        : state.selectedProductIds.filter(productId => productId !== event.target.value);
      const ourAsin = asinFromUrl($('#product-url').value);
      const ourItem = (state.research?.items || []).find(item => String(item.role || '').startsWith('我方商品'));
      const ourId = ourItem?.product_id || (ourAsin ? `amazon:${ourAsin}` : '');
      $('#same-product').checked = Boolean(ourId && state.selectedProductIds.length === 1 && ourId === state.selectedProductIds[0]);
      renderResearch();
    }
  });
  $('#image-groups').addEventListener('input', event => {
    const field = event.target.dataset.groupField;
    if (!field || !state.analysis?.image_groups) return;
    const group = state.analysis.image_groups[Number(event.target.dataset.groupIndex)];
    const suggestion = group?.suggestions?.[Number(event.target.dataset.suggestionIndex)];
    if (!suggestion) return;
    suggestion[field] = event.target.value;
    updateExportStatus();
  });
  $('#image-groups').addEventListener('change', event => {
    if (event.target.matches('[data-export-select]')) {
      const group = state.analysis?.image_groups?.[Number(event.target.dataset.groupIndex)];
      const suggestion = group?.suggestions?.[Number(event.target.dataset.suggestionIndex)];
      if (suggestion) suggestion.export_selected = event.target.checked;
      updateExportStatus();
      return;
    }
    const field = event.target.dataset.groupField;
    if (!field || !state.analysis?.image_groups) return;
    const suggestion = state.analysis.image_groups[Number(event.target.dataset.groupIndex)]?.suggestions?.[Number(event.target.dataset.suggestionIndex)];
    if (suggestion) suggestion[field] = event.target.value;
    updateExportStatus();
  });
  $('#image-groups').addEventListener('click', async event => {
    const button = event.target.closest('[data-copy-field]');
    if (!button) return;
    const suggestion = state.analysis?.image_groups?.[Number(button.dataset.groupIndex)]?.suggestions?.[Number(button.dataset.suggestionIndex)];
    try { await copyText(suggestion?.[button.dataset.copyField]); message('#analysis-message', '提示词已复制。', 'success'); }
    catch (error) { message('#analysis-message', error.message, 'error'); }
  });
  $('#same-product').addEventListener('change', updateSelectedReference);
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const isExampleImage = image.matches('.example-image img');
    if (image.matches('.product-main-image')) {
      const placeholder = document.createElement('div');
      placeholder.className = 'product-main-missing'; placeholder.textContent = '图片无法加载';
      image.replaceWith(placeholder); return;
    }
    image.style.display = 'none';
    const container = image.parentElement;
    container?.classList.add('image-load-failed');
    if (container && !container.querySelector('.image-load-note')) {
      const note = document.createElement('span'); note.className = 'image-load-note';
      note.textContent = isExampleImage ? '例图预览加载失败，可能是源站限制或图片链接失效；点击卡片可重试' : '图片链接无法读取';
      container.appendChild(note);
    }
  }, true);
  loadConfig();
})();
