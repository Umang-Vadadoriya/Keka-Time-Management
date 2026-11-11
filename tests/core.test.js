// Pure time/punch logic: parsing, durations, the punch model.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./load-script.js');

const { api } = loadScript();
const norm = (s, guessPm) => api.normalizeTimeFormat(s, guessPm ? { guessPm: true } : undefined);
// Values built inside the vm sandbox have that realm's prototypes, which strict
// deepEqual rejects; compare their plain-JSON form instead.
const same = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg);

test('normalizeTimeFormat: 12-hour forms', () => {
    const cases = {
        '9:30 AM': '09:30 AM',
        '9:30am': '09:30 AM',
        '9:30 a.m.': '09:30 AM',
        '9.30pm': '09:30 PM',
        '9 am': '09:00 AM',
        '9a': '09:00 AM',
        '930am': '09:30 AM',
        '1230 PM': '12:30 PM',
        '12:00 AM': '12:00 AM',
        '12:15 am': '12:15 AM',
        '12 pm': '12:00 PM',
        '  09:05   PM ': '09:05 PM',
        '08:12 am': '08:12 AM', // Keka's own modal text
    };
    for (const [input, want] of Object.entries(cases)) assert.equal(norm(input), want, input);
});

test('normalizeTimeFormat: 24-hour forms', () => {
    const cases = {
        '13:30': '01:30 PM',
        '13.30': '01:30 PM',
        '1330': '01:30 PM',
        '0930': '09:30 AM',
        '00:00': '12:00 AM',
        '00:45': '12:45 AM',
        '12:00': '12:00 PM',
        '23:59': '11:59 PM',
        '9': '09:00 AM',
        '18': '06:00 PM',
        '13:30:15': '01:30 PM',
    };
    for (const [input, want] of Object.entries(cases)) assert.equal(norm(input), want, input);
});

test('normalizeTimeFormat: guessPm only for typed input', () => {
    // Bare 1–6 with no AM/PM reads as afternoon when typed…
    assert.equal(norm('1:30', true), '01:30 PM');
    assert.equal(norm('5', true), '05:00 PM');
    assert.equal(norm('6:15', true), '06:15 PM');
    // …but not 7+, not with a leading zero, and not when AM/PM is given.
    assert.equal(norm('7:30', true), '07:30 AM');
    assert.equal(norm('01:30', true), '01:30 AM');
    assert.equal(norm('1:30 am', true), '01:30 AM');
    // Page text never guesses.
    assert.equal(norm('1:30'), '01:30 AM');
});

test('normalizeTimeFormat: rejects garbage', () => {
    for (const bad of ['', '   ', 'abc', '25:00', '24:00', '9:60', '13 pm', '0 am', '12345', '9:5', 'MISSING', '-1', '9::30']) {
        assert.equal(norm(bad), null, JSON.stringify(bad));
        assert.equal(norm(bad, true), null, JSON.stringify(bad) + ' (guessPm)');
    }
    assert.equal(api.normalizeTimeFormat(undefined), null);
    assert.equal(api.normalizeTimeFormat(null), null);
});

test('parsePunchInput: single time and ranges', () => {
    same(api.parsePunchInput('1:30 PM').times, ['01:30 PM']);
    same(api.parsePunchInput('13:30').times, ['01:30 PM']);
    same(api.parsePunchInput('9:30 AM - 1:00 PM').times, ['09:30 AM', '01:00 PM']);
    same(api.parsePunchInput('9:30am-1pm').times, ['09:30 AM', '01:00 PM']);
    same(api.parsePunchInput('9:30 – 13:00').times, ['09:30 AM', '01:00 PM']);
    same(api.parsePunchInput('9 to 5').times, ['09:00 AM', '05:00 PM']);
    same(api.parsePunchInput('0930 — 1800').times, ['09:30 AM', '06:00 PM']);
});

test('parsePunchInput: errors', () => {
    assert.match(api.parsePunchInput('').error, /Enter a time/);
    assert.match(api.parsePunchInput('9 - 10 - 11').error, /Enter a time/);
    assert.match(api.parsePunchInput('25:00').error, /Couldn't read "25:00"/);
    assert.match(api.parsePunchInput('9:00 - xyz').error, /Couldn't read "xyz"/);
    assert.match(api.parsePunchInput('5 PM - 9 AM').error, /after start/);
    assert.match(api.parsePunchInput('9:00 - 9:00').error, /after start/);
});

test('calculateDuration', () => {
    same(api.calculateDuration('09:00 AM', '01:30 PM'), { hours: 4, minutes: 30 });
    same(api.calculateDuration('12:47 PM', '12:55 PM'), { hours: 0, minutes: 8 });
    same(api.calculateDuration('11:30 PM', '12:30 AM'), { hours: 1, minutes: 0 });
    same(api.calculateDuration(null, '01:00 PM'), { hours: 0, minutes: 0 });
});

test('punch model: insert re-pairs by time', () => {
    api.setState({ manualEntries: [] });
    api.insertPunch('09:00 AM');
    same(api.getState().manualEntries, [{ start: '09:00 AM', end: null }]);
    api.insertPunch('01:00 PM');
    api.insertPunch('11:00 AM'); // lands between, everything after shifts
    same(api.getState().manualEntries, [
        { start: '09:00 AM', end: '11:00 AM' },
        { start: '01:00 PM', end: null },
    ]);
});

test('punch model: remove and edit', () => {
    api.setState({ manualEntries: [{ start: '09:00 AM', end: '01:00 PM' }, { start: '01:30 PM', end: '06:00 PM' }] });
    assert.equal(api.editPunchAt(1, '12:45'), true); // 12:45 → 12:45 PM
    same(api.getState().manualEntries[0], { start: '09:00 AM', end: '12:45 PM' });
    assert.equal(api.editPunchAt(0, '2:00'), true); // 2:00 → 2 PM, moves past 12:45/1:30 and re-pairs
    same(api.getState().manualEntries, [
        { start: '12:45 PM', end: '01:30 PM' },
        { start: '02:00 PM', end: '06:00 PM' },
    ]);
    assert.equal(api.editPunchAt(0, 'nonsense'), false);
    assert.equal(api.editPunchAt(9, '10:00'), false);
    api.removePunchAt(3);
    same(api.getState().manualEntries, [
        { start: '12:45 PM', end: '01:30 PM' },
        { start: '02:00 PM', end: null },
    ]);
});

test('processManualEntries: totals and breaks for closed pairs', () => {
    api.setState({ manualEntries: [{ start: '09:00 AM', end: '01:00 PM' }, { start: '01:30 PM', end: '03:00 PM' }] });
    const r = api.processManualEntries(false);
    assert.equal(r.totalWorkSeconds, 5.5 * 3600);
    assert.equal(r.breakTime, 30);
    assert.equal(r.firstStartTime, '09:00 AM');
    assert.equal(r.manualOpenStartMs, null);
});
