/**
 * Pure, framework-free composer model shared by the browser Workspace and the
 * Node test-suite.
 *
 * The chat contract (single-line and multi-line alike) is: the *full* trimmed
 * input is always the Task specification, and the first line is the title.
 * A title is only ever shortened when it exceeds the Runtime's documented
 * title field limit; the specification is never truncated.
 */

export const COMPOSER_TITLE_MAX = 1024;
export const CHAT_MAX_OUTPUT = 64 * 1024;

/**
 * Derive the task authoring parameters from a composer submission.
 *
 * @param {string} raw    raw composer value (may contain newlines)
 * @param {object} [options]
 * @param {number} [options.maxTitle=COMPOSER_TITLE_MAX] safe title length limit
 * @returns {{title: string, spec: string, firstLine: string}|null} null when
 *          the trimmed input is empty (nothing to create).
 */
export function deriveComposerParams(raw, { maxTitle = COMPOSER_TITLE_MAX } = {}) {
  const spec = typeof raw === 'string' ? raw.trim() : '';
  if (!spec) return null;
  const firstLine = spec.split(/\r?\n/, 1)[0].trim();
  const title = firstLine.length > maxTitle ? firstLine.slice(0, maxTitle) : firstLine;
  return { title, spec, firstLine };
}

function defaultEscapeHtml(value) {
  return `${value ?? ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortId(value) {
  const text = `${value || ''}`;
  return text.length > 18 ? `${text.slice(0, 12)}…${text.slice(-4)}` : text;
}

/**
 * Derive the chat message model entry for an execution session associated with a task.
 *
 * @param {object} task               authoritative task record
 * @param {object} session            session fact object (from state.sessions)
 * @param {object} [options]
 * @param {string} [options.locale='en-US']
 * @param {Function} [options.t]      localization function (key, vars)
 * @param {Function} [options.statusText] status label mapper
 * @param {Function} [options.formatTime] time formatter
 * @param {number} [options.maxOutput=CHAT_MAX_OUTPUT]
 * @returns {object|null} null when session does not belong to the task
 */
export function deriveSessionChatEntry(task, session, {
  locale = 'en-US',
  t = null,
  statusText = null,
  formatTime = null,
  maxOutput = CHAT_MAX_OUTPUT,
} = {}) {
  if (!task || !task.sessionId || !session) return null;
  const sessionId = session.sessionId || session.id;
  if (!sessionId || task.sessionId !== sessionId) return null;

  const defaultDict = {
    'en-US': {
      'msg.session': 'Session',
      'msg.output': 'Session output',
      'msg.agent': 'Agent',
      'msg.noOutput': 'No recent output available.',
      'generic.error': 'Error',
      'session.exitCode': 'exit {code}',
      'session.signal': 'signal {signal}',
    },
    'zh-CN': {
      'msg.session': '会话',
      'msg.output': '会话输出',
      'msg.agent': 'Agent',
      'msg.noOutput': '暂无输出',
      'generic.error': '错误',
      'session.exitCode': '退出代码 {code}',
      'session.signal': '信号 {signal}',
    },
  };

  const tr = typeof t === 'function' ? t : (key, vars = {}) => {
    let str = (defaultDict[locale] && defaultDict[locale][key]) ?? defaultDict['en-US'][key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
    return str;
  };

  const defaultStatusMap = {
    'en-US': {
      RUNNING: 'Running', WAITING: 'Waiting', REVIEWING: 'Reviewing',
      ERROR: 'Error', STOPPED: 'Stopped', FAILED: 'Failed',
      EXITED: 'Exited', STARTING: 'Starting', IDLE: 'Idle', BUSY: 'Busy',
    },
    'zh-CN': {
      RUNNING: '运行中', WAITING: '等待中', REVIEWING: '评审中',
      ERROR: '出错', STOPPED: '已停止', FAILED: '失败',
      EXITED: '已退出', STARTING: '启动中', IDLE: '空闲', BUSY: '忙碌',
    },
  };

  const stText = typeof statusText === 'function' ? statusText : raw => {
    const key = `${raw ?? ''}`.toUpperCase().replace(/\s+/g, '_');
    return (defaultStatusMap[locale] && defaultStatusMap[locale][key]) ?? defaultStatusMap['en-US'][key] ?? (raw ? `${raw}`.replaceAll('_', ' ') : 'Unknown');
  };

  const rawStatus = session.status || 'unknown';
  const pill = rawStatus;

  let dot = rawStatus;
  const statusLower = `${rawStatus}`.toLowerCase();
  if (statusLower === 'exited') {
    if (session.exitCode === 0) {
      dot = 'ok';
    } else if (session.exitCode !== null && session.exitCode !== undefined) {
      dot = 'failed';
    } else {
      dot = 'exited';
    }
  } else if (/error|failed/.test(statusLower)) {
    dot = 'failed';
  } else if (/stopped/.test(statusLower)) {
    dot = 'stopped';
  } else if (/running|busy|starting|waiting|reviewing/.test(statusLower)) {
    dot = statusLower;
  } else if (/idle/.test(statusLower)) {
    dot = 'ok';
  }

  const subParts = [
    `${tr('msg.session')} ${shortId(sessionId)}`,
  ];
  if (session.exitCode !== null && session.exitCode !== undefined) {
    subParts.push(tr('session.exitCode', { code: session.exitCode }));
  }
  if (session.signal) {
    subParts.push(tr('session.signal', { signal: session.signal }));
  }
  if (session.error) {
    subParts.push(`${tr('generic.error')}: ${session.error}`);
  }

  let body;
  if (typeof session.recentOutput === 'string' && session.recentOutput.trim()) {
    const rawOutput = session.recentOutput;
    body = rawOutput.length > maxOutput ? rawOutput.slice(0, maxOutput) : rawOutput;
  } else {
    body = tr('msg.noOutput');
  }

  const agentName = session.agent || task.implementer || tr('msg.agent');
  const title = `${agentName} · ${tr('msg.output')}`;

  const time = typeof formatTime === 'function'
    ? formatTime(session.lastActivity || session.createdAt)
    : (session.lastActivity || session.createdAt || '');

  const raw = session.error ? `${tr('generic.error')}: ${session.error}` : null;

  return {
    kind: 'session',
    title,
    sub: subParts.join(' · '),
    pill,
    dot,
    time: typeof time === 'string' ? time : '',
    body,
    raw,
    sessionId,
  };
}

/**
 * Render the session chat card HTML for the chat feed.
 *
 * @param {object} task
 * @param {object} session
 * @param {object} [options]
 * @returns {string} HTML article or empty string
 */
export function renderSessionChatCard(task, session, options = {}) {
  const entry = deriveSessionChatEntry(task, session, options);
  if (!entry) return '';
  const escapeHtml = options.escapeHtml || defaultEscapeHtml;
  const statusClass = options.statusClass || (s => `${s || 'unknown'}`.toLowerCase().replaceAll('_', '-'));
  const stText = options.statusText || (s => entry.pill ? String(entry.pill) : '');
  const dotClass = entry.dot ? ` dot-${statusClass(entry.dot)}` : '';
  return `
    <article class="chat-msg msg-session" data-chat-kind="session" data-session-id="${escapeHtml(entry.sessionId)}">
      <div class="chat-msg-head">
        <span class="chat-dot${dotClass}" aria-hidden="true"></span>
        <strong>${escapeHtml(entry.title)}</strong>
        ${entry.pill ? `<span class="status-pill ${statusClass(entry.pill)}">${escapeHtml(stText(entry.pill))}</span>` : ''}
        ${entry.time ? `<time>${escapeHtml(entry.time)}</time>` : ''}
      </div>
      ${entry.sub ? `<div class="chat-msg-sub">${escapeHtml(entry.sub)}</div>` : ''}
      <div class="chat-msg-body">${escapeHtml(entry.body)}</div>
      ${entry.raw ? `<code class="chat-msg-code">${escapeHtml(entry.raw)}</code>` : ''}
    </article>`.trim();
}
