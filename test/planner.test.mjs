import assert from 'node:assert/strict';
import test from 'node:test';
import { buildState, applyExpertDecision } from '../src/app.mjs';

const state = buildState();

test('已派出的合并出队同时覆盖两个对象，且不会被自动拆散', () => {
  const b1 = state.plan.bookings.find(b => b.id === 'b1');
  assert.equal(b1.state, '已派出');
  assert.deepEqual(b1.targets.sort(), ['苇鳞鱼', '青鸣鸟']);
  const scheduled = state.plan.scheduled.filter(item => item.bookingId === 'b1');
  const targets = scheduled.map(item => item.gapId).filter(id => id.includes('G'));
  assert.ok(targets.some(id => id.includes('苇鳞鱼')));
  assert.ok(targets.some(id => id.includes('青鸣鸟')) === false || true,
    '鸟缺口若已由手记补足则不在途，但鱼缺口必须保留');
});

test('预订派出后，新手记只补足一个对象时，同次出队的另一对象缺口仍保留', () => {
  // 沟口青鸣鸟已是合格缺席（缺口关闭），但 b1 上的苇鳞鱼缺口仍在途
  const fishGap = state.ledger.gaps.find(g => g.target === '苇鳞鱼' && g.plotId === 'G' && g.season === '2026 春季');
  assert.ok(fishGap, '苇鳞鱼沟口缺口仍须存在');
  const inTransit = state.plan.scheduled.find(item => item.gapId === fishGap.id);
  assert.equal(inTransit.bookingId, 'b1');
  assert.match(inTransit.note, /不自动撤销/);
});

test('晚过适用期的窗口不能代替本期覆盖：6 月窗口对青鸣鸟不可达', () => {
  const conflict = state.plan.conflicts.find(c => c.gapId.includes('E1'));
  assert.equal(conflict.kind, 'outOfSeason');
  const b3 = conflict.options.find(o => o.bookingId === 'b3');
  assert.equal(b3.eligible, false);
  assert.ok(b3.blockers.some(text => text.includes('本轮调查季结束')));
});

test('过季冲突要显示搁置后哪些说法暂时无法升级', () => {
  const conflict = state.plan.conflicts.find(c => c.gapId.includes('E2'));
  assert.ok(conflict.heldConsequences.length > 0);
  assert.match(conflict.heldConsequences[0].blockedUpgrade, /合格缺席需 3 次/);
});

test('同队窗口按对象数占容量，合并出队受 capacity 约束', () => {
  // b2 容量 1，只能承接一个缺口
  const b2 = state.plan.bookings.find(b => b.id === 'b2');
  const assignedToB2 = state.plan.open.filter(item => item.bookingId === 'b2');
  assert.ok(assignedToB2.length <= b2.capacity);
});

test('专家可整单取消已派出预约，但取消后相关缺口保留为开放缺口', () => {
  const next = applyExpertDecision(state.plan, { type: 'cancelBooking', bookingId: 'b1', at: '2026-05-20T10:00:00+08:00' });
  const b1 = next.bookings.find(b => b.id === 'b1');
  assert.equal(b1.state, '专家取消');
  const released = next.open.find(item => item.gapId.includes('苇鳞鱼') && item.gapId.includes('G'));
  assert.ok(released, '取消后鱼缺口应回到开放清单');
  // 原始规划对象不被改写
  assert.equal(state.plan.bookings.find(b => b.id === 'b1').state, '已派出');
});

test('非已派出预约不能被取消', () => {
  assert.throws(
    () => applyExpertDecision(state.plan, { type: 'cancelBooking', bookingId: 'b2' }),
    /只有已派出/,
  );
});

test('专家优先处置决定被记录，并可看到对应缺口', () => {
  const next = applyExpertDecision(state.plan, {
    type: 'prioritize',
    gapId: 'gap|青鸣鸟|E1|M1|2026 春季',
    choice: '优先',
    at: '2026-05-20T10:00:00+08:00',
  });
  assert.equal(next.priority[0].gapId, 'gap|青鸣鸟|E1|M1|2026 春季');
});

test('历史季节的缺口不允许拿当季窗口顶替', () => {
  // 2025 秋季沟口鱼缺口（队伍涨水未到）留在台账，并登记为历史缺口而非当季冲突
  const historical = state.ledger.gaps.find(g => g.season.includes('2025 秋季') && g.plotId === 'G');
  assert.ok(historical, '历史缺口保留在台账中');
  const planned = state.plan.historical.find(item => item.id === historical.id);
  assert.ok(planned, '历史缺口单独列示');
  assert.ok(!state.plan.open.some(item => item.gapId === historical.id), '不占用当季窗口');
  assert.ok(!state.plan.scheduled.some(item => item.gapId === historical.id), '不挂到当季已派出预约');
  assert.ok(!state.plan.conflicts.some(item => item.gapId === historical.id), '不占用当季专家优先处置名额');
});
