// 补查规划：在队伍可达季节、已确认预订与合并出队约定下安排有限名额。
// 已派出任务不得自动拆散或改期；晚过适用期的窗口不能代替本期覆盖。
import { monthAllowed, targetAllowed, slotFitsWindow, pastSeasonEnd, GAP_REASONS } from './domain.mjs';

function bookingDate(booking) {
  return booking.window.slice(0, 10);
}

// 单个预订对某缺口是否可达：窗口在方法适用月与时段内、未过物种本轮季末、地点与对象允许
export function evaluateBooking(booking, gap, methods) {
  const method = methods.find(m => m.id === gap.methodId);
  const date = bookingDate(booking);
  const slot = booking.window.slice(11, 16);
  const blockers = [];
  if (!booking.plots.includes(gap.plotId)) blockers.push('地点不在该队窗口覆盖范围');
  if (!monthAllowed(method, date)) blockers.push(`窗口月份不在方法 ${method.id} 适用月份`);
  if (!slotFitsWindow(method.window, date, slot)) blockers.push('窗口时段不在方法观察时段内');
  if (!targetAllowed(method, gap.target)) blockers.push('方法不适用该对象');
  if (pastSeasonEnd(gap.target, date)) blockers.push(`窗口晚于${gap.target}本轮调查季结束`);
  return { eligible: blockers.length === 0, blockers };
}

export function planResurvey({ ledger, bundle }) {
  const { gaps } = ledger;
  const bookings = bundle.bookings;
  const open = [];
  const scheduled = [];
  const conflicts = [];
  const historical = [];

  // 预订占用：已派出任务按 targets 实际占容量；可用窗口待分配
  const bookingViews = bookings.map(booking => ({
    ...booking,
    date: bookingDate(booking),
    usedCapacity: booking.state === '已派出' ? booking.targets.length : 0,
    assignments: [],
  }));
  const bookingById = new Map(bookingViews.map(b => [b.id, b]));
  const currentYear = Math.max(...bookingViews.map(b => Number(b.date.slice(0, 4))));

  for (const gap of gaps) {
    // 历史季节的缺口：现有预订全部属于更晚季节，不可代替本期覆盖；
    // 单独登记为历史缺口，不进入当季补查清单，也不占用专家当季优先处置名额
    if (Number(gap.season.slice(0, 4)) < currentYear) {
      historical.push({ ...gap, note: '该缺口所属调查季已结束，现有窗口均不可代替本期覆盖；保留记录供下一轮规划参考' });
      continue;
    }
    const gapSeasonYear = gap.season.slice(0, 4);
    const options = [];
    for (const booking of bookingViews) {
      const sameSeason = bookingDate(booking).startsWith(gapSeasonYear) &&
        (gap.season.includes('秋季') ? Number(bookingDate(booking).slice(5, 7)) >= 10
          : Number(bookingDate(booking).slice(5, 7)) < 10);
      if (!sameSeason) {
        options.push({ bookingId: booking.id, eligible: false, blockers: ['预订窗口不属于缺口所在季节，不能代替本期覆盖'] });
        continue;
      }
      const result = evaluateBooking(booking, gap, bundle.methods);
      options.push({ bookingId: booking.id, ...result });
    }
    const eligibleOptions = options.filter(o => o.eligible);

    // 已派出且同次出队已登记该对象、且同季：缺口在途，不重复占名额
    const dispatched = bookingViews.find(
      b => b.state === '已派出' && b.targets.includes(gap.target) && b.plots.includes(gap.plotId) &&
        bookingDate(b).startsWith(gapSeasonYear),
    );
    if (dispatched) {
      scheduled.push({
        gapId: gap.id,
        bookingId: dispatched.id,
        team: dispatched.team,
        mode: '已派出在途',
        note: '任务已确认派出；即使后续手记补足同次其他对象，本缺口在完成前保留，不自动撤销出队',
      });
      continue;
    }

    if (eligibleOptions.length === 0) {
      const pastSeason = options.some(o => o.blockers.some(text => text.includes('本轮调查季结束')));
      conflicts.push({
        gapId: gap.id,
        ...gap,
        kind: pastSeason ? 'outOfSeason' : 'noWindow',
        reasonLabel: pastSeason ? GAP_REASONS.outOfSeason : gap.reasonLabel,
        options,
        heldConsequences: heldClaims(gap, ledger),
      });
      continue;
    }

    // 容量分配：同队窗口按对象数占容量，优先用容量允许的窗口
    const withCapacity = eligibleOptions
      .map(o => bookingById.get(o.bookingId))
      .filter(b => b.state === '可用' && b.usedCapacity + 1 <= b.capacity);

    if (withCapacity.length === 0) {
      conflicts.push({ gapId: gap.id, ...gap, kind: 'capacityFull', options, heldConsequences: heldClaims(gap, ledger) });
      continue;
    }
    withCapacity.sort((a, b) => a.date.localeCompare(b.date));
    const chosen = withCapacity[0];
    chosen.usedCapacity += 1;
    chosen.assignments.push({ gapId: gap.id, target: gap.target, plotId: gap.plotId });
    open.push({
      gapId: gap.id,
      bookingId: chosen.id,
      team: chosen.team,
      window: chosen.window,
      mode: '建议占用可用窗口',
    });
  }

  return {
    bookings: bookingViews,
    scheduled,
    open,
    conflicts,
    historical,
    mergeRules: [
      '同一队伍同一窗口的多个对象按对象数占容量，组成合并出队',
      '已派出任务不得自动拆散或改期；专家可决定整单取消，但相关缺口保留',
      '晚过适用期的窗口不可代替本期覆盖',
    ],
  };
}

// 搁置一个缺口后，哪些简报说法暂时无法升级
function heldClaims(gap, ledger) {
  const related = ledger.entries.filter(
    e => e.target === gap.target && e.plotId === gap.plotId && e.season === gap.season,
  );
  return related.map(e => ({
    claimId: `claim|${e.key}`,
    currentStatus: e.status,
    blockedUpgrade: e.completedMin ? `合格缺席需 ${e.completedMin} 次完整有效观察，现 ${e.completeCount} 次` : '无法升级为可发布结论',
  }));
}

// 专家操作：整单取消仍有缺口的预约（缺口保留）；确认占用；选定待核地点
export function applyExpertDecision(plan, action) {
  const next = structuredClone(plan);
  if (action.type === 'cancelBooking') {
    const booking = next.bookings.find(b => b.id === action.bookingId);
    if (!booking || booking.state !== '已派出') {
      throw new Error('只有已派出的预约可由专家决定取消');
    }
    booking.state = '专家取消';
    booking.cancelledAt = action.at ?? new Date().toISOString();
    // 取消后原在途缺口回到开放缺口
    const released = next.scheduled.filter(item => item.bookingId === booking.id);
    next.scheduled = next.scheduled.filter(item => item.bookingId !== booking.id);
    for (const item of released) {
      next.open.push({ gapId: item.gapId, bookingId: null, team: null, window: null, mode: '预约取消后回到开放缺口' });
    }
  }
  if (action.type === 'resolvePlace') {
    next.placeResolution = next.placeResolution ?? [];
    next.placeResolution.push({ ...action, at: action.at ?? new Date().toISOString() });
  }
  if (action.type === 'prioritize') {
    next.priority = next.priority ?? [];
    next.priority.push({ gapId: action.gapId, choice: action.choice, at: action.at ?? new Date().toISOString() });
  }
  return next;
}
