// app.js - simple live tracker / UI
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const goBtn = document.getElementById('goBtn');
const useRepoBtn = document.getElementById('useRepoBtn');
const leaguesInput = document.getElementById('leaguesInput');

goBtn.onclick = () => startLive();
useRepoBtn.onclick = () => loadRepoJSON();

function setStatus(msg) { statusEl.innerText = msg; }

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function loadRepoJSON() {
  setStatus('Trying to load data/results.json from the site...');
  try {
    const data = await fetchJSON('/data/results.json');
    setStatus('Loaded data/results.json — rendering.');
    renderFromResults(data);
  } catch (err) {
    setStatus('No data/results.json found on the site. Try the Fetch & Compare button or set up scheduled updates.');
    console.error(err);
  }
}

async function startLive() {
  const raw = (leaguesInput.value || '').trim();
  let leagues = null;
  if (raw) {
    leagues = raw.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    setStatus('No league IDs in the input. Attempting to load leagues.json from repo root...');
    try {
      leagues = await fetchJSON('/leagues.json');
    } catch (err) {
      setStatus('Please paste league IDs into the input or create leagues.json in the repo.');
      return;
    }
  }
  setStatus('Fetching current NFL state to determine week...');
  try {
    const state = await fetchJSON('https://api.sleeper.app/v1/state/nfl');
    const maxWeek = Math.max(1, state.week || 18);
    setStatus(`Will pull transactions for weeks 1 → ${maxWeek}. This may take a bit.`);
    const results = {};
    for (const lid of leagues) {
      results[lid] = await fetchLeagueTransactions(lid, maxWeek);
    }
    const players = await getPlayersMap();
    const summary = buildSummary(results, players);
    renderFromResults(summary); // summary is league->player metrics
    setStatus('Done. Table below shows computed scores (adds/trades/drops).');
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('Failed to fetch')) {
      setStatus('Network/CORS error while fetching the Sleeper API. See troubleshooting notes below.');
    } else {
      setStatus('Error: ' + err.message);
    }
  }
}

async function fetchLeagueTransactions(leagueId, maxWeek) {
  const txs = [];
  for (let week = 1; week <= maxWeek; week++) {
    const url = `https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) txs.push(...data);
    } catch (err) {
      // Could be CORS or network; bubble up if everything fails
      console.warn('fetch tx error', leagueId, week, err);
    }
  }
  return txs;
}

async function getPlayersMap() {
  // Cache players map in localStorage for 24h (large payload ~5MB)
  const key = 'sleeper_players_cache';
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts < 24 * 3600 * 1000) {
        return parsed.data;
      }
    }
  } catch(e){ /* ignore */ }

  const url = 'https://api.sleeper.app/v1/players/nfl';
  const players = await (await fetch(url)).json();
localStorage.setItem("sleeper_players_cache", JSON.stringify(players));
  return players;
}

function buildSummary(resultsByLeague, players) {
  const out = {};
  for (const [leagueId, txs] of Object.entries(resultsByLeague)) {
    const metrics = {};
    for (const t of txs) {
      if (!t || !t.type) continue;
      if (t.adds) {
        for (const [pid, val] of Object.entries(t.adds)) {
          const m = metrics[pid] = metrics[pid] || {adds:0,trades:0,drops:0};
          m.adds += Number(val) || 1;
        }
      }
      if (t.drops) {
        for (const [pid, val] of Object.entries(t.drops)) {
          const m = metrics[pid] = metrics[pid] || {adds:0,trades:0,drops:0};
          m.drops += Number(val) || 1;
        }
      }
      if (t.type === 'trade') {
        // Some trades may include adds mapping for player side of trade
        if (t.adds) {
          for (const pid of Object.keys(t.adds)) {
            const m = metrics[pid] = metrics[pid] || {adds:0,trades:0,drops:0};
            m.trades += 1;
          }
        }
        // if trades only contain draft picks, we won't assign player trade counts
      }
    }
    // produce sorted array with names
    const arr = Object.entries(metrics).map(([pid, m]) => {
      const p = players && players[pid];
      const name = p ? `${p.first_name} ${p.last_name}` : pid;
      const score = (m.adds || 0) * 1 + (m.trades || 0) * 3; // simple weights: add=1, trade=3
      return {player_id: pid, name, adds: m.adds, trades: m.trades, drops: m.drops, score};
    }).sort((a,b) => b.score - a.score);
    out[leagueId] = arr;
  }
  return out;
}

function renderFromResults(data) {
  resultsEl.innerHTML = '';
  for (const [leagueId, arr] of Object.entries(data)) {
    const h = document.createElement('h2');
    h.innerText = `League ${leagueId}`;
    resultsEl.appendChild(h);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Player</th><th>Score</th><th>Adds</th><th>Trades</th><th>Drops</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const r of arr.slice(0, 200)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.name}</td><td>${r.score}</td><td>${r.adds||0}</td><td>${r.trades||0}</td><td>${r.drops||0}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    resultsEl.appendChild(table);
  }
}
