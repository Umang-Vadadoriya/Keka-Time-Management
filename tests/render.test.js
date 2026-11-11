// Render smoke tests: the edit page, the results card and the empty-day card
// all build without throwing, and every <button> is type="button" (the page
// sits inside Keka's <form>; an untyped button is a submit button).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, FakeElement } = require('./load-script.js');

const untypedButtons = (html) => (html.match(/<button\b[^>]*>/g) || []).filter(tag => !/type="button"/.test(tag));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// updateUI is debounced (250ms); render, wait, and return the card's HTML.
async function renderVia(ctx, state) {
    ctx.api.setState(state);
    const container = new FakeElement();
    ctx.api.updateUI(container);
    await wait(350);
    const card = container.children[0];
    assert.ok(card, 'updateUI rendered no card');
    return card.innerHTML;
}

test('source: every <button> the script renders is type="button"', () => {
    const { src } = loadScript();
    assert.deepEqual(untypedButtons(src), []);
});

test('edit page renders punches, minute-only values and editable times', () => {
    const { api } = loadScript();
    api.setState({
        manualEntries: [{ start: '09:00 AM', end: '01:00 PM' }, { start: '01:30 PM', end: '03:00 PM' }],
        plannedBreakMin: 0,
        isHalfDayMode: false,
    });
    const html = api.renderManualEntryUI(null);
    assert.deepEqual(untypedButtons(html), []);
    assert.equal((html.match(/class="me-time"/g) || []).length, 4, 'one editable time per punch');
    assert.match(html, /data-punch="0"[^>]*>9:00 AM</);
    assert.match(html, /☕ 30m/, 'break pill before the second pair');
    assert.match(html, />5:30 pm</i, 'leave time = 9:00 + 8h + 30m break, no seconds');
    assert.doesNotMatch(html, /· 0s|undefined|NaN/);
});

test('edit page: planned break moves the leave time', () => {
    const { api } = loadScript();
    api.setState({ manualEntries: [{ start: '09:00 AM', end: '01:00 PM' }], plannedBreakMin: 25 });
    const html = api.renderManualEntryUI(null);
    assert.match(html, />5:25 pm</i);
    assert.match(html, /including your 25m planned break/);
    assert.match(html, /value="25"[^>]*>\s*<span>min<\/span>/, 'custom box shows "min" once a value is set');
});

test('results card renders all five values with copy wiring', async () => {
    const ctx = loadScript();
    const html = await renderVia(ctx, {
        manualEntries: [{ start: '09:00 AM', end: '01:00 PM' }, { start: '01:30 PM', end: '03:00 PM' }],
        isManualMode: true,
        showManualForm: false,
    });
    assert.deepEqual(ctx.errors, [], 'render threw');
    for (const k of ['total', 'completion', 'overtime', 'remaining', 'break']) {
        assert.match(html, new RegExp(`data-k="${k}"`), `missing value ${k}`);
    }
    for (const ev of ['copyDuration', 'copyCompletion', 'copyOvertime', 'copyRemaining', 'copyBreakTime']) {
        assert.match(html, new RegExp(`CustomEvent\\('${ev}'`), `card not wired: ${ev}`);
    }
    assert.match(html, /linear-gradient\(135deg, #a78bfa/, 'gradients resolved');
    assert.doesNotMatch(html, /undefined|NaN/);
    assert.deepEqual(untypedButtons(html), []);
});

test('edit view and empty-day view render through updateUI', async () => {
    const ctx = loadScript();
    const edit = await renderVia(ctx, { manualEntries: [{ start: '09:00 AM', end: null }], isManualMode: true, showManualForm: true });
    assert.match(edit, /manual-entry-container/);
    const empty = await renderVia(ctx, { manualEntries: [], isManualMode: false, showManualForm: false });
    assert.match(empty, /No Time Entries/);
    assert.deepEqual(ctx.errors, [], 'render threw');
});
