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
  round_ok: boolean;
  latest_graded_at: string | null;
  round_updated_at: string | null;
  stale_days: number;
  errors: string[];
}
