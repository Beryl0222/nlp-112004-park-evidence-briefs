// 命令行：打印证据台账、可发布简报、待核假设、补查清单与更正说明。
import { buildState, explainClaim } from '../src/app.mjs';

const state = buildState();
const line = (text = '') => console.log(text);
const heading = text => line(`\n=== ${text} ===`);

heading('解析提示（未识别原句需人工核对）');
if (state.parseWarnings.length === 0) line('无');
for (const warning of state.parseWarnings) line(`- [${warning.noteId}] ${warning.clause} —— ${warning.reason}`);

heading('地点待核选项');
if (state.ledger.pendingPlace.length === 0) line('无');
for (const item of state.ledger.pendingPlace) {
  line(`- ${item.target}：陈述 ${item.statementId}（${item.noteId}）候选单元 ${item.candidates.join(' / ')}`);
}

heading('证据台账（物种 × 单元 × 季节）');
for (const entry of state.ledger.entries) {
  line(
    `\n[${entry.key}] 状态=${entry.status} 完整有效=${entry.completeCount}/${entry.completedMin ?? '?'} ` +
    `合格缺席=${entry.qualifiedNegative ? '是' : '否'} 正观察=${entry.positives.length} ` +
    `独立调查=${entry.independentSurveyIds.join(',') || '无'}`,
  );
  if (entry.citationStatements.length) line(`  转引（不增加独立调查）: ${entry.citationStatements.join(', ')}`);
  if (entry.pendingPlaceStatements.length) line(`  地点待核: ${entry.pendingPlaceStatements.join(', ')}`);
  if (entry.invalidStatements.length) line(`  方法失效: ${entry.invalidStatements.join(', ')}`);
  if (entry.coverageStatements.length) line(`  未覆盖陈述: ${entry.coverageStatements.join(', ')}`);
}

heading('可发布简报');
for (const claim of state.briefing.publishable) {
  line(`- [${claim.plotLabel}·${claim.target}·${claim.season}] ${claim.status}｜${claim.limitation}`);
}
line(state.briefing.coverageNote);

heading('待核假设 / 不能发布的整区结论');
for (const claim of state.briefing.hypotheses) {
  line(`- [${claim.plotLabel}·${claim.target}·${claim.season}] ${claim.status}｜${claim.limitation}`);
}
for (const item of state.briefing.withheld) {
  line(`- 整区扣留 [${item.plotLabel}·${item.target}] “${item.sentence}”`);
  for (const reason of item.reasons) line(`    · ${reason}`);
}

heading('补查清单');
line('-- 已派出在途 --');
for (const item of state.plan.scheduled) line(`- ${item.gapId} -> ${item.bookingId}（${item.team}）${item.note}`);
line('-- 建议占用 --');
for (const item of state.plan.open) line(`- ${item.gapId} -> ${item.bookingId}（${item.team} ${item.window}）`);
line('-- 历史季节遗留（现有窗口不可代替，不占当季名额）--');
for (const item of state.plan.historical) line(`- ${item.id}：${item.note}`);
line('-- 冲突/需专家优先处置 --');
for (const conflict of state.plan.conflicts) {
  line(`- [${conflict.kind}] ${conflict.target}@${conflict.plotId} ${conflict.season}：${conflict.reasonLabel}`);
  for (const option of conflict.options) {
    line(`    预订 ${option.bookingId}：${option.eligible ? '可达' : option.blockers.join('；')}`);
  }
  for (const held of conflict.heldConsequences) {
    line(`    搁置影响：${held.claimId}（${held.currentStatus}）${held.blockedUpgrade}`);
  }
}

heading('更正说明（已发布说法的实质变动）');
if (state.briefing.corrections.length === 0) line('无');
for (const correction of state.briefing.corrections) {
  line(`- ${correction.id} [${correction.changeLabel}]`);
  line(`  新表述：${correction.newSentence}`);
  line(`  引用：${correction.citations.join('、')}｜理由：${correction.reason}`);
}

if (process.argv[2] === '--explain') {
  const claimId = process.argv[3];
  heading(`溯源 ${claimId ?? ''}`);
  const detail = explainClaim(state, claimId);
  if (!detail) line('未找到该结论');
  else console.log(JSON.stringify(detail, null, 2));
}
