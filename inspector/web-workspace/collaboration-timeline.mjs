// Presentation of persisted receipts only. No terminal IO or collaboration actions.
export function mountCollaborationTimeline({ document, getContext, t, loadPage }) {
  const panel = document.querySelector('#collaboration-timeline');
  const heading = document.querySelector('#timeline-heading');
  const filter = document.querySelector('#timeline-round');
  const list = document.querySelector('#timeline-events');
  const empty = document.querySelector('#timeline-empty');
  const content = document.querySelector('.timeline-content');
  const more = document.querySelector('#timeline-more');
  const error = document.querySelector('#timeline-error');
  const pages = new Map();
  let identity = null, signature = null, generation = 0, loading = false, loadError = false;
  function previousPage(task) {
    let page = task?.collaborationHistory?.previousPage;
    while (page && pages.has(page)) page--;
    return page || null;
  }

  function update() {
    const { projectId, selectedId, task } = getContext();
    const key = JSON.stringify([projectId, selectedId, task?.id, task?.mode]);
    if (key !== identity) {
      identity = key; signature = null; filter.value = 'current';
      list.textContent = ''; pages.clear(); generation++; loading = false; loadError = false;
    }
    panel.hidden = !task || task.id !== selectedId || task.mode === 'custom';
    if (panel.hidden) return;
    const events = [...new Map([...Array.from(pages.values()).flat(), ...(task.collaborationEvents || [])]
      .map(event => [event.revision, event])).values()].sort((a, b) => a.revision - b.revision);
    const archived = task.collaborationHistory?.archivedEvents || 0;
    const cursor = previousPage(task);
    const rounds = [...new Set(events.map(event => event.roundId))];
    let selected = filter.value || 'current';
    if (!['current', 'all'].includes(selected) && !rounds.includes(selected)) selected = 'current';
    const next = JSON.stringify([events, task.cooperation?.roundId, selected, archived, cursor, loading, loadError, t('timeline.title')]);
    if (next === signature) return;
    signature = next;
    heading.textContent = `${t('timeline.title')} · ${events.length}`;
    document.querySelector('#timeline-filter-label').textContent = t('timeline.round');
    document.querySelector('#timeline-note').textContent = `${t('timeline.note')}${archived ? ` ${t('timeline.archived').replace('{count}', String(archived))}` : ''}`;
    if (more) {
      more.hidden = !cursor || !loadPage;
      more.disabled = loading;
      more.textContent = t(loading ? 'timeline.loading' : 'timeline.more');
    }
    if (error) { error.hidden = !loadError; error.textContent = loadError ? t('timeline.loadError') : ''; }
    const options = [['current', t('timeline.current')], ['all', t(cursor ? 'timeline.allLoaded' : 'timeline.all')], ...rounds.map(round => [round, round])];
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
  more?.addEventListener('click', async () => {
    update();
    const { projectId, selectedId, task } = getContext();
    const historyPage = previousPage(task);
    if (panel.hidden || loading || !historyPage || !loadPage) return;
    const requestGeneration = generation;
    loading = true; loadError = false; update();
    try {
      const value = await loadPage({ projectId, taskId: selectedId, historyPage });
      update(); // Observe a selection change even if its render has not run yet.
      if (generation !== requestGeneration) return;
      if (value.id !== selectedId) throw Error('History Task mismatch.');
      pages.set(historyPage, value.collaborationEvents || []);
    } catch {
      update();
      if (generation !== requestGeneration) return;
      loadError = true;
    } finally {
      if (generation === requestGeneration) { loading = false; update(); }
    }
  });
  filter.addEventListener('change', update);
  return { update };
}
