// 会审：按方法适用边界与证据判定约定，决定每条说法的可发布级别；
// 已对外发布且发生实质变动的说法，生成带引用的更正说明。
import { DISPOSITION } from './domain.mjs';
import { familyOf } from './places.mjs';

const TARGET_WORDS = [
  ['苇鳞鱼', '苇鳞鱼'],
  ['青鸣鸟', '青鸣鸟'],
  ['青鸣', '青鸣鸟'],
  ['鱼', '苇鳞鱼'],
  ['鸟', '青鸣鸟'],
];

export function targetOfSentence(sentence) {
  for (const [word, target] of TARGET_WORDS) {
    if (sentence.includes(word)) return target;
  }
  return null;
}

function currentSeasonOf(entries) {
  const seasons = entries.map(e => e.season).sort();
  return seasons.filter(s => s.includes('春季')).at(-1) ?? seasons.at(-1);
}

// 说法自己的时间词决定它引用的是哪个季节，避免拿当季证据评跨季说法
function seasonOfSentence(sentence, fallback) {
  if (/上一季|上季|去年|秋季|秋天/.test(sentence)) {
    const year = Number(fallback.slice(0, 4));
    return sentence.includes('去年') ? `${year - 1} 秋季` : `${year - 1} 秋季`;
  }
  return fallback;
}

export function evaluateHearing(bundle, ledger, registry, statements) {
  const entryByKey = new Map(ledger.entries.map(entry => [entry.key, entry]));
  const statementById = new Map(statements.map(stmt => [stmt.id, stmt]));
  const noteStatements = new Map();
  for (const stmt of statements) {
    if (!noteStatements.has(stmt.noteId)) noteStatements.set(stmt.noteId, []);
    noteStatements.get(stmt.noteId).push(stmt);
  }
  const currentSeason = currentSeasonOf(ledger.entries);

  const decisions = bundle.hearing.map(record => {
    const target = targetOfSentence(record.sentence);
    const scope = registry.byId.get(record.scope);
    const { descendants } = familyOf(registry, record.scope);
    const units = descendants.length > 0 ? descendants : [record.scope];
    const season = seasonOfSentence(record.sentence, currentSeason);

    const unitEntries = units.map(unit =>
      target ? entryByKey.get(`${target}|${unit}|${season}`) ?? null : null,
    );
    const coveredUnits = unitEntries.filter(Boolean);
    const limitations = [];
    let disposition;
    let basisStatementIds = [];

    if (descendants.length > 0) {
      // 片区级说法：每个从属单元都要有“合格”证据（合格缺席或正观察）；
      // 证据不足、待核或完全没有证据的单元都使整区结论不能发布
      const missing = units.filter((unit, index) => {
        const entry = unitEntries[index];
        return !entry || (!entry.qualifiedNegative && entry.positives.length === 0);
      });
      if (missing.length > 0) {
        disposition = DISPOSITION.withheld;
        limitations.push(
          `整区结论超出已覆盖范围：${missing.join('、')} 缺少本对象的合格证据，不能把整区画成阴性`,
        );
      } else {
        disposition = DISPOSITION.publishable;
      }
      for (const entry of coveredUnits) basisStatementIds.push(...entry.allStatements);
    } else {
      const entry = unitEntries[0];
      if (!entry) {
        disposition = DISPOSITION.hypothesis;
        limitations.push(`本单元在 ${season} 没有可归位的证据`);
      } else if (entry.pendingPlaceStatements.length > 0) {
        disposition = DISPOSITION.hypothesis;
        limitations.push('存在地点待核陈述，覆盖范围未确定');
        basisStatementIds = entry.allStatements;
      } else if (entry.qualifiedNegative) {
        disposition = DISPOSITION.publishable;
        limitations.push(`仅为${entry.methodId} 方法条件下的未记录，不代表物种不存在`);
        basisStatementIds = entry.allStatements.filter(id => {
          const s = statementById.get(id);
          return s && (s.kind === 'negative' || s.kind === 'correction') && s.validity.valid && !s.supersededBy;
        });
      } else if (entry.positives.length > 0) {
        disposition = DISPOSITION.publishable;
        basisStatementIds = entry.positives.map(p => p.statementId);
      } else {
        disposition = DISPOSITION.hypothesis;
        limitations.push(`完整有效观察 ${entry.completeCount} 次，未达方法卡 ${entry.completedMin} 次的要求`);
        basisStatementIds = entry.allStatements;
      }
    }

    // 引用手记里的推断/转引不能升级发布级别
    const refKinds = record.references.flatMap(id =>
      (noteStatements.get(id) ?? []).map(s => s.kind),
    );
    if (disposition === DISPOSITION.publishable && refKinds.every(k => k === 'citation' || k === 'inference')) {
      disposition = DISPOSITION.hypothesis;
      limitations.push('引用全部由转引或推测构成，缺少独立调查支撑');
    }

    const decision = {
      hearingId: record.id,
      target,
      scopePlotId: record.scope,
      scopeLabel: scope.label,
      publishedAt: record.publishedAt,
      hearingStatus: record.status,
      originalSentence: record.sentence,
      references: [...record.references],
      disposition,
      limitations,
      basisStatementIds: [...new Set(basisStatementIds)],
      unitStatus: units.map((unit, i) => ({
        plotId: unit,
        status: unitEntries[i]?.status ?? 'no-evidence',
      })),
    };
    decision.correction = buildCorrection(decision, entryByKey, registry, season, statements);
    return decision;
  });

  return decisions;
}

// 已发布说法的实质变动：调查结束（被完成状态取代）、被新证据推翻、范围被勘误收窄
function buildCorrection(decision, entryByKey, registry, season, statementsAll) {
  if (!decision.publishedAt) return null;
  const record = decision;
  if (record.scopePlotId && familyOf(registry, record.scopePlotId).descendants.length === 0) {
    const entry = entryByKey.get(`${record.target}|${record.scopePlotId}|${season}`);
    const mentionsOngoing = /尚未结束|进行中|未完|暂未结束/.test(record.originalSentence);
    if (mentionsOngoing && entry?.qualifiedNegative) {
      const citations = entry.allStatements
        .map(id => statementsAll.find(s => s.id === id))
        .filter(s => s && (s.kind === 'negative' || s.kind === 'correction') && s.validity.valid && !s.supersededBy)
        .map(s => s.noteId);
      return {
        id: `corr-${record.hearingId}`,
        changeType: 'superseded',
        changeLabel: '原说法被完成状态取代',
        newSentence: `${registry.byId.get(record.scopePlotId).label}本季${entry.methodId}已完成 ${new Set(entry.validNegativeSurveyIds).size} 次独立完整观察，均未记录到${record.target}；该结论仅在方法适用条件下成立。`,
        citations: [...new Set(citations)],
        reason: '原发布时调查尚未结束；后续手记与勘误使合格缺席条件成立，原句中的“尚未结束”不再符合现状',
      };
    }
    if (entry?.positives.length && /未见|未记录|没有/.test(record.originalSentence)) {
      return {
        id: `corr-${record.hearingId}`,
        changeType: 'overturned',
        changeLabel: '原阴性说法被新发现推翻',
        newSentence: `${registry.byId.get(record.scopePlotId).label}在 ${entry.positives[0].date} 的独立调查中记录到${record.target}，原未记录说法作废。`,
        citations: [entry.positives[0].statementId],
        reason: '先前缺席与后来新发现各自对应不同时段；新证据出现后原阴性结论不再成立',
      };
    }
  }
  return null;
}

// 生成两份产物：可发布简报（保留局部可用结果与覆盖缺口说明）和待核假设清单
export function buildBriefing(bundle, ledger, registry, statements, decisions) {
  const publishable = [];
  const hypotheses = [];
  const withheld = [];

  for (const entry of ledger.entries) {
    const plot = registry.byId.get(entry.plotId);
    const claim = {
      id: `claim|${entry.key}`,
      target: entry.target,
      plotId: entry.plotId,
      plotLabel: plot.label,
      season: entry.season,
      status: entry.status,
      limitation: entry.positives.length > 0
        ? `正观察来自 ${entry.positives.map(p => p.date).join('、')} 的独立调查；只代表当时当范围，不外推到其他季节或单元`
        : entry.qualifiedNegative
          ? `${entry.methodId} 条件下未记录（完整有效观察 ${entry.completeCount}/${entry.completedMin} 次），不等于物种不存在`
          : entry.pendingPlaceStatements.length > 0
            ? '地点旧称重叠，覆盖哪一部分待核'
            : `完整有效观察 ${entry.completeCount}/${entry.completedMin ?? '?'} 次，存在覆盖缺口`,
      statementIds: [...entry.allStatements],
    };
    if (entry.qualifiedNegative || entry.positives.length > 0) publishable.push(claim);
    else if (entry.pendingPlaceStatements.length > 0 || entry.inferenceStatements.length > 0) hypotheses.push(claim);
    else hypotheses.push(claim);
  }

  for (const decision of decisions) {
    if (decision.hearingStatus === '送审' && decision.disposition === DISPOSITION.withheld) {
      withheld.push({
        id: `withheld|${decision.hearingId}`,
        target: decision.target,
        plotId: decision.scopePlotId,
        plotLabel: decision.scopeLabel,
        sentence: decision.originalSentence,
        reasons: decision.limitations,
        unitStatus: decision.unitStatus,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    publishable,
    hypotheses,
    withheld,
    corrections: decisions.map(d => d.correction).filter(Boolean),
    coverageNote: '本简报只陈述已覆盖单元的结果；未覆盖或未达方法数量的单元列入补查清单，不以缺席措辞外推。',
  };
}
