// Small DOM double for the workspace's two lists. Browser QA covers real layout.
export function listDocument() {
  const document = { activeElement: null, writes: 0, moves: 0 };
  const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const dataKey = name => name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.dataset = {}; this.attributes = {}; this.className = ''; this.hidden = false; this.scrollTop = 0;
      this.listeners = new Map(); this.text = '';
      this.classList = { toggle: (name, enabled) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      }, contains: name => this.className.split(' ').includes(name) };
    }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { if (this.closest('.project-list')) document.writes++; this.text = String(value); for (const child of [...this.children]) child.remove(); }
    get title() { return this.attributes.title || ''; }
    set title(value) { this.setAttribute('title', value); }
    get firstElementChild() { return this.children[0] || null; }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    setAttribute(name, value) {
      if (this.closest('.project-list')) document.writes++; this.attributes[name] = String(value);
      if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
      if (name === 'class') this.className = String(value);
      if (name === 'hidden') this.hidden = true;
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) {
      if (selector.startsWith('#')) return this.attributes.id === selector.slice(1);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      if (selector.startsWith('[')) {
        const [, name, value] = selector.match(/^\[([^=\]]+)(?:="(.*)")?\]$/) || [];
        return name?.startsWith('data-') ? (value === undefined ? dataKey(name) in this.dataset : this.dataset[dataKey(name)] === value) : name in this.attributes;
      }
      return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.children) { if (child.matches(selector)) result.push(child); result.push(...child.querySelectorAll(selector)); }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    insertBefore(child, before) {
      document.moves++;
      child.remove(); child.parentElement = this;
      this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
      return child;
    }
    append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
    remove() {
      if (!this.parentElement) return;
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null;
    }
    focus() { document.activeElement = this; }
    addEventListener(name, listener) { const listeners = this.listeners.get(name) || []; listeners.push(listener); this.listeners.set(name, listeners); }
    click() { this.focus(); this.onclick?.(); for (const listener of this.listeners.get('click') || []) listener({ target: this }); }
    set innerHTML(html) {
      for (const child of [...this.children]) child.remove();
      this.text = '';
      const stack = [this];
      for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (!token.startsWith('<')) { stack.at(-1).text += decode(token); continue; }
        const child = new Element(token.match(/^<([\w-]+)/)[1]);
        for (const attribute of token.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
          if (attribute.index === 1) continue;
          child.setAttribute(attribute[1], decode(attribute[2] || ''));
        }
        stack.at(-1).append(child); if (!token.endsWith('/>')) stack.push(child);
      }
    }
    insertAdjacentHTML(_position, html) { const holder = new Element('div'); holder.innerHTML = html; this.append(...holder.children); }
  }
  document.createElement = tag => new Element(tag);
  document.body = new Element('body'); document.activeElement = document.body;
  document.body.innerHTML = '<div id="project-list" class="project-list"><div id="workspace-task-list"></div></div><input id="task-search-input"/><button id="task-search-clear"></button><span id="task-count"></span>';
  document.querySelector = selector => document.body.querySelector(selector);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  return document;
}
