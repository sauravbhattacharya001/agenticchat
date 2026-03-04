/**
 * Tests for the MessageDiff module.
 */

const { setupDOM, loadApp } = require('./setup');

describe('MessageDiff', () => {
    beforeEach(() => {
        setupDOM();
        loadApp();
    });

    // ── diffLines ──────────────────────────────────────────────

    describe('diffLines', () => {
        test('returns entry for two empty strings', () => {
            const result = MessageDiff.diffLines('', '');
            expect(result.length).toBe(1);
            expect(result[0].type).toBe('same');
        });

        test('identical single-line texts produce one same entry', () => {
            const result = MessageDiff.diffLines('hello', 'hello');
            expect(result).toEqual([{ type: 'same', text: 'hello' }]);
        });

        test('identical multi-line texts are all same', () => {
            const text = 'line1\nline2\nline3';
            const result = MessageDiff.diffLines(text, text);
            expect(result.length).toBe(3);
            result.forEach(r => expect(r.type).toBe('same'));
        });

        test('completely different texts show del + add', () => {
            const result = MessageDiff.diffLines('hello', 'world');
            const dels = result.filter(r => r.type === 'del');
            const adds = result.filter(r => r.type === 'add');
            expect(dels.length).toBe(1);
            expect(dels[0].text).toBe('hello');
            expect(adds.length).toBe(1);
            expect(adds[0].text).toBe('world');
        });

        test('added lines at end', () => {
            const result = MessageDiff.diffLines('line1', 'line1\nline2\nline3');
            expect(result[0]).toEqual({ type: 'same', text: 'line1' });
            expect(result.filter(r => r.type === 'add').length).toBe(2);
        });

        test('removed lines from middle', () => {
            const a = 'line1\nline2\nline3';
            const b = 'line1\nline3';
            const result = MessageDiff.diffLines(a, b);
            const sames = result.filter(r => r.type === 'same');
            const dels = result.filter(r => r.type === 'del');
            expect(sames.length).toBe(2);
            expect(dels.length).toBe(1);
            expect(dels[0].text).toBe('line2');
        });

        test('handles null inputs gracefully', () => {
            const result = MessageDiff.diffLines(null, 'hello');
            const adds = result.filter(r => r.type === 'add');
            expect(adds.length).toBeGreaterThanOrEqual(1);
        });

        test('mixed additions, deletions, and unchanged', () => {
            const a = 'alpha\nbeta\ngamma\ndelta';
            const b = 'alpha\nBETA\ngamma\nepsilon';
            const result = MessageDiff.diffLines(a, b);
            const sames = result.filter(r => r.type === 'same');
            const adds = result.filter(r => r.type === 'add');
            const dels = result.filter(r => r.type === 'del');
            expect(sames.length).toBe(2);
            expect(adds.length).toBe(2);
            expect(dels.length).toBe(2);
        });

        test('large identical text is efficient', () => {
            const lines = [];
            for (let i = 0; i < 100; i++) lines.push('line ' + i);
            const text = lines.join('\n');
            const result = MessageDiff.diffLines(text, text);
            expect(result.length).toBe(100);
            result.forEach(r => expect(r.type).toBe('same'));
        });

        test('addition at start', () => {
            const result = MessageDiff.diffLines('B\nC', 'A\nB\nC');
            const adds = result.filter(r => r.type === 'add');
            expect(adds.length).toBe(1);
            expect(adds[0].text).toBe('A');
        });

        test('all deletions', () => {
            const result = MessageDiff.diffLines('a\nb\nc', '');
            const dels = result.filter(r => r.type === 'del');
            expect(dels.length).toBe(3);
        });

        test('all additions', () => {
            const result = MessageDiff.diffLines('', 'x\ny');
            const adds = result.filter(r => r.type === 'add');
            expect(adds.length).toBe(2);
        });
    });

    // ── diffStats ──────────────────────────────────────────────

    describe('diffStats', () => {
        test('counts all same entries', () => {
            const diff = [
                { type: 'same', text: 'a' },
                { type: 'same', text: 'b' }
            ];
            const stats = MessageDiff.diffStats(diff);
            expect(stats.added).toBe(0);
            expect(stats.removed).toBe(0);
            expect(stats.unchanged).toBe(2);
            expect(stats.total).toBe(2);
        });

        test('counts mixed entries', () => {
            const diff = [
                { type: 'same', text: 'a' },
                { type: 'del', text: 'b' },
                { type: 'add', text: 'c' },
                { type: 'add', text: 'd' }
            ];
            const stats = MessageDiff.diffStats(diff);
            expect(stats.added).toBe(2);
            expect(stats.removed).toBe(1);
            expect(stats.unchanged).toBe(1);
            expect(stats.total).toBe(4);
        });

        test('empty diff', () => {
            const stats = MessageDiff.diffStats([]);
            expect(stats.total).toBe(0);
            expect(stats.added).toBe(0);
            expect(stats.removed).toBe(0);
            expect(stats.unchanged).toBe(0);
        });

        test('all additions', () => {
            const diff = [
                { type: 'add', text: 'x' },
                { type: 'add', text: 'y' }
            ];
            const stats = MessageDiff.diffStats(diff);
            expect(stats.added).toBe(2);
            expect(stats.removed).toBe(0);
        });

        test('all deletions', () => {
            const diff = [
                { type: 'del', text: 'x' },
                { type: 'del', text: 'y' },
                { type: 'del', text: 'z' }
            ];
            const stats = MessageDiff.diffStats(diff);
            expect(stats.removed).toBe(3);
            expect(stats.added).toBe(0);
        });
    });

    // ── Selection logic ────────────────────────────────────────

    describe('selection', () => {
        test('initially no selection', () => {
            expect(MessageDiff.getSelection()).toBeNull();
        });

        test('selecting stores the message index and role', () => {
            ConversationManager.addMessage('user', 'hello');
            ConversationManager.addMessage('assistant', 'hi there');

            // Index 0 is the system prompt; user messages start at index 1
            MessageDiff.selectMessage(1);
            const sel = MessageDiff.getSelection();
            expect(sel).not.toBeNull();
            expect(sel.index).toBe(1);
            expect(sel.role).toBe('user');
        });

        test('selecting same message twice deselects', () => {
            ConversationManager.addMessage('user', 'hello');
            MessageDiff.selectMessage(0);
            expect(MessageDiff.getSelection()).not.toBeNull();

            MessageDiff.selectMessage(0);
            expect(MessageDiff.getSelection()).toBeNull();
        });

        test('clearSelection resets to null', () => {
            ConversationManager.addMessage('user', 'hello');
            MessageDiff.selectMessage(0);
            expect(MessageDiff.getSelection()).not.toBeNull();

            MessageDiff.clearSelection();
            expect(MessageDiff.getSelection()).toBeNull();
        });

        test('selecting out of range is no-op', () => {
            MessageDiff.selectMessage(99);
            expect(MessageDiff.getSelection()).toBeNull();
        });

        test('selecting negative index is no-op', () => {
            MessageDiff.selectMessage(-1);
            expect(MessageDiff.getSelection()).toBeNull();
        });
    });

    // ── Modal ──────────────────────────────────────────────────

    describe('modal', () => {
        test('isOpen returns false initially', () => {
            expect(MessageDiff.isOpen()).toBe(false);
        });

        test('showDiff opens the modal', () => {
            const msgA = { index: 0, role: 'user', content: 'hello world' };
            const msgB = { index: 1, role: 'assistant', content: 'hello there' };
            MessageDiff.showDiff(msgA, msgB);
            expect(MessageDiff.isOpen()).toBe(true);
        });

        test('closeModal closes it', () => {
            const msgA = { index: 0, role: 'user', content: 'a' };
            const msgB = { index: 1, role: 'user', content: 'b' };
            MessageDiff.showDiff(msgA, msgB);
            expect(MessageDiff.isOpen()).toBe(true);

            MessageDiff.closeModal();
            expect(MessageDiff.isOpen()).toBe(false);
        });

        test('showDiff renders diff lines in the body', () => {
            const msgA = { index: 0, role: 'user', content: 'line1\nline2' };
            const msgB = { index: 1, role: 'user', content: 'line1\nline3' };
            MessageDiff.showDiff(msgA, msgB);

            const body = document.getElementById('diff-body');
            expect(body).not.toBeNull();
            const rows = body.querySelectorAll('tr');
            expect(rows.length).toBe(3); // line1 (same), line2 (del), line3 (add)
        });

        test('stats display shows correct counts', () => {
            const msgA = { index: 0, role: 'user', content: 'same\nold' };
            const msgB = { index: 1, role: 'assistant', content: 'same\nnew' };
            MessageDiff.showDiff(msgA, msgB);

            const statsEl = document.getElementById('diff-stats');
            expect(statsEl.textContent).toContain('+1 added');
            expect(statsEl.textContent).toContain('-1 removed');
            expect(statsEl.textContent).toContain('1 unchanged');
        });

        test('reset clears selection and closes modal', () => {
            ConversationManager.addMessage('user', 'hello');
            MessageDiff.selectMessage(0);
            MessageDiff.showDiff(
                { index: 0, role: 'user', content: 'a' },
                { index: 1, role: 'user', content: 'b' }
            );

            MessageDiff.reset();
            expect(MessageDiff.getSelection()).toBeNull();
            expect(MessageDiff.isOpen()).toBe(false);
        });

        test('showDiff with identical content shows all same lines', () => {
            const content = 'hello\nworld';
            MessageDiff.showDiff(
                { index: 0, role: 'user', content: content },
                { index: 1, role: 'user', content: content }
            );
            const body = document.getElementById('diff-body');
            const rows = body.querySelectorAll('tr');
            expect(rows.length).toBe(2);
        });
    });

    // ── decorateMessages ───────────────────────────────────────

    describe('decorateMessages', () => {
        test('adds compare buttons to message elements', () => {
            ConversationManager.addMessage('user', 'hello');
            ConversationManager.addMessage('assistant', 'hi');

            const chatOutput = document.getElementById('chat-output');
            chatOutput.innerHTML = '';
            for (let i = 0; i < 2; i++) {
                const msg = document.createElement('div');
                msg.className = 'msg';
                const role = document.createElement('span');
                role.className = 'msg-role';
                msg.appendChild(role);
                chatOutput.appendChild(msg);
            }

            MessageDiff.decorateMessages();

            const btns = chatOutput.querySelectorAll('.diff-compare-btn');
            expect(btns.length).toBe(2);
            expect(btns[0].textContent).toContain('Compare');
        });

        test('buttons update when a message is selected', () => {
            ConversationManager.addMessage('user', 'hello');
            ConversationManager.addMessage('assistant', 'hi');

            const chatOutput = document.getElementById('chat-output');
            chatOutput.innerHTML = '';
            // Create 2 DOM msg elements (one per non-system message)
            for (let i = 0; i < 2; i++) {
                const msg = document.createElement('div');
                msg.className = 'msg';
                const role = document.createElement('span');
                role.className = 'msg-role';
                msg.appendChild(role);
                chatOutput.appendChild(msg);
            }

            // Select index 1 (first user msg after system prompt)
            MessageDiff.selectMessage(1);

            const btns = chatOutput.querySelectorAll('.diff-compare-btn');
            // First DOM msg (user at index 1) should say "Cancel"
            // Second DOM msg (assistant at index 2) should say "Diff with"
            expect(btns[0].textContent).toContain('Cancel');
            expect(btns[1].textContent).toContain('Diff with');
        });
    });

    // ── Integration ────────────────────────────────────────────

    describe('integration', () => {
        test('selecting two messages opens diff modal', () => {
            ConversationManager.addMessage('user', 'What is 2+2?');
            ConversationManager.addMessage('assistant', 'The answer is 4.');
            ConversationManager.addMessage('user', 'What is 3+3?');
            ConversationManager.addMessage('assistant', 'The answer is 6.');

            MessageDiff.selectMessage(0);
            expect(MessageDiff.getSelection()).not.toBeNull();
            expect(MessageDiff.isOpen()).toBe(false);

            MessageDiff.selectMessage(2);
            expect(MessageDiff.isOpen()).toBe(true);
            expect(MessageDiff.getSelection()).toBeNull();
        });

        test('diffLines + diffStats end-to-end', () => {
            const a = 'function hello() {\n  return "hi";\n}';
            const b = 'function hello() {\n  return "hello";\n  console.log("done");\n}';
            const diff = MessageDiff.diffLines(a, b);
            const stats = MessageDiff.diffStats(diff);
            expect(stats.added).toBeGreaterThan(0);
            expect(stats.removed).toBeGreaterThan(0);
            expect(stats.unchanged).toBeGreaterThan(0);
        });
    });
});
