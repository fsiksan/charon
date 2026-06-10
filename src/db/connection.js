import Database from 'better-sqlite3';
import { DB_PATH } from '../config.js';

export const db = new Database(DB_PATH);

export function initDb() {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_wallets (
      label TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      signature TEXT,
      signal_key TEXT,
      candidate_json TEXT NOT NULL,
      filter_result_json TEXT NOT NULL,
      UNIQUE(signature, mint)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      mint TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at_ms INTEGER NOT NULL,
      telegram_message_id INTEGER,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT,
      risks_json TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at_ms INTEGER NOT NULL,
      trigger_candidate_id INTEGER,
      selected_candidate_id INTEGER,
      selected_mint TEXT,
      verdict TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT,
      risks_json TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      candidate_ids_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dry_run_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      mint TEXT NOT NULL,
      symbol TEXT,
      status TEXT NOT NULL,
      opened_at_ms INTEGER NOT NULL,
      closed_at_ms INTEGER,
      size_sol REAL NOT NULL,
      entry_price REAL,
      entry_mcap REAL,
      token_amount_est REAL,
      high_water_price REAL,
      high_water_mcap REAL,
      tp_percent REAL NOT NULL,
      sl_percent REAL NOT NULL,
      trailing_enabled INTEGER NOT NULL,
      trailing_percent REAL NOT NULL,
      trailing_armed INTEGER NOT NULL DEFAULT 0,
      exit_price REAL,
      exit_mcap REAL,
      exit_reason TEXT,
      pnl_percent REAL,
      pnl_sol REAL,
      llm_decision_id INTEGER,
      execution_mode TEXT DEFAULT 'dry_run',
      entry_signature TEXT,
      exit_signature TEXT,
      token_amount_raw TEXT,
      snapshot_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dry_run_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      side TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      price REAL,
      mcap REAL,
      size_sol REAL,
      token_amount_est REAL,
      reason TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tp_sl_rules (
      position_id INTEGER PRIMARY KEY,
      tp_percent REAL NOT NULL,
      sl_percent REAL NOT NULL,
      trailing_enabled INTEGER NOT NULL,
      trailing_percent REAL NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trade_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      side TEXT NOT NULL,
      size_sol REAL NOT NULL,
      confidence REAL,
      reason TEXT,
      llm_decision_id INTEGER,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decision_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at_ms INTEGER NOT NULL,
      batch_id INTEGER,
      trigger_candidate_id INTEGER,
      selected_candidate_id INTEGER,
      selected_mint TEXT,
      mode TEXT NOT NULL,
      action TEXT NOT NULL,
      verdict TEXT,
      confidence REAL,
      reason TEXT,
      guardrails_json TEXT NOT NULL,
      token_json TEXT NOT NULL,
      candidate_json TEXT NOT NULL,
      batch_json TEXT NOT NULL,
      execution_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      kind TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at_ms INTEGER NOT NULL,
      window_ms INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      lessons_json TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      lesson TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      target_price_usd REAL,
      target_mcap_usd REAL,
      target_ath_distance_percent REAL,
      candidate_json TEXT NOT NULL,
      signals_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at_ms INTEGER NOT NULL,
      triggered_at_ms INTEGER,
      expires_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON price_alerts(status, expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_candidates_mint ON candidates(mint);
    CREATE INDEX IF NOT EXISTS idx_positions_status ON dry_run_positions(status);
    CREATE INDEX IF NOT EXISTS idx_trade_intents_status ON trade_intents(status);
    CREATE INDEX IF NOT EXISTS idx_decision_logs_mint ON decision_logs(selected_mint);
    CREATE INDEX IF NOT EXISTS idx_signal_events_mint ON signal_events(mint);
    CREATE INDEX IF NOT EXISTS idx_learning_lessons_status ON learning_lessons(status, created_at_ms);
  `);
  ensureColumn('candidates', 'signal_key', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_signal_key ON candidates(signal_key) WHERE signal_key IS NOT NULL');
  ensureColumn('dry_run_positions', 'execution_mode', "TEXT DEFAULT 'dry_run'");
  ensureColumn('dry_run_positions', 'entry_signature', 'TEXT');
  ensureColumn('dry_run_positions', 'exit_signature', 'TEXT');
  ensureColumn('dry_run_positions', 'token_amount_raw', 'TEXT');
  ensureColumn('dry_run_positions', 'strategy_id', "TEXT DEFAULT 'sniper'");
  ensureColumn('dry_run_positions', 'partial_tp_done', 'INTEGER DEFAULT 0');
  // trailing_from_entry: arm trailing stop immediately — no fixed TP ceiling, unlimited upside
  ensureColumn('dry_run_positions', 'trailing_from_entry', 'INTEGER DEFAULT 0');
  // partial_tp_2_done: second partial take-profit level (deeper profit tier)
  ensureColumn('dry_run_positions', 'partial_tp_2_done', 'INTEGER DEFAULT 0');
  ensureColumn('decision_logs', 'strategy_id', 'TEXT');
  migrateStrategyConfigs();

  const defaults = {
    agent_enabled: 'true',
    trading_mode: process.env.TRADING_MODE || 'dry_run',
    llm_candidate_pick_count: process.env.LLM_CANDIDATE_PICK_COUNT || '10',
    llm_candidate_max_age_ms: process.env.LLM_CANDIDATE_MAX_AGE_MS || String(10 * 60 * 1000),
    llm_min_confidence: '75',
    max_open_positions: process.env.MAX_OPEN_POSITIONS || '3',
    dry_run_buy_sol: '0.1',
    circuit_breaker_enabled: process.env.CIRCUIT_BREAKER_ENABLED || 'true',
    daily_loss_limit_sol: process.env.DAILY_LOSS_LIMIT_SOL || '0.35',
    default_tp_percent: '50',
    default_sl_percent: '-25',
    default_trailing_enabled: 'true',
    default_trailing_percent: '20',
    min_fee_claim_sol: process.env.MIN_FEE_CLAIM_SOL || '2',
    min_mcap_usd: '0',
    max_mcap_usd: '0',
    min_gmgn_total_fee_sol: '0',
    min_graduated_volume_usd: '0',
    max_top20_holder_percent: '100',
    min_saved_wallet_holders: '0',
    gmgn_request_delay_ms: process.env.GMGN_REQUEST_DELAY_MS || '2500',
    gmgn_max_retries: process.env.GMGN_MAX_RETRIES || '2',
    trending_enabled: process.env.TRENDING_ENABLED || 'true',
    trending_source: process.env.TRENDING_SOURCE || 'jupiter',
    trending_allow_degen: process.env.TRENDING_ALLOW_DEGEN || 'false',
    trending_interval: process.env.TRENDING_INTERVAL || '5m',
    trending_limit: process.env.TRENDING_LIMIT || '100',
    trending_order_by: process.env.TRENDING_ORDER_BY || 'volume',
    trending_min_volume_usd: process.env.TRENDING_MIN_VOLUME_USD || '0',
    trending_min_swaps: process.env.TRENDING_MIN_SWAPS || '0',
    trending_max_rug_ratio: process.env.TRENDING_MAX_RUG_RATIO || '0.3',
    trending_max_bundler_rate: process.env.TRENDING_MAX_BUNDLER_RATE || '0.5',
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) insert.run(key, value);

  // Seed default strategies
  const stratInsert = db.prepare('INSERT OR IGNORE INTO strategies (id, name, enabled, config_json, created_at_ms) VALUES (?, ?, ?, ?, ?)');
  const ts = Date.now();

  stratInsert.run('sniper', 'Sniper', 1, JSON.stringify({
    entry_mode: 'immediate',
    min_source_count: 2,
    require_fee_claim: true,
    token_age_max_ms: 3600000,
    min_mcap_usd: 7000,
    max_mcap_usd: 200000,
    min_fee_claim_sol: 0.5,
    min_gmgn_total_fee_sol: 10,
    min_holders: 0,
    max_top20_holder_percent: 100,
    min_saved_wallet_holders: 0,
    max_ath_distance_pct: 0,
    min_graduated_volume_usd: 0,
    trending_min_volume_usd: 0,
    trending_min_swaps: 0,
    trending_max_rug_ratio: 0.3,
    trending_max_bundler_rate: 0.5,
    position_size_sol: 0.1,
    max_open_positions: 3,
    tp_percent: 50,
    sl_percent: -25,
    trailing_enabled: true,
    trailing_percent: 20,
    partial_tp: false,
    partial_tp_at_percent: 0,
    partial_tp_sell_percent: 0,
    max_hold_ms: 0,
    use_llm: true,
    llm_min_confidence: 50,
    buy_slippage_bps: 300,
    sell_slippage_bps: 800,
  }), ts);

  stratInsert.run('dip_buy', 'Dip Buy', 0, JSON.stringify({
    entry_mode: 'wait_for_dip',
    min_source_count: 1,
    require_fee_claim: false,
    token_age_max_ms: 86400000,
    min_mcap_usd: 25000,
    max_mcap_usd: 500000,
    min_fee_claim_sol: 0,
    min_gmgn_total_fee_sol: 0,
    min_holders: 0,
    max_top20_holder_percent: 100,
    min_saved_wallet_holders: 0,
    max_ath_distance_pct: -40,
    min_graduated_volume_usd: 0,
    trending_min_volume_usd: 0,
    trending_min_swaps: 0,
    trending_max_rug_ratio: 0.3,
    trending_max_bundler_rate: 0.5,
    position_size_sol: 0.05,
    max_open_positions: 3,
    tp_percent: 30,
    sl_percent: -20,
    trailing_enabled: true,
    trailing_percent: 15,
    partial_tp: false,
    partial_tp_at_percent: 0,
    partial_tp_sell_percent: 0,
    max_hold_ms: 0,
    use_llm: true,
    llm_min_confidence: 60,
    buy_slippage_bps: 300,
    sell_slippage_bps: 500,
  }), ts);

  stratInsert.run('smart_money', 'Smart Money', 0, JSON.stringify({
    entry_mode: 'immediate',
    min_source_count: 2,
    require_fee_claim: false,
    token_age_max_ms: 86400000,
    min_mcap_usd: 10000,
    max_mcap_usd: 1000000,
    min_fee_claim_sol: 0,
    min_gmgn_total_fee_sol: 0,
    min_holders: 1000,
    max_top20_holder_percent: 50,
    min_saved_wallet_holders: 0,
    max_ath_distance_pct: 0,
    min_graduated_volume_usd: 0,
    trending_min_volume_usd: 5000,
    trending_min_swaps: 100,
    trending_max_rug_ratio: 0.2,
    trending_max_bundler_rate: 0.3,
    position_size_sol: 0.1,
    max_open_positions: 3,
    tp_percent: 100,
    sl_percent: -25,
    trailing_enabled: false,
    trailing_percent: 0,
    partial_tp: true,
    partial_tp_at_percent: 100,
    partial_tp_sell_percent: 50,
    max_hold_ms: 0,
    use_llm: true,
    llm_min_confidence: 70,
    buy_slippage_bps: 200,
    sell_slippage_bps: 500,
  }), ts);

  stratInsert.run('degen', 'Degen', 0, JSON.stringify({
    entry_mode: 'immediate',
    min_source_count: 1,
    require_fee_claim: false,
    token_age_max_ms: 3600000,
    min_mcap_usd: 5000,
    max_mcap_usd: 100000,
    min_fee_claim_sol: 0,
    min_gmgn_total_fee_sol: 0,
    min_holders: 0,
    max_top20_holder_percent: 100,
    min_saved_wallet_holders: 0,
    max_ath_distance_pct: 0,
    min_graduated_volume_usd: 0,
    trending_min_volume_usd: 0,
    trending_min_swaps: 0,
    trending_max_rug_ratio: 0.5,
    trending_max_bundler_rate: 0.7,
    min_liquidity_usd: 0,
    min_hot_level: 0,
    min_smart_degen_count: 0,
    position_size_sol: 0.05,
    max_open_positions: 5,
    tp_percent: 30,
    sl_percent: -15,
    trailing_enabled: true,
    trailing_from_entry: false,
    trailing_percent: 10,
    tiered_trailing: true,
    partial_tp: false,
    partial_tp_at_percent: 0,
    partial_tp_sell_percent: 0,
    partial_tp_2: false,
    partial_tp_2_at_percent: 0,
    partial_tp_2_sell_percent: 0,
    max_hold_ms: 0,
    use_llm: false,
    llm_min_confidence: 0,
    buy_slippage_bps: 500,
    sell_slippage_bps: 1500,
  }), ts);

  // Moon Bag — dual-confirmed signals (fee+graduated OR fee+trending), rides winners
  // to maximum with tiered profit lock.
  // Exit engine recalibrated against 76 real dry-run trades (23.7% win, −2.1%/trade):
  // trailing armed from entry was converting every +3–16% blip into a trailing exit at
  // −4..−13% — 76% of all "TRAILING_TP" exits were losses. Trailing now arms only after
  // +25% (tp_percent), noise tokens exit via the flat −18% SL, and runners survive their
  // first normal dip. Partials lowered to levels pumps actually reach (80%/250%).
  // Pre-buy audit gating + circuit breaker + conviction sizing unchanged.
  stratInsert.run('moon_bag', 'Moon Bag', 0, JSON.stringify({
    entry_mode: 'immediate',
    min_source_count: 2,          // fee+graduated OR fee+trending
    require_fee_claim: true,
    token_age_max_ms: 14400000,   // 4h window — more signals, negligible quality loss
    min_mcap_usd: 8000,
    max_mcap_usd: 400000,         // wider net for more opportunities
    min_fee_claim_sol: 0.5,
    min_gmgn_total_fee_sol: 3,    // looser — more signals
    min_holders: 30,
    max_top20_holder_percent: 70,
    min_saved_wallet_holders: 0,
    max_ath_distance_pct: 0,
    min_graduated_volume_usd: 0,
    trending_min_volume_usd: 1000,
    trending_min_swaps: 30,
    trending_max_rug_ratio: 0.30,
    trending_max_bundler_rate: 0.45,
    min_liquidity_usd: 2000,
    min_hot_level: 0,
    min_smart_degen_count: 0,
    // Pre-buy safety audit — the dominant real risk is rugs gapping through the SL,
    // so reject them before entry. Enforced only when Jupiter audit data is present.
    require_mint_revoked: true,
    require_freeze_revoked: true,
    max_dev_holder_percent: 5,
    // Conviction-weighted sizing — scale capital by LLM confidence (0.10–0.22 SOL).
    conviction_sizing: true,
    position_size_sol: 0.15,      // base/mid size (used when conviction sizing is off)
    position_size_min_sol: 0.10,
    position_size_max_sol: 0.22,
    max_open_positions: 6,
    tp_percent: 25,               // trail ARM threshold — trailing activates once up +25%
    sl_percent: -18,              // hard floor while trail is unarmed; rugs gap through anyway
    trailing_enabled: true,
    trailing_from_entry: false,   // arm only after +25% — see header comment
    trailing_percent: 15,         // tiered tightens to 8% at +500%
    tiered_trailing: true,
    partial_tp: true,
    partial_tp_at_percent: 80,    // bank the first slice sooner — most pumps stall before +120%
    partial_tp_sell_percent: 30,
    partial_tp_2: true,
    partial_tp_2_at_percent: 250, // second lock at a level runners actually reach
    partial_tp_2_sell_percent: 20,
    max_hold_ms: 10800000,        // 3h force-exit — recycles capital out of stagnant positions
    use_llm: true,
    llm_min_confidence: 60,
    buy_slippage_bps: 300,
    sell_slippage_bps: 1000,
  }), ts);

  // Momentum Rocket — catches hot trending tokens with smart-money accumulation.
  // Uses trailing_from_entry so there is no fixed exit — just follows the momentum.
  // Tight entry filters ensure quality; tiered trailing locks in gains progressively.
  stratInsert.run('momentum_rocket', 'Momentum Rocket', 0, JSON.stringify({
    entry_mode: 'immediate',
    min_source_count: 1,
    require_fee_claim: false,
    token_age_max_ms: 86400000,   // can be up to 1 day old
    min_mcap_usd: 20000,
    max_mcap_usd: 500000,
    min_fee_claim_sol: 0,
    min_gmgn_total_fee_sol: 0,
    min_holders: 200,
    max_top20_holder_percent: 55,
    min_saved_wallet_holders: 0,
    max_ath_distance_pct: 0,
    min_graduated_volume_usd: 0,
    trending_min_volume_usd: 8000, // strong volume confirmation
    trending_min_swaps: 120,
    trending_max_rug_ratio: 0.2,   // strict rug filter
    trending_max_bundler_rate: 0.3,
    min_liquidity_usd: 10000,
    min_hot_level: 1,              // at least "warm" momentum
    min_smart_degen_count: 2,      // smart money must be accumulating
    position_size_sol: 0.12,
    max_open_positions: 2,         // focused — fewer, higher-quality positions
    tp_percent: 75,                // trailing arms once we're up 75%
    sl_percent: -18,
    trailing_enabled: true,
    trailing_from_entry: true,     // arm trailing at entry — pure momentum play
    trailing_percent: 18,          // tightens automatically as PnL grows
    tiered_trailing: true,
    // Lock in 30% of position at +75% profit
    partial_tp: true,
    partial_tp_at_percent: 75,
    partial_tp_sell_percent: 30,
    // Lock in another 25% at +250%
    partial_tp_2: true,
    partial_tp_2_at_percent: 250,
    partial_tp_2_sell_percent: 25,
    max_hold_ms: 0,
    use_llm: true,
    llm_min_confidence: 65,
    buy_slippage_bps: 500,
    sell_slippage_bps: 1000,
  }), ts);
}

const SLIPPAGE_DEFAULTS = {
  sniper:           { buy_slippage_bps: 300,  sell_slippage_bps: 800  },
  dip_buy:          { buy_slippage_bps: 300,  sell_slippage_bps: 500  },
  smart_money:      { buy_slippage_bps: 200,  sell_slippage_bps: 500  },
  degen:            { buy_slippage_bps: 500,  sell_slippage_bps: 1500 },
  moon_bag:         { buy_slippage_bps: 300,  sell_slippage_bps: 1000 },
  momentum_rocket:  { buy_slippage_bps: 500,  sell_slippage_bps: 1000 },
};

// Patch existing strategy configs in the DB if they still carry old restrictive values.
// Runs on every startup but is idempotent (only writes when migration is needed).
function migrateStrategyConfigs() {
  const moonRow = db.prepare("SELECT config_json FROM strategies WHERE id = 'moon_bag'").get();
  if (moonRow) {
    const cfg = JSON.parse(moonRow.config_json);
    let moonChanged = false;

    // Migration 1: old triple-source / high-fee config
    if (Number(cfg.min_source_count) >= 3 || Number(cfg.min_fee_claim_sol) >= 1.5) {
      Object.assign(cfg, {
        min_source_count: 2,
        min_fee_claim_sol: 0.5,
        min_gmgn_total_fee_sol: 5,
        min_holders: 30,
        max_top20_holder_percent: 70,
        token_age_max_ms: 7200000,
        trending_min_volume_usd: 1000,
        trending_min_swaps: 30,
        trending_max_rug_ratio: 0.30,
        trending_max_bundler_rate: 0.45,
        min_liquidity_usd: 2000,
      });
      moonChanged = true;
      console.log('[db] moon_bag migrated: min_source_count 3→2, fee thresholds lowered');
    }

    // Migration 2: Monte Carlo optimised exit params (trailing 22→15, partials tightened).
    // Only for pre-bundle configs (conviction_sizing missing) — migration 4 moves
    // partial_tp_2_at_percent below 400 on purpose and must not be reverted here.
    if (cfg.conviction_sizing == null && (Number(cfg.trailing_percent) > 15 || Number(cfg.partial_tp_2_at_percent) < 400)) {
      Object.assign(cfg, {
        sl_percent: -25,
        trailing_percent: 15,
        partial_tp_at_percent: 150,
        partial_tp_sell_percent: 20,
        partial_tp_2_at_percent: 400,
        partial_tp_2_sell_percent: 20,
        max_mcap_usd: 200000,
        max_open_positions: 5,
        position_size_sol: cfg.position_size_sol < 0.15 ? 0.15 : cfg.position_size_sol,
        llm_min_confidence: cfg.llm_min_confidence > 60 ? 60 : cfg.llm_min_confidence,
      });
      moonChanged = true;
      console.log('[db] moon_bag migrated: exit params optimised (trail 22→15%, PT2 300→400%, sl -22→-25%)');
    }

    // Migration 3: full improvement bundle — pre-buy audit gating, conviction sizing,
    // realistic-execution exit tuning, more signals + capital recycling. Detected by the
    // absence of the conviction_sizing field (added with this bundle).
    if (cfg.conviction_sizing == null) {
      Object.assign(cfg, {
        // realistic-execution exit tuning
        sl_percent: -22,
        partial_tp_at_percent: 120,
        partial_tp_sell_percent: 25,
        partial_tp_2_sell_percent: 15,
        max_hold_ms: 10800000,
        // more signals + capital recycling
        token_age_max_ms: 14400000,
        max_mcap_usd: 400000,
        min_gmgn_total_fee_sol: 3,
        max_open_positions: 6,
        // pre-buy safety audit
        require_mint_revoked: true,
        require_freeze_revoked: true,
        max_dev_holder_percent: 5,
        // conviction-weighted sizing
        conviction_sizing: true,
        position_size_min_sol: 0.10,
        position_size_max_sol: 0.22,
      });
      moonChanged = true;
      console.log('[db] moon_bag migrated: improvement bundle (audit gating, conviction sizing, capital recycling)');
    }

    // Migration 4: exit-engine recalibration from real dry-run results (76 trades,
    // 23.7% win rate). trailing_from_entry was shaking every position out on its first
    // 15% retrace — trail now arms at +25% with a flat −18% SL below it, and partial
    // TPs moved down to levels pumps actually reach. Detected by trailing_from_entry
    // still being true (set by migration 3 / old seed).
    if (cfg.trailing_from_entry === true) {
      Object.assign(cfg, {
        trailing_from_entry: false,
        tp_percent: 25,
        sl_percent: -18,
        partial_tp_at_percent: 80,
        partial_tp_sell_percent: 30,
        partial_tp_2_at_percent: 250,
        partial_tp_2_sell_percent: 20,
      });
      moonChanged = true;
      console.log('[db] moon_bag migrated: trail arms at +25% (was from entry), sl -18, partials 80/250');
    }

    // Repair: a zero trail width silently widens to 20% at runtime (|| 20 fallback)
    // while the UI shows 0.0% — restore the intended 15%.
    if (!(Number(cfg.trailing_percent) > 0)) {
      cfg.trailing_percent = 15;
      moonChanged = true;
      console.log('[db] moon_bag repaired: trailing_percent 0 → 15');
    }

    if (moonChanged) {
      db.prepare("UPDATE strategies SET config_json = ? WHERE id = 'moon_bag'").run(JSON.stringify(cfg));
    }
  }

  // Patch missing slippage fields on all existing strategies
  const allStrats = db.prepare('SELECT id, config_json FROM strategies').all();
  for (const row of allStrats) {
    const cfg = JSON.parse(row.config_json);
    const defaults = SLIPPAGE_DEFAULTS[row.id] || { buy_slippage_bps: 300, sell_slippage_bps: 1000 };
    if (cfg.buy_slippage_bps == null || cfg.sell_slippage_bps == null) {
      if (cfg.buy_slippage_bps == null) cfg.buy_slippage_bps = defaults.buy_slippage_bps;
      if (cfg.sell_slippage_bps == null) cfg.sell_slippage_bps = defaults.sell_slippage_bps;
      db.prepare('UPDATE strategies SET config_json = ? WHERE id = ?').run(JSON.stringify(cfg), row.id);
      console.log(`[db] ${row.id} migrated: added buy/sell slippage (${cfg.buy_slippage_bps}/${cfg.sell_slippage_bps} bps)`);
    }
  }
}

export function ensureColumn(table, column, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
