/**
 * @jest-environment jsdom
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');

beforeEach(() => {
  document.body.innerHTML = '<button id="mindmap-btn"></button>';
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  const overlay = document.getElementById('mindmap-overlay');
  if (overlay) overlay.remove();
});

/* ---------- Mock canvas ---------- */
HTMLCanvasElement.prototype.getContext = function () {
  return {
    clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
    fillText() {}, measureText: () => ({ width: 50 }), roundRect() {},
    set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {},
    set font(_) {}, set textAlign(_) {}, set textBaseline(_) {}
  };
};
HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,fake';

/* ---------- Inline ConversationMindMap (extracted from app.js) ---------- */
function createMindMap(history) {
  let _overlay = null;
  let _canvas = null;
  let _ctx = null;
  let _isOpen = false;
  let _nodes = [];
  let _edges = [];
  let _animId = null;

  const STOP_WORDS = new Set([
    'the','be','to','of','and','a','in','that','have','i','it','for','not','on',
    'with','he','as','you','do','at','this','but','his','by','from','they','we',
    'say','her','she','or','an','will','my','one','all','would','there','their',
    'what','so','up','out','if','about','who','get','which','go','me','when',
    'make','can','like','time','no','just','him','know','take','people','into',
    'year','your','good','some','could','them','see','other','than','then','now',
    'look','only','come','its','over','think','also','back','after','use','two',
    'how','our','work','first','well','way','even','new','want','because','any',
    'these','give','day','most','us','is','are','was','were','been','being','am',
    'has','had','does','did','doing','done','got','getting','made','said','went',
    'going','let','here','more','very','much','too','still','own','such','should',
    'may','might','must','shall','need','dare','used','using','thing','things',
    've','re','ll','don','doesn','didn','won','wouldn','couldn','shouldn','isn',
    'aren','wasn','weren','hasn','haven','hadn','can','cannot','yes','yeah',
    'okay','sure','right','oh','um','uh','ah','ok','well','code','data','function',
    'really','keep','tell','help','try','call','put','show','ask','seem','feel',
    'kind','actually','pretty','quite','maybe','something','anything','everything',
    'nothing','someone','anyone','everyone','already','always','never','often'
  ]);

  const MIN_WORD_LEN = 3;
  const MAX_TOPICS = 40;
  const MIN_OCCURRENCES = 2;

  function _extractTopics() {
    if (history.length === 0) return { topics: [], cooccur: [] };
    const wordFreq = {};
    const msgWords = [];

    history.forEach((msg, idx) => {
      const text = (msg.content || '').toLowerCase()
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]+`/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[^a-z0-9\s'-]/g, ' ');
      const words = text.split(/\s+/).filter(w => w.length >= MIN_WORD_LEN && !STOP_WORDS.has(w));
      const unique = new Set(words);
      msgWords.push(unique);

      for (const w of words) {
        if (!wordFreq[w]) wordFreq[w] = { count: 0, user: 0, ai: 0, msgs: new Set() };
        wordFreq[w].count++;
        wordFreq[w].msgs.add(idx);
        if (msg.role === 'user') wordFreq[w].user++;
        else wordFreq[w].ai++;
      }
    });

    const totalMsgs = history.length;
    const scored = Object.entries(wordFreq)
      .filter(([, v]) => v.count >= MIN_OCCURRENCES)
      .map(([word, v]) => {
        const tf = v.count;
        const df = v.msgs.size;
        const idf = Math.log((totalMsgs + 1) / (df + 1));
        return { word, score: tf * idf, ...v };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TOPICS);

    const topicSet = new Set(scored.map(t => t.word));
    const edgeMap = {};
    for (const mw of msgWords) {
      const relevant = [...mw].filter(w => topicSet.has(w));
      for (let i = 0; i < relevant.length; i++) {
        for (let j = i + 1; j < relevant.length; j++) {
          const key = [relevant[i], relevant[j]].sort().join('||');
          edgeMap[key] = (edgeMap[key] || 0) + 1;
        }
      }
    }

    const edges = Object.entries(edgeMap)
      .filter(([, w]) => w >= 1)
      .map(([key, weight]) => {
        const [a, b] = key.split('||');
        return { a, b, weight };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 120);

    return { topics: scored, cooccur: edges };
  }

  function _createUI() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.id = 'mindmap-overlay';
    _overlay.innerHTML = ''
      + '<div class="mm-container">'
      + '<div class="mm-header">'
      + '<span class="mm-title">🧠 Conversation Mind Map</span>'
      + '<div class="mm-controls">'
      + '<button class="btn-sm mm-export" title="Export PNG">📷</button>'
      + '<button class="btn-sm mm-refresh" title="Refresh">🔄</button>'
      + '<button class="btn-sm mm-close" title="Close">✕</button>'
      + '</div></div>'
      + '<div class="mm-legend">'
      + '<span class="mm-leg-user">● You</span> '
      + '<span class="mm-leg-ai">● AI</span> '
      + '<span class="mm-leg-hint">Drag nodes · Scroll to zoom · Click topic to search</span>'
      + '</div>'
      + '<canvas class="mm-canvas"></canvas>'
      + '</div>';
    document.body.appendChild(_overlay);
    _overlay.querySelector('.mm-close').addEventListener('click', close);
    _overlay.querySelector('.mm-refresh').addEventListener('click', _refresh);
    _overlay.addEventListener('click', (e) => { if (e.target === _overlay) close(); });
  }

  function _refresh() {
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    const { topics, cooccur } = _extractTopics();
    const container = _overlay.querySelector('.mm-container');
    const existingEmpty = container.querySelector('.mm-empty');
    if (existingEmpty) existingEmpty.remove();
    _canvas = _overlay.querySelector('.mm-canvas');

    if (topics.length === 0) {
      _canvas.style.display = 'none';
      const empty = document.createElement('div');
      empty.className = 'mm-empty';
      empty.textContent = 'No topics yet — start a conversation!';
      container.appendChild(empty);
      return;
    }
    _canvas.style.display = 'block';
  }

  function open() {
    _createUI();
    _overlay.classList.add('visible');
    _isOpen = true;
    _refresh();
  }

  function close() {
    if (_overlay) _overlay.classList.remove('visible');
    _isOpen = false;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
  }

  function toggle() { _isOpen ? close() : open(); }

  return { open, close, toggle, _extractTopics };
}

/* ============= Tests ============= */

describe('ConversationMindMap', () => {
  test('module has expected API', () => {
    const mm = createMindMap([]);
    expect(typeof mm.open).toBe('function');
    expect(typeof mm.close).toBe('function');
    expect(typeof mm.toggle).toBe('function');
  });

  test('open creates and shows overlay', () => {
    const mm = createMindMap([]);
    mm.open();
    const overlay = document.getElementById('mindmap-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('visible')).toBe(true);
    mm.close();
  });

  test('close removes visible class', () => {
    const mm = createMindMap([]);
    mm.open();
    mm.close();
    expect(document.getElementById('mindmap-overlay').classList.contains('visible')).toBe(false);
  });

  test('toggle switches state', () => {
    const mm = createMindMap([]);
    mm.toggle();
    expect(document.getElementById('mindmap-overlay').classList.contains('visible')).toBe(true);
    mm.toggle();
    expect(document.getElementById('mindmap-overlay').classList.contains('visible')).toBe(false);
  });

  test('shows empty message with no conversation', () => {
    const mm = createMindMap([]);
    mm.open();
    expect(document.querySelector('.mm-empty').textContent).toContain('No topics yet');
    mm.close();
  });

  test('header has title', () => {
    const mm = createMindMap([]);
    mm.open();
    expect(document.querySelector('.mm-title').textContent).toContain('Mind Map');
    mm.close();
  });

  test('legend shows user/AI indicators', () => {
    const mm = createMindMap([]);
    mm.open();
    const legend = document.querySelector('.mm-legend');
    expect(legend.textContent).toContain('You');
    expect(legend.textContent).toContain('AI');
    mm.close();
  });

  test('close button works', () => {
    const mm = createMindMap([]);
    mm.open();
    document.querySelector('.mm-close').click();
    expect(document.getElementById('mindmap-overlay').classList.contains('visible')).toBe(false);
  });

  test('clicking overlay background closes', () => {
    const mm = createMindMap([]);
    mm.open();
    document.getElementById('mindmap-overlay').click();
    expect(document.getElementById('mindmap-overlay').classList.contains('visible')).toBe(false);
  });

  test('filters stop words from topics', () => {
    const mm = createMindMap([
      { role: 'user', content: 'the the the and and and' },
      { role: 'assistant', content: 'the and is are was were' }
    ]);
    const { topics } = mm._extractTopics();
    expect(topics.length).toBe(0);
  });

  test('extracts topics from repeated words', () => {
    const msgs = [];
    for (let i = 0; i < 5; i++) {
      msgs.push(
        { role: 'user', content: 'machine learning algorithms neural networks' },
        { role: 'assistant', content: 'machine learning uses neural networks algorithms' }
      );
    }
    const mm = createMindMap(msgs);
    const { topics } = mm._extractTopics();
    expect(topics.length).toBeGreaterThan(0);
    const words = topics.map(t => t.word);
    expect(words).toContain('machine');
    expect(words).toContain('learning');
    expect(words).toContain('neural');
  });

  test('builds co-occurrence edges', () => {
    const msgs = [];
    for (let i = 0; i < 5; i++) {
      msgs.push(
        { role: 'user', content: 'python javascript typescript programming' },
        { role: 'assistant', content: 'python javascript are popular programming languages' }
      );
    }
    const mm = createMindMap(msgs);
    const { cooccur } = mm._extractTopics();
    expect(cooccur.length).toBeGreaterThan(0);
    const edge = cooccur.find(e =>
      (e.a === 'python' && e.b === 'javascript') || (e.a === 'javascript' && e.b === 'python')
    );
    expect(edge).toBeDefined();
  });

  test('tracks user vs AI attribution', () => {
    const msgs = [];
    for (let i = 0; i < 3; i++) {
      msgs.push(
        { role: 'user', content: 'kubernetes containers docker deployment' },
        { role: 'assistant', content: 'kubernetes orchestrates containers docker' }
      );
    }
    const mm = createMindMap(msgs);
    const { topics } = mm._extractTopics();
    const k8s = topics.find(t => t.word === 'kubernetes');
    expect(k8s).toBeDefined();
    expect(k8s.user).toBeGreaterThan(0);
    expect(k8s.ai).toBeGreaterThan(0);
  });

  test('respects MAX_TOPICS limit', () => {
    const msgs = [];
    // Generate many unique words
    for (let i = 0; i < 50; i++) {
      msgs.push({ role: 'user', content: `uniqueword${i} uniqueword${i} anotherword${i} anotherword${i}` });
      msgs.push({ role: 'assistant', content: `uniqueword${i} uniqueword${i}` });
    }
    const mm = createMindMap(msgs);
    const { topics } = mm._extractTopics();
    expect(topics.length).toBeLessThanOrEqual(40);
  });

  test('ignores code blocks and URLs', () => {
    const msgs = [
      { role: 'user', content: 'Check ```specialword specialword``` and https://specialurl.com/specialurl' },
      { role: 'user', content: 'Check ```specialword specialword``` and https://specialurl.com/specialurl' },
      { role: 'assistant', content: 'Here is `inlinecode inlinecode` result' },
      { role: 'assistant', content: 'Here is `inlinecode inlinecode` result' },
    ];
    const mm = createMindMap(msgs);
    const { topics } = mm._extractTopics();
    const words = topics.map(t => t.word);
    expect(words).not.toContain('specialword');
    expect(words).not.toContain('inlinecode');
    expect(words).not.toContain('specialurl');
  });

  test('renders canvas when topics exist', () => {
    const msgs = [];
    for (let i = 0; i < 5; i++) {
      msgs.push(
        { role: 'user', content: 'database optimization queries indexing' },
        { role: 'assistant', content: 'database optimization through indexing queries' }
      );
    }
    const mm = createMindMap(msgs);
    mm.open();
    const canvas = document.querySelector('.mm-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.display).toBe('block');
    mm.close();
  });

  test('refresh re-renders without error', () => {
    const mm = createMindMap([
      { role: 'user', content: 'python syntax python syntax' },
      { role: 'assistant', content: 'python syntax clarity python' }
    ]);
    mm.open();
    const refresh = document.querySelector('.mm-refresh');
    expect(() => refresh.click()).not.toThrow();
    mm.close();
  });
});
