// 区划与历史称呼：把手记里的地点说法解析成调查单元，重叠旧称给出待核候选。
import { PLACE_SYNONYMS } from './domain.mjs';

export function buildPlotRegistry(plots) {
  const byId = new Map(plots.map(plot => [plot.id, plot]));
  const codeIndex = new Map(); // 称呼 -> plot id 列表
  const synonymIndex = new Map(Object.entries(PLACE_SYNONYMS));
  for (const plot of plots) {
    for (const code of plot.codes) {
      if (!codeIndex.has(code)) codeIndex.set(code, []);
      codeIndex.get(code).push(plot.id);
    }
  }
  return { byId, codeIndex, synonymIndex, plots };
}

// 把一段文字里出现的登记称呼/俗称解析为地点
// 返回 { status: exact | ambiguous | synonym | none, plotIds, candidates, term, uncertain }
export function resolvePlace(registry, text, contextPlotIds = []) {
  // 先看登记的正式 label
  for (const plot of registry.plots) {
    if (text.includes(plot.label)) {
      return { status: 'exact', plotIds: [plot.id], candidates: [plot.id], term: plot.label, uncertain: false };
    }
  }
  // 登记 codes（可能重叠）
  for (const [code, ids] of registry.codeIndex) {
    if (text.includes(code)) {
      if (ids.length === 1) {
        return { status: 'exact', plotIds: [...ids], candidates: [...ids], term: code, uncertain: false };
      }
      return {
        status: 'ambiguous',
        plotIds: [],
        candidates: [...ids],
        term: code,
        uncertain: true,
        note: `称呼「${code}」在区划名册中同时登记于 ${ids.join('、')}，覆盖范围待核`,
      };
    }
  }
  // 现场俗称（推断，保留 uncertain 标记）
  for (const [word, plotId] of registry.synonymIndex) {
    if (text.includes(word)) {
      return {
        status: 'synonym',
        plotIds: contextPlotIds.length === 1 ? [plotId] : [plotId],
        candidates: [plotId],
        term: word,
        uncertain: true,
        note: `「${word}」为现场俗称，按区划惯例推定为 ${plotId}，需会审确认`,
      };
    }
  }
  // 指示词：只在上下文唯一时落定，否则保持待核
  if (/这里|这儿|这个地方|那一头|这一头/.test(text)) {
    const unique = [...new Set(contextPlotIds)];
    if (unique.length === 1) {
      return { status: 'deictic', plotIds: unique, candidates: unique, term: '指示词', uncertain: false };
    }
    return {
      status: 'ambiguous',
      plotIds: [],
      candidates: unique,
      term: '指示词',
      uncertain: true,
      note: '指示地点在本次出队计划中不唯一，覆盖范围待核',
    };
  }
  return { status: 'none', plotIds: [], candidates: [], term: null, uncertain: true };
}

// 区划汇总：parent/includes 的向上与向下成员
export function familyOf(registry, plotId) {
  const plot = registry.byId.get(plotId);
  if (!plot) return { ancestors: [], descendants: [] };
  const ancestors = [];
  let cur = plot.parent;
  while (cur) {
    ancestors.push(cur);
    cur = registry.byId.get(cur)?.parent ?? null;
  }
  const descendants = [...(plot.includes ?? [])];
  for (const child of plot.includes ?? []) {
    descendants.push(...(registry.byId.get(child)?.includes ?? []));
  }
  return { ancestors, descendants: [...new Set(descendants)] };
}

// 单元级证据是否可以外推到某片区：只允许向下限定，不允许向上自动覆盖
export function coveredBy(registry, claimPlotId, targetPlotId) {
  if (claimPlotId === targetPlotId) return true;
  const { descendants } = familyOf(registry, claimPlotId);
  return descendants.includes(targetPlotId);
}
