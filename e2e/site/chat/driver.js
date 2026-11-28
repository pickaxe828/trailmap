// Local stand-in for a chat assistant page. It renders the DOM shape each site's extractor expects, answers
// only a few canned questions, and never touches a network or model. The unit tests evaluate this file in
// JSDOM too, so there is one source for the markup. The shapes are reconstructions (see README.md).
(() => {
  const site = document.documentElement.dataset.site;
  const esc = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const node = (html) => {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  };
  // Chrome that must never reach a transcript: controls, a sources panel, a hidden block and a decorative icon.
  const noise = '<button type="button">Copy code</button><svg aria-hidden="true"></svg><p hidden>Hidden scratch text</p>' +
    '<aside aria-label="Sources"><p>Sources side panel</p><a href="https://science.test/side.html">Sidebar result</a></aside>';
  const body = ({ answer, links = [] }) => `<p>${esc(answer)}</p>` +
    links.map((href) => `<p>Read <a href="${href}">this source</a></p>`).join('') + noise;
  const shapes = {
    chatgpt: {
      user: (q) => `<article data-testid="conversation-turn"><div data-message-author-role="user"><div class="whitespace-pre-wrap">${esc(q)}</div></div></article>`,
      assistant: (reply, done) => `<article data-testid="conversation-turn"><div data-message-author-role="assistant"><div class="markdown">${reply}</div></div>` +
        (done ? '<div><button data-testid="copy-turn-action-button" type="button">Copy</button></div>' : '') + '</article>',
      unknown: (q) => `<article data-testid="conversation-turn"><div class="mystery-reply"><p>Reply to ${esc(q)} in a layout nobody documented.</p></div></article>`,
      newChat: '/', path: '/c/fixture-conversation',
    },
    claude: {
      user: (q) => `<div data-testid="user-message"><p>${esc(q)}</p></div>`,
      assistant: (reply, done) => `<div data-is-streaming="${done ? 'false' : 'true'}"><div class="font-claude-response">${reply}</div></div>`,
      unknown: (q) => `<div class="mystery-reply"><p>Reply to ${esc(q)} in a layout nobody documented.</p></div>`,
      newChat: '/new', path: '/chat/fixture-conversation',
    },
    gemini: {
      user: (q) => `<user-query><div class="query-text">${esc(q)}</div></user-query>`,
      assistant: (reply, done) => `<model-response><message-content aria-busy="${done ? 'false' : 'true'}"><div class="markdown">${reply}</div></message-content>` +
        (done ? '<copy-button><button type="button" aria-label="Copy" data-test-id="copy-button">Copy</button></copy-button>' : '') + '</model-response>',
      unknown: (q) => `<model-response><div class="mystery-reply"><p>Reply to ${esc(q)} in a layout nobody documented.</p></div></model-response>`,
      newChat: '/app', path: '/app/fixture-conversation',
    },
  }[site];
  const answers = {
    'Why is the sky blue?': { answer: 'Molecules scatter blue light more than red light.', links: ['https://science.test/light.html'] },
    'What is Rayleigh scattering?': { answer: 'Rayleigh scattering explains how light scatters from particles much smaller than its wavelength.' },
  };
  const thread = document.querySelector('[data-thread]');
  const addHistory = (question, answer) => {
    thread.append(node(shapes.user(question)), node(shapes.assistant(body({ answer }), true)));
  };
  /** Adds a typed turn: the question immediately, the reply streaming, then complete after `streamMs`. */
  function addTurn(question, { streamMs = 150, reply = answers[question] } = {}) {
    thread.append(node(shapes.user(question)));
    if (!reply) {
      thread.append(node(shapes.unknown(question)));
      return;
    }
    const streaming = node(shapes.assistant('<p></p>', false));
    thread.append(streaming);
    const finish = () => streaming.replaceWith(node(shapes.assistant(body(reply), true)));
    if (streamMs < 0) return finish;
    setTimeout(finish, streamMs);
  }
  const composer = document.querySelector('[data-composer]');
  const send = document.querySelector('[data-send]');
  function submit() {
    const question = composer.textContent.trim();
    if (!question) return;
    composer.textContent = '';
    // A new chat moves to its own conversation URL on the first message, like the real sites.
    if (location.pathname === shapes.newChat) window.history.pushState({}, '', shapes.path);
    addTurn(question);
  }
  composer?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  send?.addEventListener('click', submit);
  window.fixtureChat = { addHistory, addTurn, answers };
  for (const text of (document.documentElement.dataset.history ?? '').split('|').filter(Boolean)) {
    addHistory(text, `Earlier answer: ${text}.`);
  }
})();
