// 领域约定：会审规则、季节、物种、方法适用边界。
// 规则集中在一处，便于会审纪要修订后统一调整。

export const TARGETS = ['青鸣鸟', '苇鳞鱼', '石塘狐'];

// 名称变体 -> 规范调查对象
export const TARGET_ALIASES = {
  青鸣鸟: '青鸣鸟',
  青鸣: '青鸣鸟',
  鸟: '青鸣鸟',
  叫声: '青鸣鸟',
  苇鳞鱼: '苇鳞鱼',
  鱼: '苇鳞鱼',
  石塘狐: '石塘狐',
  狐: '石塘狐',
};

// 非结构化俗称 -> 区划 id（登记 codes 之外的现场俗称，推断要标 uncertain）
export const PLACE_SYNONYMS = {
  坡上: 'N',
  背阴: 'N',
  水边: 'S',
  水洼边: 'S',
};

// 本地日出（静听窗口用）：4 月 06:00，5 月 05:50，其它月份按 4 月口径
export const SUNRISE_BY_MONTH = { 4: '06:00', 5: '05:50', 10: '06:00' };

// 物种本轮调查季结束日（ISO 日期）；无结束日的物种可在任何适用月份内完成
export const SEASON_END = {
  青鸣鸟: '2026-05-31',
};

// 季节标签按自然年划分
export function seasonOf(dateIso) {
  const month = Number(dateIso.slice(5, 7));
  const year = dateIso.slice(0, 4);
  if (month <= 3) return `${year} 冬`;
  if (month <= 5) return `${year} 春季`;
  if (month <= 8) return `${year} 夏季`;
  if (month <= 11) return `${year} 秋季`;
  return `${year} 冬季`;
}

// 证据类型与中文标签：观察、未观察、推测、征引、纠正
export const STATEMENT_KINDS = {
  positive: '正观察',
  negative: '未观察',
  inference: '推测',
  citation: '征引',
  correction: '纠正',
};

// 结论在会审口径下的可发布级别
export const DISPOSITION = {
  publishable: '可面向公众',
  hypothesis: '仅可作待核假设',
  withheld: '暂不发布',
};

// 补查缺口的成因
export const GAP_REASONS = {
  coverage: '路线/单元未实际覆盖',
  incomplete: '完整独立观察数量不足',
  invalid: '方法执行不完整或条件失效',
  unresolvedPlace: '地点旧称重叠，待核覆盖范围',
  outOfSeason: '适用季节已过，现有名额无法覆盖',
};

// 日出前后一小时窗口；其它方法窗口按 methods.json 的 window 文本校验
export function insideListeningWindow(dateIso, slot) {
  const month = Number(dateIso.slice(5, 7));
  const sunrise = SUNRISE_BY_MONTH[month] ?? '06:00';
  const [sh, sm] = sunrise.split(':').map(Number);
  const [h, m] = slot.split(':').map(Number);
  const minutes = h * 60 + m;
  const center = sh * 60 + sm;
  return minutes >= center - 60 && minutes <= center + 60;
}

// 窗口文本 -> 当日分钟区间（仅登记数据中出现的口径）
const DAY_WINDOWS = {
  '日出前后一小时': (dateIso, slot) => insideListeningWindow(dateIso, slot),
  白天: (dateIso, slot) => {
    const [h] = slot.split(':').map(Number);
    return h >= 6 && h <= 18;
  },
  午前: (_dateIso, slot) => {
    const [h] = slot.split(':').map(Number);
    return h < 12;
  },
};

export function slotFitsWindow(windowText, dateIso, slot) {
  const check = DAY_WINDOWS[windowText];
  if (!check) return true; // 未登记的窗口口径不擅自判失效
  return check(dateIso, slot);
}

export function monthAllowed(method, dateIso) {
  return method.months.includes(Number(dateIso.slice(5, 7)));
}

export function targetAllowed(method, target) {
  return method.targets.includes(target);
}

// 当日是否已过该物种的本轮调查季
export function pastSeasonEnd(target, dateIso) {
  const end = SEASON_END[target];
  return Boolean(end) && dateIso > end;
}
