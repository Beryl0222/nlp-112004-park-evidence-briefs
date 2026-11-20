import assert from 'node:assert/strict';
import test from 'node:test';
import { buildState } from '../src/app.mjs';

const state = buildState();
const stmt = (id) => state.statements.find(s => s.id === id);
const entry = (target, plotId, season) =>
  state.ledger.entries.find(e => e.target === target && e.plotId === plotId && e.season === season);

test('同一段手记里的观察、未观察、推测、征引、纠正分别成类并保留原句', () => {
  const kindsByNote = Object.groupBy(
    state.statements.filter(s => s.noteId === 'n7'),
    s => s.kind,
  );
  assert.ok(kindsByNote.negative, 'n7 应含未观察陈述');
  assert.ok(kindsByNote.inference, 'n7 应含推测陈述');
  assert.ok(kindsByNote.negative[0].text.includes('静听无记录'));
  assert.ok(kindsByNote.inference[0].text.includes('不确定'));

  const n2 = state.statements.filter(s => s.noteId === 'n2');
  assert.ok(n2.some(s => s.kind === 'citation'), 'n2 转引帆叶手记应标为征引');
  assert.ok(n2.some(s => s.kind === 'negative'), 'n2 自己的静听应保留为未观察');

  assert.ok(state.statements.some(s => s.noteId === 'n9' && s.kind === 'correction'));
  assert.ok(state.statements.some(s => s.noteId === 'n4' && s.kind === 'positive'));
});

test('“没听见叫声”与“做完调查仍未记录到”在台账中是不同强度：失效场次不计有效', () => {
  // n1：雨大且发生在听的过程中，静听失效，不进有效场次
  const n1 = state.statements.find(s => s.noteId === 'n1' && s.kind === 'negative');
  assert.deepEqual(n1.validity.issues, ['rainNoise']);
  assert.equal(n1.validity.valid, false);

  // n6：回来后才下大雨，完成的静听仍然有效；地点后由 n9 勘误到沟口
  const n6 = state.statements.find(s => s.noteId === 'n6' && s.kind === 'negative');
  assert.equal(n6.validity.valid, true);
  assert.ok(n6.supersededBy === 'n9', 'n6 地点陈述应被 n9 取代');

  // 沟口三次独立完整静听（含 n9 勘误归位的 u6）-> 可判条件下未记录；
  // 背阴坡只剩 u2 一次有效（u6 被勘误移走、u1 雨噪失效）-> 不能判
  const g = entry('青鸣鸟', 'G', '2026 春季');
  assert.equal(g.qualifiedNegative, true);
  assert.equal(g.completeCount, 3);
  const n = entry('青鸣鸟', 'N', '2026 春季');
  assert.equal(n.qualifiedNegative, false);
  assert.equal(n.completeCount, 1);
  assert.deepEqual(n.independentSurveyIds, ['u2']);
});

test('合格缺席只声明方法条件下未记录，绝不等于物种不存在', () => {
  const g = entry('青鸣鸟', 'G', '2026 春季');
  const claim = state.briefing.publishable.find(c => c.id === `claim|${g.key}`);
  assert.match(claim.limitation, /不等于物种不存在/);
});

test('重述与转引回到同一独立调查，不增加独立调查数量', () => {
  const n = entry('青鸣鸟', 'N', '2026 春季');
  assert.ok(n.citationStatements.length > 0);
  // n2 的征引指向 u1，不应把 u1 算作背阴坡的独立调查；u6 已由勘误移到沟口
  assert.deepEqual(n.independentSurveyIds, ['u2']);

  const s2025 = entry('苇鳞鱼', 'S', '2025 秋季');
  const s2026 = entry('苇鳞鱼', 'S', '2026 春季');
  // n5 征引 n4 的秋季发现，2026 春季条目里只有征引，没有独立调查
  assert.ok(s2026.citationStatements.length > 0);
  assert.deepEqual(s2026.independentSurveyIds, []);
  assert.equal(s2025.positives.length, 1);
});

test('征引中的“这里”与本卡地点范围不一致时标记范围错配，不自动迁移覆盖', () => {
  const citation = state.statements.find(s => s.noteId === 'n5' && s.kind === 'citation');
  assert.equal(citation.citedScopeMismatch, true);
  // 秋季浅湖的正观察不能让 2026 年的沟口/浅湖变成有覆盖
  const g2026 = entry('苇鳞鱼', 'G', '2026 春季');
  assert.equal(g2026.positives.length, 0);
});

test('重叠历史称呼给出待核候选，不把整区画成阴性', () => {
  const candidates = state.ledger.pendingPlace.map(p => `${p.statementId}:${p.candidates.join('/')}`);
  assert.ok(candidates.some(text => text.startsWith('n8#') && text.includes('N/E1')),
    'n8 的“老坡”应在 N 与 E1 之间待核');
  const e1 = entry('青鸣鸟', 'E1', '2026 春季');
  assert.equal(e1.qualifiedNegative, false);
  assert.ok(e1.pendingPlaceStatements.length > 0);
});

test('勘误把同次调查的地点从背阴坡改到沟口，纠正陈述归沟口且原卡被取代', () => {
  const correction = state.statements.find(s => s.id === 'n9#c1');
  assert.deepEqual(correction.place.plotIds, ['G']);
  assert.equal(correction.complete, true);
  const negated = state.statements.find(s => s.id === 'n9#c2');
  assert.ok(negated.place.negated);
  // 沟口的合格缺席独立调查包含 u6（勘误后的同次出队）
  const g = entry('青鸣鸟', 'G', '2026 春季');
  assert.ok(g.validNegativeSurveyIds.includes('u6'));
});

test('先前缺席与后来新发现可以同时为真，按季节与范围各自成立', () => {
  const s2025 = entry('苇鳞鱼', 'S', '2025 秋季');
  const s2026 = entry('苇鳞鱼', 'S', '2026 春季');
  assert.equal(s2025.status, 'positive');
  assert.equal(s2026.status, 'no-valid-coverage');
});

test('网具规格待核使撒网缺席不成立，并保留为方法失效缺口', () => {
  const g2026 = entry('苇鳞鱼', 'G', '2026 春季');
  assert.equal(g2026.qualifiedNegative, false);
  assert.ok(g2026.invalidStatements.length > 0);
  const gap = state.ledger.gaps.find(gapRow =>
    gapRow.target === '苇鳞鱼' && gapRow.plotId === 'G' && gapRow.season === '2026 春季');
  assert.equal(gap.reason, 'invalid');
});

test('未实际采用方法（没下网/看一眼）不产生该对象的阴性证据', () => {
  // n3 在浅湖“看了一眼，没下网”：M3 未实际采用，不能作为苇鳞鱼缺席
  const s2026 = entry('苇鳞鱼', 'S', '2026 春季');
  assert.ok(!s2026.allStatements.some(id => stmt(id).kind === 'negative' && stmt(id).validity.valid));
  // M3 出队中对青鸣鸟的顺带观察不产生 M1 缺口
  assert.ok(!state.ledger.gaps.some(g => g.target === '青鸣鸟' && g.plotId === 'S'));
});
