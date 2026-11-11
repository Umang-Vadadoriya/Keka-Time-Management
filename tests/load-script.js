// Loads keka-time-helper.user.js into a Node vm sandbox with just enough fake
// browser to run it, and returns its internals. No dependencies; run the suite
// with `node --test tests/`.
//
// The shipped script contains no test code (it's served from a Gist to
// Tampermonkey and the bookmarklet). Its helpers live inside one IIFE, so the
// loader splices HOOK into an in-memory copy right after ANCHOR. HOOK runs
// inside the IIFE and hands its functions/state accessors to the sandbox.
'use strict';

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'keka-time-helper.user.js');

const ANCHOR = 'window.__kekaEnhanceLoaded = true;';
// Function declarations are hoisted, so they can be referenced here before
// their definitions; the `let` state is only read later, when tests call in.
const HOOK = `
    __KEKA_TEST_HOOK__({
        parseTime, parseFlexibleTime, normalizeTimeFormat, parsePunchInput,
        calculateDuration, formatDuration, flattenPunches, repairFromPunches,
        insertPunch, removePunchAt, editPunchAt, processManualEntries,
        renderManualEntryUI, updateUI: (c) => updateUI(c),
        getState: () => ({ manualEntries, plannedBreakMin, isManualMode, showManualForm, isHalfDayMode }),
        setState: (s) => {
            if ('manualEntries' in s) manualEntries = s.manualEntries;
            if ('plannedBreakMin' in s) plannedBreakMin = s.plannedBreakMin;
            if ('isManualMode' in s) isManualMode = s.isManualMode;
            if ('showManualForm' in s) showManualForm = s.showManualForm;
            if ('isHalfDayMode' in s) isHalfDayMode = s.isHalfDayMode;
        },
    });
`;

function withHook(src) {
    const at = src.indexOf(ANCHOR);
    if (at === -1 || src.indexOf(ANCHOR, at + 1) !== -1) {
        throw new Error(`tests/load-script.js: expected exactly one "${ANCHOR}" in the script to attach the test hook`);
    }
    const end = at + ANCHOR.length;
    return src.slice(0, end) + HOOK + src.slice(end);
}

// Minimal element: enough for updateUI's results/edit/empty renders, which
// write innerHTML strings and look up a handful of nodes by class.
class FakeElement {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.parentElement = null;
        this.style = { cssText: '' };
        this.dataset = {};
        this.className = '';
        this.innerHTML = '';
        this.textContent = '';
        this.listeners = {};
        this.classList = { add() {}, remove() {}, contains: () => false };
    }
    appendChild(child) {
        child.parentNode = child.parentElement = this;
        this.children.push(child);
        return child;
    }
    replaceChild(next, prev) {
        const i = this.children.indexOf(prev);
        if (i !== -1) this.children[i] = next;
        next.parentNode = next.parentElement = this;
        prev.parentNode = prev.parentElement = null;
        return prev;
    }
    cloneNode() {
        const c = new FakeElement(this.tagName);
        c.className = this.className;
        c.dataset = { ...this.dataset };
        c.style = { ...this.style };
        return c;
    }
    querySelector(sel) {
        if (sel.startsWith('.')) {
            const cls = sel.slice(1);
            return this.children.find(c => c.className.split(/\s+/).includes(cls)) || null;
        }
        return null;
    }
    querySelectorAll() { return []; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener() {}
    insertAdjacentHTML() {}
    setAttribute() {}
    remove() {}
}

function makeDocument() {
    // updateUI bails out early unless it finds the modal's date header, so
    // hand it one.
    const dateRow = new FakeElement();
    const dateNode = new FakeElement();
    dateRow.appendChild(dateNode);
    return {
        title: '',
        head: new FakeElement('head'),
        body: null, // keeps the script from starting its MutationObserver/toast
        createElement: (tag) => new FakeElement(tag),
        getElementById: () => null,
        querySelector: (sel) => (sel.includes('Selected date') ? dateNode : null),
        querySelectorAll: () => [],
        addEventListener() {},
    };
}

function loadScript() {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const errors = [];
    let api = null;

    // Timer callbacks run outside vm.runInContext, so catch their errors here
    // instead of letting them crash the test process.
    const guard = (cb, args) => () => { try { cb(...args); } catch (e) { errors.push(e); } };
    const sandbox = {
        console, Date, Math, JSON, Promise, URL,
        setTimeout: (cb, ms, ...args) => setTimeout(guard(cb, args), ms),
        clearTimeout,
        setInterval: (cb, ms, ...args) => { const h = setInterval(guard(cb, args), ms); h.unref(); return h; },
        clearInterval,
        requestAnimationFrame: () => 0,
        document: makeDocument(),
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        navigator: { clipboard: { writeText: async () => {} } },
        MutationObserver: class { observe() {} disconnect() {} },
        Notification: { permission: 'denied', requestPermission: async () => 'denied' },
        fetch: async () => { throw new Error('no network in tests'); },
        __KEKA_TEST_HOOK__: (internals) => { api = internals; },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(withHook(src), sandbox, { filename: 'keka-time-helper.user.js' });
    if (!api) throw new Error('test hook did not run');
    return { api, errors, sandbox, FakeElement, src };
}

module.exports = { loadScript, FakeElement, SCRIPT_PATH };
