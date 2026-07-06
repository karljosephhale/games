// =========================================
// Druid's Duel — Main Application
// =========================================

const SUPABASE_URL = 'https://wxxxcibobcudmaiqsyql.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4eHhjaWJvYmN1ZG1haXFzeXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNTcxODgsImV4cCI6MjA5ODkzMzE4OH0.N-DGT53h529McgOT5UeplHOl1jd0BzXYfUgmqKI-WDA';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ────────────────────────────────
let state = {
  user: null,
  profile: null,
  completedIds: new Set(),
  currentChallenge: null,
  timerInterval: null,
  timerStart: null,
  timerMs: 0,
  gamePlayers: [],
  gameChallenge: null,
  gameTimerInterval: null,
  gameTimerStart: null,
};

const WEAVES = [
  { key: 'loop_count',   name: 'Loop',   img: 'assets/weave-loop.png' },
  { key: 'span_count',   name: 'Span',   img: 'assets/weave-span.png' },
  { key: 'bend_count',   name: 'Bend',   img: 'assets/weave-bend.png' },
  { key: 'branch_count', name: 'Branch', img: 'assets/weave-branch.png' },
  { key: 'cross_count',  name: 'Cross',  img: 'assets/weave-cross.png' },
];

// ── Helpers ──────────────────────────────
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function el(id)   { return document.getElementById(id); }

function showToast(msg, duration = 3000) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

function showLoading() { show('loading-overlay'); }
function hideLoading() { hide('loading-overlay'); }

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2,'0')}.${tenths}`;
}

function showError(id, msg) {
  const e = el(id); e.textContent = msg; e.classList.remove('hidden');
}
function clearError(id) { const e = el(id); if (e) { e.textContent = ''; e.classList.add('hidden'); } }

// ── Router ───────────────────────────────
const PAGES = ['landing','login','register','forgot','challenge','challenges','game','history','friends','profile','rules','lore','admin'];
const AUTH_PAGES = ['challenge','challenges','game','history','friends','profile','admin'];
const PUBLIC_PAGES = ['landing','login','register','forgot','rules','lore'];

function showPage(name) {
  PAGES.forEach(p => hide(`page-${p}`));
  show(`page-${name}`);

  // Update nav active link
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === `#/${name}`);
  });

  // Nav visibility
  if (AUTH_PAGES.includes(name) || (state.user && PUBLIC_PAGES.includes(name))) {
    show('main-nav');
  } else {
    if (name === 'landing' || name === 'login' || name === 'register' || name === 'forgot') {
      hide('main-nav');
    } else {
      show('main-nav');
    }
  }

  // Page-specific init
  switch(name) {
    case 'challenge':     initChallengePage();  break;
    case 'challenges':    initChallengeList();  break;
    case 'history':       initHistory();        break;
    case 'friends':       initFriends();        break;
    case 'profile':       initProfile();        break;
    case 'game':          initGame();           break;
    case 'admin':         initAdmin();          break;
  }
}

function route() {
  const hash = location.hash.slice(1) || '/';
  const name = hash.replace('/','') || 'landing';

  if (AUTH_PAGES.includes(name) && !state.user) {
    location.hash = '/login'; return;
  }
  if ((name === 'login' || name === 'register' || name === 'landing') && state.user) {
    location.hash = '/challenge'; return;
  }

  showPage(name);
}

// ── Auth ─────────────────────────────────
async function loadProfile() {
  if (!state.user) return;
  const { data } = await sb.from('profiles').select('*').eq('id', state.user.id).single();
  state.profile = data;
  if (data) el('nav-username').textContent = data.display_name || data.username || 'Profile';
  await loadCompletedChallenges();
}

async function loadCompletedChallenges() {
  if (!state.user) return;
  const { data } = await sb.from('session_players')
    .select('session_id, game_sessions(challenge_id)')
    .eq('user_id', state.user.id)
    .not('game_sessions', 'is', null);
  state.completedIds = new Set(
    (data || []).map(d => d.game_sessions?.challenge_id).filter(Boolean)
  );
}

el('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearError('login-error');
  const email = el('login-email').value.trim();
  const pass  = el('login-password').value;
  showLoading();
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  hideLoading();
  if (error) { showError('login-error', error.message); return; }
  // auth state change will handle redirect
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
    options: { data: { display_name: name, username: name.toLowerCase().replace(/\s+/g,'_') } }
  });
  hideLoading();
  if (error) { showError('register-error', error.message); return; }
  const s = el('register-success');
  s.textContent = 'Check your email to confirm your account, then sign in.';
  s.classList.remove('hidden');
  el('register-form').reset();
});

el('forgot-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearError('forgot-error');
  const email = el('forgot-email').value.trim();
  showLoading();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}${location.pathname}#/profile`
  });
  hideLoading();
  if (error) { showError('forgot-error', error.message); return; }
  const s = el('forgot-success');
  s.textContent = 'Recovery link sent! Check your email.';
  s.classList.remove('hidden');
});

el('nav-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  state.user = null; state.profile = null;
  location.hash = '/';
});

el('nav-hamburger').addEventListener('click', () => {
  el('main-nav').classList.toggle('mobile-open');
});

// ── Challenge Page ─────────────────────
async function initChallengePage() {
  hide('challenge-card');
  show('challenge-draw-area');
  stopTimer();
}

el('btn-draw').addEventListener('click', drawChallenge);
el('btn-redraw').addEventListener('click', drawChallenge);

async function drawChallenge() {
  hide('challenge-card');
  hide('complete-success');
  stopTimer();

  const difficulties = [];
  if (el('f-easy').checked)   difficulties.push('Easy');
  if (el('f-medium').checked) difficulties.push('Medium');
  if (el('f-hard').checked)   difficulties.push('Hard');
  if (difficulties.length === 0) { showToast('Select at least one difficulty'); return; }

  const newOnly = el('f-new-only').checked;

  let query = sb.from('challenges').select('*').eq('is_visible', true).in('difficulty', difficulties);

  const { data: all } = await query;
  if (!all || all.length === 0) { showToast('No challenges found'); return; }

  let pool = newOnly ? all.filter(c => !state.completedIds.has(c.id)) : all;
  if (pool.length === 0) {
    showToast('No new challenges left! Try including completed ones.');
    pool = all;
  }

  const c = pool[Math.floor(Math.random() * pool.length)];
  state.currentChallenge = c;
  renderChallengeCard(c, 'challenge-weaves', 'challenge-difficulty', 'challenge-id', 'challenge-total');

  hide('complete-success');
  show('challenge-card');
  hide('challenge-draw-area');
  startTimer();
}

function renderChallengeCard(c, weavesId, diffId, idLabelId, totalId) {
  const weavesEl = el(weavesId);
  weavesEl.innerHTML = '';
  WEAVES.forEach(w => {
    const count = c[w.key];
    if (count > 0) {
      weavesEl.innerHTML += `
        <div class="weave-item">
          <img src="${w.img}" alt="${w.name}">
          <span class="weave-count">${count}</span>
          <span class="weave-name">${w.name}</span>
        </div>`;
    }
  });
  const diffEl = el(diffId);
  diffEl.textContent = c.difficulty || 'Challenge';
  diffEl.className = `difficulty-badge ${c.difficulty || ''}`;
  el(idLabelId).textContent = `#${c.id}`;
  el(totalId).textContent = c.weave_count;
}

// Timer
function startTimer() {
  stopTimer();
  state.timerStart = Date.now();
  state.timerMs = 0;
  el('timer-display').textContent = '0:00.0';
  hide('timer-result');
  hide('btn-stop-timer');

  // Delay showing stop button until timer starts
  setTimeout(() => show('btn-stop-timer'), 300);

  state.timerInterval = setInterval(() => {
    state.timerMs = Date.now() - state.timerStart;
    el('timer-display').textContent = formatTime(state.timerMs);
  }, 100);
}

function stopTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

el('btn-stop-timer').addEventListener('click', () => {
  stopTimer();
  hide('btn-stop-timer');
  const result = el('timer-result');
  result.textContent = `Time: ${formatTime(state.timerMs)}`;
  result.classList.remove('hidden');
});

el('btn-complete').addEventListener('click', async () => {
  if (!state.currentChallenge || !state.user) return;
  stopTimer();

  showLoading();
  // Create a solo session
  const { data: session } = await sb.from('game_sessions').insert({
    challenge_id: state.currentChallenge.id,
    host_user_id: state.user.id,
    started_at: new Date(state.timerStart || Date.now()).toISOString(),
    completed_at: new Date().toISOString(),
    is_solo: true,
  }).select().single();

  if (session) {
    await sb.from('session_players').insert({
      session_id: session.id,
      user_id: state.user.id,
      display_name: state.profile?.display_name || 'You',
      is_winner: true,
      completion_time_ms: state.timerMs || null,
    });
    state.completedIds.add(state.currentChallenge.id);
  }
  hideLoading();
  show('complete-success');
  hide('btn-complete');
  showToast('Challenge complete! ⬡');
});

// ── Challenge List ─────────────────────
async function initChallengeList() {
  const { data } = await sb.from('challenges').select('*').eq('is_visible', true).order('difficulty').order('weave_count');
  if (!data) return;

  const render = () => {
    const showCompleted = el('cl-completed').checked;
    const showNew = el('cl-new').checked;
    const diffs = [];
    if (el('cl-easy').checked) diffs.push('Easy');
    if (el('cl-medium').checked) diffs.push('Medium');
    if (el('cl-hard').checked) diffs.push('Hard');

    const filtered = data.filter(c => {
      if (!diffs.includes(c.difficulty)) return false;
      const done = state.completedIds.has(c.id);
      if (done && !showCompleted) return false;
      if (!done && !showNew) return false;
      return true;
    });

    const grid = el('challenges-list-grid');
    grid.innerHTML = filtered.length === 0
      ? '<p class="empty-state" style="color:var(--text-light);text-align:center;padding:2rem">No challenges match your filters.</p>'
      : filtered.map(c => {
          const done = state.completedIds.has(c.id);
          const weaveHtml = WEAVES.filter(w => c[w.key] > 0).map(w =>
            `<span class="tile-weave"><img src="${w.img}" alt="${w.name}"> ×${c[w.key]}</span>`
          ).join('');
          return `<div class="challenge-tile parchment ${done ? 'completed' : ''}" data-id="${c.id}">
            <div class="tile-header">
              <span class="difficulty-badge ${c.difficulty}">${c.difficulty}</span>
              <span style="font-size:0.75rem;color:var(--text-mid)">#${c.id}</span>
            </div>
            <div class="tile-weaves">${weaveHtml}</div>
            <div class="tile-total">Total: ${c.weave_count} weaves</div>
          </div>`;
        }).join('');
  };

  render();
  ['cl-easy','cl-medium','cl-hard','cl-completed','cl-new'].forEach(id =>
    el(id).addEventListener('change', render)
  );
}

// ── Game Session ──────────────────────
function initGame() {
  state.gamePlayers = [];
  if (state.user && state.profile) {
    state.gamePlayers = [{ name: state.profile.display_name || state.profile.username, user_id: state.user.id }];
  }
  hide('game-active');
  hide('game-finish');
  show('game-setup');
  renderPlayersList();
}

function renderPlayersList() {
  const list = el('players-list');
  list.innerHTML = state.gamePlayers.map((p, i) =>
    `<div class="player-item">
      <span>${p.name}${p.user_id ? ' ✓' : ''}</span>
      ${i > 0 ? `<button class="remove-player" data-i="${i}">✕</button>` : ''}
    </div>`
  ).join('');
  list.querySelectorAll('.remove-player').forEach(btn =>
    btn.addEventListener('click', () => {
      state.gamePlayers.splice(Number(btn.dataset.i), 1);
      renderPlayersList();
    })
  );
}

el('btn-add-player').addEventListener('click', () => {
  const name = el('add-player-name').value.trim();
  if (!name) return;
  state.gamePlayers.push({ name, user_id: null });
  el('add-player-name').value = '';
  renderPlayersList();
});

// Show friend suggestions as user types
el('add-player-name').addEventListener('input', async () => {
  const q = el('add-player-name').value.trim();
  const suggestEl = el('friend-suggestions');
  if (q.length < 2 || !state.user) { suggestEl.classList.add('hidden'); return; }

  const { data } = await sb.from('profiles').select('id, display_name, username')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq('id', state.user.id).limit(5);

  if (!data || data.length === 0) { suggestEl.classList.add('hidden'); return; }
  suggestEl.classList.remove('hidden');
  suggestEl.innerHTML = data.map(p =>
    `<div class="friend-item" style="cursor:pointer" data-id="${p.id}" data-name="${p.display_name || p.username}">
      <span>${p.display_name || p.username}</span><span style="font-size:0.8rem;color:var(--text-mid)">@${p.username}</span>
    </div>`
  ).join('');
  suggestEl.querySelectorAll('.friend-item').forEach(item =>
    item.addEventListener('click', () => {
      state.gamePlayers.push({ name: item.dataset.name, user_id: item.dataset.id });
      el('add-player-name').value = ''; suggestEl.classList.add('hidden');
      renderPlayersList();
    })
  );
});

el('btn-start-game').addEventListener('click', async () => {
  if (state.gamePlayers.length < 1) { showToast('Add at least one player'); return; }
  const difficulties = ['Easy','Medium','Hard'];
  const { data: all } = await sb.from('challenges').select('*').eq('is_visible', true).in('difficulty', difficulties);
  if (!all || all.length === 0) return;
  state.gameChallenge = all[Math.floor(Math.random() * all.length)];

  const card = el('game-challenge-card');
  card.innerHTML = `<div class="challenge-header">
    <span class="difficulty-badge ${state.gameChallenge.difficulty}">${state.gameChallenge.difficulty}</span>
    <span class="challenge-id-label">#${state.gameChallenge.id}</span>
  </div>
  <div id="game-weaves-grid" class="weaves-grid"></div>
  <div class="challenge-total">Total Weaves: <strong>${state.gameChallenge.weave_count}</strong></div>`;
  WEAVES.forEach(w => {
    if (state.gameChallenge[w.key] > 0) {
      el('game-weaves-grid').innerHTML += `<div class="weave-item">
        <img src="${w.img}" alt="${w.name}">
        <span class="weave-count">${state.gameChallenge[w.key]}</span>
        <span class="weave-name">${w.name}</span>
      </div>`;
    }
  });

  hide('game-setup');
  show('game-active');

  // Start game timer
  let ms = 0;
  state.gameTimerStart = Date.now();
  state.gameTimerInterval = setInterval(() => {
    ms = Date.now() - state.gameTimerStart;
    el('game-timer').textContent = formatTime(ms);
  }, 100);
});

el('btn-game-stop').addEventListener('click', () => {
  clearInterval(state.gameTimerInterval);
  hide('game-active');

  // Populate winner select
  const sel = el('game-winner-select');
  sel.innerHTML = state.gamePlayers.map((p, i) =>
    `<option value="${i}">${p.name}</option>`
  ).join('');

  show('game-finish');
});

el('game-photo-upload').addEventListener('change', () => {
  const file = el('game-photo-upload').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = el('photo-preview');
    preview.innerHTML = `<img src="${e.target.result}" alt="Knot photo">`;
    preview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

el('btn-save-game').addEventListener('click', async () => {
  showLoading();
  const winnerIdx = Number(el('game-winner-select').value);
  const winnerPlayer = state.gamePlayers[winnerIdx];
  const elapsed = state.gameTimerStart ? Date.now() - state.gameTimerStart : 0;

  // Upload photo if present
  let photoUrl = null;
  const file = el('game-photo-upload').files[0];
  if (file && state.user) {
    const ext = file.name.split('.').pop();
    const path = `${state.user.id}/${Date.now()}.${ext}`;
    const { data: upload } = await sb.storage.from('knot-photos').upload(path, file);
    if (upload) {
      const { data: urlData } = sb.storage.from('knot-photos').getPublicUrl(path);
      photoUrl = urlData.publicUrl;
    }
  }

  // Save session
  const { data: session } = await sb.from('game_sessions').insert({
    challenge_id: state.gameChallenge?.id,
    host_user_id: state.user?.id || null,
    started_at: state.gameTimerStart ? new Date(state.gameTimerStart).toISOString() : new Date().toISOString(),
    completed_at: new Date().toISOString(),
    is_solo: state.gamePlayers.length === 1,
    knot_photo_url: photoUrl,
  }).select().single();

  if (session) {
    for (const [i, p] of state.gamePlayers.entries()) {
      await sb.from('session_players').insert({
        session_id: session.id,
        user_id: p.user_id || null,
        display_name: p.name,
        is_winner: i === winnerIdx,
        completion_time_ms: i === winnerIdx ? elapsed : null,
      });
    }
    state.completedIds.add(state.gameChallenge?.id);
  }

  hideLoading();
  show('game-save-success');
  showToast('Game saved! ⬡');
  setTimeout(() => location.hash = '/history', 2000);
});

// ── History ────────────────────────────
async function initHistory() {
  if (!state.user) return;
  showLoading();

  const { data: sessions } = await sb.from('game_sessions')
    .select('*, challenges(*), session_players(*)')
    .or(`host_user_id.eq.${state.user.id}`)
    .order('created_at', { ascending: false })
    .limit(30);

  hideLoading();
  const list = el('history-list');

  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<p class="empty-state" style="color:var(--text-light);text-align:center;padding:3rem">No games yet. Play your first challenge!</p>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const c = s.challenges;
    const players = s.session_players || [];
    const winner = players.find(p => p.is_winner);
    const timeStr = winner?.completion_time_ms ? `in ${formatTime(winner.completion_time_ms)}` : '';
    const date = new Date(s.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const photoHtml = s.knot_photo_url
      ? `<div class="history-photo"><img src="${s.knot_photo_url}" alt="Knot photo"></div>` : '';
    const weaveStr = c ? WEAVES.filter(w => c[w.key] > 0).map(w => `${c[w.key]}×${w.name}`).join(', ') : '';
    return `<div class="history-item parchment">
      <h4>${c ? `Challenge #${c.id}` : 'Game'} — ${c?.difficulty || ''} ${timeStr}</h4>
      <div class="history-meta">
        ${date} · ${s.is_solo ? 'Solo' : `${players.length} players`}
        ${winner ? ` · Winner: ${winner.display_name}` : ''}
        ${weaveStr ? `<br>${weaveStr} (${c?.weave_count} total)` : ''}
      </div>
      ${photoHtml}
    </div>`;
  }).join('');
}

// ── Friends ────────────────────────────
async function initFriends() {
  if (!state.user) return;
  showLoading();

  const { data: fr } = await sb.from('friendships')
    .select('*, requester:profiles!requester_id(id,display_name,username), addressee:profiles!addressee_id(id,display_name,username)')
    .or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`);

  hideLoading();

  const accepted = (fr||[]).filter(f => f.status === 'accepted');
  const pending = (fr||[]).filter(f => f.status === 'pending');

  const friendsList = el('friends-list');
  friendsList.innerHTML = accepted.length === 0
    ? '<p class="empty-state">Your circle is empty. Search for druids to invite!</p>'
    : accepted.map(f => {
        const other = f.requester_id === state.user.id ? f.addressee : f.requester;
        return `<div class="friend-item">
          <span class="friend-item-name">${other?.display_name || other?.username}</span>
          <span style="font-size:0.8rem;color:var(--text-mid)">@${other?.username || ''}</span>
        </div>`;
      }).join('');

  const pendingList = el('pending-list');
  pendingList.innerHTML = pending.length === 0
    ? '<p class="empty-state">No pending invitations.</p>'
    : pending.map(f => {
        const isIncoming = f.addressee_id === state.user.id;
        const other = isIncoming ? f.requester : f.addressee;
        return `<div class="friend-item">
          <span class="friend-item-name">${other?.display_name || other?.username} ${isIncoming ? '(invited you)' : '(pending)'}</span>
          ${isIncoming
            ? `<button class="btn-primary" style="padding:0.3rem 0.8rem;font-size:0.8rem" onclick="acceptFriend('${f.id}')">Accept</button>`
            : ''}
        </div>`;
      }).join('');
}

window.acceptFriend = async (id) => {
  await sb.from('friendships').update({ status: 'accepted' }).eq('id', id);
  showToast('Friend accepted!');
  initFriends();
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
  if (!data || data.length === 0) {
    results.innerHTML = '<p class="empty-state">No druids found.</p>'; return;
  }
  results.innerHTML = data.map(p =>
    `<div class="friend-item">
      <div><span class="friend-item-name">${p.display_name || p.username}</span> <span style="font-size:0.8rem;color:var(--text-mid)">@${p.username}</span></div>
      <button class="btn-secondary" style="padding:0.3rem 0.8rem;font-size:0.8rem" onclick="inviteFriend('${p.id}', '${p.display_name || p.username}')">Invite</button>
    </div>`
  ).join('');
}

window.inviteFriend = async (id, name) => {
  const { error } = await sb.from('friendships').insert({ requester_id: state.user.id, addressee_id: id });
  if (error) { showToast(error.message.includes('unique') ? 'Already in your circle.' : error.message); return; }
  showToast(`Invitation sent to ${name}!`);
};

// ── Profile ────────────────────────────
async function initProfile() {
  if (!state.profile) return;
  el('profile-name').value = state.profile.display_name || '';
  el('profile-username').value = state.profile.username || '';

  // Stats
  const { count: completed } = await sb.from('session_players').select('*', { count:'exact', head:true })
    .eq('user_id', state.user.id);
  const { count: games } = await sb.from('session_players').select('*', { count:'exact', head:true })
    .eq('user_id', state.user.id);
  const { count: wins } = await sb.from('session_players').select('*', { count:'exact', head:true })
    .eq('user_id', state.user.id).eq('is_winner', true);
  el('stat-completed').textContent = completed || 0;
  el('stat-games').textContent = games || 0;
  el('stat-wins').textContent = wins || 0;
}

el('btn-save-profile').addEventListener('click', async () => {
  const name = el('profile-name').value.trim();
  const username = el('profile-username').value.trim().toLowerCase().replace(/\s+/g,'_');
  if (!name || !username) return;
  showLoading();
  const { error } = await sb.from('profiles').update({ display_name: name, username, updated_at: new Date().toISOString() }).eq('id', state.user.id);
  hideLoading();
  if (error) { showToast(error.message); return; }
  state.profile.display_name = name;
  state.profile.username = username;
  el('nav-username').textContent = name;
  show('profile-success');
  setTimeout(() => hide('profile-success'), 2500);
});

// ── Admin ──────────────────────────────
async function initAdmin() {
  if (!state.user) return;
  showLoading();
  const { data } = await sb.from('challenges').select('*').order('id');
  hideLoading();
  if (!data) return;

  const wrap = el('admin-challenges-table');
  wrap.innerHTML = `<table class="admin-table">
    <thead><tr>
      <th>#</th><th>Loop</th><th>Span</th><th>Cross</th><th>Bend</th><th>Branch</th>
      <th>Difficulty</th><th>Weaves</th><th>For Dual</th><th>Visible</th>
    </tr></thead>
    <tbody>
      ${data.map(c => `<tr>
        <td>${c.id}</td>
        <td>${c.loop_count}</td><td>${c.span_count}</td><td>${c.cross_count}</td>
        <td>${c.bend_count}</td><td>${c.branch_count}</td>
        <td><span class="difficulty-badge ${c.difficulty}">${c.difficulty||'—'}</span></td>
        <td>${c.weave_count}</td>
        <td>${c.for_dual ? '✓' : ''}</td>
        <td>
          <label style="cursor:pointer">
            <input type="checkbox" ${c.is_visible ? 'checked' : ''}
              onchange="toggleVisible(${c.id}, this.checked)">
          </label>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

window.toggleVisible = async (id, visible) => {
  await sb.from('challenges').update({ is_visible: visible }).eq('id', id);
  showToast(visible ? 'Challenge visible' : 'Challenge hidden');
};

// ── Boot ───────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  state.user = session?.user ?? null;
  if (state.user) {
    await loadProfile();
  }
  route();
});

window.addEventListener('hashchange', route);

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user ?? null;
  if (state.user) await loadProfile();
  hideLoading();
  route();
})();
