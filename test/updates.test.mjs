import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBundle } from '../tools/materials.mjs';

// 在临时资料包中模拟“会审后补交新手记”，验证两份产物可以继续维护
async function buildFrom(directory) {
  const { buildState } = await import('../src/app.mjs?update=' + Date.now());
  return buildState(pathToFileURL(directory + '/'));
}

function copyBundle() {
  const bundle = readBundle();
  const directory = mkdtempSync(join(tmpdir(), 'park-briefing-update-'));
  mkdirSync(join(directory), { recursive: true });
  for (const [name, rows] of Object.entries(bundle)) {
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(rows));
  }
  return directory;
}

test('会审后补交的新手记只补足一个对象时，同次已派出预订的另一缺口不撤销', async () => {
  const directory = copyBundle();
  const before = await buildFrom(directory);
  const fishGapId = 'gap|苇鳞鱼|G|M3|2026 春季';
  assert.ok(before.plan.scheduled.some(item => item.gapId === fishGapId));

  // 补交：桦径在 b1 同次出队中完成了青鸣鸟的有效静听（鱼仍未补）
  const notesPath = join(directory, 'notes.json');
  const notes = JSON.parse(readFileSync(notesPath));
  notes.push({
    id: 'n10',
    survey: 'u7',
    loggedAt: '2026-05-21',
    refs: [],
    previous: null,
    note: '沟口补听满一个时段，仍无青鸣鸟；苇鳞鱼的网具这趟没核成。',
  });
  writeFileSync(notesPath, JSON.stringify(notes));

  const after = await buildFrom(directory);
  // 鱼缺口仍在，且仍挂在已派出的 b1 上，没有被自动撤销
  assert.ok(after.ledger.gaps.some(g => g.id === fishGapId));
  assert.ok(after.plan.scheduled.some(item => item.gapId === fishGapId && item.bookingId === 'b1'));
  const b1 = after.plan.bookings.find(b => b.id === 'b1');
  assert.equal(b1.state, '已派出');

  rmSync(directory, { recursive: true, force: true });
});

test('后来的新发现与先前缺席同时为真，并自动生成推翻式更正说明', async () => {
  const directory = copyBundle();
  // 构造一条已发布的沟口阴性说法
  const hearingPath = join(directory, 'hearing.json');
  const hearing = JSON.parse(readFileSync(hearingPath));
  hearing.push({
    id: 'h4',
    scope: 'G',
    publishedAt: '2026-05-10',
    status: '公布',
    sentence: '沟口未见苇鳞鱼。',
    references: ['n5'],
  });
  // 补交一条沟口鱼的正观察手记
  const notesPath = join(directory, 'notes.json');
  const notes = JSON.parse(readFileSync(notesPath));
  notes.push({
    id: 'n11',
    survey: 'u5',
    loggedAt: '2026-05-22',
    refs: [],
    previous: null,
    note: '沟口两轮撒网核实完毕，第二轮捞到一尾苇鳞鱼。',
  });
  writeFileSync(join(directory, 'hearing.json'), JSON.stringify(hearing));
  writeFileSync(notesPath, JSON.stringify(notes));

  const state2 = await buildFrom(directory);
  const decision = state2.decisions.find(d => d.hearingId === 'h4');
  assert.ok(decision.correction, '新发现应触发更正说明');
  assert.equal(decision.correction.changeType, 'overturned');
  assert.match(decision.correction.newSentence, /记录到苇鳞鱼/);
  // 先前的缺席陈述没有被删除，仍可在溯源中查到
  const entry = state2.ledger.entries.find(e => e.key === '苇鳞鱼|G|2026 春季');
  assert.equal(entry.status, 'positive');
  assert.ok(entry.allStatements.some(id => id.startsWith('n5')));

  rmSync(directory, { recursive: true, force: true });
});
