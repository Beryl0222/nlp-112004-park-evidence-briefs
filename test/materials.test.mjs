import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBundle, readCollection } from '../tools/materials.mjs';

test('接件资料包含原文和原始记录', () => {
  const bundle = readBundle();
  const excerpts = [["notes", "n9", "沟口那一头"], ["notes", "n4", "一尾苇鳞鱼"], ["notes", "n2", "在这儿"], ["hearing", "h2", "暂未见"]];
  for (const [group, id, phrase] of excerpts) {
    const entry = bundle[group].find(row => row.id === id);
    assert.ok(entry, `${group}/${id} 缺少来件`);
    if (phrase) assert.ok(Object.values(entry).some(value => typeof value === 'string' && value.includes(phrase)), `${group}/${id} 的源文字缺少约定片段`);
  }
});

test('拒绝缺少正式字段的接件', t => {
  const directory = mkdtempSync(join(tmpdir(), 'park-evidence-briefs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'plots.json'), JSON.stringify([{ id: 'bad' }]));
  assert.throws(() => readCollection('plots', pathToFileURL(directory + sep)), TypeError);
});

test('补交只更正同次调查，原卡与队长的时段记录可联查', () => {
  const { notes, surveys } = readBundle();
  for (const note of notes.filter(row => row.previous)) {
    const original = notes.find(row => row.id === note.previous);
    assert.equal(note.survey, original.survey);
    assert.ok(Date.parse(note.loggedAt) >= Date.parse(original.loggedAt));
  }
  assert.ok(surveys.every(survey => /^\d{2}:\d{2}$/.test(survey.slot)));
});
