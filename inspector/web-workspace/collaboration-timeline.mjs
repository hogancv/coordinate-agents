// Presentation of persisted receipts only. No terminal IO or collaboration actions.
export function mountCollaborationTimeline({ document, getContext, t, onResize }) {
  const details = document.querySelector('#collaboration-timeline');
  const heading = document.querySelector('#timeline-heading');
  const filter = document.querySelector('#timeline-round');
  const list = document.querySelector('#timeline-events');
  const empty = document.querySelector('#timeline-empty');
  const content = document.querySelector('.timeline-content');
  let identity = null, signature = null;

  function update() {
    const { projectId, selectedId, task } = getContext();
    const key = JSON.stringify([projectId, selectedId]);
    if (key !== identity) {
      identity = key; signature = null; details.open = false; filter.value = 'current';
      list.textContent = '';
    }
    details.hidden = !task || task.id !== selectedId || task.mode === 'custom';
    if (details.hidden) return;
    const events = task.collaborationEvents || [];
    const rounds = [...new Set(events.map(event => event.roundId))];
    let selected = filter.value || 'current';
    if (!['current', 'all'].includes(selected) && !rounds.includes(selected)) selected = 'current';
    const next = JSON.stringify([events, task.cooperation?.roundId, selected, t('timeline.title')]);
    if (next === signature) return;
    signature = next;
    heading.textContent = `${t('timeline.title')} · ${events.length}`;
    document.querySelector('#timeline-filter-label').textContent = t('timeline.round');
    document.querySelector('#timeline-note').textContent = t('timeline.note');
    const options = [['current', t('timeline.current')], ['all', t('timeline.all')], ...rounds.map(round => [round, round])];
    filter.textContent = '';
    for (const [value, label] of options) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; filter.append(option);
    }
    filter.value = selected;
    const visible = events.filter(event => selected === 'all' || event.roundId === (selected === 'current' ? task.cooperation?.roundId : selected));
    const scroll = content.scrollTop;
    list.textContent = '';
    for (const event of visible) {
      const row = document.createElement('li');
      row.dataset.revision = String(event.revision);
      const meta = document.createElement('div'); meta.className = 'timeline-event-meta';
      const time = document.createElement('time'); time.dateTime = event.timestamp;
      const date = new Date(event.timestamp); time.textContent = date.toLocaleString(); time.title = event.timestamp;
      const agent = document.createElement('strong'); agent.textContent = event.agent === 'codex' ? 'Codex' : 'Antigravity';
      const transition = document.createElement('span'); transition.className = 'timeline-transition';
      transition.textContent = `${event.fromStatus} → ${event.status}`;
      const round = document.createElement('code'); round.textContent = event.roundId;
      meta.append(time, agent, transition);
      row.append(meta, round);
      const description = document.createElement('p');
      description.textContent = t(`timeline.${event.status}`); row.append(description);
      if (event.summary) {
        const summary = document.createElement('p'); summary.className = 'timeline-receipt'; summary.textContent = event.summary; row.append(summary);
      }
      list.append(row);
    }
    content.scrollTop = scroll;
    empty.textContent = t('timeline.empty'); empty.hidden = visible.length > 0;
  }
  filter.addEventListener('change', update);
  details.addEventListener('toggle', () => onResize?.());
  return { update };
}
