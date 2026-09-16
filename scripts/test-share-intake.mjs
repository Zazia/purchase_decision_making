import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { runPipeline, diagnoseRecord, matchSnapshotValue } from './intake/run-pipeline.mjs';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = createRequire(join(root, 'packages/apple-value-engine/package.json'))('typescript');
const clone = x => JSON.parse(JSON.stringify(x));
const params = { category: 'mac-mini', budget: 5000, buyTiming: 'used', performanceFloor: 0.5, holdingYears: [1, 2, 3] };
const point = { model: 'M2_16G_256G_二手 × 2年', chip: 'M2', buyTiming: 'used', holdingYears: 2,
  buyPrice: 2700, monthlyCost: 100, avgPerformance: 0.7, residual: 1000, maintenanceCost: 100,
  holdingMonths: 24, performanceS0: 0.8, performanceSN: 0.6 };
const report = { params, frontier: [point], dominated: [], recommendationRange: null, performanceFloor: 0.5, budget: 5000 };
function loader(globals = {}, mocks = {}) {
  const cache = new Map();
  const load = path => {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { console, setTimeout, clearTimeout, Buffer, ...globals })((name) => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.')) return load(resolve(dirname(path), name + '.ts'));
      return require(name);
    }, module, module.exports);
    return module.exports;
  };
  return load;
}
const upload = loader()(join(root, 'miniapp/wx/services/share-upload.ts'));
const contract = require(join(root, 'miniapp/wx/cloudfunctions/share-result/contract.js'));
function edited() { return { ...point, source: 'edited', rowId: 'r1', editedBuyPrice: 2500, channel: '闲鱼', useSubsidy: false }; }
function content() {
  const context = upload.captureUploadContext({ points: [edited()], deferredRowIds: [], updatedAt: 1 }, [point]);
  return upload.buildUploadContent(report, context, true);
}
function request() {
  const c = content(); const state = upload.prepareUpload(c);
  state.consentVersion = upload.CONSENT_VERSION;
  return clone(upload.uploadRequest(c, state));
}
function cloudHarness() {
  const docs = new Map(); let identity = 'test-identity'; let qrScene;
  const cloud = { DYNAMIC_CURRENT_ENV: '', init() {}, getWXContext: () => ({ OPENID: identity }),
    database: () => ({ collection: () => ({
      async add({ data }) { const id = data._id || 'legacy1'; if (docs.has(id)) throw new Error('duplicate'); docs.set(id, clone(data)); return { _id: id }; },
      doc: id => ({ async get() { if (!docs.has(id)) throw new Error('not found'); return { data: clone(docs.get(id)) }; },
        async remove() { docs.delete(id); } }),
    }) }), openapi: { wxacode: { async getUnlimited({ scene }) { qrScene = scene; return { buffer: Buffer.from('image') }; } } } };
  const module = { exports: {} };
  const source = readFileSync(join(root, 'miniapp/wx/cloudfunctions/share-result/index.js'), 'utf8');
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, Buffer })((name) => name === 'wx-server-sdk' ? cloud : name === './contract' ? contract : require(name), module, module.exports);
  return { main: module.exports.main, docs, identity: value => { identity = value; }, scene: () => qrScene };
}

test('平台userInfo不进入业务校验或存储，伪造值不能改变身份和幂等键', async () => {
  const h = cloudHarness(); const r = request();
  const first = await h.main({ ...r, userInfo: { openId: 'forged-a' }, tcbContext: { OPENID: 'forged-a' } });
  const second = await h.main({ ...r, userInfo: { openId: 'forged-b' }, tcbContext: { OPENID: 'forged-b' } });
  assert.equal(first.ok, true); assert.equal(second.id, first.id);
  assert.equal(h.docs.size, 1); assert.equal(h.docs.get(first.id).userInfo, undefined);
  assert.equal(h.docs.get(first.id).tcbContext, undefined);
  const invalid = await h.main({ ...r, unexpected: 'private-value' });
  assert.equal(invalid.error, 'invalid_payload');
  assert.deepEqual(Array.from(invalid.invalidFields), ['unexpected']);
  assert.equal(JSON.stringify(invalid).includes('private-value'), false);
});

test('冻结价格来源，2700/2500分离，排除暂缓和普通推荐，明确预测改价及自定义', () => {
  const e = edited(); const context = upload.captureUploadContext({ points: [e, { ...e, rowId: 'exclude', excluded: true },
    { ...e, rowId: 'defer' }, { ...point, source: 'original', rowId: 'holding' },
    { ...point, source: 'custom', rowId: 'custom', buyPrice: 1800, predictedPrice: true }], deferredRowIds: ['defer'] }, [point]);
  e.editedBuyPrice = 2200;
  assert.equal(context.submittedPlans.length, 2);
  assert.equal(context.submittedPlans[0].buyPrice, 2500);
  assert.equal(context.originalPlans[0].buyPrice, 2700);
  assert.equal(context.submittedPlans[1].predictedPrice, false);
  assert.equal(point.buyPrice, 2700);
  assert.equal(upload.buildUploadContent(report).submittedPlans.length, 0);
});
test('同内容重试复用用途版本和ID，新内容/过期重建状态', () => {
  const c = content(); const s = upload.prepareUpload(c); s.consentVersion = upload.CONSENT_VERSION;
  s.cloudId = 'cloud'; s.expireAt = Date.now() + 10000;
  assert.equal(upload.prepareUpload(c, s).submissionId, s.submissionId);
  const newer = clone(c); newer.submittedPlans[0].buyPrice++;
  assert.equal(upload.prepareUpload(newer, s).consentVersion, undefined);
  assert.equal(upload.prepareUpload(c, { ...s, expireAt: 1 }).cloudId, undefined);
});
test('本地回看持久化上传上下文、同意及测试隔离；旧缓存不推断样本', () => {
  const store = new Map();
  const saved = loader({ wx: { getStorageSync: k => clone(store.get(k) ?? null), setStorageSync: (k, v) => store.set(k, clone(v)) } })(join(root, 'miniapp/wx/services/saved-results.ts'));
  const c = content(); const state = upload.prepareUpload(c); state.consentVersion = upload.CONSENT_VERSION;
  const snapshot = { params, reportData: report, headerTitle: '测试', lastUpdated: '2026-09-09', isTest: true,
    uploadContext: { submittedPlans: c.submittedPlans, originalPlans: c.originalPlans }, uploadState: state };
  const id = saved.saveResult(snapshot); snapshot.uploadContext.submittedPlans[0].buyPrice = 2200;
  const read = saved.getSavedResult(id);
  assert.equal(read.uploadContext.submittedPlans[0].buyPrice, 2500); assert.equal(read.isTest, true);
  assert.equal(read.uploadState.submissionId, state.submissionId);
  saved.updateResult(id, { ...read, uploadState: { ...read.uploadState, cloudId: 'saved', expireAt: Date.now() + 100000 } });
  assert.equal(saved.getSavedResult(id).uploadState.cloudId, 'saved');
  assert.equal(upload.buildUploadContent(report, undefined).submittedPlans.length, 0);
});
test('真实六品类完整引擎结果通过上传契约和大小限额', () => {
  const engine = require(join(root, 'miniapp/wx/vendor/apple-value-engine/index.js'));
  const constants = engine.loadConstants(readFileSync(join(root, 'miniapp/wx/snapshot/constants.json'), 'utf8'));
  for (const category of ['mac-mini', 'macbook-air', 'macbook-pro', 'iphone', 'ipad', 'imac']) {
    const p = { ...params, category, buyTiming: 'both', holdingYears: [1, 2, 3, 4, 5] };
    const result = engine.computeParetoFrontier(constants, p);
    const c = upload.buildUploadContent({ ...result, params: p, performanceFloor: p.performanceFloor, budget: p.budget });
    const state = upload.prepareUpload(c); state.consentVersion = upload.CONSENT_VERSION;
    assert.doesNotThrow(() => contract.validate(clone(upload.uploadRequest(c, state))), category);
  }
});
test('v2校验、可信身份、并发原子幂等、冲突、公开最小字段、二维码及过期保留', async () => {
  const h = cloudHarness(); const req = request();
  const responses = await Promise.all(Array.from({ length: 10 }, () => h.main(req)));
  assert.ok(responses.every(r => r.ok && r.id === responses[0].id)); assert.equal(h.docs.size, 1);
  const id = responses[0].id; assert.equal(id.length, 32);
  const stored = h.docs.get(id); assert.equal(stored.submittedPlans[0].buyPrice, 2500); assert.equal(stored.originalPlans[0].buyPrice, 2700);
  assert.equal(stored.OPENID, undefined); assert.equal(typeof stored.consentAt, 'number');
  assert.equal((await h.main({ ...req, isTest: false })).error, 'conflict');
  stored.reportData.frontier[0].sourceId = 'private-row';
  stored.reportData.frontier[0].privateField = 'private-value';
  const got = await h.main({ action: 'get', id });
  assert.deepEqual(Object.keys(got).sort(), ['createdAt', 'ok', 'params', 'reportData', 'schemaVersion']);
  assert.equal(got.reportData.isUserModified, true);
  for (const secret of ['anonId', 'consentAt', 'submittedPlans', 'originalPlans', 'sourceId', 'private-value']) {
    assert.equal(JSON.stringify(got).includes(secret), false, secret);
  }
  assert.equal((await h.main({ action: 'qrcode', id })).ok, true); assert.equal(h.scene(), id);
  stored.expireAt = 1; assert.equal((await h.main({ action: 'get', id })).error, 'expired'); assert.equal(h.docs.size, 1);
  h.identity(''); assert.equal((await h.main({ ...req, submissionId: 'another' })).error, 'missing_identity');
});
test('非法字段/枚举/数值/数量/大小整体拒绝；旧save/get兼容且不补同意；空样本合法', async () => {
  const h = cloudHarness(); const req = request();
  for (const change of [r => r.anonId = 'forged', r => r.params.budget = Infinity, r => r.consentVersion = 'fake',
    r => r.submittedPlans[0].buyPrice = -1, r => r.submittedPlans[0].source = 'original',
    r => r.submittedPlans[0].channel = 'x'.repeat(81), r => r.submittedPlans = Array(201).fill(r.submittedPlans[0]),
    r => r.reportData.frontier[0].privateField = 'secret', r => r.reportData.frontier = Array(1500).fill(r.reportData.frontier[0])]) {
    const bad = clone(req); change(bad); assert.equal((await h.main(bad)).ok, false); assert.equal(h.docs.size, 0);
  }
  const old = await h.main({ action: 'save', params }); assert.equal(old.ok, true);
  assert.equal(h.docs.get(old.id).consentVersion, undefined); assert.equal((await h.main({ action: 'get', id: old.id })).ok, true);
  assert.equal((await h.main({ ...req, submittedPlans: [], originalPlans: [] })).ok, true);
});
function pipelineFiles() {
  const base = join(root, 'scripts/debug/share-intake-tests'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'run-'));
  const files = { ledgerFile: join(dir, 'ledger.json'), reportsDir: join(dir, 'reports'), debugDir: join(dir, 'cache'), constantsFile: join(dir, 'constants.json') };
  writeFileSync(files.constantsFile, JSON.stringify({ '实时市场价快照': {} })); return files;
}
test('shared_results筛选/持有期去重/配置渠道分组/毫秒水位线/重复运行/诊断不改台账', async () => {
  const files = pipelineFiles(); const req = request();
  const rec = { ...req, _id: 'sample1', createdAt: 1700000000000, isTest: false, anonId: 'PRIVATE_ID' };
  const p = rec.submittedPlans[0]; rec.submittedPlans = [p, { ...p, holdingYears: 3 }, { ...p, channel: '京东' }, { ...p, memoryGb: 24 }];
  const records = [rec, { ...rec, _id: 'test', isTest: true }, { _id: 'legacy', params },
    { ...rec, _id: 'ordinary', submittedPlans: [] }, { ...rec, _id: 'consent', consentVersion: 'other' }];
  const run = () => runPipeline({ files, fetchRecords: async () => ({ envLabel: 'test', records }) });
  const result = await run(); assert.equal(result.newPoints, 3);
  assert.deepEqual(result.skipped, { legacy: 1, test: 1, ordinary: 1, consent: 1, invalid: 0 });
  const ledger = JSON.parse(readFileSync(files.ledgerFile)); assert.equal(ledger.watermark, rec.createdAt);
  assert.equal(ledger.sourceCollection, 'shared_results'); assert.equal(Object.keys(ledger.groups).length, 3);
  assert.ok(!readFileSync(result.reportPath, 'utf8').includes('PRIVATE_ID'));
  const second = await run(); assert.equal(second.newPoints, 0); assert.notEqual(second.reportPath, result.reportPath);
  const before = readFileSync(files.ledgerFile, 'utf8');
  const diag = await diagnoseRecord('test', { client: { getDoc: async () => records[1] } });
  assert.equal(diag.submittedPlans[0].buyPrice, 2500); assert.equal(diag.originalPlans[0].buyPrice, 2700);
  assert.ok(!JSON.stringify(diag).includes('PRIVATE_ID')); assert.equal(readFileSync(files.ledgerFile, 'utf8'), before);
});
test('非空旧台账和云读取失败原样保留，独立台账及空集合正常', async () => {
  const files = pipelineFiles(); const old = JSON.stringify({ version: 1, processedIds: ['old'], groups: {}, watermark: '2026-09-01' });
  writeFileSync(files.ledgerFile, old);
  await assert.rejects(() => runPipeline({ files, fetchRecords: async () => ({ envLabel: 'test', records: [] }) }), /旧台账非空/);
  assert.equal(readFileSync(files.ledgerFile, 'utf8'), old);
  const independent = { ...files, ledgerFile: files.ledgerFile + '.v2' };
  assert.equal((await runPipeline({ files: independent, fetchRecords: async () => ({ envLabel: 'test', records: [] }) })).newPoints, 0);
  const before = readFileSync(independent.ledgerFile, 'utf8');
  await assert.rejects(() => runPipeline({ files: independent, fetchRecords: async () => { throw new Error('collection missing'); } }));
  assert.equal(readFileSync(independent.ledgerFile, 'utf8'), before);
});
test('constants配置、渠道和补贴口径不确定时不提供错误修正', () => {
  const index = { Mac_mini: { M2_16G_256G_二手: { 闲鱼中位价: 2700 } } };
  const dimensions = { category: 'mac-mini', model: 'M2_16G_256G_二手', chip: 'M2', memoryGb: 16, storageGb: 256,
    buyTiming: 'used', channel: '闲鱼', useSubsidy: false };
  assert.equal(matchSnapshotValue(index, dimensions).value, 2700);
  for (const change of [{ memoryGb: 24 }, { channel: null }, { useSubsidy: true }]) assert.equal(matchSnapshotValue(index, { ...dimensions, ...change }), null);
});
test('维护发布编排在每个失败阶段中止，并透传干跑和环境参数', () => {
  const dir = dirname(pipelineFiles().ledgerFile);
  writeFileSync(join(dir, 'release-constants.mjs'), readFileSync(join(root, 'scripts/release-constants.mjs')));
  for (const failed of ['lint', 'publish', 'verify', 'none']) {
    for (const [stage, file] of [['lint', 'lint-constants.mjs'], ['publish', 'publish-constants.mjs'], ['verify', 'verify-cloud-constants.mjs']]) {
      writeFileSync(join(dir, file), `console.log('TEST_STAGE_${stage}', JSON.stringify(process.argv.slice(2)));process.exit(${failed === stage ? 7 : 0});`);
    }
    const res = spawnSync(process.execPath, [join(dir, 'release-constants.mjs'), '--dry-run', '--env', 'test-env'], { encoding: 'utf8' });
    assert.equal(res.status, failed === 'none' ? 0 : 7);
    if (failed === 'lint') assert.ok(!res.stdout.includes('TEST_STAGE_publish'));
    if (failed === 'publish') assert.ok(!res.stdout.includes('TEST_STAGE_verify'));
    if (failed === 'none') assert.ok(res.stdout.includes('["--dry-run","--env","test-env"]'));
  }
});

test('分享页开启直接上传、关闭不上传、无二次确认、二维码失败复用云ID、渲染失败可重试', async () => {
  for (const mode of ['off', 'save-failure', 'qr-failure', 'render-failure', 'normal']) {
    const store = new Map(); let definition; let confirmations = 0; let saves = 0; let qrs = 0; let renders = 0;
    const wx = { getStorageSync: k => store.get(k), setStorageSync: (k,v) => store.set(k, clone(v)), removeStorageSync: k => store.delete(k),
      showLoading() {}, hideLoading() {}, showToast() {},
      async showModal(o) {
        if (Array.from(o.cancelText || '').length > 4 || Array.from(o.confirmText || '').length > 4) {
          throw new Error('showModal:fail button text exceeds 4 characters');
        }
        if (o.title === '确认上传用途') {
          confirmations++;
        }
        return { confirm: true };
      },
      cloud: { async callFunction({ data }) {
        if (data.action === 'save') { saves++; if (mode === 'save-failure' && saves === 1) throw new Error('network'); return { result: { ok: true, id: 'cloud', expireAt: Date.now() + 100000 } }; }
        qrs++; if (mode === 'qr-failure' && qrs === 1) throw new Error('qr'); return { result: { ok: true, buffer: 'image' } };
      } } };
    const load = loader({ wx, Page: p => { definition = p; } }, { '../../engine-bridge/index': {} });
    load(join(root, 'miniapp/wx/pages/share-card/share-card.ts'));
    const page = { ...definition, data: clone(definition.data), setData(v, callback) { Object.assign(this.data, v); callback?.(); },
      selectComponent() { return { whenQrcodeReady: async () => {}, exportImage: async () => { renders++; if (mode === 'render-failure' && renders === 1) throw new Error('render'); return 'image.png'; } }; } };
    Object.assign(page.data, { params, reportData: report, uploadContext: { submittedPlans: content().submittedPlans, originalPlans: content().originalPlans }, showMyPlan: mode !== 'off' });
    await page.onGenerate();
    if (mode === 'render-failure') assert.match(page.data.generationStatus, /云端已保存.*图片生成失败/);
    await page.onGenerate();
    assert.equal(confirmations, 0, mode);
    assert.equal(saves, mode === 'off' ? 0 : mode === 'save-failure' ? 2 : 1, mode);
    assert.equal(page.data.uploadState.consentVersion, mode === 'off' ? undefined : upload.CONSENT_VERSION, mode);
    assert.equal(page.data.generated, true, mode); assert.equal(store.get('saved_result_index').length, 1, mode);
  }
});

test('结果页重算后编辑不污染保存，原始版不带改价，直接长图导出零云调用', async () => {
  let definition; let exports = 0; let clouds = 0; const app = { globalData: {} }; const storage = new Map();
  const wx = { getStorageSync: k => storage.get(k), setStorageSync: (k,v) => storage.set(k,v),
    showLoading() {}, hideLoading() {}, showToast() {}, navigateTo() {},
    cloud: { callFunction() { clouds++; throw new Error('must not upload'); } } };
  loader({ wx, getApp: () => app, Page: p => { definition = p; } }, {
    '../../engine-bridge/index': { getKnownChips: async () => ['M2'], recomputeFromEditedPlans: async () => ({ frontier: [{ ...point, buyPrice: 2500 }], dominated: [], recommendationRange: null }) },
    '../../services/long-image-export': { exportLongImage: async o => { exports++; assert.equal(o.qrcodeBase64, ''); return 'local.png'; } },
  })(join(root, 'miniapp/wx/pages/result/result.ts'));
  const page = { ...definition, data: clone(definition.data), setData(v) { Object.assign(this.data, v); } };
  Object.assign(page.data, { params, original: { frontier: [point], dominated: [], recommendationRange: null }, frontier: [point], dominated: [] });
  await page.onEnterEditor(); const key = page.getGroupKey(page.data.editorSnapshot.points[0]);
  const input = value => ({ currentTarget: { dataset: { groupKey: key } }, detail: { value } });
  page.onEditorPriceChange(input('2500')); await page.onEditorRecompute(); page.onEditorPriceChange(input('2300'));
  page.onSaveUserModified(); assert.equal(app.globalData.shareCardData.uploadContext.submittedPlans[0].buyPrice, 2500);
  assert.equal(app.globalData.shareCardData.reportData.isUserModified, true);
  assert.equal(app.globalData.shareCardData.uploadContext.originalPlans[0].buyPrice, 2700);
  page.onSwitchViewMode({ currentTarget: { dataset: { mode: 'original' } } }); page.onGenerateShareCard();
  assert.equal(app.globalData.shareCardData.uploadContext, null);
  await page.onEditorExport(); assert.equal(exports, 1); assert.equal(clouds, 0);
});

test('完整报告保存读取自己的快照，不受后来globalData变化影响', () => {
  let definition; const app = { globalData: { reportData: { params: { category: 'changed' } } } };
  loader({ getApp: () => app, Page: p => { definition = p; }, wx: { navigateTo() {} } }, { '../../engine-bridge/index': {} })(join(root, 'miniapp/wx/pages/report/report.ts'));
  const c = content(); const page = { ...definition, data: { ...clone(definition.data), reportSnapshot: report, isTest: true,
    uploadContext: { submittedPlans: c.submittedPlans, originalPlans: c.originalPlans } } };
  page.onSaveResult(); assert.equal(app.globalData.shareCardData.params.category, 'mac-mini');
  assert.equal(app.globalData.shareCardData.uploadContext.submittedPlans[0].buyPrice, 2500);
  assert.equal(app.globalData.shareCardData.isTest, true);
});

 test('扫码和卡片同ID恢复修改快照，不重算；转发保留ID，旧记录仍兼容', async () => {
  const modified = { ...clone(report), isUserModified: true, frontier: [{ ...point, buyPrice: 2500, monthlyCost: 87 }] };
  for (const entry of ['scene', 'shareId']) {
    let definition; let computes = 0; let requested;
    const app = { globalData: {} };
    loader({ Page: p => { definition = p; }, getApp: () => app,
      wx: { cloud: { async callFunction({ data }) { requested = data.id; return { result: { ok: true, schemaVersion: 2, params, reportData: modified } }; } } } },
      { '../../engine-bridge/index': { compute: async () => { computes++; throw new Error('must not recompute'); }, getDataFreshness: async () => ({}) } }
    )(join(root, 'miniapp/wx/pages/result/result.ts'));
    const page = { ...definition, data: clone(definition.data), setData(v) { Object.assign(this.data, v); }, loadFreshness() {} };
    let loading; const original = page.loadFromCloud; page.loadFromCloud = function(id) { loading = original.call(this, id); return loading; };
    page.onLoad({ [entry]: 'shared123' }); await loading;
    assert.equal(requested, 'shared123'); assert.equal(computes, 0);
    assert.equal(page.data.frontier[0].buyPrice, 2500); assert.equal(page.data.frontier[0].monthlyCost, 87);
    assert.equal(page.data.viewMode, 'userModified'); assert.equal(page.data.userModified.frontier[0].buyPrice, 2500);
    assert.equal(page.onShareAppMessage().path, '/pages/result/result?shareId=shared123');
  }
  let share;
  loader({ Page: p => { share = p; } }, { '../../engine-bridge/index': {} })(join(root, 'miniapp/wx/pages/share-card/share-card.ts'));
  const page = { ...share, data: { params, showMyPlan: true, uploadState: { cloudId: 'shared123' } } };
  assert.equal(page.onShareAppMessage().path, '/pages/result/result?shareId=shared123');
  page.data.showMyPlan = false; assert.equal(page.onShareAppMessage().path.includes('shareId='), false);
  const h = cloudHarness(); const req = request(); req.reportData = modified;
  const saved = await h.main(req); const received = await h.main({ action: 'get', id: saved.id });
  assert.equal(received.reportData.frontier[0].buyPrice, 2500);
  delete h.docs.get(saved.id).reportData;
  assert.equal((await h.main({ action: 'get', id: saved.id })).error, 'missing_snapshot');
});
