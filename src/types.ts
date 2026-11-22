export type ScoreStatus = "complete" | "provisional";
export type RoundScoreStatus = "complete" | "partial";

export interface SourceScore {
  score: number;
  coverage: number;
  required_tasks: number;
  graded_runs_count: number;
}

export interface HistoryPoint {
  at: string;
  score: number;
  coverage: number;
  required_tasks: number;
  score_status: ScoreStatus;
}

export interface RadarCandidate {
  model: string;
  effort: string;
  score: number;
  coverage: number;
  required_tasks: number;
  score_status: ScoreStatus;
  graded_runs_count: number;
  source_scores: Record<string, SourceScore>;
  statistics: {
    sample_count: number;
    elapsed_ms_mean: number | null;
    api_equivalent_usd_mean: number | null;
  };
  latest_graded_at: string | null;
  history: HistoryPoint[];
}

export interface RadarBenchData {
  schema_version: 1;
  fetch_id: string;
  generated_at: string;
  checked_at: string;
  benchmark: string;
  score_version: string;
  score_max: number;
  catalog_version: string;
  task_set_sha256: string;
  candidates: RadarCandidate[];
}

export interface RoundTaskDef {
  id: string;
  category: string;
  title_zh: string;
  title_en: string;
  weight: number;
  required: boolean;
}

export interface RoundTaskResult {
  task_id: string;
  status: string;
  reward: number | null;
  seconds: number | null;
  cost_usd: number | null;
}

export interface RoundAnimation {
  status: string;
  score: number | null;
  scores: Record<string, number>;
  reason: string | null;
  seconds: number | null;
  cost_usd: number | null;
  asset_url: string | null;
  /**
   * 上游替我们算好的动画资产校验和。可选是因为历史落盘数据没有这个字段，
   * 转换层补上之后新数据就会有。
   */
  asset_sha256?: string | null;
}

export interface RoundCandidate {
  model: string;
  effort: string;
  score: number | null;
  score_max: number;
  score_status: RoundScoreStatus;
  scored_tasks: number;
  total_tasks: number;
  tasks: RoundTaskResult[];
  totals: {
    seconds: number;
    cost_usd: number;
    cost_known_tasks: number;
    cost_unknown_tasks: number;
  };
  animation: RoundAnimation | null;
}

export interface RoundData {
  schema_version: 1;
  fetch_id: string;
  generated_at: string;
  checked_at: string;
  source_schema: string;
  round: {
    id: string;
    status: string;
    started_at: string;
    completed_at: string;
    updated_at: string;
    taskset_version: string;
    task_count: number;
    timings: Record<string, number>;
  };
  tasks: RoundTaskDef[];
  candidates: RoundCandidate[];
}

export interface StatusData {
  checked_at: string;
  ok: boolean;
  benchmark: string;
  candidates_ok: number;
  candidates_total: number;
  /** 上游声明的候选数，含被丢弃的；candidates_total 只数真正参与统计的。 */
  binding_total: number;
  /** 抓取失败、用旧数据兜底的候选数。 */
  reused_count: number;
  /** 抓取失败且无旧数据、被直接丢弃的候选数。 */
  missing_count: number;
  round_ok: boolean;
  latest_graded_at: string | null;
  /** 参与候选里最旧的评分时间，防止 1 个新鲜候选盖住一堆陈旧。 */
  min_latest: string | null;
  /** 评分时间超过 7 天（或时间未知）的候选数。 */
  stale_count: number;
  round_updated_at: string | null;
  /** null = 上游没给，未知不等于 0。取分数与轮次两者的较大值。 */
  stale_days: number | null;
  /** 只看分数的陈旧天数（横幅「分数已超过 7 天未更新」按它判）；键缺失时横幅才回落 stale_days，显式 null 视为未知。 */
  score_stale_days?: number | null;
  /** 只看降智轮次的陈旧天数；轮次久未更新不等于分数过期。 */
  round_stale_days?: number | null;
  /**
   * 分数取自哪条链：radar-bench-api（旧结构化端点）、site-overview（首页兜底，无历史）、
   * four-task（现行四题链，分数 + 历史 + 轮次同源）。旧 status.json 无此键。
   */
  score_source?: "radar-bench-api" | "site-overview" | "four-task";
  /** 旧评分接口退役时的原始错误，仅取证；数据由现行链发布，不参与新鲜度判定。 */
  legacy_error?: string | null;
  /** 独立的活动轮次进度快照，不代表上方 completed round 的完成时间。 */
  round_progress?: {
    round_id: string;
    revision: number;
    state: "not_started" | "running" | "paused" | "failed" | "waiting_publication" | "published";
    total: number;
    answered: number;
    graded: number;
    observed_at: string;
    changed_at: string;
  } | null;
  /** 活动进度端点失败时单独呈现，不影响其他数据槽。 */
  round_progress_error?: string | null;
  errors: string[];
}

/**
 * 社区体感单条：1–10 星人工打分，与 RadarBench 的 0–150 是两套刻度。
 * 只有「有票」的档位才会被管道写入（count >= 1 且 average 落在 1–10）。
 */
export interface RatingRow {
  id: string;
  model: string;
  effort: string;
  label: string;
  average: number;
  count: number;
}

/** `public/data/ratings.json`：P1 可选源，缺这份文件不影响其它区块。 */
export interface RatingsData {
  schema_version: 1;
  generated_at: string;
  checked_at: string;
  window: string;
  window_hours: number;
  source_updated_at: string | null;
  timezone: string | null;
  /** 上游声明的档位总数（含没人投票的），用来算「N/M 个档位有投票」。 */
  total_slots: number;
  ratings: RatingRow[];
}

/** 四题协议里的四个任务：权重和恒等于 score_max（150）。 */
export interface FourTaskDef {
  id: string;
  title_zh: string;
  weight: number;
  /** 单项内部刻度固定 0–100，乘权重后计入总分。 */
  max: number;
}

/** 单个候选在单个任务上的成绩。 */
export interface FourTaskCell {
  id: string;
  score: number;
  /** 判分前的原始分；有 capped 时它高于 score。 */
  raw_total: number;
  /** 原始分被规则上限压过（如核心关系不全）。 */
  capped: boolean;
  seconds: number;
  cost_usd: number;
  /** 仅 candy：只有对错，score 是 100 / 0。 */
  correct?: boolean;
  /** 仅 pompeii：0–1 的 reward。 */
  reward?: number;
}

export interface FourTaskCandidate {
  model: string;
  effort: string;
  score: number;
  score_status: string;
  latest_at: string;
  tasks: FourTaskCell[];
  totals: { seconds: number; cost_usd: number };
  history: { at: string; score: number }[];
}

export interface FourTaskBatch {
  id: string;
  label: string;
  completed_at: string;
  /** 该批次里有分数的点数（正常是 46）。 */
  points: number;
}

/**
 * `public/data/four-task.json`：四题加权 150 分协议，2026-10-27 起取代旧的 10/64 题口径。
 * 与 RadarBench 的 0–150 数值范围相同但**不可横向比较**——题目集合不同。
 */
export interface FourTaskData {
  schema_version: 1;
  generated_at: string;
  checked_at: string;
  protocol: string;
  score_max: number;
  round: {
    id: string;
    label: string;
    completed_at: string;
    expected: number;
    graded: number;
    asset_prefix: string | null;
  };
  tasks: FourTaskDef[];
  candidates: FourTaskCandidate[];
  batches: FourTaskBatch[];
}
