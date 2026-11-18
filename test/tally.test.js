'use strict';

// index.html 안의 <script id="tally-core"> 블록만 꺼내 Node에서 실행해 시험한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script id="tally-core">([\s\S]*?)<\/script>/);
assert.ok(match, 'index.html에 <script id="tally-core"> 블록이 있어야 한다');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[1], sandbox);
const { parseTsv, classifyCell, formatAverage, tally } = sandbox.SurveyTally;

// vm 컨텍스트에서 만든 객체는 프로토타입이 달라 deepEqual이 실패하므로 JSON으로 옮긴다.
const plain = (v) => JSON.parse(JSON.stringify(v));
const run = (text) => plain(tally(text));
const rowOf = (result, name) => result.questions.find((q) => q.name === name);

test('칸 판정: 1~5는 유효', () => {
  for (const v of ['1', '2', '3', '4', '5']) assert.equal(classifyCell(v), 'valid', v);
});

test('칸 판정: 앞뒤 공백을 지운 뒤 판정', () => {
  assert.equal(classifyCell(' 3 '), 'valid');
  assert.equal(classifyCell(' 4　'), 'valid');
  assert.equal(classifyCell('  '), 'blank');
  assert.equal(classifyCell('　'), 'blank');
});

test('칸 판정: 비었거나 없는 칸은 빈 응답', () => {
  assert.equal(classifyCell(''), 'blank');
  assert.equal(classifyCell(undefined), 'blank');
});

test('칸 판정: 그 밖의 값은 제외', () => {
  for (const v of ['0', '6', '10', '1.0', '3.5', '-1', '+3', '３', '예', 'N/A', '1 2', '"3"']) {
    assert.equal(classifyCell(v), 'excluded', v);
  }
});

test('평균: 소수 둘째 자리까지 표시', () => {
  assert.equal(formatAverage(9, 3), '3.00');
  assert.equal(formatAverage(5, 1), '5.00');
  assert.equal(formatAverage(7, 2), '3.50');
});

test('평균: 소수 셋째 자리에서 반올림', () => {
  assert.equal(formatAverage(1, 3), '0.33');
  assert.equal(formatAverage(2, 3), '0.67');
  assert.equal(formatAverage(8, 3), '2.67');
  assert.equal(formatAverage(13, 3), '4.33');
  // 2.665는 부동소수점으로는 2.66499...이 되기 쉽다. 정확히 반올림해 2.67.
  assert.equal(formatAverage(533, 200), '2.67');
  assert.equal(formatAverage(2665, 1000), '2.67');
  assert.equal(formatAverage(2664, 1000), '2.66');
  assert.equal(formatAverage(1005, 1000), '1.01');
});

test('평균: 유효 응답이 0이면 "-"', () => {
  assert.equal(formatAverage(0, 0), '-');
});

test('기본 집계: 첫 열은 집계하지 않는다', () => {
  const text = '응답번호\tQ1\tQ2\n1\t5\t3\n2\t4\t\n3\t3\t예\n';
  const r = run(text);
  assert.equal(r.ok, true);
  assert.equal(r.rowCount, 3);
  assert.deepEqual(r.questions.map((q) => q.name), ['Q1', 'Q2']);
  assert.deepEqual(rowOf(r, 'Q1'), { name: 'Q1', valid: 3, sum: 12, average: '4.00', blank: 0, excluded: 0 });
  assert.deepEqual(rowOf(r, 'Q2'), { name: 'Q2', valid: 1, sum: 3, average: '3.00', blank: 1, excluded: 1 });
});

test('응답번호 열의 값은 판정에 영향이 없다', () => {
  const r = run('번호\tQ1\n가나다\t2\n\t4\n99\t\n');
  assert.deepEqual(rowOf(r, 'Q1'), { name: 'Q1', valid: 2, sum: 6, average: '3.00', blank: 1, excluded: 0 });
});

test('칸이 모자란 줄은 모자란 칸을 빈 응답으로 센다', () => {
  const r = run('번호\tQ1\tQ2\tQ3\n1\t5\n2\n3\t1\t2\t3\n');
  assert.equal(r.rowCount, 3);
  assert.deepEqual(rowOf(r, 'Q1'), { name: 'Q1', valid: 2, sum: 6, average: '3.00', blank: 1, excluded: 0 });
  assert.deepEqual(rowOf(r, 'Q2'), { name: 'Q2', valid: 1, sum: 2, average: '2.00', blank: 2, excluded: 0 });
  assert.deepEqual(rowOf(r, 'Q3'), { name: 'Q3', valid: 1, sum: 3, average: '3.00', blank: 2, excluded: 0 });
});

test('머리글보다 많은 칸은 무시한다', () => {
  const r = run('번호\tQ1\n1\t2\t9\t9\n');
  assert.equal(r.questions.length, 1);
  assert.deepEqual(rowOf(r, 'Q1'), { name: 'Q1', valid: 1, sum: 2, average: '2.00', blank: 0, excluded: 0 });
});

test('유효 응답이 없는 문항의 평균은 "-"', () => {
  const r = run('번호\tQ1\n1\t\n2\t모름\n');
  assert.deepEqual(rowOf(r, 'Q1'), { name: 'Q1', valid: 0, sum: 0, average: '-', blank: 1, excluded: 1 });
});

test('앞뒤 공백이 붙은 숫자는 유효로 합산', () => {
  const r = run('번호\tQ1\n1\t 4 \n2\t 2\n');
  assert.deepEqual(rowOf(r, 'Q1'), { name: 'Q1', valid: 2, sum: 6, average: '3.00', blank: 0, excluded: 0 });
});

test('평균 반올림이 표에 반영된다', () => {
  const r = run('번호\tQ1\n1\t3\n2\t3\n3\t2\n');
  assert.equal(rowOf(r, 'Q1').average, '2.67');
});

test('\\r\\n 줄바꿈과 끝의 빈 줄을 처리한다', () => {
  const r = run('번호\tQ1\r\n1\t5\r\n2\t1\r\n\r\n');
  assert.equal(r.rowCount, 2);
  assert.deepEqual(rowOf(r, 'Q1'), { name: 'Q1', valid: 2, sum: 6, average: '3.00', blank: 0, excluded: 0 });
});

test('탭만 있는 줄은 모두 빈 응답인 줄로 센다', () => {
  const r = run('번호\tQ1\tQ2\n\t\t\n1\t5\t5\n');
  assert.equal(r.rowCount, 2);
  assert.equal(rowOf(r, 'Q1').blank, 1);
  assert.equal(rowOf(r, 'Q2').blank, 1);
});

test('완전히 빈 줄은 응답 줄로 치지 않는다', () => {
  const r = run('번호\tQ1\n1\t5\n\n2\t3\n');
  assert.equal(r.rowCount, 2);
  assert.equal(rowOf(r, 'Q1').blank, 0);
});

test('엑셀이 따옴표로 감싼 머리글(칸 안 줄바꿈)을 읽는다', () => {
  const text = '번호\t"만족도\r\n(전반)"\t"그는 ""좋다""고"\r\n1\t4\t2\r\n';
  const r = run(text);
  assert.deepEqual(r.questions.map((q) => q.name), ['만족도\r\n(전반)', '그는 "좋다"고']);
  assert.equal(r.questions[0].valid, 1);
  assert.equal(r.questions[1].sum, 2);
});

test('짝이 맞지 않는 따옴표는 글자 그대로 읽는다', () => {
  assert.deepEqual(plain(parseTsv('a\t"b\tc\n')), [['a', '"b', 'c']]);
  assert.deepEqual(plain(parseTsv('"x"y\t1')), [['"x"y', '1']]);
});

test('이름이 빈 문항 열은 열 번호로 표시한다', () => {
  const r = run('번호\t\tQ2\n1\t3\t4\n');
  assert.deepEqual(r.questions.map((q) => q.name), ['(2번째 열)', 'Q2']);
});

test('머리글만 있으면 모든 수치가 0', () => {
  const r = run('번호\tQ1\tQ2');
  assert.equal(r.ok, true);
  assert.equal(r.rowCount, 0);
  assert.deepEqual(rowOf(r, 'Q1'), { name: 'Q1', valid: 0, sum: 0, average: '-', blank: 0, excluded: 0 });
});

test('빈 입력과 문항 열이 없는 입력은 오류', () => {
  assert.deepEqual(run(''), { ok: false, error: 'empty' });
  assert.deepEqual(run('\n\n'), { ok: false, error: 'empty' });
  assert.deepEqual(run('응답번호\n1\n2\n'), { ok: false, error: 'noQuestions' });
});
