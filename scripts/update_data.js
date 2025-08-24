// scripts/update_data.js
// Node 18+ (GitHub Actions runners include Node 18/20)
const fs = require('fs/promises');

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

(async () => {
  try {
    const leaguesRaw = await fs.readFile('leagues.json', 'utf8');
    const leagues = JSON.parse(leaguesRaw);
    const state = await fetchJSON('https://api.sleeper.app/v1/state/nfl');
    const maxWeek = Math.max(1, state.week || 18);

    const players = await fetchJSON('https://api.sleeper.app/v1/players/nfl'); // ~5MB
    const output = {};

    for (const lid of leagues) {
      console.log('Fetching league', lid);
      const txs = [];
      for (let w=1; w<=maxWeek; w++) {
        const url = `https://api.sleeper.app/v1/league/${lid}/transactions/${w}`;
        try {
          const data = await fetchJSON(url);
          if (Array.isArray(data) && data.length) txs.push(...data);
        } catch (e) {
          console.warn('week fetch err', lid, w, e.message);
        }
      }

      // compute metrics (same logic as client)
      const metrics = {};
      for (const t of txs) {
        if (!t) continue;
        if (t.adds) for (const [pid, val] of Object.entries(t.adds)) {
          const m = metrics[pid] ||= {adds:0,trades:0,drops:0};
          m.adds += Number(val) || 1;
        }
        if (t.drops) for (const [pid, val] of Object.entries(t.drops)) {
          const m = metrics[pid] ||= {adds:0,trades:0,drops:0};
          m.drops += Number(val) || 1;
        }
        if (t.type === 'trade' && t.adds) {
          for (const pid of Object.keys(t.adds)) {
            const m = metrics[pid] ||= {adds:0,trades:0,drops:0};
            m.trades += 1;
          }
        }
      }

      const summary = Object.entries(metrics).map(([pid, m]) => {
        const p = players[pid];
        const name = p ? `${p.first_name} ${p.last_name}` : pid;
        return { player_id: pid, name, adds: m.adds, trades: m.trades, drops: m.drops, score: (m.adds||0) * 1 + (m.trades||0) * 3 };
      }).sort((a,b) => b.score - a.score);

      output[lid] = { league_id: lid, computed_at: new Date().toISOString(), summary };
    }

    await fs.mkdir('data', { recursive: true });
    await fs.writeFile('data/results.json', JSON.stringify(output, null, 2));
    console.log('Wrote data/results.json');
    process.exit(0);
  } catch (err) {
    console.error('Error in update script', err);
    process.exit(1);
  }
})();
