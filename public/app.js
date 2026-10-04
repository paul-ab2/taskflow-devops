/* TaskFlow browser client - plain JS, talks to the REST API. */
(function () {
  'use strict';

  const state = { token: sessionStorage.getItem('tf_token'), mode: 'login' };
  const $ = (id) => document.getElementById(id);

  function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    return headers;
  }

  function errorMessage(res, body) {
    const detail = body.error && body.error.details && body.error.details.map((d) => d.message).join(', ');
    return detail || (body.error && body.error.message) || `Request failed (${res.status})`;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, { ...options, headers: authHeaders() });
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    if (res.status === 401 && state.token) logout();
    throw new Error(errorMessage(res, body));
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.forEach((c) => node.appendChild(c));
    return node;
  }

  async function loadBuild() {
    try {
      const info = await api('/api/version');
      const box = $('build');
      box.textContent = '';
      box.appendChild(el('span', { class: `env ${info.env}`, text: info.env }));
      box.appendChild(document.createTextNode(`v${info.version} · build ${info.buildNumber} · ${info.commit}`));
    } catch {
      $('build').textContent = 'build info unavailable';
    }
  }

  function showBoard(loggedIn) {
    $('auth').classList.toggle('hidden', loggedIn);
    $('board').classList.toggle('hidden', !loggedIn);
    $('logout').classList.toggle('hidden', !loggedIn);
    if (loggedIn) refresh();
  }

  function logout() {
    state.token = null;
    sessionStorage.removeItem('tf_token');
    showBoard(false);
  }

  async function refresh() {
    const params = new URLSearchParams();
    if ($('filter-status').value) params.set('status', $('filter-status').value);
    if ($('filter-search').value.trim()) params.set('search', $('filter-search').value.trim());
    const [list, stats] = await Promise.all([api(`/api/tasks?${params}`), api('/api/tasks/stats')]);
    renderStats(stats);
    renderTasks(list.items);
  }

  function renderStats(s) {
    const box = $('stats');
    box.textContent = '';
    [['Total', s.total], ['In progress', s.byStatus.in_progress], ['Overdue', s.overdue], ['Done', `${s.completionRate}%`]]
      .forEach(([label, value]) => box.appendChild(el('div', { class: 'stat' }, [
        el('b', { text: String(value) }), el('span', { text: label }),
      ])));
  }

  function renderTasks(items) {
    const list = $('tasks');
    list.textContent = '';
    $('empty').classList.toggle('hidden', items.length > 0);
    items.forEach((task) => {
      const status = el('select', { 'aria-label': 'Status', onchange: (e) => updateStatus(task, e.target) },
        [['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']].map(([v, t]) => {
          const opt = el('option', { value: v, text: t });
          if (v === task.status) opt.selected = true;
          return opt;
        }));
      const pills = [el('span', { class: `pill ${task.priority}`, text: task.priority })];
      if (task.overdue) pills.push(el('span', { class: 'pill overdue', text: 'overdue' }));
      if (task.dueDate) pills.push(el('span', { class: 'pill', text: task.dueDate.slice(0, 10) }));
      list.appendChild(el('li', { class: `task ${task.status}` }, [
        el('span', { class: 'title', text: task.title }),
        ...pills,
        status,
        el('button', { class: 'danger', type: 'button', text: 'Delete', onclick: () => remove(task) }),
      ]));
    });
  }

  async function updateStatus(task, select) {
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
    } catch (err) {
      alert(err.message);
    }
    refresh();
  }

  async function remove(task) {
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    refresh();
  }

  $('toggle-mode').addEventListener('click', () => {
    state.mode = state.mode === 'login' ? 'register' : 'login';
    const registering = state.mode === 'register';
    $('name-row').classList.toggle('hidden', !registering);
    $('auth-submit').textContent = registering ? 'Create account' : 'Log in';
    $('toggle-mode').textContent = registering ? 'I already have an account' : 'Create an account';
  });

  $('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('auth-error').textContent = '';
    const data = Object.fromEntries(new FormData(e.target));
    if (state.mode === 'login') delete data.name;
    try {
      const result = await api(`/api/auth/${state.mode}`, { method: 'POST', body: JSON.stringify(data) });
      state.token = result.token;
      sessionStorage.setItem('tf_token', result.token);
      showBoard(true);
    } catch (err) {
      $('auth-error').textContent = err.message;
    }
  });

  $('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (!data.dueDate) delete data.dueDate;
    await api('/api/tasks', { method: 'POST', body: JSON.stringify(data) });
    e.target.reset();
    refresh();
  });

  $('filter-status').addEventListener('change', refresh);
  $('filter-search').addEventListener('input', () => { clearTimeout(state.t); state.t = setTimeout(refresh, 250); });
  $('logout').addEventListener('click', logout);

  loadBuild();
  showBoard(Boolean(state.token));
})();
