/**
 * Tests for the ConversationTimeline module.
 */

const { setupDOM, loadApp } = require('./setup');

describe('ConversationTimeline', () => {
    beforeEach(() => {
        setupDOM();
        loadApp();
        // init() is not auto-called because DOMContentLoaded is suppressed in tests
        ConversationTimeline.init();
    });

    // ── Visibility ──────────────────────────────────────────

    describe('visibility', () => {
        test('starts hidden', () => {
            expect(ConversationTimeline.isVisible()).toBe(false);
        });

        test('toggle shows and hides', () => {
            ConversationTimeline.toggle();
            expect(ConversationTimeline.isVisible()).toBe(true);
            ConversationTimeline.toggle();
            expect(ConversationTimeline.isVisible()).toBe(false);
        });

        test('show() makes visible', () => {
            ConversationTimeline.show();
            expect(ConversationTimeline.isVisible()).toBe(true);
        });

        test('hide() makes hidden', () => {
            ConversationTimeline.show();
            ConversationTimeline.hide();
            expect(ConversationTimeline.isVisible()).toBe(false);
        });

        test('show() when already visible is no-op', () => {
            ConversationTimeline.show();
            ConversationTimeline.show();
            expect(ConversationTimeline.isVisible()).toBe(true);
        });

        test('hide() when already hidden is no-op', () => {
            ConversationTimeline.hide();
            expect(ConversationTimeline.isVisible()).toBe(false);
        });
    });

    // ── Stats ───────────────────────────────────────────────

    describe('getStats', () => {
        test('empty conversation returns zeros', () => {
            const stats = ConversationTimeline.getStats();
            expect(stats.total).toBe(0);
            expect(stats.user).toBe(0);
            expect(stats.assistant).toBe(0);
            expect(stats.hasCode).toBe(0);
        });

        test('counts messages by role', () => {
            ConversationManager.addMessage('user', 'hello');
            ConversationManager.addMessage('assistant', 'hi there');
            ConversationManager.addMessage('user', 'how are you?');

            const stats = ConversationTimeline.getStats();
            expect(stats.total).toBe(3);
            expect(stats.user).toBe(2);
            expect(stats.assistant).toBe(1);
        });

        test('excludes system messages from count', () => {
            // ConversationManager starts with a system message
            ConversationManager.addMessage('user', 'test');
            const stats = ConversationTimeline.getStats();
            expect(stats.total).toBe(1);
            expect(stats.user).toBe(1);
        });

        test('detects code blocks', () => {
            ConversationManager.addMessage('user', 'show me code');
            ConversationManager.addMessage('assistant', 'Here:\n```js\nconsole.log("hi")\n```');

            const stats = ConversationTimeline.getStats();
            expect(stats.hasCode).toBe(1);
        });

        test('counts multiple code block messages', () => {
            ConversationManager.addMessage('user', '```python\nprint("a")\n```');
            ConversationManager.addMessage('assistant', '```js\nalert("b")\n```');

            const stats = ConversationTimeline.getStats();
            expect(stats.hasCode).toBe(2);
        });
    });

    // ── Segments ────────────────────────────────────────────

    describe('segments', () => {
        test('no segments when hidden', () => {
            ConversationManager.addMessage('user', 'hello');
            ConversationTimeline.refresh();
            expect(ConversationTimeline.getSegments().length).toBe(0);
        });

        test('creates segments when visible', () => {
            ConversationManager.addMessage('user', 'hello');
            ConversationManager.addMessage('assistant', 'hi there');

            ConversationTimeline.show();

            const segs = ConversationTimeline.getSegments();
            expect(segs.length).toBe(2);
            expect(segs[0].role).toBe('user');
            expect(segs[1].role).toBe('assistant');
        });

        test('segment heights are proportional to content length', () => {
            ConversationManager.addMessage('user', 'short');
            ConversationManager.addMessage('assistant', 'This is a much longer response with lots of text that should make this segment taller than the user message segment');

            ConversationTimeline.show();

            const segs = ConversationTimeline.getSegments();
            expect(segs.length).toBe(2);
            // The assistant message is longer, so its segment should be taller
            expect(segs[1].height).toBeGreaterThan(segs[0].height);
        });

        test('segments have preview text', () => {
            ConversationManager.addMessage('user', 'What is the meaning of life?');
            ConversationTimeline.show();

            const segs = ConversationTimeline.getSegments();
            expect(segs[0].preview).toBe('What is the meaning of life?');
        });

        test('long previews are truncated', () => {
            const longText = 'A'.repeat(100);
            ConversationManager.addMessage('user', longText);
            ConversationTimeline.show();

            const segs = ConversationTimeline.getSegments();
            expect(segs[0].preview.length).toBeLessThanOrEqual(60);
            expect(segs[0].preview).toContain('...');
        });

        test('preview uses first line only', () => {
            ConversationManager.addMessage('user', 'First line\nSecond line\nThird line');
            ConversationTimeline.show();

            const segs = ConversationTimeline.getSegments();
            expect(segs[0].preview).toBe('First line');
        });

        test('segments update on refresh', () => {
            ConversationManager.addMessage('user', 'hello');
            ConversationTimeline.show();
            expect(ConversationTimeline.getSegments().length).toBe(1);

            ConversationManager.addMessage('assistant', 'hi');
            ConversationTimeline.refresh();
            expect(ConversationTimeline.getSegments().length).toBe(2);
        });

        test('each segment has correct msgIndex', () => {
            ConversationManager.addMessage('user', 'msg1');
            ConversationManager.addMessage('assistant', 'msg2');
            ConversationManager.addMessage('user', 'msg3');
            ConversationTimeline.show();

            const segs = ConversationTimeline.getSegments();
            // Index 0 is system, so user msgs start at 1
            expect(segs[0].msgIndex).toBe(1);
            expect(segs[1].msgIndex).toBe(2);
            expect(segs[2].msgIndex).toBe(3);
        });
    });

    // ── Scroll ──────────────────────────────────────────────

    describe('scrollToMessage', () => {
        test('does not throw for valid index', () => {
            ConversationManager.addMessage('user', 'hello');
            const chatOutput = document.getElementById('chat-output');
            chatOutput.innerHTML = '';
            const msg = document.createElement('div');
            msg.className = 'msg';
            chatOutput.appendChild(msg);

            expect(() => {
                ConversationTimeline.scrollToMessage(0);
            }).not.toThrow();
        });

        test('does not throw for out of range index', () => {
            expect(() => {
                ConversationTimeline.scrollToMessage(99);
            }).not.toThrow();
        });

        test('does not throw for negative index', () => {
            expect(() => {
                ConversationTimeline.scrollToMessage(-1);
            }).not.toThrow();
        });
    });

    // ── DOM structure ───────────────────────────────────────

    describe('DOM', () => {
        test('creates timeline container', () => {
            const container = document.getElementById('timeline-container');
            expect(container).not.toBeNull();
        });

        test('creates toggle button', () => {
            const toggle = document.getElementById('timeline-toggle');
            expect(toggle).not.toBeNull();
        });

        test('creates tooltip element', () => {
            const tooltip = document.getElementById('timeline-tooltip');
            expect(tooltip).not.toBeNull();
        });

        test('creates timeline strip', () => {
            const strip = document.getElementById('timeline-strip');
            expect(strip).not.toBeNull();
        });

        test('creates viewport indicator', () => {
            const vp = document.getElementById('timeline-viewport');
            expect(vp).not.toBeNull();
        });

        test('toggle button has accessible label', () => {
            const toggle = document.getElementById('timeline-toggle');
            expect(toggle.getAttribute('aria-label')).toBe('Toggle conversation timeline');
        });

        test('container has navigation role', () => {
            const container = document.getElementById('timeline-container');
            expect(container.getAttribute('role')).toBe('navigation');
        });
    });

    // ── Integration ─────────────────────────────────────────

    describe('integration', () => {
        test('adding messages and refreshing creates segments with markers', () => {
            ConversationManager.addMessage('user', 'show code');
            ConversationManager.addMessage('assistant', 'Here:\n```js\nconsole.log("hi")\n```');
            ConversationManager.addMessage('user', 'thanks');

            ConversationTimeline.show();

            const segs = ConversationTimeline.getSegments();
            expect(segs.length).toBe(3);

            // Check that code marker was created
            const strip = document.getElementById('timeline-strip');
            const codeMarkers = strip.querySelectorAll('.tl-marker-code');
            expect(codeMarkers.length).toBe(1);
        });

        test('toggle button text changes with state', () => {
            const toggle = document.getElementById('timeline-toggle');
            expect(toggle.textContent).toBe('\u25C0');
            ConversationTimeline.toggle();
            expect(toggle.textContent).toBe('\u25B6');
            ConversationTimeline.toggle();
            expect(toggle.textContent).toBe('\u25C0');
        });

        test('stats and segments are consistent', () => {
            ConversationManager.addMessage('user', 'a');
            ConversationManager.addMessage('assistant', 'b');
            ConversationManager.addMessage('user', 'c');
            ConversationManager.addMessage('assistant', 'd');

            ConversationTimeline.show();

            const stats = ConversationTimeline.getStats();
            const segs = ConversationTimeline.getSegments();
            expect(stats.total).toBe(segs.length);
        });
    });
});
