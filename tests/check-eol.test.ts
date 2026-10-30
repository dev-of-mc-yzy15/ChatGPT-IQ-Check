import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * check-eol.mjs 的换行闸门测试。
 *
 * 闸门本身只有四种结局，缺一条就等于留一条假绿通道——尤其是「假绿」这种最难在
 * review 里看见的：闸门退 0、CI 全绿、约定其实已经破了。
 *
 * 已实测的两个假绿形态，就是本文件第 2、3 条：
 *   - 缺换行时把结论写到 stdout：闸门退 1 了，但 CI 日志里一眼看不出，且断言
 *     「stderr 有东西」的守卫会失效。
 *   - 工作区删掉已跟踪文件时 `catch { continue; }` 直接吞掉：`git ls-files` 照样
 *     列出该路径（清单来自 index），`readFileSync` 抛 ENOENT 被吞，脚本一次都不报
 *     违规，直接打出「均以换行结尾」过闸——文件都没了还说它换行合规。
 *
 * 一律用真子进程跑脚本，不 import 内部函数：脚本是 `main()` 自执行的一次性 CLI，
 * 测它的模块内函数测不到「退出码」与「写到哪个流」这两件真正决定 CI 红绿的事。
 *
 * 夹具造在 os.tmpdir() 的临时目录里，用 cwd 指过去（脚本读的是相对 cwd 的
 * `git ls-files`，CI 也是在仓库根直接跑）。迷你仓库是必须的：真仓库删文件/去换行
 * 会互相踩，而第 4 条又正好需要一个「不在任何仓库里」的目录——就用迷你仓库的父目录。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts/check-eol.mjs");

/**
 * 强制英文报错：第 4 条要断言 git 自己的 `not a git repository`，不能随宿主 locale 漂。
 * Node 写 stdout 与 locale 无关，中文文案照旧。
 */
const GIT_ENV: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

const created: string[] = [];

afterEach(async () => {
  // .git 目录在 Windows 上偶尔有短暂占用，给几次重试。
  await Promise.all(
    created.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })),
  );
});

/** 跑 git，失败直接抛（夹具自身坏掉要当场炸，不能带病继续断言）。 */
function git(args: string[], cwd: string): void {
  const out = spawnSync(
    "git",
    [
      "-c",
      "user.email=check-eol@example.invalid",
      "-c",
      "user.name=check-eol",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "safe.directory=*",
      ...args,
    ],
    { cwd, encoding: "utf8", env: GIT_ENV },
  );
  if (out.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} 退出 ${out.status}\n${out.stdout ?? ""}${out.stderr ?? ""}`,
    );
  }
}

/**
 * 造一个迷你仓库：两个已跟踪文本文件都带末尾换行，已提交。
 * 返回父目录（它本身不在任何仓库里，第 4 条用）与两个文件的绝对路径。
 */
async function makeRepo(): Promise<{ parent: string; root: string; clean: string; bare: string }> {
  const parent = await mkdtemp(join(tmpdir(), "check-eol-"));
  created.push(parent);
  const root = join(parent, "repo");
  await mkdir(root);

  git(["init", "-b", "main"], root);
  // 宿主全局的 autocrlf 不能进来搅局：断言针对的是工作区字节。
  git(["config", "core.autocrlf", "false"], root);

  const clean = join(root, "notes.txt");
  const bare = join(root, "draft.md");
  await writeFile(clean, "第一行\n第二行\n", "utf8");
  await writeFile(bare, "# 标题\n\n正文\n", "utf8");
  git(["add", "."], root);
  git(["commit", "-m", "fixture"], root);

  return { parent, root, clean, bare };
}

function run(cwd: string) {
  const out = spawnSync(process.execPath, [script], { cwd, encoding: "utf8", env: GIT_ENV });
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

/** 成功时唯一该出现的文案。它一旦出现在失败的 stdout 里，就是假绿。 */
const OK_TEXT = "均以换行结尾";

describe("check-eol", () => {
  // ── 绿：全部合规必须退 0，且不往 stderr 写噪音 ──
  it("全部已跟踪文件都以换行结尾时退 0", async () => {
    const { root } = await makeRepo();

    const r = run(root);

    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(OK_TEXT);
    expect(r.stderr).toBe("");
  });

  // ── 红：缺末尾换行。结论必须落在 stderr，否则 CI 日志与守卫都看不见 ──
  it("已跟踪文件末尾缺换行时退 1，点名该文件写到 stderr", async () => {
    const { root, bare } = await makeRepo();
    // 只改工作区、不提交：闸门判的是工作区字节，不看 index。
    await writeFile(bare, "# 标题\n\n没有末尾换行的一行", "utf8");

    const r = run(root);

    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain("draft.md");
    // 合规的那个文件不能被顺手点名，否则「点名」不成立。
    expect(r.stderr).not.toContain("notes.txt");
    expect(r.stderr).toContain("缺文件末尾换行");
    expect(r.stdout).not.toContain(OK_TEXT);
  });

  // ── 红（假绿那一格）：已跟踪但工作区被删。清单来自 index，读文件必须失败即报 ──
  it("工作区删掉已跟踪文件时退 1，说明读取失败", async () => {
    const { root, clean } = await makeRepo();
    await rm(clean, { force: true });
    // 夹具自检：文件真没了才有意义，删失败会让这条退化成「全合规」假验。
    expect(existsSync(clean), "夹具文件必须先真的删掉").toBe(false);

    const r = run(root);

    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain("notes.txt");
    expect(r.stderr).toContain("读取失败");
    // 空清单会被吞成「均以换行结尾」——这正是简化版假绿的出口。
    expect(r.stdout).not.toContain(OK_TEXT);
  });

  // ── 红：不在仓库里。git 失败的空清单不能被当成「零违规」 ──
  it("在非 git 目录下跑时退 1 并透出 git 的 not a git repository", async () => {
    const { parent } = await makeRepo();
    // 前置：父目录必须在任何仓库之外，否则这条测的不是想要的东西。
    const probe = spawnSync("git", ["rev-parse", "--git-dir"], {
      cwd: parent,
      encoding: "utf8",
      env: GIT_ENV,
    });
    expect(probe.status, "夹具父目录不能在某个仓库里").not.toBe(0);

    const r = run(parent);

    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).not.toBe("");
    expect(r.stderr).toContain("not a git repository");
    expect(r.stdout).not.toContain(OK_TEXT);
  });
});
