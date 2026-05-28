/**
 * simulate.js — Monte Carlo & 7-day portfolio simulation for Charon strategies
 *
 * Part 1: Per-trade analysis (10 000 trades/strategy) — quick sanity check
 * Part 2: 7-day portfolio simulation (500 runs/strategy, 2 SOL starting capital)
 *         Models signal arrival rate, capital constraints, concurrent positions,
 *         compounding, daily equity curve, and risk metrics.
 *
 * Run with: node simulate.js
 * No API keys or database required — fully self-contained.
 */

// ─── PRNG (mulberry32 — fast, seedable) ──────────────────────────────────────

function makePrng(seed) {
  let s = (seed + 1) >>> 0;
  return function rand() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function makeRandNorm(rand) {
  return function randNorm() {
    let u;
    do { u = rand(); } while (u === 0);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t)    { return a + (b - a) * clamp(t, 0, 1); }
function sol(n)  { return n.toFixed(4); }
function pct(n, d = 1) { const s = n >= 0 ? '+' : ''; return `${s}${n.toFixed(d)}%`; }
function pad(s, w, r = false) { s = String(s); return r ? s.padEnd(w) : s.padStart(w); }
function bar(v, max, w = 30) {
  const f = Math.round(clamp(v / max, 0, 1) * w);
  return '█'.repeat(f) + '░'.repeat(w - f);
}

// ─── Price path archetypes ────────────────────────────────────────────────────
// 1-minute candles up to 720 steps (12 h). price[0] = 1.0 (entry).

function generatePricePath(archetype, peakMultiple, rand, randNorm) {
  const N = 720;
  const path = new Float64Array(N + 1);
  path[0] = 1.0;
  let p = 1.0;

  switch (archetype) {
    case 'immediate_rug': {
      const peakAt = 3 + Math.floor(rand() * 12);
      const peakPx = 1.0 + rand() * 0.20;
      const rugAt  = peakAt + 10 + Math.floor(rand() * 30);
      const floor  = 0.02 + rand() * 0.08;
      for (let t = 1; t <= N; t++) {
        if      (t <= peakAt) p = lerp(1.0, peakPx, t / peakAt);
        else if (t <= rugAt)  p = lerp(peakPx, floor, (t - peakAt) / (rugAt - peakAt));
        else    p = floor * (1 + (rand() - 0.5) * 0.08);
        path[t] = Math.max(p, 0.001);
      }
      break;
    }
    case 'slow_bleed': {
      const peakAt = 10 + Math.floor(rand() * 60);
      const peakPx = 1.0 + rand() * 0.5;
      const settle = 0.15 + rand() * 0.35;
      for (let t = 1; t <= N; t++) {
        if (t <= peakAt) p = lerp(1.0, peakPx, t / peakAt);
        else {
          const d = (t - peakAt) / (N - peakAt);
          p = lerp(peakPx, settle, Math.pow(d, 0.6)) + randNorm() * 0.025;
        }
        path[t] = Math.max(p, 0.01);
      }
      break;
    }
    case 'pump_dump': {
      const peak   = peakMultiple;
      const peakAt = 20 + Math.floor(rand() * 90);
      const dumpD  = 20 + Math.floor(rand() * 60);
      const floor  = 0.25 + rand() * 0.35;
      for (let t = 1; t <= N; t++) {
        if (t <= peakAt)
          p = 1.0 + (peak - 1.0) * Math.pow(t / peakAt, 0.65) + randNorm() * 0.015;
        else if (t <= peakAt + dumpD)
          p = lerp(peak, floor, Math.pow((t - peakAt) / dumpD, 0.5)) + randNorm() * 0.02;
        else
          p = floor * (1 + (rand() - 0.5) * 0.12);
        path[t] = Math.max(p, 0.01);
      }
      break;
    }
    case 'runner': {
      const peak    = peakMultiple;
      const peakAt  = 60 + Math.floor(rand() * 180);
      const retrace = 0.20 + rand() * 0.30;
      const retAt   = peakAt + 20 + Math.floor(rand() * 80);
      const settle  = peak * (1 - retrace) * (0.75 + rand() * 0.25);
      for (let t = 1; t <= N; t++) {
        if (t <= peakAt)
          p = 1.0 + (peak - 1.0) * Math.pow(t / peakAt, 0.55) + randNorm() * 0.025;
        else if (t <= retAt)
          p = lerp(peak, peak * (1 - retrace), (t - peakAt) / (retAt - peakAt)) + randNorm() * 0.03;
        else
          p = settle + randNorm() * 0.04;
        path[t] = Math.max(p, 0.1);
      }
      break;
    }
    case 'moon': {
      const p1   = peakMultiple * (0.5 + rand() * 0.3);
      const p1At = 30 + Math.floor(rand() * 120);
      const ret  = 0.25 + rand() * 0.30;
      const retAt = p1At + 30 + Math.floor(rand() * 90);
      const p2   = peakMultiple * (1 + rand() * 0.5);
      const p2At = retAt + 60 + Math.floor(rand() * 120);
      const sett = p2 * (0.55 + rand() * 0.3);
      const bot  = p1 * (1 - ret);
      for (let t = 1; t <= N; t++) {
        if (t <= p1At)
          p = 1.0 + (p1 - 1.0) * Math.pow(t / p1At, 0.45) + randNorm() * 0.03;
        else if (t <= retAt)
          p = lerp(p1, bot, (t - p1At) / (retAt - p1At)) + randNorm() * 0.03;
        else if (t <= p2At)
          p = lerp(bot, p2, Math.pow((t - retAt) / (p2At - retAt), 0.45)) + randNorm() * 0.04;
        else
          p = sett + randNorm() * 0.05;
        path[t] = Math.max(p, 0.1);
      }
      break;
    }
    case 'flat': {
      for (let t = 1; t <= N; t++) {
        p = Math.max(1.0 + randNorm() * 0.04 * Math.sqrt(t / 30) - t * 0.0003, 0.1);
        path[t] = p;
      }
      break;
    }
  }
  return path;
}

// ─── Dynamic trailing (mirrors execution/positions.js) ───────────────────────

function getDynamicTrailing(base, hwPnl) {
  const b = Math.abs(base);
  if (hwPnl >= 500) return Math.max(b * 0.45, 8);
  if (hwPnl >= 300) return Math.max(b * 0.55, 9);
  if (hwPnl >= 150) return Math.max(b * 0.65, 10);
  if (hwPnl >= 75)  return Math.max(b * 0.75, 11);
  if (hwPnl >= 40)  return Math.max(b * 0.85, 12);
  return b;
}

// ─── Strategy configs ─────────────────────────────────────────────────────────

const STRATEGIES = {
  sniper: {
    label: 'Sniper',
    tp_percent: 50,  sl_percent: -25,
    trailing_enabled: true,  trailing_from_entry: false,
    trailing_percent: 20,    tiered_trailing: false,
    partial_tp: false, partial_tp_at_percent: 0, partial_tp_sell_percent: 0,
    partial_tp_2: false, partial_tp_2_at_percent: 0, partial_tp_2_sell_percent: 0,
    position_size_sol: 0.10, max_open_positions: 3,
  },
  dip_buy: {
    label: 'Dip Buy',
    tp_percent: 30,  sl_percent: -20,
    trailing_enabled: true,  trailing_from_entry: false,
    trailing_percent: 15,    tiered_trailing: false,
    partial_tp: false, partial_tp_at_percent: 0, partial_tp_sell_percent: 0,
    partial_tp_2: false, partial_tp_2_at_percent: 0, partial_tp_2_sell_percent: 0,
    position_size_sol: 0.05, max_open_positions: 3,
  },
  smart_money: {
    label: 'Smart Money',
    tp_percent: 100, sl_percent: -25,
    trailing_enabled: false, trailing_from_entry: false,
    trailing_percent: 0,     tiered_trailing: false,
    partial_tp: true, partial_tp_at_percent: 100, partial_tp_sell_percent: 50,
    partial_tp_2: false, partial_tp_2_at_percent: 0, partial_tp_2_sell_percent: 0,
    position_size_sol: 0.10, max_open_positions: 3,
  },
  degen: {
    label: 'Degen',
    tp_percent: 30,  sl_percent: -15,
    trailing_enabled: true,  trailing_from_entry: false,
    trailing_percent: 10,    tiered_trailing: false,
    partial_tp: false, partial_tp_at_percent: 0, partial_tp_sell_percent: 0,
    partial_tp_2: false, partial_tp_2_at_percent: 0, partial_tp_2_sell_percent: 0,
    position_size_sol: 0.05, max_open_positions: 5,
  },
  moon_bag: {
    label: 'Moon Bag',
    tp_percent: 50,  sl_percent: -22,
    trailing_enabled: true,  trailing_from_entry: true,
    trailing_percent: 22,    tiered_trailing: true,
    partial_tp: true, partial_tp_at_percent: 100, partial_tp_sell_percent: 25,
    partial_tp_2: true, partial_tp_2_at_percent: 300, partial_tp_2_sell_percent: 25,
    position_size_sol: 0.10, max_open_positions: 3,
  },
  momentum_rocket: {
    label: 'Momentum Rocket',
    tp_percent: 75,  sl_percent: -18,
    trailing_enabled: true,  trailing_from_entry: true,
    trailing_percent: 18,    tiered_trailing: true,
    partial_tp: true, partial_tp_at_percent: 75, partial_tp_sell_percent: 30,
    partial_tp_2: true, partial_tp_2_at_percent: 250, partial_tp_2_sell_percent: 25,
    position_size_sol: 0.12, max_open_positions: 2,
  },
};

// ─── Archetype distributions per strategy ────────────────────────────────────

const ARCHETYPE_DISTS = {
  sniper:           { immediate_rug: 0.20, slow_bleed: 0.20, pump_dump: 0.30, runner: 0.22, moon: 0.06, flat: 0.02 },
  dip_buy:          { immediate_rug: 0.04, slow_bleed: 0.28, pump_dump: 0.36, runner: 0.24, moon: 0.06, flat: 0.02 },
  smart_money:      { immediate_rug: 0.12, slow_bleed: 0.22, pump_dump: 0.29, runner: 0.27, moon: 0.07, flat: 0.03 },
  degen:            { immediate_rug: 0.44, slow_bleed: 0.22, pump_dump: 0.20, runner: 0.10, moon: 0.02, flat: 0.02 },
  moon_bag:         { immediate_rug: 0.10, slow_bleed: 0.17, pump_dump: 0.27, runner: 0.29, moon: 0.13, flat: 0.04 },
  momentum_rocket:  { immediate_rug: 0.16, slow_bleed: 0.18, pump_dump: 0.27, runner: 0.28, moon: 0.08, flat: 0.03 },
};

const PEAK_RANGES = {
  sniper:           { pump_dump: [1.5, 4.0], runner: [2.5,  9.0], moon: [6.0,  25.0] },
  dip_buy:          { pump_dump: [1.4, 3.0], runner: [2.0,  7.0], moon: [4.0,  18.0] },
  smart_money:      { pump_dump: [1.3, 3.0], runner: [2.0,  6.0], moon: [4.0,  15.0] },
  degen:            { pump_dump: [1.4, 3.5], runner: [2.0,  8.0], moon: [5.0,  20.0] },
  moon_bag:         { pump_dump: [1.5, 4.5], runner: [3.0, 12.0], moon: [8.0,  40.0] },
  momentum_rocket:  { pump_dump: [1.4, 4.0], runner: [2.5, 10.0], moon: [6.0,  30.0] },
};

// Qualifying signals that pass all filters per strategy (per day)
// Calibrated to post-fix Moon Bag (min_source_count=2) and real Solana market activity
const DAILY_SIGNAL_RATES = {
  sniper:           8,   // fee+graduated, decent filter
  dip_buy:          4,   // ATH dip required — rarer
  smart_money:      6,   // holders+volume filter
  degen:            28,  // very loose — catches everything
  moon_bag:         10,  // fee+(grad or trending) — now practical after fix
  momentum_rocket:  5,   // hot_level + smart_degen — selective
};

// ─── Archetype sampler ────────────────────────────────────────────────────────

function sampleArchetype(dist, rand) {
  let cum = 0, r = rand();
  for (const [k, p] of Object.entries(dist)) { cum += p; if (r < cum) return k; }
  return 'flat';
}

function samplePeak(archetype, ranges, rand) {
  const r = ranges[archetype];
  return r ? r[0] + rand() * (r[1] - r[0]) : 1.5;
}

// ─── Per-trade exit logic ─────────────────────────────────────────────────────
// Runs the full price path through exit logic; returns { pnl%, reason, hwPnl }.

function simulateTrade(strategy, pricePath) {
  const { tp_percent, sl_percent, trailing_enabled, trailing_from_entry, trailing_percent,
          tiered_trailing, partial_tp, partial_tp_at_percent, partial_tp_sell_percent,
          partial_tp_2, partial_tp_2_at_percent, partial_tp_2_sell_percent } = strategy;

  let hw = 1.0, armed = Boolean(trailing_from_entry);
  let pt1 = false, pt2 = false, locked = 0, rem = 1.0;

  for (let i = 0; i < pricePath.length; i++) {
    const px = pricePath[i];
    const pnl = (px - 1.0) * 100;
    if (px > hw) hw = px;
    const hwPnl = (hw - 1.0) * 100;

    if (!armed && trailing_enabled && pnl >= tp_percent) armed = true;

    if (partial_tp && !pt1 && pnl >= partial_tp_at_percent) {
      pt1 = true;
      const f = partial_tp_sell_percent / 100;
      locked += f * pnl; rem -= f;
    }
    if (partial_tp_2 && !pt2 && pnl >= partial_tp_2_at_percent) {
      pt2 = true;
      const f = (partial_tp_2_sell_percent / 100) * rem;
      locked += f * pnl; rem -= f;
    }

    if (pnl <= sl_percent)
      return { pnl: locked + rem * pnl, reason: 'SL', hwPnl };
    if (!trailing_enabled && pnl >= tp_percent)
      return { pnl: locked + rem * pnl, reason: 'TP', hwPnl };
    if (armed && trailing_enabled) {
      const trail = tiered_trailing ? getDynamicTrailing(trailing_percent, hwPnl) : Math.abs(trailing_percent);
      if ((px / hw - 1) * 100 <= -trail)
        return { pnl: locked + rem * pnl, reason: 'TRAILING_TP', hwPnl };
    }
  }
  const last = pricePath[pricePath.length - 1];
  const hwPnl = (hw - 1.0) * 100;
  return { pnl: locked + rem * ((last - 1.0) * 100), reason: 'TIME_EXIT', hwPnl };
}

// ─── Per-trade Monte Carlo ────────────────────────────────────────────────────

function runTradeMC(strategyId, N, rand, randNorm) {
  const strat = STRATEGIES[strategyId];
  const dist  = ARCHETYPE_DISTS[strategyId];
  const peaks = PEAK_RANGES[strategyId];
  const pnls  = [];
  const reasons = {};

  for (let i = 0; i < N; i++) {
    const arch   = sampleArchetype(dist, rand);
    const peak   = samplePeak(arch, peaks, rand);
    const path   = generatePricePath(arch, peak, rand, randNorm);
    const trade  = simulateTrade(strat, path);
    pnls.push(trade.pnl);
    reasons[trade.reason] = (reasons[trade.reason] || 0) + 1;
  }
  pnls.sort((a, b) => a - b);
  const sum = pnls.reduce((s, v) => s + v, 0);
  const wins = pnls.filter(v => v > 0).length;
  const grossW = pnls.filter(v => v > 0).reduce((s, v) => s + v, 0);
  const grossL = Math.abs(pnls.filter(v => v <= 0).reduce((s, v) => s + v, 0));
  const p = (q) => pnls[Math.floor(q * N)];
  return {
    strategyId, label: strat.label, N,
    winRate: wins / N * 100,
    avgPnl: sum / N,
    medPnl: p(0.5),
    p10: p(0.10), p25: p(0.25), p75: p(0.75), p90: p(0.90),
    bestPnl: pnls[N - 1], worstPnl: pnls[0],
    profitFactor: grossL > 0 ? grossW / grossL : Infinity,
    avgSol: strat.position_size_sol * sum / N / 100,
    reasons, posSize: strat.position_size_sol,
  };
}

// ─── 7-day portfolio simulator ────────────────────────────────────────────────
//
// Event-driven: 5-minute ticks over 7 days.
// New signals arrive with Poisson probability based on daily signal rate.
// Each open position tracks its own price path and exit state.
// Capital is allocated per-trade; partial TPs and trailing stops update in real time.

const TICK_MINS      = 5;
const TICKS_PER_DAY  = (24 * 60) / TICK_MINS;   // 288
const SIM_DAYS       = 7;
const TOTAL_TICKS    = SIM_DAYS * TICKS_PER_DAY; // 2016
const START_CAPITAL  = 2.0;

// Advance position by one minute; return final pnl% if exits, else null.
function tickPosition(pos, price, strat) {
  if (price > pos.hw) pos.hw = price;
  const hwPnl = (pos.hw - 1.0) * 100;
  const pnl   = (price - 1.0) * 100;

  if (!pos.armed && strat.trailing_enabled && pnl >= strat.tp_percent) pos.armed = true;

  if (strat.partial_tp && !pos.pt1 && pnl >= strat.partial_tp_at_percent) {
    pos.pt1 = true;
    const f = strat.partial_tp_sell_percent / 100;
    pos.locked += f * pnl; pos.rem -= f;
  }
  if (strat.partial_tp_2 && !pos.pt2 && pnl >= strat.partial_tp_2_at_percent) {
    pos.pt2 = true;
    const f = (strat.partial_tp_2_sell_percent / 100) * pos.rem;
    pos.locked += f * pnl; pos.rem -= f;
  }

  if (pnl <= strat.sl_percent)          return pos.locked + pos.rem * pnl;
  if (!strat.trailing_enabled && pnl >= strat.tp_percent) return pos.locked + pos.rem * pnl;
  if (pos.armed && strat.trailing_enabled) {
    const trail = strat.tiered_trailing
      ? getDynamicTrailing(strat.trailing_percent, hwPnl)
      : Math.abs(strat.trailing_percent);
    if ((price / pos.hw - 1) * 100 <= -trail) return pos.locked + pos.rem * pnl;
  }
  return null;
}

function run7DaySim(strategyId, nRuns, rand, randNorm) {
  const strat    = STRATEGIES[strategyId];
  const dist     = ARCHETYPE_DISTS[strategyId];
  const peaks    = PEAK_RANGES[strategyId];
  const sigProb  = DAILY_SIGNAL_RATES[strategyId] / TICKS_PER_DAY;

  const finalCaps     = [];
  const allDailyCaps  = Array.from({ length: SIM_DAYS + 1 }, () => []);
  let totalTrades = 0, totalWins = 0;

  for (let run = 0; run < nRuns; run++) {
    let capital  = START_CAPITAL;
    const open   = [];   // active positions
    let maxCap   = capital, minCap = capital, peakCap = capital;
    let maxDD    = 0;
    let trades   = 0, wins = 0;

    allDailyCaps[0].push(capital);

    for (let tick = 0; tick < TOTAL_TICKS; tick++) {
      // ── Advance all open positions (5 minutes each) ──────────────────────
      for (let i = open.length - 1; i >= 0; i--) {
        const pos = open[i];
        let exited = false;
        for (let m = 0; m < TICK_MINS; m++) {
          pos.idx++;
          const idx = Math.min(pos.idx, pos.path.length - 1);
          const px  = pos.path[idx];
          const finalPnl = tickPosition(pos, px, strat);

          if (finalPnl !== null || pos.idx >= pos.path.length) {
            const pnl  = finalPnl ?? (pos.locked + pos.rem * ((pos.path[pos.path.length - 1] - 1.0) * 100));
            const gain = strat.position_size_sol * pnl / 100;
            capital   += strat.position_size_sol + gain;
            if (pnl > 0) wins++;
            trades++;
            open.splice(i, 1);
            exited = true;
            break;
          }
        }
      }

      // ── Try to open new position ──────────────────────────────────────────
      if (rand() < sigProb &&
          open.length < strat.max_open_positions &&
          capital >= strat.position_size_sol) {
        const arch  = sampleArchetype(dist, rand);
        const peak  = samplePeak(arch, peaks, rand);
        const path  = generatePricePath(arch, peak, rand, randNorm);
        capital    -= strat.position_size_sol;
        open.push({ path, idx: 0, hw: 1.0, armed: Boolean(strat.trailing_from_entry),
                    pt1: false, pt2: false, locked: 0, rem: 1.0 });
      }

      // ── Track drawdown & portfolio value ─────────────────────────────────
      const portVal = capital + open.length * strat.position_size_sol;
      if (portVal > peakCap) peakCap = portVal;
      const dd = peakCap > 0 ? (peakCap - portVal) / peakCap * 100 : 0;
      if (dd > maxDD) maxDD = dd;

      // ── Daily snapshot ────────────────────────────────────────────────────
      if ((tick + 1) % TICKS_PER_DAY === 0) {
        const day = Math.floor((tick + 1) / TICKS_PER_DAY);
        allDailyCaps[day].push(portVal);
      }
    }

    // Close all remaining positions at their last price
    for (const pos of open) {
      const lastPx  = pos.path[Math.min(pos.idx, pos.path.length - 1)];
      const lastPnl = pos.locked + pos.rem * ((lastPx - 1.0) * 100);
      const gain    = strat.position_size_sol * lastPnl / 100;
      capital      += strat.position_size_sol + gain;
      if (lastPnl > 0) wins++;
      trades++;
    }

    finalCaps.push(capital);
    totalTrades += trades;
    totalWins   += wins;
  }

  // ── Aggregate statistics ──────────────────────────────────────────────────
  finalCaps.sort((a, b) => a - b);
  const med  = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const pct_ = (arr, q) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(q * s.length)];
  };

  const mean = finalCaps.reduce((s, v) => s + v, 0) / nRuns;
  const above = (threshold) => finalCaps.filter(v => v > threshold).length / nRuns * 100;

  // Daily medians
  const dailyMedians = allDailyCaps.map(arr => arr.length ? med([...arr]) : START_CAPITAL);

  // Max drawdown median
  return {
    strategyId, label: strat.label, nRuns,
    mean, median: finalCaps[Math.floor(nRuns / 2)],
    p10: pct_(finalCaps, 0.10),
    p25: pct_(finalCaps, 0.25),
    p75: pct_(finalCaps, 0.75),
    p90: pct_(finalCaps, 0.90),
    best: finalCaps[nRuns - 1],
    worst: finalCaps[0],
    returnPct: (mean / START_CAPITAL - 1) * 100,
    winRate: totalTrades > 0 ? totalWins / totalTrades * 100 : 0,
    totalTradesPerRun: totalTrades / nRuns,
    dailyMedians,
    prob2x:  above(START_CAPITAL * 2),
    prob3x:  above(START_CAPITAL * 3),
    prob5x:  above(START_CAPITAL * 5),
    prob10x: above(START_CAPITAL * 10),
    probBreakEven: above(START_CAPITAL),
    probRuin: finalCaps.filter(v => v < START_CAPITAL * 0.25).length / nRuns * 100,
    posSize: strat.position_size_sol,
    maxPositions: strat.max_open_positions,
    dailySignals: DAILY_SIGNAL_RATES[strategyId],
  };
}

// ─── Output ───────────────────────────────────────────────────────────────────

function printTradeMC(results) {
  console.log('\n── Per-trade Monte Carlo (10 000 sims/strategy) ──────────────────────────────────────');
  console.log('┌─────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐');
  console.log('│ Strategy            │ Win Rate │ Avg PnL% │ Median   │  P90     │    PF    │');
  console.log('├─────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');
  for (const r of results) {
    const pf = isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞';
    console.log(`│ ${pad(r.label, 19, true)} │ ${pad(r.winRate.toFixed(1)+'%', 8)} │ ${pad(pct(r.avgPnl), 8)} │ ${pad(pct(r.medPnl), 8)} │ ${pad(pct(r.p90), 8)} │ ${pad(pf, 8)} │`);
  }
  console.log('└─────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘');
}

function printPortfolioResults(results) {
  const W = 100;
  console.log('\n' + '═'.repeat(W));
  console.log('  7-DAY PORTFOLIO SIMULATION');
  console.log(`  Starting capital: ${START_CAPITAL} SOL  ·  ${results[0].nRuns} independent runs per strategy`);
  console.log('═'.repeat(W));

  // ── Main table ────────────────────────────────────────────────────────────
  console.log(`
┌──────────────────────┬───────────┬───────────┬───────────┬───────────┬───────────┬───────────┐
│ Strategy             │ Mean End  │  Median   │   P10     │   P90     │  Best     │ Return%   │
├──────────────────────┼───────────┼───────────┼───────────┼───────────┼───────────┼───────────┤`);
  for (const r of results) {
    console.log(
      `│ ${pad(r.label, 20, true)} │ ${pad(sol(r.mean)+' SOL', 9)} │ ${pad(sol(r.median)+' SOL', 9)} │ ${pad(sol(r.p10)+' SOL', 9)} │ ${pad(sol(r.p90)+' SOL', 9)} │ ${pad(sol(r.best)+' SOL', 9)} │ ${pad(pct(r.returnPct, 0), 9)} │`
    );
  }
  console.log('└──────────────────────┴───────────┴───────────┴───────────┴───────────┴───────────┴───────────┘');
  console.log('  P10 = 10th percentile (bad luck run). P90 = 90th percentile (lucky run).\n');

  // ── Median equity curve ───────────────────────────────────────────────────
  console.log('── Median Equity Curve (SOL) ───────────────────────────────────────────────────────────');
  const header = ['Strategy             '].concat(
    ['Start', 'Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7']
  ).map((h, i) => i === 0 ? pad(h, 21, true) : pad(h, 8)).join(' │ ');
  console.log('  ' + header);
  console.log('  ' + '─'.repeat(90));
  for (const r of results) {
    const row = [pad(r.label, 21, true)].concat(
      r.dailyMedians.map(v => pad(sol(v), 8))
    ).join(' │ ');
    console.log('  ' + row);
  }
  console.log('');

  // ── Visual equity bars (Day 7 median) ────────────────────────────────────
  const maxEnd = Math.max(...results.map(r => r.dailyMedians[SIM_DAYS]));
  console.log('── Day 7 Median Capital ─────────────────────────────────────────────────────────────────');
  for (const r of results) {
    const v = r.dailyMedians[SIM_DAYS];
    const marker = v >= START_CAPITAL ? '▲' : '▼';
    console.log(`  ${pad(r.label, 20, true)}  ${bar(v, maxEnd * 1.1, 35)} ${sol(v)} SOL ${marker}`);
  }
  console.log('');

  // ── Probability table ─────────────────────────────────────────────────────
  console.log('── Outcome Probability Matrix ───────────────────────────────────────────────────────────');
  console.log(`  ${'Strategy'.padEnd(20)}  │  ${'BE>2'.padStart(6)}  │  ${'2x>4'.padStart(6)}  │  ${'3x>6'.padStart(6)}  │  ${'5x>10'.padStart(6)}  │  ${'10x>20'.padStart(7)}  │  ${'RUIN<0.5'.padStart(8)}  │`);
  console.log('  ' + '─'.repeat(88));
  for (const r of results) {
    const fmt = (v) => pad(v.toFixed(1) + '%', 7);
    console.log(`  ${pad(r.label, 20, true)}  │  ${fmt(r.probBreakEven)}  │  ${fmt(r.prob2x)}  │  ${fmt(r.prob3x)}  │  ${fmt(r.prob5x)}  │  ${fmt(r.prob10x)}   │  ${fmt(r.probRuin)}   │`);
  }
  console.log('  (BE = break-even i.e. > starting 2 SOL. RUIN = final capital < 0.5 SOL)\n');

  // ── Trade statistics ──────────────────────────────────────────────────────
  console.log('── Trade Throughput & Execution ─────────────────────────────────────────────────────────');
  console.log(`  ${'Strategy'.padEnd(20)}  │  ${'Sig/day'.padStart(7)}  │  ${'Trades/7d'.padStart(9)}  │  ${'Win%'.padStart(6)}  │  ${'Size'.padStart(6)}  │  ${'MaxPos'.padStart(6)}  │`);
  console.log('  ' + '─'.repeat(75));
  for (const r of results) {
    console.log(`  ${pad(r.label, 20, true)}  │  ${pad(r.dailySignals, 7)}  │  ${pad(r.totalTradesPerRun.toFixed(0), 9)}  │  ${pad(r.winRate.toFixed(1)+'%', 6)}  │  ${pad(r.posSize+' SOL', 6)}  │  ${pad(r.maxPositions, 6)}  │`);
  }
  console.log('');

  // ── Kelly Criterion ───────────────────────────────────────────────────────
  console.log('── Kelly Criterion (optimal % of bankroll per trade) ────────────────────────────────────');
  for (const mc of perTradeResults) {
    const wins = mc.winRate / 100;
    const losses = 1 - wins;
    const avgW = Math.abs(mc.avgPnl > 0 ? mc.avgPnl : 1);
    const avgL = Math.abs(mc.worstPnl < 0 ? mc.p10 : 25);
    const kelly = ((wins * avgW - losses * avgL) / avgW) * 100;
    const halfKelly = kelly / 2;
    const posSize = STRATEGIES[mc.strategyId].position_size_sol;
    const kellySol = START_CAPITAL * Math.max(halfKelly, 0) / 100;
    console.log(`  ${pad(mc.label, 20, true)}  Kelly=${pct(kelly, 1)}  Half-Kelly=${pct(halfKelly, 1)}  → ${sol(kellySol)} SOL/trade  (using ${posSize} SOL)`);
  }
  console.log('');

  // ── Ranked summary ────────────────────────────────────────────────────────
  const ranked = [...results].sort((a, b) => b.mean - a.mean);
  console.log('── 7-Day Rankings (by mean final capital) ───────────────────────────────────────────────');
  ranked.forEach((r, i) => {
    const medal = ['🥇', '🥈', '🥉', '4️⃣ ', '5️⃣ ', '6️⃣ '][i] || `${i + 1}.`;
    const gain  = r.mean - START_CAPITAL;
    const sign  = gain >= 0 ? '+' : '';
    console.log(`  ${medal}  ${pad(r.label, 20, true)}  ${sol(r.mean)} SOL median (${sign}${sol(gain)} SOL)  ·  ${r.prob3x.toFixed(1)}% chance 3x  ·  ${r.probRuin.toFixed(1)}% ruin`);
  });

  console.log('');
  console.log('  Notes:');
  console.log('  · Signal rates calibrated to post-fix Moon Bag (min_source_count=2) and Solana activity.');
  console.log('  · Price paths limited to 12 h max per position — very long moon runs slightly undervalued.');
  console.log('  · Slippage, gas, LLM latency, and failed transactions are not modelled.');
  console.log('  · Re-run simulate.js to see variance; outcomes differ across seeds.');
  console.log('═'.repeat(W) + '\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const N_TRADE_SIMS   = 10_000;
const N_PORTFOLIO    = 500;
const SEED           = 0xdeadbeef;

const rand     = makePrng(SEED);
const randNorm = makeRandNorm(rand);

console.log('\nCharon Strategy Simulation');
console.log('──────────────────────────');

// Part 1 — per-trade Monte Carlo
console.log('\nPart 1: Per-trade Monte Carlo (10 000 trades each)...');
const perTradeResults = Object.keys(STRATEGIES).map(id => {
  process.stdout.write(`  ${STRATEGIES[id].label.padEnd(20)} `);
  const r = runTradeMC(id, N_TRADE_SIMS, rand, randNorm);
  console.log(`done  win=${r.winRate.toFixed(1)}%  avg=${pct(r.avgPnl)}`);
  return r;
});
printTradeMC(perTradeResults);

// Part 2 — 7-day portfolio
console.log(`\nPart 2: 7-day portfolio simulation (${N_PORTFOLIO} runs, ${START_CAPITAL} SOL start)...`);
const t0 = Date.now();
const portfolioResults = Object.keys(STRATEGIES).map(id => {
  process.stdout.write(`  ${STRATEGIES[id].label.padEnd(20)} `);
  const r = run7DaySim(id, N_PORTFOLIO, rand, randNorm);
  console.log(`done  mean=${sol(r.mean)} SOL  p90=${sol(r.p90)} SOL`);
  return r;
});
console.log(`\nTotal simulation time: ${Date.now() - t0}ms`);
printPortfolioResults(portfolioResults);
