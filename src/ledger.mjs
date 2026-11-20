// 证据台账：按 物种 × 调查单元 × 季节 汇总独立证据。
// 重述与转引不增加独立调查数量；只有满足方法卡完整观察数量的未观察才可判“条件下未记录”。
import { GAP_REASONS, SEASON_END } from './domain.mjs';

function methodFor(methods, target, dateIso) {
  const month = Number(dateIso.slice(5, 7));
  return methods.find(m => m.targets.includes(target) && m.months.includes(month)) ?? null;
}

export function buildLedger({ statements, bundle, registry }) {
  const keys = new Map();
  const ensure = key => {
    if (!keys.has(key)) {
      keys.set(key, {
        key,
        target: key.split('|')[0],
        plotId: key.split('|')[1],
        season: key.split('|')[2],
        methodId: null,
        independentSurveys: new Set(),
        validNegativeSurveys: new Set(),
        completeCount: 0,
        completedMin: null,
        positives: [],
        qualifiedNegative: false,
        pendingPlaceStatements: [],
        inferenceStatements: [],
        citationStatements: [],
        invalidStatements: [],
        coverageStatements: [],
        allStatements: [],
      });
    }
    return keys.get(key);
  };

  const pending = []; // 地点待核的陈述，供专家选候选单元

  for (const stmt of statements) {
    if (stmt.supersededBy) continue; // 被勘误取代的原卡陈述不进台账
    if (!stmt.target) continue;
    const method = bundle.methods.find(m => m.id === stmt.methodId);
    const target = stmt.target;

    // 待核选项只针对“多个候选、无法确定覆盖哪一部分”的重叠称呼；
    // 唯一候选的俗称推断保留 uncertain 标记供溯源，但不占用专家待核名额
    if (
      stmt.place.uncertain &&
      stmt.place.candidates.length > 1 &&
      !stmt.place.negated
    ) {
      pending.push({ statementId: stmt.id, target, candidates: [...stmt.place.candidates], noteId: stmt.noteId });
    }
    // 登记方法没有实际采用的陈述：
    // 同方法的“未到达/未覆盖”说明保留为覆盖缺口；
    // 跨方法的顺带观察（如 M3 出队时“看一眼”鸟）不进该对象的证据条目
    if (stmt.methodActuallyApplied === false) {
      const sameMethodFamily =
        (stmt.methodId === 'M1' && /听|叫声|静听/.test(stmt.text)) ||
        (stmt.methodId === 'M3' && /网|捞|下到|到/.test(stmt.text));
      if (!stmt.coverageOnly || !sameMethodFamily) continue;
    }

    const plotIds = stmt.place.plotIds.length > 0 ? stmt.place.plotIds : stmt.place.candidates;

    for (const plotId of plotIds) {
      const key = `${target}|${plotId}|${stmt.season}`;
      const entry = ensure(key);
      entry.methodId = stmt.methodId;
      entry.completedMin = method?.completedMin ?? entry.completedMin;
      entry.allStatements.push(stmt.id);

      if (stmt.kind === 'citation') {
        entry.citationStatements.push(stmt.id);
        continue; // 转引不增加独立调查
      }
      if (stmt.kind === 'inference') {
        entry.inferenceStatements.push(stmt.id);
        continue;
      }
      if (stmt.coverageOnly) {
        entry.coverageStatements.push(stmt.id);
        continue;
      }
      if (stmt.gearNoteOnly) {
        entry.invalidStatements.push(stmt.id);
        continue; // 器材待核说明本身不是一场观察
      }
      if (stmt.place.uncertain) {
        entry.pendingPlaceStatements.push(stmt.id);
        // 覆盖哪一部分尚未核定：不进任何单元的独立调查与场次计数
        continue;
      }
      if (!stmt.validity.valid) {
        entry.invalidStatements.push(stmt.id);
        continue; // 方法失效或条件不满足，不计有效场次
      }

      entry.independentSurveys.add(stmt.independentSurveyId);
      if (stmt.kind === 'positive') {
        entry.positives.push({ statementId: stmt.id, surveyId: stmt.independentSurveyId, date: stmt.date });
      }
      if (stmt.kind === 'negative' && stmt.complete) {
        entry.validNegativeSurveys.add(stmt.independentSurveyId);
        entry.completeCount += 1;
      }
      if (stmt.kind === 'correction' && stmt.complete && !stmt.place.negated) {
        entry.validNegativeSurveys.add(stmt.independentSurveyId);
        entry.completeCount += 1;
      }
    }
  }

  // 合格缺席判定（条件下未记录，不等于物种不存在）
  for (const entry of keys.values()) {
    const method = bundle.methods.find(m => m.id === entry.methodId);
    entry.completedMin = method?.completedMin ?? null;
    entry.qualifiedNegative =
      entry.positives.length === 0 &&
      entry.completedMin !== null &&
      new Set(entry.validNegativeSurveys).size >= entry.completedMin &&
      entry.pendingPlaceStatements.length === 0;
    entry.status = classify(entry);
    entry.independentSurveyIds = [...entry.independentSurveys];
    entry.validNegativeSurveyIds = [...entry.validNegativeSurveys];
    delete entry.independentSurveys;
    delete entry.validNegativeSurveys;
  }
  const gaps = deriveGaps([...keys.values()], { bundle, registry, statements });
  return {
    entries: [...keys.values()].sort((a, b) => a.key.localeCompare(b.key)),
    gaps,
    pendingPlace: pending,
  };
}

function classify(entry) {
  if (entry.positives.length > 0 && entry.qualifiedNegative) return 'mixed-conflict';
  if (entry.positives.length > 0) return 'positive';
  if (entry.qualifiedNegative) return 'qualified-negative';
  if (entry.completeCount > 0 || entry.independentSurveys.size > 0) return 'insufficient';
  return 'no-valid-coverage';
}

// 缺口：只在“有方法适用、且队伍确实到过该单元或该单元被列入计划”的组合上产生
function deriveGaps(entries, { bundle, registry, statements }) {
  const gaps = [];

  // 每个 季节 × 物种 实际登记使用过的方法：没有队伍采用的方法不产生补查口径
  const methodsInUse = new Map(); // `${season}|${target}` -> Set(methodId)
  const appliedTargets = new Set(); // `${season}|${target}` 实际有方法动作的对象
  const plannedUnits = new Map(); // `${season}|${target}|${plotId}` -> methodId
  for (const survey of bundle.surveys) {
    const method = bundle.methods.find(m => m.id === survey.registeredMethod);
    const season = seasonLabel(survey.date);
    for (const plotId of survey.planned) {
      for (const target of method.targets) {
        const mapKey = `${season}|${target}`;
        if (!methodsInUse.has(mapKey)) methodsInUse.set(mapKey, new Set());
        methodsInUse.get(mapKey).add(method.id);
        plannedUnits.set(`${mapKey}|${plotId}`, method.id);
      }
    }
  }
  for (const stmt of statements) {
    if (stmt.methodActuallyApplied && stmt.target && !stmt.supersededBy) {
      appliedTargets.add(`${stmt.season}|${stmt.target}`);
    }
  }
  // 实际出现过该对象陈述（含“未到达”说明）的单元：
  // 计划里挂名、或只是其他方法顺带“看一眼”的单元不产生本方法缺口
  const mentionedUnits = new Set();
  for (const stmt of statements) {
    if (!stmt.target || stmt.supersededBy || stmt.methodActuallyApplied === false) continue;
    for (const plotId of stmt.place.plotIds) {
      mentionedUnits.add(`${stmt.season}|${stmt.target}|${plotId}`);
    }
  }

  const makeGap = (target, plotId, methodId, season, reason, detail, currentCompletes) => {
    const method = bundle.methods.find(m => m.id === methodId);
    return {
      id: `gap|${target}|${plotId}|${methodId}|${season}`,
      target,
      plotId,
      methodId,
      season,
      reason,
      reasonLabel: GAP_REASONS[reason],
      detail,
      requiredCompletes: method.completedMin,
      currentCompletes,
      deadline: SEASON_END[target] ?? null,
      pastDeadline: SEASON_END[target] ? isSeasonPast(season, SEASON_END[target]) : false,
    };
  };

  for (const entry of entries) {
    if (entry.status === 'qualified-negative' || entry.status === 'positive') continue;
    // 该季根本没有对该对象实际采用过方法：不产生阴性口径，只留覆盖说明
    if (!appliedTargets.has(`${entry.season}|${entry.target}`)) continue;
    // 缺口方法以该条目实际登记的方法为准；没有任何陈述时才退回当季采用过的方法
    const methodIds = entry.methodId ? [entry.methodId] : [...(methodsInUse.get(`${entry.season}|${entry.target}`) ?? [])];
    for (const methodId of methodIds) {
      const reason = pickReason(entry);
      gaps.push(
        makeGap(entry.target, entry.plotId, methodId, entry.season, reason, describeGap(entry, reason), entry.completeCount),
      );
    }
  }

  // 计划到达但完全没有形成任何陈述的单元 × 适用对象；
  // 若全季未对该对象实际采用方法，则只是覆盖说明，不列为可补查缺口
  const coveredKeys = new Set(entries.map(e => `${e.target}|${e.plotId}|${e.season}`));
  for (const [planKey, methodId] of plannedUnits) {
    // 键格式 `${season}|${target}|${plotId}`，季节本身含空格但不含竖线
    const plotId = planKey.slice(planKey.lastIndexOf('|') + 1);
    const rest = planKey.slice(0, planKey.lastIndexOf('|'));
    const target = rest.slice(rest.lastIndexOf('|') + 1);
    const season = rest.slice(0, rest.lastIndexOf('|'));
    // 全季未对该对象实际采用方法：只是计划上的名义对象，不产生可补查缺口
    if (!appliedTargets.has(`${season}|${target}`)) continue;
    // 手记完全没有提到该单元与对象的组合（计划挂名/顺带看一眼）：不画成阴性缺口
    if (!mentionedUnits.has(`${season}|${target}|${plotId}`)) continue;
    if (coveredKeys.has(`${target}|${plotId}|${season}`)) continue;
    gaps.push(
      makeGap(target, plotId, methodId, season, 'coverage',
        '该单元在本季被列入出队计划，但手记中没有形成该对象的有效陈述', 0),
    );
  }

  return dedupeGaps(gaps);
}

function seasonLabel(dateIso) {
  const month = Number(dateIso.slice(5, 7));
  const year = dateIso.slice(0, 4);
  return month >= 10 ? `${year} 秋季` : `${year} 春季`;
}

function pickReason(entry) {
  if (entry.pendingPlaceStatements.length > 0) return 'unresolvedPlace';
  if (entry.invalidStatements.length > 0 && entry.completeCount === 0) return 'invalid';
  if (entry.coverageStatements.length > 0 && entry.independentSurveyIds.length === 0) return 'coverage';
  return 'incomplete';
}

function describeGap(entry, reason) {
  if (reason === 'unresolvedPlace') return '存在地点旧称重叠的陈述，无法确认覆盖的是哪个单元，需专家对待核选项定性';
  if (reason === 'invalid') return '已到场但方法执行不完整或观察条件失效（如雨噪、网具待核）';
  if (reason === 'coverage') return '队伍未实际到达该单元或未实际采用该方法';
  return `已有 ${entry.completeCount} 次完整有效观察，方法卡要求 ${entry.completedMin} 次`;
}

function isSeasonPast(season, deadlineIso) {
  const year = Number(season.slice(0, 4));
  const deadlineYear = Number(deadlineIso.slice(0, 4));
  if (year < deadlineYear) return true;
  if (year > deadlineYear) return false;
  return season.includes('秋季') ? deadlineIso < `${year}-10-01` : deadlineIso < `${year}-06-01`;
}

function dedupeGaps(gaps) {
  const map = new Map();
  for (const gap of gaps) {
    const key = `${gap.target}|${gap.plotId}|${gap.methodId}|${gap.season}`;
    if (!map.has(key)) map.set(key, gap);
    else {
      const order = ['unresolvedPlace', 'invalid', 'coverage', 'incomplete'];
      if (order.indexOf(gap.reason) < order.indexOf(map.get(key).reason)) map.set(key, gap);
    }
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
