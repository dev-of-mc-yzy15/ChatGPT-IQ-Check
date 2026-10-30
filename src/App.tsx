import { useEffect, useMemo, useState } from "react";
import { loadAll } from "./data/loader";
import type { RadarBenchData, RoundData, StatusData } from "./types";
import { topCandidates } from "./lib/derive";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FreshnessBanner } from "./components/FreshnessBanner";
import { RoundDetail } from "./components/RoundDetail";
import { RoundMatrix } from "./components/RoundMatrix";
import { CandidateTable } from "./components/CandidateTable";
import { TrendChart } from "./components/TrendChart";
import { TrendControls } from "./components/TrendControls";
import { ThemeToggle } from "./components/ThemeToggle";
import { SkipLink } from "./components/SkipLink";

type Tab = "round" | "trend" | "about";

export default function App() {
  const [data, setData] = useState<{
    radarBench: RadarBenchData;
    round: RoundData;
    status: StatusData;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("round");
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  useEffect(() => {
    loadAll()
      .then((loaded) => {
        setData(loaded);
        setSelectedKeys(
          topCandidates(loaded.radarBench.candidates, 6).map(
            (c) => c.model + "|" + c.effort,
          ),
        );
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const selectedCandidate = useMemo(() => {
    if (!data || !selectedRound) return null;
    return (
      data.round.candidates.find(
        (c) => c.model + "|" + c.effort === selectedRound,
      ) ?? null
    );
  }, [data, selectedRound]);

  const trendCandidates = useMemo(() => {
    if (!data) return [];
    return data.radarBench.candidates.filter((c) =>
      selectedKeys.includes(c.model + "|" + c.effort),
    );
  }, [data, selectedKeys]);

  return (
    <ErrorBoundary>
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

        {error ? (
          <div className="card" role="alert">
            <p>加载数据失败：{error}</p>
            <button type="button" onClick={() => location.reload()}>
              重试
            </button>
          </div>
        ) : !data ? (
          <div className="card" role="status" aria-live="polite">
            加载中…
          </div>
        ) : (
          <>
            <FreshnessBanner
              status={data.status}
              roundUpdatedAt={data.round.round.updated_at}
            />

            <div role="tablist" aria-label="视图" style={{ display: "flex", gap: 8 }}>
              {(
                [
                  ["round", "本轮雷达"],
                  ["trend", "RadarBench 趋势"],
                  ["about", "关于"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "round" && (
              <>
                <RoundMatrix
                  round={data.round}
                  selectedKey={selectedRound}
                  onSelect={setSelectedRound}
                />
                <RoundDetail
                  candidate={selectedCandidate}
                  tasks={data.round.tasks}
                  round={data.round.round}
                />
              </>
            )}

            {tab === "trend" && (
              <>
                <TrendControls
                  rows={data.radarBench.candidates}
                  selectedKeys={selectedKeys}
                  onToggle={(key) =>
                    setSelectedKeys((prev) =>
                      prev.includes(key)
                        ? prev.filter((k) => k !== key)
                        : prev.length >= 6
                          ? prev
                          : [...prev, key],
                    )
                  }
                />
                <TrendChart candidates={trendCandidates} scoreMax={data.radarBench.score_max} />
                <CandidateTable
                  rows={data.radarBench.candidates}
                  selectedKeys={selectedKeys}
                  scoreMax={data.radarBench.score_max}
                  onToggle={(key) =>
                    setSelectedKeys((prev) =>
                      prev.includes(key)
                        ? prev.filter((k) => k !== key)
                        : prev.length >= 6
                          ? prev
                          : [...prev, key],
                    )
                  }
                />
              </>
            )}

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
                <p>
                  RadarBench 分数是 {data.radarBench.benchmark} 基准测试的加权分数（0–{data.radarBench.score_max}），
                  不是心理学 IQ。
                </p>
                <p>
                  降智信号：相邻日桶分数下降 ≥ 5 分，且覆盖率 ≥ 90%、评分状态为 complete。
                </p>
                <p>本项目与 OpenAI 无关联；数据版权归原站所有。</p>
                <p>源码许可：AGPL-3.0-or-later。</p>
              </section>
            )}
          </>
        )}

        {data && (
          <footer className="muted" style={{ fontSize: 12 }}>
            数据检查于 {data.status.checked_at} · 北京时间（UTC+8）· 来源 codexradar.com ·
            非官方项目
          </footer>
        )}
      </main>
    </ErrorBoundary>
  );
}