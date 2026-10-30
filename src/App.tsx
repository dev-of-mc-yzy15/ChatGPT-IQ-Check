import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { slotRadarBench, slotRound, slotStatus, type Slot } from "./data/loader";
import type { StatusData } from "./types";
import { topCandidates } from "./lib/derive";
import { candidateKey } from "../scripts/contract.mjs";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FreshnessBanner } from "./components/FreshnessBanner";
import { RoundDetail } from "./components/RoundDetail";
import { RoundMatrix } from "./components/RoundMatrix";
import { CandidateTable } from "./components/CandidateTable";
import { TrendChart } from "./components/TrendChart";
import { TrendControls } from "./components/TrendControls";
import { ThemeToggle } from "./components/ThemeToggle";
import { SkipLink } from "./components/SkipLink";
import { fmtDateTime } from "./lib/format";

type Tab = "round" | "trend" | "about";

/** tab 顺序即焦点顺序，方向键据此环绕。 */
const TABS: readonly (readonly [Tab, string])[] = [
  ["round", "本轮雷达"],
  ["trend", "RadarBench 趋势"],
  ["about", "关于"],
];

/** 一槽一状态：loading / 失败 / 成功互不影响，重试只重试自己。 */
function useSlot<T>(load: () => Promise<Slot<T>>) {
  const [slot, setSlot] = useState<Slot<T>>({ data: null, error: null });
  const [loading, setLoading] = useState(true);

  const run = useCallback(() => {
    let alive = true;
    setLoading(true);
    setSlot({ data: null, error: null });
    load().then((next) => {
      if (!alive) return;
      setSlot(next);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(run, [run]);

  return { slot, loading, retry: run };
}

function SlotFallback({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="card" role="alert">
      <strong>{label}加载失败</strong>
      <p className="muted">{error}</p>
      <p className="muted">其余数据不受影响，可单独重试。</p>
      <button type="button" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="card" role="status" aria-live="polite">
      正在加载{label}…
    </div>
  );
}

export default function App() {
  const radarBench = useSlot(slotRadarBench);
  const round = useSlot(slotRound);
  const status = useSlot(slotStatus);

  const [tab, setTab] = useState<Tab>("round");
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 左右方向键在 tablist 内环绕切换，焦点跟着走（ARIA tabs 键盘约定）。
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex(([key]) => key === tab);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + delta + TABS.length) % TABS.length;
    setTab(TABS[next][0]);
    tabRefs.current[next]?.focus();
  };

  const bench = radarBench.slot.data;
  const roundData = round.slot.data;
  const statusData: StatusData | null = status.slot.data;
  // 题数取数据里的 task_count（上游会随任务集轮换），文案不许写常量。
  const taskCount = roundData?.round.task_count ?? null;

  // 趋势默认选中：等雷达数据到位后取一次前 6 名。
  useEffect(() => {
    if (!bench) return;
    setSelectedKeys((prev) =>
      prev.length > 0 ? prev : topCandidates(bench.candidates, 6).map((c) => candidateKey(c.model, c.effort)),
    );
  }, [bench]);

  const selectedCandidate = useMemo(() => {
    if (!roundData || !selectedRound) return null;
    return roundData.candidates.find((c) => candidateKey(c.model, c.effort) === selectedRound) ?? null;
  }, [roundData, selectedRound]);

  const trendCandidates = useMemo(() => {
    if (!bench) return [];
    return bench.candidates.filter((c) => selectedKeys.includes(candidateKey(c.model, c.effort)));
  }, [bench, selectedKeys]);

  const toggleKey = (key: string) =>
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : prev.length >= 6 ? prev : [...prev, key],
    );

  return (
    <>
      <SkipLink />
      <main id="main">
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>降智雷达</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              非官方项目 · 分数是第三方基准测试分数，不是心理学 IQ
            </p>
          </div>
          <ThemeToggle />
        </header>

        <ErrorBoundary inline label="数据状态">
          {status.loading && !statusData ? (
            <Loading label="数据状态" />
          ) : status.slot.error ? (
            <SlotFallback label="数据状态" error={status.slot.error} onRetry={status.retry} />
          ) : (
            <FreshnessBanner status={statusData!} roundUpdatedAt={roundData?.round.updated_at ?? null} />
          )}
        </ErrorBoundary>

        <div
          role="tablist"
          aria-label="视图"
          style={{ display: "flex", gap: 8 }}
          onKeyDown={onTabKeyDown}
        >
          {TABS.map(([key, label], index) => (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`tab-${key}`}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* panel 常驻，只挂载当前内容：aria-controls 始终指向真实存在的 tabpanel。 */}
        <div
          role="tabpanel"
          id="panel-round"
          aria-labelledby="tab-round"
          tabIndex={0}
          hidden={tab !== "round"}
        >
          {tab === "round" && (
            <ErrorBoundary inline label="本轮雷达">
              {round.loading && !roundData ? (
                <Loading label="本轮雷达" />
              ) : round.slot.error ? (
                <SlotFallback label="本轮雷达" error={round.slot.error} onRetry={round.retry} />
              ) : (
                <>
                  <RoundMatrix round={roundData!} selectedKey={selectedRound} onSelect={setSelectedRound} />
                  <RoundDetail
                    candidate={selectedCandidate}
                    tasks={roundData!.tasks}
                    round={roundData!.round}
                  />
                </>
              )}
            </ErrorBoundary>
          )}
        </div>

        <div
          role="tabpanel"
          id="panel-trend"
          aria-labelledby="tab-trend"
          tabIndex={0}
          hidden={tab !== "trend"}
        >
          {tab === "trend" && (
            <ErrorBoundary inline label="RadarBench 趋势">
              {radarBench.loading && !bench ? (
                <Loading label="RadarBench 趋势" />
              ) : radarBench.slot.error ? (
                <SlotFallback
                  label="RadarBench 趋势"
                  error={radarBench.slot.error}
                  onRetry={radarBench.retry}
                />
              ) : (
                <>
                  <TrendControls rows={bench!.candidates} selectedKeys={selectedKeys} onToggle={toggleKey} />
                  <TrendChart candidates={trendCandidates} scoreMax={bench!.score_max} />
                  <CandidateTable
                    rows={bench!.candidates}
                    selectedKeys={selectedKeys}
                    scoreMax={bench!.score_max}
                    onToggle={toggleKey}
                  />
                </>
              )}
            </ErrorBoundary>
          )}
        </div>

        <div
          role="tabpanel"
          id="panel-about"
          aria-labelledby="tab-about"
          tabIndex={0}
          hidden={tab !== "about"}
        >
          {tab === "about" && (
            <section className="card">
              <h2>关于</h2>
              <p>
                数据来源：
                <a href="https://codexradar.com/" target="_blank" rel="noreferrer">
                  codexradar.com
                </a>{" "}
                的公开接口。
              </p>
              {bench && (
                <p>
                  RadarBench 分数是{taskCount != null ? `${taskCount} 题` : ""}基准测试（
                  {bench.benchmark}）的加权分数（0–{bench.score_max}），不是心理学 IQ。
                </p>
              )}
              <p>降智信号：相邻日桶分数下降 ≥ 5 分，且覆盖率 ≥ 90%、评分状态为 complete。</p>
              <p>本项目与 OpenAI 无关联；数据版权归原站所有。</p>
              <p>源码许可：AGPL-3.0-or-later。</p>
            </section>
          )}
        </div>

        <footer className="muted" style={{ fontSize: 12 }}>
          数据检查于 {statusData ? fmtDateTime(statusData.checked_at) : "（未取到）"} · 北京时间（UTC+8）· 来源
          codexradar.com · 非官方项目
        </footer>
      </main>
    </>
  );
}
