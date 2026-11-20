// 应用编排：从已登记资料包构建证据台账、会审结论、可发布简报与补查清单。
import { readBundle } from '../tools/materials.mjs';
import { buildPlotRegistry } from './places.mjs';
import { extractStatements } from './statements.mjs';
import { buildLedger } from './ledger.mjs';
import { evaluateHearing, buildBriefing } from './hearing.mjs';
import { planResurvey, applyExpertDecision } from './planner.mjs';

export function buildState(directory) {
  const bundle = readBundle(directory);
  const registry = buildPlotRegistry(bundle.plots);
  const { statements, warnings } = extractStatements(bundle, registry);
  const ledger = buildLedger({ statements, bundle, registry });
  const decisions = evaluateHearing(bundle, ledger, registry, statements);
  const briefing = buildBriefing(bundle, ledger, registry, statements, decisions);
  const plan = planResurvey({ ledger, bundle });
  return {
    bundle,
    registry,
    statements,
    parseWarnings: warnings,
    ledger,
    decisions,
    briefing,
    plan,
  };
}

export { applyExpertDecision };

// 点开一条结论时的溯源视图：成立依据、限定条件、被谁推翻
export function explainClaim(state, claimId) {
  const statementById = new Map(state.statements.map(s => [s.id, s]));
  const entry = state.ledger.entries.find(e => `claim|${e.key}` === claimId);
  if (!entry) {
    const decision = state.decisions.find(d => `withheld|${d.hearingId}` === claimId);
    if (decision) return { kind: 'withheld-hearing', ...decision };
    return null;
  }
  // 被勘误取代的原卡陈述也要可追溯：按同一 物种×单元 补进溯源
  const supersededForEntry = state.statements.filter(
    s => s.supersededBy && s.target === entry.target && s.place.candidates.includes(entry.plotId),
  );
  const traceIds = [...new Set([...entry.allStatements, ...supersededForEntry.map(s => s.id)])];
  const trace = traceIds.map(id => {
    const s = statementById.get(id);
    return {
      statementId: s.id,
      noteId: s.noteId,
      surveyId: s.surveyId,
      independentSurveyId: s.independentSurveyId,
      team: s.team,
      date: s.date,
      season: s.season,
      kind: s.kind,
      kindLabel: s.kindLabel,
      target: s.target,
      place: s.place,
      complete: s.complete,
      validity: s.validity,
      cites: s.cites,
      citedScopeMismatch: s.citedScopeMismatch,
      corrects: s.corrects,
      supersededBy: s.supersededBy,
      text: s.text,
    };
  });
  // 更正说明只在同一物种、同一单元的条目上展示，避免跨单元串挂
  const correction = state.decisions
    .filter(d => d.target === entry.target && d.scopePlotId === entry.plotId)
    .flatMap(d => (d.correction ? [d.correction] : []))
    .find(c => entry.allStatements.some(id => c.citations.includes(statementById.get(id)?.noteId)) ?? false);
  return {
    kind: 'entry',
    key: entry.key,
    target: entry.target,
    plotId: entry.plotId,
    season: entry.season,
    status: entry.status,
    qualifiedNegative: entry.qualifiedNegative,
    completedMin: entry.completedMin,
    completeCount: entry.completeCount,
    independentSurveyIds: entry.independentSurveyIds,
    validNegativeSurveyIds: entry.validNegativeSurveyIds,
    limitation: entry.qualifiedNegative
      ? '仅在方法适用条件下未记录，不能宣布物种不存在'
      : '证据未达方法卡数量或范围待核，仅可作待核假设',
    trace,
    correction: correction ?? null,
  };
}
