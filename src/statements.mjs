// 踏查手记解析：把一段手记拆成带证据强度的陈述。
// 每条陈述保留来源原句、独立调查编号、地点解析、方法是否实际采用与有效性问题。
// 解析不掉的原句不丢弃，进入 warnings 交工作人员人工核对。
import {
  TARGET_ALIASES,
  STATEMENT_KINDS,
  seasonOf,
  slotFitsWindow,
  monthAllowed,
  targetAllowed,
} from './domain.mjs';
import { resolvePlace } from './places.mjs';

const SENTENCE_SPLIT = /[。；;！!？?]+/;
const SUB_SPLIT = /[，,、]+/;

const CITE_WORDS = ['旧报告', '上一季', '上季', '去年', '转引', '报告说', '资料说'];
const INFER_WORDS = ['不确定', '疑似', '可能', '推测', '不能确定', '没法确定'];
const RAIN_WORDS = /雨大|大雨|雨后|下雨|噪声大/;
const RAIN_AFTER_DONE = /回来|之后|事后|完后/; // 雨在完成之后才出现，不追溯使场次失效
const COMPLETE_WORDS = /听满|听足|听完|做完|完整|两轮|两次|二个时段|做满/;
const NOT_VISITED = /没下到|没到|没去|未到|只到|没听|未听|可排除去过|另一头|这一头/;
const METHOD_NOT_APPLIED = /没下网|未下网|没有下网|看了一眼/;
const GEAR_UNVERIFIED = /规格待核|待核|网具.*未核实|未核实/;
const LISTEN_HINT = /听|叫声|声源|静听/;
const NET_HINT = /网|捞/;
const OBSERVATION_HINT = /听|叫声|声源|静听|网|捞|见|看|排除/;
const POSITIVE_WORDS = /有一尾|捞到|见到|看到|记到|听到过|听见有|有记录/;
const NEGATIVE_WORDS = /没听见|没有听见|没记到|没听到|未记录|无记录|未有|没有|没|未|无/;
// 否定词在前时，“有/见/到”等字只是否定短语的一部分，不算正观察
function isPositive(text) {
  if (!POSITIVE_WORDS.test(text)) return false;
  return !/(没|未|无|没有|未有)[^，。；]{0,6}(有一尾|捞到|见到|看到|记到|听到过|听见有|有记录)/.test(text);
}

function detectTarget(text, method) {
  const aliases = Object.keys(TARGET_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (text.includes(alias)) return { target: TARGET_ALIASES[alias], uncertain: false };
  }
  if (LISTEN_HINT.test(text) && method?.targets?.length === 1) {
    return { target: method.targets[0], uncertain: false };
  }
  if (NET_HINT.test(text) && method?.targets?.length === 1) {
    return { target: method.targets[0], uncertain: false };
  }
  if (method?.targets?.length === 1) return { target: method.targets[0], uncertain: true };
  return { target: null, uncertain: true };
}

function detectKind(text, note) {
  if (note.previous) return 'correction';
  if (CITE_WORDS.some(word => text.includes(word))) return 'citation';
  if (note.refs?.length > 0 && /^看|据|引/.test(text)) return 'citation';
  if (INFER_WORDS.some(word => text.includes(word))) return 'inference';
  if (METHOD_NOT_APPLIED.test(text)) return 'coverage';
  if (GEAR_UNVERIFIED.test(text) && !OBSERVATION_HINT.test(text.replace(/待核/g, ''))) return 'gearNote';
  if (NEGATIVE_WORDS.test(text) && OBSERVATION_HINT.test(text) && !isPositive(text)) return 'negative';
  // 完成了一次方法动作且未出现正观察词：该场次记为未观察（方法卡数量在台账再核）
  if (COMPLETE_WORDS.test(text) && (LISTEN_HINT.test(text) || NET_HINT.test(text)) && !isPositive(text)) {
    return 'negative';
  }
  if (isPositive(text)) return 'positive';
  if (NOT_VISITED.test(text)) return 'coverage';
  return 'other';
}

// 一场雨是否使本卡静听失效：雨在完成之后才下的不追溯
function rainInvalidates(noteText) {
  const rainMatch = noteText.match(RAIN_WORDS);
  if (!rainMatch) return false;
  const before = noteText.slice(0, rainMatch.index);
  return !RAIN_AFTER_DONE.test(before);
}

// 按句号先切句；句内只在“未到达/未采用方法”这类独立短语处再切，
// 避免把“没记到青鸣鸟”等否定观察从方法与对象上拆开。
function splitClauses(text) {
  const clauses = [];
  for (const sentence of text.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean)) {
    const parts = sentence.split(SUB_SPLIT).map(part => part.trim()).filter(Boolean);
    let merged = '';
    for (const part of parts) {
      const standaloneGap = NOT_VISITED.test(part) || METHOD_NOT_APPLIED.test(part) || /^可排除/.test(part);
      if (standaloneGap && merged) {
        clauses.push(merged);
        merged = part;
      } else if (!standaloneGap && merged && /^(雨大|大雨|雨后|回来下大雨)$/.test(part)) {
        clauses.push(merged);
        merged = part;
      } else {
        merged = merged ? `${merged}，${part}` : part;
      }
    }
    if (merged) clauses.push(merged);
  }
  return clauses;
}

export function extractStatements(bundle, registry) {
  const surveyById = new Map(bundle.surveys.map(survey => [survey.id, survey]));
  const methodById = new Map(bundle.methods.map(method => [method.id, method]));
  const noteById = new Map(bundle.notes.map(note => [note.id, note]));
  const statements = [];
  const warnings = [];
  let seq = 0;

  for (const note of bundle.notes) {
    const survey = surveyById.get(note.survey);
    const method = methodById.get(survey.registeredMethod);
    // 勘误卡由 applyCorrections 统一生成纠正陈述，主循环不重复成句
    if (note.previous) continue;
    const rainBad = method.id === 'M1' && rainInvalidates(note.note);
    const clauses = splitClauses(note.note);
    const covered = new Set();

    for (const clause of clauses) {
      // 程序性说明与纯天气短语：不构成证据陈述，但已消费、不报“漏掉原句”
      const procedural =
        (/^(补交|当时只有一组在场)/.test(clause) && !/听|网|见|鱼|鸟/.test(clause)) ||
        /^(雨大|大雨|雨后|回来下大雨|下雨)$/.test(clause);
      if (procedural) {
        covered.add(clause);
        continue;
      }
      const kind = detectKind(clause, note);
      if (kind === 'other') {
        warnings.push({ noteId: note.id, clause, reason: '未识别的陈述类型，需人工归类' });
        continue;
      }
      covered.add(clause);
      const { target, uncertain: targetUncertain } = detectTarget(clause, method);
      const place = resolvePlace(registry, clause, survey.planned);
      const complete = COMPLETE_WORDS.test(clause);
      const issues = [];

      if (rainBad && LISTEN_HINT.test(clause)) issues.push('rainNoise');
      if (GEAR_UNVERIFIED.test(clause)) issues.push('gearUnverified');
      if (METHOD_NOT_APPLIED.test(clause)) issues.push('methodNotApplied');
      if (!slotFitsWindow(method.window, survey.date, survey.slot)) issues.push('outsideWindow');
      if (!monthAllowed(method, survey.date)) issues.push('outOfSeasonMonth');
      if (target && !targetAllowed(method, target)) issues.push('targetNotApplicable');

      const isCitation = kind === 'citation';
      const citedNote = isCitation ? noteById.get(note.refs?.[0]) : null;
      let scopeMismatch = false;
      if (isCitation && citedNote) {
        const citedPlace = resolvePlace(registry, citedNote.note, surveyById.get(citedNote.survey).planned);
        const here = place.plotIds;
        const there = citedPlace.plotIds;
        scopeMismatch = here.length > 0 && there.length > 0 && !here.every(id => there.includes(id));
        if (place.status === 'ambiguous' || citedPlace.status === 'ambiguous') scopeMismatch = true;
      }
      // 是否实际采用了登记方法：明说没下网/只看一眼不算；动作与方法窗口无关也不算
      const methodActuallyApplied = !issues.includes('methodNotApplied') &&
        !(method.id === 'M1' && !LISTEN_HINT.test(clause)) &&
        !(method.id === 'M3' && !NET_HINT.test(clause));

      statements.push({
        id: `${note.id}#s${(seq += 1)}`,
        noteId: note.id,
        surveyId: survey.id,
        independentSurveyId: survey.id,
        team: survey.team,
        date: survey.date,
        season: seasonOf(survey.date),
        slot: survey.slot,
        methodId: method.id,
        methodLabel: method.label,
        target,
        targetUncertain,
        kind,
        kindLabel:
          STATEMENT_KINDS[kind] ?? (kind === 'coverage' ? '未覆盖' : kind === 'gearNote' ? '器材待核说明' : '其他'),
        place,
        complete: kind === 'coverage' || kind === 'gearNote' ? false : complete,
        validity: {
          valid: issues.length === 0,
          issues,
        },
        coverageOnly: kind === 'coverage',
        gearNoteOnly: kind === 'gearNote',
        methodActuallyApplied,
        cites: isCitation ? [...(note.refs ?? [])] : [],
        citedScopeMismatch: scopeMismatch,
        corrects: note.previous ?? null,
        supersededBy: null,
        text: clause,
      });
    }

    for (const clause of clauses) {
      if (!covered.has(clause)) warnings.push({ noteId: note.id, clause, reason: '原句未进入任何陈述' });
    }
  }

  applyCorrections(statements, bundle, registry);
  return { statements, warnings };
}

// 会审补交的勘误：原卡同地点陈述被取代，勘误本身作为同次独立调查的纠正性陈述
function applyCorrections(statements, bundle, registry) {
  const surveyById = new Map(bundle.surveys.map(survey => [survey.id, survey]));
  const methodById = new Map(bundle.methods.map(method => [method.id, method]));
  for (const note of bundle.notes.filter(row => row.previous)) {
    const original = bundle.notes.find(row => row.id === note.previous);
    const survey = surveyById.get(note.survey);
    const method = methodById.get(survey.registeredMethod);
    // 原卡中被地点更正的陈述：标记被取代，不再参与计数
    for (const stmt of statements.filter(row => row.noteId === original.id && row.place.uncertain)) {
      stmt.supersededBy = note.id;
    }
    // 勘误合并为一条纠正性陈述：地点以勘误明确落点为准，完整性看全卡；
    // “不是 X”另记一条否定地点的纠正，只用于推翻原卡，不参与目标计数。
    const clauses = splitClauses(note.note).filter(text => /听|网|见|鱼|鸟|点位/.test(text));
    const fullText = clauses.join('，');
    const { target } = detectTarget(fullText, method);
    const positivePlace = resolvePlace(
      registry,
      clauses.find(text => !/不是|未在|不在/.test(text)) ?? fullText,
      survey.planned,
    );
    const negatedMatch = fullText.match(/不是([^，。；]+)/);
    const negatedPlace = negatedMatch ? resolvePlace(registry, negatedMatch[1], survey.planned) : null;
    const base = {
      noteId: note.id,
      surveyId: survey.id,
      independentSurveyId: survey.id,
      team: survey.team,
      date: survey.date,
      season: seasonOf(survey.date),
      slot: survey.slot,
      methodId: method.id,
      methodLabel: method.label,
      target,
      targetUncertain: false,
      kind: 'correction',
      kindLabel: STATEMENT_KINDS.correction,
      validity: {
        valid: slotFitsWindow(method.window, survey.date, survey.slot) && monthAllowed(method, survey.date),
        issues: [
          ...(!slotFitsWindow(method.window, survey.date, survey.slot) ? ['outsideWindow'] : []),
          ...(!monthAllowed(method, survey.date) ? ['outOfSeasonMonth'] : []),
        ],
      },
      coverageOnly: false,
      gearNoteOnly: false,
      methodActuallyApplied: true,
      cites: [],
      citedScopeMismatch: false,
      corrects: original.id,
      supersededBy: null,
    };
    statements.push({
      ...base,
      id: `${note.id}#c1`,
      place: positivePlace,
      complete: COMPLETE_WORDS.test(fullText),
      text: fullText,
    });
    if (negatedPlace && negatedPlace.candidates.length > 0) {
      statements.push({
        ...base,
        id: `${note.id}#c2`,
        place: { ...negatedPlace, plotIds: [], negated: true, uncertain: true },
        complete: false,
        text: negatedMatch[0],
      });
    }
  }
}
