import assert from 'node:assert/strict';
import test from 'node:test';
import { buildState, explainClaim } from '../src/app.mjs';

const state = buildState();
const decision = id => state.decisions.find(d => d.hearingId === id);

test('整区结论在从属单元证据不足时扣留，且不连累局部可发布结果', () => {
  const h2 = decision('h2');
  assert.equal(h2.disposition, '暂不发布');
  assert.ok(h2.limitations[0].includes('N、S'));
  // 沟口的局部合格缺席仍然可发布，没有随整区结论一起被删
  const local = state.briefing.publishable.find(c => c.plotLabel.startsWith('沟口') && c.target === '青鸣鸟');
  assert.ok(local);
  assert.equal(local.status, 'qualified-negative');
});

test('单元级合格缺席可面向公众，但带“不等于不存在”的限定', () => {
  const h1 = decision('h1');
  assert.equal(h1.disposition, '可面向公众');
  assert.ok(h1.limitations.some(text => text.includes('不代表物种不存在')));
});

test('已发布说法发生实质变动时生成带引用的更正说明', () => {
  const h1 = decision('h1');
  assert.ok(h1.correction);
  assert.equal(h1.correction.changeType, 'superseded');
  assert.deepEqual([...new Set(h1.correction.citations)].sort(), ['n3', 'n7', 'n9']);
  assert.match(h1.correction.newSentence, /3 次独立完整观察/);
  // 未发布的送审稿不产生更正说明
  assert.equal(decision('h2').correction, null);
});

test('跨季说法按它自己提到的季节评审：秋季发现不能被春季缺口推翻', () => {
  const h3 = decision('h3');
  assert.equal(h3.disposition, '可面向公众');
  assert.equal(h3.correction, null, '秋季正观察与春季无覆盖同时为真，不构成更正');
});

test('简报显式声明覆盖缺口，不汇总成“全区无记录”', () => {
  assert.match(state.briefing.coverageNote, /不.*外推/);
  const withheld = state.briefing.withheld.find(w => w.id === 'withheld|h2');
  assert.ok(withheld.unitStatus.some(u => u.status === 'no-evidence' || u.status === 'no-valid-coverage'));
  assert.ok(withheld.unitStatus.some(u => u.status === 'qualified-negative'));
});

test('点开结论可查到成立依据、限定条件与被谁勘误', () => {
  const detail = explainClaim(state, 'claim|青鸣鸟|G|2026 春季');
  assert.equal(detail.kind, 'entry');
  const noteIds = detail.trace.map(t => t.noteId);
  assert.ok(noteIds.includes('n9'), '溯源包含勘误手记');
  const superseded = detail.trace.find(t => t.supersededBy);
  assert.ok(superseded, '溯源中能看到被取代的原卡陈述');
  assert.equal(superseded.supersededBy, 'n9');
  // 转引陈述保留征引标记
  const fish = explainClaim(state, 'claim|苇鳞鱼|S|2026 春季');
  assert.ok(fish.trace.some(t => t.kind === 'citation' && t.cites.length > 0));
});

test('扣留的整区结论也能打开溯源，显示各单元不同状态', () => {
  const detail = explainClaim(state, 'withheld|h2');
  assert.equal(detail.kind, 'withheld-hearing');
  assert.deepEqual(detail.unitStatus.map(u => u.plotId).sort(), ['G', 'N', 'S']);
});

test('推断与转引不能单独把结论升级为可发布', () => {
  // n7 的声源推测保持 inference，不进入任何正观察
  const inference = state.statements.find(s => s.noteId === 'n7' && s.kind === 'inference');
  assert.ok(inference);
  const n = state.ledger.entries.find(e => e.key === '青鸣鸟|N|2026 春季');
  assert.equal(n.positives.length, 0);
});

test('解析阶段没有丢弃任何原句片段', () => {
  assert.deepEqual(state.parseWarnings, []);
});
