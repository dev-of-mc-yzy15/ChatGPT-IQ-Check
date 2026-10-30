import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = resolve(repoRoot, ".github/workflows");
const load = (name: string) => parse(readFileSync(resolve(workflowsDir, name), "utf8"));

describe("workflows", () => {
  it("refresh-data uses Node 24, no npm ci, and a timeout", () => {
    const wf = load("refresh-data.yml");
    expect(wf.jobs.refresh["timeout-minutes"]).toBe(10);
    // 按 uses 找而不是按下标：中间插一个 step 就整条断言错位到别的对象上。
    const setup = wf.jobs.refresh.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith("actions/setup-node"),
    );
    expect(setup?.with["node-version"]).toBe("24");
    expect(JSON.stringify(wf)).not.toContain("npm ci");
    expect(wf.permissions.contents).toBe("write");
  });

  it("refresh-data suppresses the push event so deploy is not double-triggered and reports failures or cancellations", () => {
    const wf = load("refresh-data.yml");
    expect(JSON.stringify(wf)).toContain("[skip ci]");
    // 失败时要能被看见，不能静默烂掉。取消时同样要开 issue，所以实现是
    // `failure() || cancelled()`——用包含匹配，只要求覆盖到 failure，不钉字面量。
    expect(
      wf.jobs.refresh.steps.some(
        (s: { if?: string }) => typeof s.if === "string" && s.if.includes("failure()"),
      ),
    ).toBe(true);
  });

  it("deploy gates workflow_run on success and scopes permissions", () => {
    const wf = load("deploy.yml");
    expect(wf.jobs.build.if).toContain("workflow_run.conclusion == 'success'");
    expect(wf.jobs.deploy.permissions.pages).toBe("write");
    expect(wf.jobs.deploy.permissions["id-token"]).toBe("write");
    expect(wf.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("ci verifies every pull request without publish permissions", () => {
    const wf = load("ci.yml");
    expect(Object.keys(wf.on)).toContain("pull_request");
    expect(wf.permissions.contents).toBe("read");
    expect(wf.permissions.pages).toBeUndefined();
    const runs: string[] = wf.jobs.verify.steps
      .map((s: { run?: string }) => s.run)
      .filter(Boolean);
    expect(runs).toEqual(expect.arrayContaining(["npm test", "npm run build"]));
    // A-9：scripts 的 checkJs 闸门必须真的在 CI 里跑到。闸门可以独立成 step，也可以
    // 并进 build——所以照 build 脚本展开一层按命令判断，不钉 step 数量与顺序。
    const executed = `${runs.join("\n")}\n${JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).scripts.build}`;
    expect(executed).toContain("tsc -b");
    expect(executed).toContain("typecheck:scripts");
    // 安装期不跑任意 install script。
    expect(executed).toContain("npm ci --ignore-scripts");
  });

  // 子路径部署的产物闸门：check:base 读的是 dist/index.html，不是源码。放在 build
  // 之前就会读到上一次构建的陈旧产物、甚至读不到直接红，闸门等于白设。
  it("ci runs check:base after build so the subpath gate reads a fresh build", () => {
    const wf = load("ci.yml");
    const runs: string[] = wf.jobs.verify.steps
      .map((s: { run?: string }) => s.run)
      .filter(Boolean);
    const build = runs.indexOf("npm run build");
    const check = runs.indexOf("npm run check:base");
    expect(build, "build 步骤必须还在").toBeGreaterThanOrEqual(0);
    expect(check, "check:base 步骤必须进 CI").toBeGreaterThanOrEqual(0);
    expect(check, "check:base 必须排在 build 之后").toBeGreaterThan(build);
  });

  it("scripts are covered by the checkJs gate", () => {
    const cfg = JSON.parse(readFileSync(resolve(repoRoot, "tsconfig.scripts.json"), "utf8"));
    expect(cfg.compilerOptions.checkJs).toBe(true);
    expect(cfg.include).toEqual(["scripts"]);
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    expect(pkg.scripts.build).toContain("typecheck:scripts");
  });

  // P1-21：日更失败会天天触发，同一标题天天新开 issue 会把看板淹掉。
  it("refresh-data reuses an open issue instead of filing a new one every day", () => {
    const wf = load("refresh-data.yml");
    const step = wf.jobs.refresh.steps.find(
      (s: { name?: string }) => s.name === "Open issue on failure",
    );
    expect(step, "失败上报步骤必须还在").toBeTruthy();
    const run: string = step.run
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line !== "" && !line.startsWith("#"))
      .join("\n");
    // 必须真的查过 open issue（带 --json 才算结构化查询，纯文本 grep 会误判）。
    expect(run).toContain("gh issue list");
    expect(run).toContain("--state open");
    expect(run).toContain("--json");
    // 查必须在建之前。
    expect(run.indexOf("gh issue list")).toBeLessThan(run.indexOf("gh issue create"));
    // 必须有分支，不能查了不用。
    expect(run).toMatch(/if \[.*\]; then/);
    expect(run).toContain("else");
    expect(run).toContain("fi");
    // 复用路径要能留下痕迹，不能静默跳过。
    expect(run).toContain("gh issue comment");
    // 复用不能把权限缩掉。
    expect(wf.permissions.contents).toBe("write");
    expect(wf.permissions.issues).toBe("write");
  });

  // P1-21：先 commit 再 pull --rebase --autostash，rebase 会把本地提交和远端提交搅在一起。
  it("refresh-data syncs with main before committing", () => {
    const wf = load("refresh-data.yml");
    const step = wf.jobs.refresh.steps.find(
      (s: { name?: string }) => s.name === "Commit data if changed",
    );
    expect(step, "提交步骤必须还在").toBeTruthy();
    // 只看真正会执行的命令行，注释里提到旧写法不该干扰断言。
    const run: string = step.run
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line !== "" && !line.startsWith("#"))
      .join("\n");
    const at = (needle: string) => {
      const i = run.indexOf(needle);
      expect(i, `缺少 ${needle}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    // 顺序：fetch → rebase → commit → push。
    expect(at("git fetch")).toBeLessThan(at("git rebase"));
    expect(at("git rebase")).toBeLessThan(at("git commit"));
    expect(at("git commit")).toBeLessThan(at("git push"));
    // 冲突出现在提交之前才算真正解决，不能再靠 autostash 事后找补。
    expect(run).not.toContain("--autostash");
    expect(run).not.toContain("git pull");
    // 浅克隆没有 merge-base，rebase 会直接失败，必须拉全历史。
    const checkout = wf.jobs.refresh.steps.find((s: { uses?: string }) =>
      String(s.uses ?? "").startsWith("actions/checkout"),
    );
    expect(checkout.with["fetch-depth"]).toBe(0);
    // 未变更时仍然要能安静退出，不白跑 rebase。
    expect(run).toContain("no data change");
  });

  // P1-22：刷新脚本改了却不重新部署，等于发布了个没人测的构建。
  it("changing a script triggers a deploy", () => {
    const wf = load("deploy.yml");
    expect(wf.on.push.paths).toContain("scripts/**");
    // 原有白名单不能被顶掉。
    for (const p of ["src/**", "tests/**", "public/data/**", ".github/workflows/**"]) {
      expect(wf.on.push.paths).toContain(p);
    }
  });

  it("deploy is reachable from both push and refresh-data completion", () => {
    const wf = load("deploy.yml");
    const triggers = Object.keys(wf.on);
    expect(triggers).toEqual(expect.arrayContaining(["push", "workflow_run", "workflow_dispatch"]));
    expect(wf.on.workflow_run.workflows).toContain("refresh-data");
  });
});
