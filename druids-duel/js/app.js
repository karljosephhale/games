// =========================================
// Druid's Duel — Main Application
// =========================================

const SUPABASE_URL  = 'https://wxxxcibobcudmaiqsyql.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4eHhjaWJvYmN1ZG1haXFzeXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNTcxODgsImV4cCI6MjA5ODkzMzE4OH0.N-DGT53h529McgOT5UeplHOl1jd0BzXYfUgmqKI-WDA';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ─────────────────────────────────
let state = {
  user: null,
  profile: null,
  completedIds: new Set(),          // challenge IDs the user has completed
  bestTimes: {},                    // { challengeId: ms }
  currentChallenge: null,
  timerInterval: null,
  timerStart: null,
  timerMs: 0,
  timerStopped: false,
  gamePlayers: [],                  // [{ name, user_id|null }]
  gameSessionId: null,
  gameTimerStart: null,
  gameTimerInterval: null,
  gameTimerMs: 0,
  isSolo: true,
};

const WEAVES = [
  { key: 'loop_count',   name: 'Loop',   img: 'assets/weave-loop.png' },
  { key: 'span_count',   name: 'Span',   img: 'assets/weave-span.png' },
  { key: 'bend_count',   name: 'Bend',   img: 'assets/weave-bend.png' },
  { key: 'branch_count', name: 'Branch', img: 'assets/weave-branch.png' },
  { key: 'cross_count',  name: 'Cross',  img: 'assets/weave-cross.png' },
];

// ── Helpers ───────────────────────────────
const show = id  => document.getElementById(id)?.classList.remove('hidden');
const hide = id  => document.getElementById(id)?.classList.add('hidden');
const el   = id  => document.getElementById(id);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function showToast(msg, duration = 3200) {
  const t = el('toast'); t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}
const showLoading = () => show('loading-overlay');
const hideLoading = () => hide('loading-overlay');

function showError(id, msg) { const e = el(id); if (e) { e.textContent = msg; e.classList.remove('hidden'); } }
function clearError(id)     { const e = el(id); if (e) { e.textContent = ''; e.classList.add('hidden'); } }

function formatTime(ms) {
  if (!ms && ms !== 0) return '—';
  const s = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}.${tenths}`;
}

// ── Segmented controls ────────────────────
function initSegmented(containerId, onChange) {
  const container = el(containerId);
  if (!container) return;
  container.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.val);
    });
  });
}

function getSegValue(containerId) {
  return el(containerId)?.querySelector('.seg-btn.active')?.dataset.val ?? 'all';
}

// ── Router ────────────────────────────────
const AUTH_PAGES   = ['play','challenges','history','friends','profile','admin'];
const PUBLIC_PAGES = ['landing','login','register','forgot','rules','lore'];
const ALL_PAGES    = [...AUTH_PAGES, ...PUBLIC_PAGES];

function route() {
  const hash = location.hash.replace('#/','') || 'landing';
  const name = ALL_PAGES.includes(hash) ? hash : 'landing';

  if (AUTH_PAGES.includes(name) && !state.user) { location.hash = '/login'; return; }
  if (name === 'login' || name === 'register' || name === 'landing') {
    if (state.user) { location.hash = '/play'; return; }
  }
  showPage(name);
}

function showPage(name) {
  ALL_PAGES.forEach(p => hide(`page-${p}`));
  show(`page-${name}`);

  const showNav = state.user || ['rules','lore'].includes(name);
  el('main-nav')?.classList.toggle('hidden', !showNav);

  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === `#/${name}`);
  });

  switch (name) {
    case 'play':       initPlayPage();        break;
    case 'challenges': initChallengeList();   break;
    case 'history':    initHistory();         break;
    case 'friends':    initFriends();         break;
    case 'profile':    initProfile();         break;
    case 'admin':      initAdmin();           break;
  }
}

// ── Auth ──────────────────────────────────
async function loadUserData() {
  if (!state.user) return;
  const { data: prof } = await sb.from('profiles').select('*').eq('id', state.user.id).single();
  state.profile = prof;
  if (prof) el('nav-username').textContent = prof.display_name || prof.username || 'Profile';
  await loadCompletions();
}

async function loadCompletions() {
  if (!state.user) return;
  const { data } = await sb
    .from('session_players')
    .select('completion_time_ms, game_sessions(challenge_id)')
    .eq('user_id', state.user.id)
    .not('game_sessions', 'is', null);

  state.completedIds = new Set();
  state.bestTimes = {};
  for (const row of (data || [])) {
    const cid = row.game_sessions?.challenge_id;
    if (!cid) continue;
    state.completedIds.add(cid);
    if (row.completion_time_ms) {
      if (!state.bestTimes[cid] || row.completion_time_ms < state.bestTimes[cid]) {
        state.bestTimes[cid] = row.completion_time_ms;
      }
    }
  }
}

// Login with email OR username
el('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearError('login-error');
  const identifier = el('login-identifier').value.trim();
  const pass       = el('login-password').value;
  showLoading();

  let email = identifier;
  if (!isEmail(identifier)) {
    // Try username (slug) then display_name — separate queries avoid .or() space-parsing bug
    const slug = identifier.toLowerCase().replace(/\s+/g, '_');
    let prof = null;
    const { data: byUser } = await sb.from('profiles')
      .select('email').eq('username', slug).maybeSingle();
    if (byUser?.email) {
      prof = byUser;
    } else {
      const { data: byName } = await sb.from('profiles')
        .select('email').ilike('display_name', identifier).maybeSingle();
      prof = byName;
    }
    if (!prof?.email) {
      hideLoading();
      showError('login-error', 'No druid found with that name. Try your email instead.');
      return;
    }
    email = prof.email;
  }

  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  hideLoading();
  if (error) { showError('login-error', error.message); }
  // auth state change handles redirect
});

el('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearError('register-error');
  const name  = el('reg-name').value.trim();
  const email = el('reg-email').value.trim();
  const pass  = el('reg-password').value;
  showLoading();
  const { error } = await sb.auth.signUp({
    email, password: pass,
    options: {
      data: { display_name: name, username: name.toLowerCase().replace(/\s+/g,'_') },
      emailRedirectTo: 'https://games.karlhale.com/druids-duel'
    }
  });
  hideLoading();
  if (error) { showError('register-error', error.message); return; }
  el('register-success').textContent = 'Check your email to confirm, then sign in.';
  el('register-success').classList.remove('hidden');
  el('register-form').reset();
});

el('forgot-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearError('forgot-error');
  const email = el('forgot-email').value.trim();
  showLoading();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://games.karlhale.com/druids-duel#/profile'
  });
  hideLoading();
  if (error) { showError('forgot-error', error.message); return; }
  el('forgot-success').textContent = 'Recovery link sent! Check your email.';
  el('forgot-success').classList.remove('hidden');
});

el('nav-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  state.user = null; state.profile = null;
  location.hash = '/';
});

el('nav-hamburger').addEventListener('click', () => {
  el('main-nav').classList.toggle('mobile-open');
});

// ── PLAY PAGE ─────────────────────────────
function initPlayPage() {
  // Reset to setup step
  showPlayStep('setup');

  // Reset player list: start with logged-in user if available
  state.gamePlayers = state.profile
    ? [{ name: state.profile.display_name || state.profile.username, user_id: state.user.id }]
    : [];
  renderPlayersList();

  // Reset timer UI
  stopTimer();
  el('timer-display').textContent = '0:00.0';
  hide('timer-result');
  hide('complete-success');
  hide('btn-stop-timer');
  hide('btn-record-win');
  hide('btn-redraw');
  hide('game-save-success');
  state.saving = false;
}

function showPlayStep(step) {
  ['setup','active','finish'].forEach(s => hide(`play-step-${s}`));
  show(`play-step-${step}`);
}

// ── Players list ──────────────────────────
function renderPlayersList() {
  const list = el('players-list');
  if (state.gamePlayers.length === 0) {
    list.innerHTML = '<p class="empty-state" style="margin:0.5rem 0">No players yet — add at least one.</p>';
    return;
  }
  list.innerHTML = state.gamePlayers.map((p, i) => `
    <div class="player-item">
      <span class="player-name">${escapeHtml(p.name)}${p.user_id ? ' <span class="linked-badge">✓</span>' : ''}</span>
      <button class="remove-player btn-ghost-sm" data-i="${i}" ${i === 0 && p.user_id === state.user?.id ? 'style="visibility:hidden"' : ''}>✕</button>
    </div>`).join('');
  list.querySelectorAll('.remove-player').forEach(btn =>
    btn.addEventListener('click', () => {
      state.gamePlayers.splice(Number(btn.dataset.i), 1);
      renderPlayersList();
    })
  );
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

el('btn-add-player').addEventListener('click', addPlayerFromInput);
el('add-player-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPlayerFromInput(); } });

function addPlayerFromInput() {
  const name = el('add-player-name').value.trim();
  if (!name) return;
  if (state.gamePlayers.length >= 8) { showToast('Maximum 8 players'); return; }
  if (state.gamePlayers.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    showToast('That name is already in the circle'); return;
  }
  state.gamePlayers.push({ name, user_id: null });
  el('add-player-name').value = '';
  el('friend-suggestions').classList.add('hidden');
  renderPlayersList();
}

// Friend suggestions while typing
el('add-player-name').addEventListener('input', async () => {
  const q = el('add-player-name').value.trim();
  const sug = el('friend-suggestions');
  if (q.length < 2 || !state.user) { sug.classList.add('hidden'); return; }

  const { data } = await sb.from('profiles').select('id, display_name, username')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq('id', state.user.id).limit(5);

  if (!data?.length) { sug.classList.add('hidden'); return; }
  sug.classList.remove('hidden');
  sug.innerHTML = data.map(p =>
    `<div class="sug-item" data-id="${p.id}" data-name="${escapeHtml(p.display_name || p.username)}">
      ${escapeHtml(p.display_name || p.username)} <span class="sug-handle">@${p.username}</span>
    </div>`).join('');
  sug.querySelectorAll('.sug-item').forEach(item =>
    item.addEventListener('click', () => {
      if (state.gamePlayers.length >= 8) { showToast('Maximum 8 players'); return; }
      state.gamePlayers.push({ name: item.dataset.name, user_id: item.dataset.id });
      el('add-player-name').value = ''; sug.classList.add('hidden');
      renderPlayersList();
    })
  );
});

// ── Draw challenge ─────────────────────────
el('btn-draw').addEventListener('click', drawChallenge);
el('btn-redraw').addEventListener('click', () => {
  if (!confirm('Draw a new challenge? This will discard the current one.')) return;
  drawChallenge();
});

async function drawChallenge() {
  if (state.gamePlayers.length === 0 && !state.user) {
    showToast('Add at least one player'); return;
  }
  // Auto-add logged-in user if no players set
  if (state.gamePlayers.length === 0 && state.user) {
    state.gamePlayers = [{ name: state.profile?.display_name || 'You', user_id: state.user.id }];
    renderPlayersList();
  }

  const diffs = [];
  if (el('f-easy').checked)   diffs.push('Easy');
  if (el('f-medium').checked) diffs.push('Medium');
  if (el('f-hard').checked)   diffs.push('Hard');
  if (!diffs.length) { showToast('Select at least one difficulty'); return; }

  const scope = getSegValue('challenge-scope');

  showLoading();
  const { data: all } = await sb.from('challenges').select('*').eq('is_visible', true).in('difficulty', diffs);
  hideLoading();
  if (!all?.length) { showToast('No challenges found'); return; }

  let pool = scope === 'new' ? all.filter(c => !state.completedIds.has(c.id)) : all;
  if (pool.length === 0) {
    showToast("You've completed all of those! Showing all.");
    pool = all;
  }

  const c = pool[Math.floor(Math.random() * pool.length)];
  state.currentChallenge = c;
  state.isSolo = state.gamePlayers.length <= 1;

  // Render challenge card
  renderChallengeCard(c);

  // Show action buttons (unified for solo + challenge)
  hide('complete-success');
  show('btn-stop-timer');
  show('btn-record-win');
  show('btn-redraw');

  startTimer();
  showPlayStep('active');
}

function renderChallengeCard(c) {
  const grid = el('challenge-weaves');
  grid.innerHTML = '';
  WEAVES.forEach(w => {
    if (c[w.key] > 0) grid.innerHTML += `
      <div class="weave-item">
        <img src="${w.img}" alt="${w.name}">
        <span class="weave-count">${c[w.key]}</span>
        <span class="weave-name">${w.name}</span>
      </div>`;
  });
  const diff = el('challenge-difficulty');
  diff.textContent = c.difficulty || 'Challenge';
  diff.className = `difficulty-badge ${c.difficulty || ''}`;
  el('challenge-id').textContent = `#${c.id}`;
  el('challenge-total').textContent = c.weave_count;

  // Best time indicator
  const best = state.bestTimes[c.id];
  const bestEl = el('challenge-best');
  if (best) {
    bestEl.textContent = `Your best: ${formatTime(best)}`;
    bestEl.classList.remove('hidden');
  } else {
    bestEl.classList.add('hidden');
  }
}

// ── Timer ─────────────────────────────────
function startTimer() {
  stopTimer();
  state.timerStart  = Date.now();
  state.timerMs     = 0;
  state.timerStopped = false;
  el('timer-display').textContent = '0:00.0';
  hide('timer-result');
  state.timerInterval = setInterval(() => {
    state.timerMs = Date.now() - state.timerStart;
    el('timer-display').textContent = formatTime(state.timerMs);
  }, 100);
}

function stopTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

el('btn-stop-timer').addEventListener('click', () => {
  if (!state.timerStopped) {
    stopTimer();
    state.timerStopped = true;
    el('btn-stop-timer').textContent = 'Resume Timer';
    el('btn-stop-timer').classList.remove('btn-stop');
    el('btn-stop-timer').classList.add('btn-secondary');
  } else {
    state.timerStart = Date.now() - state.timerMs;
    state.timerStopped = false;
    state.timerInterval = setInterval(() => {
      state.timerMs = Date.now() - state.timerStart;
      el('timer-display').textContent = formatTime(state.timerMs);
    }, 100);
    el('btn-stop-timer').textContent = 'Stop Timer';
    el('btn-stop-timer').classList.add('btn-stop');
    el('btn-stop-timer').classList.remove('btn-secondary');
  }
});

// ── Record Win (unified solo + challenge) ──
el('btn-record-win').addEventListener('click', () => {
  if (!state.currentChallenge) return;
  if (!confirm('Record a win and finish this duel?')) return;
  stopTimer();
  state.timerStopped = true;
  if (state.isSolo) {
    hide('winner-group');
  } else {
    const sel = el('game-winner-select');
    sel.innerHTML = state.gamePlayers.map((p,i) =>
      `<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
    show('winner-group');
  }
  el('game-photo-upload').value = '';
  el('game-camera-upload').value = '';
  el('photo-preview').classList.add('hidden');
  el('photo-upload-text').textContent = '📎 Choose Photo';
  hide('game-save-success');
  showPlayStep('finish');
});

function handlePhotoFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const prev = el('photo-preview');
    prev.innerHTML = `<img src="${ev.target.result}" alt="Knot photo">`;
    prev.classList.remove('hidden');
    el('photo-upload-text').textContent = file.name;
  };
  reader.readAsDataURL(file);
}
el('game-photo-upload').addEventListener('change', () => handlePhotoFile(el('game-photo-upload').files[0]));
el('game-camera-upload').addEventListener('change', () => handlePhotoFile(el('game-camera-upload').files[0]));

// ── Unified save (solo + challenge) ────────
async function saveAndFinish() {
  if (state.saving) return;
  state.saving = true;
  showLoading();

  const winnerIdx = state.isSolo ? 0 : Number(el('game-winner-select').value);
  const elapsed = state.timerMs;

  // Upload photo if provided (from gallery OR camera)
  let photoUrl = null;
  const file = el('game-photo-upload').files[0] || el('game-camera-upload').files[0];
  if (file && state.user) {
    const ext = file.name.split('.').pop();
    const { data: upload } = await sb.storage.from('knot-photos')
      .upload(`${state.user.id}/${Date.now()}.${ext}`, file);
    if (upload) {
      const { data: u } = sb.storage.from('knot-photos').getPublicUrl(upload.path);
      photoUrl = u.publicUrl;
    }
  }

  const { data: session, error: sessionErr } = await sb.from('game_sessions').insert({
    challenge_id: state.currentChallenge?.id,
    host_user_id: state.user?.id || null,
    started_at: new Date(state.timerStart || Date.now()).toISOString(),
    completed_at: new Date().toISOString(),
    is_solo: state.isSolo,
    knot_photo_url: photoUrl,
  }).select().single();

  if (sessionErr) {
    console.error('game_sessions insert failed:', sessionErr);
    state.saving = false;
    hideLoading();
    showToast('Save failed — ' + sessionErr.message);
    return;
  }

  if (session) {
    for (const [i, p] of state.gamePlayers.entries()) {
      const { error: playerErr } = await sb.from('session_players').insert({
        session_id: session.id,
        user_id: p.user_id || null,
        display_name: p.name,
        is_winner: i === winnerIdx,
        completion_time_ms: i === winnerIdx ? elapsed : null,
      });
      if (playerErr) console.error('session_players insert failed:', playerErr);
    }
    if (state.currentChallenge) {
      state.completedIds.add(state.currentChallenge.id);
      if (elapsed && state.isSolo) {
        const cid = state.currentChallenge.id;
        if (!state.bestTimes[cid] || elapsed < state.bestTimes[cid]) state.bestTimes[cid] = elapsed;
      }
    }
  }

  state.saving = false;
  hideLoading();
  show('game-save-success');
  showToast(state.isSolo ? 'Challenge recorded! ⬡' : 'Duel recorded! ⬡');
  setTimeout(() => { location.hash = '/history'; }, 1800);
}

el('btn-save-game').addEventListener('click', saveAndFinish);

// Clicking anywhere on the finish card (outside interactive elements) also saves
el('play-step-finish').addEventListener('click', e => {
  if (e.target.closest('button, select, label, input, a')) return;
  saveAndFinish();
});

// ── ALL CHALLENGES ─────────────────────────
async function initChallengeList() {
  showLoading();
  const { data } = await sb.from('challenges').select('*')
    .eq('is_visible', true).order('difficulty').order('weave_count');
  hideLoading();
  if (!data) return;

  let scope = 'all';
  const render = () => {
    const diffs = [];
    if (el('cl-easy').checked)   diffs.push('Easy');
    if (el('cl-medium').checked) diffs.push('Medium');
    if (el('cl-hard').checked)   diffs.push('Hard');

    const filtered = data.filter(c => {
      if (!diffs.includes(c.difficulty)) return false;
      const done = state.completedIds.has(c.id);
      if (scope === 'new'  && done)  return false;
      if (scope === 'done' && !done) return false;
      return true;
    });

    const grid = el('challenges-list-grid');
    if (!filtered.length) {
      grid.innerHTML = '<p class="empty-state">No challenges match your filters.</p>'; return;
    }
    grid.innerHTML = filtered.map(c => {
      const done = state.completedIds.has(c.id);
      const best = state.bestTimes[c.id];
      const weaveHtml = WEAVES.filter(w => c[w.key] > 0).map(w =>
        `<span class="tile-weave"><img src="${w.img}" alt="${w.name}"> ×${c[w.key]}</span>`).join('');
      return `<div class="challenge-tile parchment${done ? ' completed' : ''}">
        <div class="tile-header">
          <span class="difficulty-badge ${c.difficulty}">${c.difficulty}</span>
          <span class="tile-id">#${c.id}</span>
          ${done ? '<span class="done-badge">✓</span>' : ''}
        </div>
        <div class="tile-weaves">${weaveHtml}</div>
        <div class="tile-footer">
          <span class="tile-total">${c.weave_count} weaves</span>
          ${best ? `<span class="tile-best">Best: ${formatTime(best)}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  };

  render();
  ['cl-easy','cl-medium','cl-hard'].forEach(id =>
    el(id).addEventListener('change', render));
  initSegmented('challenges-scope', val => { scope = val; render(); });
}

// ── HISTORY ────────────────────────────────
async function initHistory() {
  if (!state.user) return;
  showLoading();
  // Get all sessions where user is a player (not just as host)
  const { data: playerRows } = await sb.from('session_players')
    .select('session_id').eq('user_id', state.user.id);
  const sessionIds = [...new Set((playerRows || []).map(r => r.session_id))];
  const { data: sessions } = sessionIds.length
    ? await sb.from('game_sessions')
        .select('*, challenges(*), session_players(*)')
        .in('id', sessionIds)
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [] };
  hideLoading();

  const list = el('history-list');
  if (!sessions?.length) {
    list.innerHTML = '<p class="empty-state">No games yet. Play your first challenge!</p>'; return;
  }
  list.innerHTML = sessions.map(s => {
    const c = s.challenges;
    const players = s.session_players || [];
    const winner  = players.find(p => p.is_winner);
    const date    = new Date(s.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const timeStr = winner?.completion_time_ms ? ` · ${formatTime(winner.completion_time_ms)}` : '';
    const weaveStr = c ? WEAVES.filter(w => c[w.key] > 0).map(w => `${c[w.key]}×${w.name}`).join(', ') : '';
    const photoHtml = s.knot_photo_url
      ? `<div class="history-photo"><img src="${s.knot_photo_url}" alt="Knot photo"></div>` : '';
    const playersHtml = players.map(p =>
      `<span class="history-player${p.is_winner ? ' winner' : ''}">${escapeHtml(p.display_name)}${p.is_winner ? ' 👑' : ''}</span>`
    ).join(', ');
    return `<div class="history-item parchment">
      <div class="history-header">
        <strong>${c ? `#${c.id}` : 'Game'}</strong>
        <span class="difficulty-badge ${c?.difficulty}">${c?.difficulty || ''}</span>
        <span class="history-date">${date}${timeStr}</span>
      </div>
      ${weaveStr ? `<div class="history-weaves">${weaveStr}</div>` : ''}
      <div class="history-players">${playersHtml}</div>
      ${photoHtml}
    </div>`;
  }).join('');
}

// ── FRIENDS ────────────────────────────────
async function initFriends() {
  if (!state.user) return;
  showLoading();
  const { data: fr, error: frErr } = await sb.from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`);
  if (frErr) { hideLoading(); showToast('Circle error: ' + frErr.message); console.error('friendships query error:', frErr); return; }

  // Collect all profile IDs and fetch in one query
  const pids = [...new Set((fr||[]).flatMap(f => [f.requester_id, f.addressee_id]))];
  const { data: profiles } = pids.length
    ? await sb.from('profiles').select('id, display_name, username').in('id', pids)
    : { data: [] };
  const pmap = Object.fromEntries((profiles||[]).map(p => [p.id, p]));
  const enriched = (fr||[]).map(f => ({
    ...f,
    requester: pmap[f.requester_id] || null,
    addressee: pmap[f.addressee_id] || null,
  }));
  hideLoading();

  const accepted = enriched.filter(f => f.status === 'accepted');
  const pending  = enriched.filter(f => f.status === 'pending');

  el('friends-list').innerHTML = accepted.length === 0
    ? '<p class="empty-state">Your circle is empty. Search for druids to invite!</p>'
    : accepted.map(f => {
        const other = f.requester_id === state.user.id ? f.addressee : f.requester;
        return `<div class="friend-item">
          <span class="friend-name">${escapeHtml(other?.display_name || other?.username || '?')}</span>
          <span class="friend-handle">@${other?.username || ''}</span>
        </div>`;
      }).join('');

  el('pending-list').innerHTML = pending.length === 0
    ? '<p class="empty-state">No pending invitations.</p>'
    : pending.map(f => {
        const isIncoming = f.addressee_id === state.user.id;
        const other = isIncoming ? f.requester : f.addressee;
        return `<div class="friend-item">
          <span class="friend-name">${escapeHtml(other?.display_name || other?.username || '?')}</span>
          <span class="friend-handle">${isIncoming ? 'invited you' : 'pending'}</span>
          ${isIncoming
            ? `<button class="btn-secondary btn-sm" onclick="acceptFriend('${f.id}')">Accept</button>`
            : ''}
        </div>`;
      }).join('');
}

window.acceptFriend = async id => {
  await sb.from('friendships').update({ status: 'accepted' }).eq('id', id);
  showToast('Friend accepted!'); initFriends();
};

el('btn-friend-search').addEventListener('click', searchFriends);
el('friend-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchFriends(); });

async function searchFriends() {
  const q = el('friend-search-input').value.trim();
  if (q.length < 2) return;
  const { data } = await sb.from('profiles').select('id, display_name, username')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq('id', state.user.id).limit(8);
  const results = el('friend-search-results');
  if (!data?.length) { results.innerHTML = '<p class="empty-state">No druids found.</p>'; return; }
  results.innerHTML = data.map(p =>
    `<div class="friend-item">
      <div>
        <span class="friend-name">${escapeHtml(p.display_name || p.username)}</span>
        <span class="friend-handle">@${p.username}</span>
      </div>
      <button class="btn-secondary btn-sm" onclick="inviteFriend('${p.id}','${escapeHtml(p.display_name||p.username)}')">Invite</button>
    </div>`).join('');
}

window.inviteFriend = async (id, name) => {
  // Prevent self-invite
  if (id === state.user.id) {
    showToast("You can't invite yourself, wise one.");
    return;
  }
  // Check both directions — prevent mutual-invite duplicates
  const { data: fwd } = await sb.from('friendships')
    .select('id, status').eq('requester_id', state.user.id).eq('addressee_id', id).maybeSingle();
  const { data: rev } = await sb.from('friendships')
    .select('id, status').eq('requester_id', id).eq('addressee_id', state.user.id).maybeSingle();
  if (fwd) {
    showToast(fwd.status === 'accepted'
      ? `${name} is already in your circle.`
      : `Already waiting for ${name} to accept your invitation.`);
    initFriends();
    return;
  }
  if (rev) {
    showToast(rev.status === 'accepted'
      ? `${name} is already in your circle.`
      : `${name} has already invited you! Check Pending Invitations.`);
    initFriends();
    return;
  }
  const { error } = await sb.from('friendships').insert({ requester_id: state.user.id, addressee_id: id });
  if (error) {
    showToast(error.message.includes('unique') ? `${name} is already in your circle.` : error.message);
    initFriends();
    return;
  }
  showToast(`Invitation sent to ${name}!`);
  initFriends();
};

// ── PROFILE ────────────────────────────────
async function initProfile() {
  if (!state.profile) return;
  el('profile-name').value     = state.profile.display_name || '';
  el('profile-username').value = state.profile.username || '';

  const { count: games } = await sb.from('session_players')
    .select('*', { count:'exact', head:true }).eq('user_id', state.user.id);
  const { count: wins } = await sb.from('session_players')
    .select('*', { count:'exact', head:true }).eq('user_id', state.user.id).eq('is_winner', true);
  el('stat-completed').textContent = state.completedIds.size;
  el('stat-games').textContent     = games || 0;
  el('stat-wins').textContent      = wins  || 0;
}

el('btn-save-profile').addEventListener('click', async () => {
  const name     = el('profile-name').value.trim();
  const username = el('profile-username').value.trim().toLowerCase().replace(/\s+/g,'_');
  if (!name || !username) return;
  showLoading();
  const { error } = await sb.from('profiles')
    .update({ display_name: name, username, updated_at: new Date().toISOString() })
    .eq('id', state.user.id);
  hideLoading();
  if (error) { showToast(error.message); return; }
  state.profile.display_name = name;
  state.profile.username = username;
  el('nav-username').textContent = name;
  show('profile-success');
  setTimeout(() => hide('profile-success'), 2500);
});

// ── ADMIN ──────────────────────────────────
async function initAdmin() {
  showLoading();
  const { data } = await sb.from('challenges').select('*').order('id');
  hideLoading();
  if (!data) return;

  const rows = data.map(c => `<tr>
    <td>${c.id}</td>
    <td>${c.loop_count}</td><td>${c.span_count}</td><td>${c.cross_count}</td>
    <td>${c.bend_count}</td><td>${c.branch_count}</td>
    <td><span class="difficulty-badge ${c.difficulty}">${c.difficulty||'—'}</span></td>
    <td>${c.weave_count}</td>
    <td><label style="cursor:pointer"><input type="checkbox" ${c.is_visible?'checked':''}
      onchange="toggleVisible(${c.id},this.checked)"></label></td>
  </tr>`).join('');

  el('admin-challenges-table').innerHTML =
    '<table class="admin-table"><thead><tr>' +
    '<th>#</th><th>Loop</th><th>Span</th><th>Cross</th><th>Bend</th><th>Branch</th>' +
    '<th>Difficulty</th><th>Weaves</th><th>Visible</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

window.toggleVisible = async (id, visible) => {
  await sb.from('challenges').update({ is_visible: visible }).eq('id', id);
  showToast(visible ? 'Challenge visible' : 'Challenge hidden');
};


// ── Boot ───────────────────────────────────
// Show something immediately (sync) so the page is never blank
route();

sb.auth.onAuthStateChange((event, session) => {
  // IMPORTANT: must NOT be async and must NOT await any Supabase calls here.
  // The SDK awaits all subscriber callbacks; Supabase DB/auth calls internally
  // await initializePromise — which is still pending during this callback —
  // creating a circular deadlock. Fire-and-forget instead.
  state.user = session?.user ?? null;
  if (state.user) {
    loadUserData()
      .catch(e => console.warn('loadUserData error:', e))
      .finally(() => route());
  } else {
    state.profile = null;
    state.completedIds = new Set();
    state.bestTimes = {};
    route();
  }
});

window.addEventListener('hashchange', route);

(async () => {
  try {
    const { data } = await sb.auth.getSession();
    state.user = data?.session?.user ?? null;
    if (state.user) {
      try { await loadUserData(); } catch(e) { console.warn('loadUserData error:', e); }
    }
  } catch(e) {
    console.warn('getSession error:', e);
    state.user = null;
  }
  hideLoading();
  route();
})();
