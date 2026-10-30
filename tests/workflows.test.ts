import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const workflowsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../.github/workflows");
const load = (name: string) => parse(readFileSync(resolve(workflowsDir, name), "utf8"));

describe("workflows", () => {
  it("refresh-data uses Node 24, no npm ci, and a timeout", () => {
    const wf = load("refresh-data.yml");
    expect(wf.jobs.refresh["timeout-minutes"]).toBe(10);
    expect(wf.jobs.refresh.steps[1].with["node-version"]).toBe("24");
    expect(JSON.stringify(wf)).not.toContain("npm ci");
    expect(wf.permissions.contents).toBe("write");
  });

  it("refresh-data suppresses the push event so deploy is not double-triggered", () => {
    const wf = load("refresh-data.yml");
    expect(JSON.stringify(wf)).toContain("[skip ci]");
    // 失败时要能被看见，不能静默烂掉。
    expect(wf.jobs.refresh.steps.some((s: { if?: string }) => s.if === "failure()")).toBe(true);
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
    const runs = wf.jobs.verify.steps.map((s: { run?: string }) => s.run).filter(Boolean);
    expect(runs).toEqual(expect.arrayContaining(["npm test", "npx tsc -b", "npm run build"]));
  });

  it("deploy is reachable from both push and refresh-data completion", () => {
    const wf = load("deploy.yml");
    const triggers = Object.keys(wf.on);
    expect(triggers).toEqual(expect.arrayContaining(["push", "workflow_run", "workflow_dispatch"]));
    expect(wf.on.workflow_run.workflows).toContain("refresh-data");
  });
});
