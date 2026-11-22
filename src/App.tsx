import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { slotFourTask, slotRadarBench, slotRatings, slotRound, slotStatus, type Slot } from "./data/loader";
import type { StatusData } from "./types";
import { MAX_TREND_SERIES, topCandidates } from "./lib/derive";
import { candidateKey } from "../scripts/contract.mjs";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FreshnessBanner } from "./components/FreshnessBanner";
import { RoundDetail } from "./components/RoundDetail";
import { RoundMatrix } from "./components/RoundMatrix";
import { CandidateTable } from "./components/CandidateTable";
import { TrendChart } from "./components/TrendChart";
import { TrendControls } from "./components/TrendControls";
import { CommunityRatings } from "./components/CommunityRatings";
import { FourTaskPanel } from "./components/FourTaskPanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { SkipLink } from "./components/SkipLink";
import { fmtDateTime } from "./lib/format";
import { OverviewHero } from "./components/OverviewHero";

type Tab = "round" | "four" | "trend" | "about";

/** tab 顺序即焦点顺序，方向键据此环绕。 */
const TABS: readonly (readonly [Tab, string])[] = [
  ["round", "本轮雷达"],
  // 四题排第二：它是上游现在唯一还在更新的口径，旧的 RadarBench 已冻结在 10-24。
  ["four", "四题竞技场"],
  ["trend", "RadarBench 趋势"],
  ["about", "关于"],
];

function TabIcon({ tab }: { tab: Tab }) {
  const paths: Record<Tab, ReactNode> = {
    round: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M12 2v4M22 12h-4M12 22v-4M2 12h4" /></>,
    four: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    trend: <><path d="M3 18 9 12l4 4 8-10" /><path d="M15 6h6v6" /></>,
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  };
  return <svg className="seg__icon" viewBox="0 0 24 24" aria-hidden="true">{paths[tab]}</svg>;
}

/**
 * 一槽一状态：loading / 失败 / 成功互不影响，重试只重试自己。
 * 单调请求号：只有最新一次请求的落点能写状态。连点重试会并发两个请求，
 * 慢的先生后到，不挡住就会覆盖掉快的那个，画面回滚成旧数据。
 */
function useSlot<T>(load: () => Promise<Slot<T>>) {
  const [slot, setSlot] = useState<Slot<T>>({ data: null, error: null });
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setSlot({ data: null, error: null });
    load().then((next) => {
      // 已经不是最新一发了：结果是过期的，直接丢掉。
      if (seq.current !== id) return;
      setSlot(next);
      setLoading(false);
    });
    return () => {
      // 卸载或重跑：让在途请求失效，避免卸载后回写。
      seq.current++;
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
      {/* 可访问名带上槽名：同屏可能出现好几个「重试」，只靠可见文本语音用户分不清要点哪个。 */}
      <button type="button" className="btn-ghost" aria-label={`重试${label}`} onClick={onRetry}>
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
  // 第四槽：社区体感是可选源，单独一槽，失败只塌这张卡片。
  const ratings = useSlot(slotRatings);
  // 第五槽：四题协议。与旧雷达链完全独立，旧链挂掉不影响这屏。
  const fourTask = useSlot(slotFourTask);

  const [tab, setTab] = useState<Tab>("round");
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 方向键在 tablist 内环绕切换，焦点跟着走；Home/End 直取首尾（ARIA tabs 键盘约定）。
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
    event.preventDefault();
    const index = TABS.findIndex(([key]) => key === tab);
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? TABS.length - 1
          : (index + (key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next][0]);
    tabRefs.current[next]?.focus();
  };

  const bench = radarBench.slot.data;
  const roundData = round.slot.data;
  const statusData: StatusData | null = status.slot.data;
  // 题数取数据里的 task_count（上游会随任务集轮换），文案不许写常量。
  const taskCount = roundData?.round.task_count ?? null;

  // 趋势默认选中：等雷达数据到位后取一次前 N 名。
  useEffect(() => {
    if (!bench) return;
    setSelectedKeys((prev) =>
      prev.length > 0 ? prev : topCandidates(bench.candidates, MAX_TREND_SERIES).map((c) => candidateKey(c.model, c.effort)),
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
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : prev.length >= MAX_TREND_SERIES
          ? prev
          : [...prev, key],
    );

  return (
    <>
      <SkipLink />
      <main id="main" tabIndex={-1}>
        <header className="masthead">
          <div className="masthead__brand">
            <svg className="masthead__mark" viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r="15" /><circle cx="22" cy="22" r="9" />
              <path d="M22 3v7M41 22h-7M22 41v-7M3 22h7" />
              <path className="masthead__sweep" d="m22 22 11-11A15 15 0 0 1 37 22Z" />
              <circle className="masthead__point" cx="29" cy="18" r="2" />
            </svg>
            <div>
              <h1>降智雷达</h1>
              <p className="masthead__sub" lang="en">CHATGPT IQ CHECK</p>
            </div>
          </div>
          <div className="masthead__actions">
            <a className="source-link" href="https://codexradar.com/" target="_blank" rel="noreferrer">
              <span className="live-dot" aria-hidden="true" /> 数据来自 CodexRadar <span aria-hidden="true">↗</span>
            </a>
            <span className="masthead__divider" aria-hidden="true" />
            <a
              className="icon-link"
              aria-label="GitHub 源代码"
              href="https://github.com/dev-of-mc-yzy15/ChatGPT-IQ-Check"
              target="_blank"
              rel="noreferrer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7.4A5.8 5.8 0 0 0 19.3 3 5.4 5.4 0 0 0 19.1-1S17.9-1.4 15 1a13.4 13.4 0 0 0-7 0C5.1-1.4 4-1 4-1a5.4 5.4 0 0 0-.2 4A5.8 5.8 0 0 0 2.2 7c0 5.8 3.5 7 6.8 7.4A4.8 4.8 0 0 0 8 18v4M8 19c-3 .9-3-1.5-4-2" transform="translate(1 2) scale(.86)" /></svg>
            </a>
            <ThemeToggle />
          </div>
        </header>

        <OverviewHero round={roundData} status={statusData} />

        <div className="freshness-slot">
          <ErrorBoundary inline label="数据状态">
            {status.loading && !statusData ? (
              <Loading label="数据状态" />
            ) : status.slot.error ? (
              <SlotFallback label="数据状态" error={status.slot.error} onRetry={status.retry} />
            ) : (
              <FreshnessBanner status={statusData!} roundUpdatedAt={roundData?.round.updated_at ?? null} />
            )}
          </ErrorBoundary>
        </div>

        <div className="workspace-heading">
          <div><p className="eyebrow">EXPLORE THE DATA</p><h2>数据观测台</h2></div>
          <p>切换视图，深入每一次评测结果</p>
        </div>
        <div role="tablist" aria-label="视图" className="seg" onKeyDown={onTabKeyDown}>
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
              <TabIcon tab={key} /><span>{label}</span>
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
                  {/* 体感放详情之后：先看矩阵与逐题，再往下才是主观投票，别抢主视图的位置。 */}
                  <ErrorBoundary inline label="社区体感">
                    {ratings.loading && !ratings.slot.data ? (
                      <Loading label="社区体感" />
                    ) : ratings.slot.error ? (
                      <SlotFallback
                        label="社区体感"
                        error={ratings.slot.error}
                        onRetry={ratings.retry}
                      />
                    ) : (
                      <CommunityRatings data={ratings.slot.data!} />
                    )}
                  </ErrorBoundary>
                </>
              )}
            </ErrorBoundary>
          )}
        </div>

        <div
          role="tabpanel"
          id="panel-four"
          aria-labelledby="tab-four"
          tabIndex={0}
          hidden={tab !== "four"}
        >
          {tab === "four" && (
            <ErrorBoundary inline label="四题竞技场">
              {fourTask.loading && !fourTask.slot.data ? (
                <Loading label="四题竞技场" />
              ) : fourTask.slot.error ? (
                <SlotFallback
                  label="四题竞技场"
                  error={fourTask.slot.error}
                  onRetry={fourTask.retry}
                />
              ) : (
                <FourTaskPanel data={fourTask.slot.data!} />
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
            <section className="card about-card">
              <p className="eyebrow">ABOUT THE PROJECT</p>
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
                  <span lang="en">{bench.benchmark}</span>）的加权分数（0–{bench.score_max}），不是心理学 IQ。
                </p>
              )}
              <p>降智信号：相邻日桶分数下降 ≥ 5 分，且覆盖率 ≥ 90%、评分状态为 complete。</p>
              <p>本项目与 OpenAI 无关联；数据版权归原站所有。</p>
              {/* AGPL-3.0 §13：与本程序网络交互的访问者必须拿得到 Corresponding Source。 */}
              <p>
                源码许可以 AGPL-3.0-or-later 发布，
                <a
                  href="https://github.com/dev-of-mc-yzy15/ChatGPT-IQ-Check"
                  target="_blank"
                  rel="noreferrer"
                >
                  源代码在此
                </a>
                。
              </p>
            </section>
          )}
        </div>

        <footer>
          <div className="footer__brand"><strong>降智雷达</strong><span>保持观察，而非断言。</span></div>
          <div className="footer__meta">
            <span>数据检查于 {statusData ? fmtDateTime(statusData.checked_at) : "（未取到）"} · UTC+8 · 非官方项目</span>
            <a href="https://github.com/dev-of-mc-yzy15/ChatGPT-IQ-Check" target="_blank" rel="noreferrer">
              源代码 <span aria-hidden="true">↗</span>
            </a>
          </div>
        </footer>
      </main>
    </>
  );
}
