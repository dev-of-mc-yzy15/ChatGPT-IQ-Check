import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * verify-assets.mjs 的行为闸门测试。
 *
 * 这个脚本是 README 里「逐个比对上游 asset_sha256」那句话的唯一可复跑证据，
 * 所以每条失败分类都要有独立用例——分类漏一条，闸门就会在真出问题时静默放绿。
 *
 * 一律在 os.tmpdir() 里造迷你仓库，并用 --root 指过去：真仓库有 34 个 20KB 级资产，
 * 拿真仓库当夹具既慢又会让用例随上游数据漂移。cwd 也一起换掉，顺带证明脚本不依赖 cwd。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts/verify-assets.mjs");

/**
 * `NAME` 是上游 `asset_url` 里的 basename，带 `.html.txt`——`round.json` 是上游快照，永远长这样。
 * `LOCAL_NAME` 是它落在 `public/assets/` 的真实文件名（去掉 `.txt`，托管才会回 `text/html`）。
 * 夹具必须照这个真实形状造：数据写上上游名、文件落本地名。少了任何一半都测不到那条映射。
 */
const NAME =
  "degradation-codex-205416a78068-6a72489e707c-gpt-6.1-sol-low-69d67bc51db3.html.txt";
const LOCAL_NAME = NAME.slice(0, -".txt".length);
const BODY = "<html><body>pelican</body></html>\n";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** 造一个最小的合法仓库骨架：round.json + assets/ 都要能被脚本按约定路径找到。 */
async function makeRepo(assetBody: string | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "verify-assets-"));
  await mkdir(join(root, "public", "data"), { recursive: true });
  await mkdir(join(root, "public", "assets"), { recursive: true });
  if (assetBody !== null) {
    await writeFile(join(root, "public", "assets", LOCAL_NAME), assetBody);
  }
  return root;
}

/** 只写数据不建目录，用于「assets/ 目录整体不存在」用例。 */
async function makeRepoWithoutAssets(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "verify-assets-"));
  await mkdir(join(root, "public", "data"), { recursive: true });
  return root;
}

type Anim = { asset_url: string | null; asset_sha256: string | null };

/** animation 单数形态：上游 round.json 的既有结构。 */
async function writeRound(root: string, animations: Anim[]): Promise<void> {
  const candidates = animations.map((animation) => ({ model: "m", effort: "e", animation }));
  await writeFile(
    join(root, "public", "data", "round.json"),
    JSON.stringify({ candidates }, null, 2),
  );
}

/** animation 数组形态：任务书按 animations[] 描述，两种都得认。 */
async function writeRoundPlural(root: string, animations: Anim[]): Promise<void> {
  const candidates = [{ model: "m", effort: "e", animations }];
  await writeFile(
    join(root, "public", "data", "round.json"),
    JSON.stringify({ candidates }, null, 2),
  );
}

function run(root: string, extra: string[] = []) {
  const out = spawnSync(process.execPath, [script, "--root", root, ...extra], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

const created: string[] = [];
async function repo(assetBody: string | null = BODY): Promise<string> {
  const root = await makeRepo(assetBody);
  created.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verify-assets", () => {
  it("全部命中时退出 0，只有 ok 计数非零", async () => {
    const root = await repo();
    await writeRound(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY) }]);

    const r = run(root);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("ok=1 missing=0 mismatch=0 unpinned=0 orphan=0");
  });

  it("资产被改一个字节即 mismatch 并退出 1", async () => {
    const root = await repo(`${BODY} `);
    await writeRound(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY) }]);

    const r = run(root);

    expect(r.code).toBe(1);
    // 必须点名是哪个文件，否则 CI 日志里只知道「有东西不符」，定位还得靠猜。
    expect(r.stdout).toContain("mismatch");
    expect(r.stdout).toContain(LOCAL_NAME);
    // 期望值与实际值都要打出来，才够人肉复核。
    expect(r.stdout).toContain(sha256(BODY));
    expect(r.stdout).toContain(sha256(`${BODY} `));
  });

  it("资产缺失即 missing 并退出 1", async () => {
    const root = await repo(null);
    await writeRound(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY) }]);

    const r = run(root);

    expect(r.code).toBe(1);
    expect(r.stdout).toContain("missing");
    expect(r.stdout).toContain(LOCAL_NAME);
  });

  it("asset_sha256 为 null 即 unpinned 并退出 1", async () => {
    // 没钉哈希等于没校验，不能因为文件存在就放过——那正是「已逐个比对」这句话的漏洞。
    const root = await repo();
    await writeRound(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: null }]);

    const r = run(root);

    expect(r.code).toBe(1);
    expect(r.stdout).toContain("unpinned");
    expect(r.stdout).toContain(LOCAL_NAME);
  });

  it("数据未引用的多余文件只在孤儿段报告，不判失败", async () => {
    const root = await repo();
    await writeRound(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY) }]);
    await writeFile(join(root, "public", "assets", "degradation-stray.html"), "stray");

    const r = run(root);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("orphan");
    expect(r.stdout).toContain("degradation-stray.html");
    expect(r.stdout).toContain("ok=1 missing=0 mismatch=0 unpinned=0 orphan=1");
  });

  it("assets/ 目录不存在时退出 1 且说明原因", async () => {
    const root = await makeRepoWithoutAssets();
    created.push(root);
    await writeRound(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY) }]);

    const r = run(root);

    expect(r.code).toBe(1);
    // 必须有中文原因。只断言含 "assets" 太弱：脚本文件压根不存在时，
    // Node 的 MODULE_NOT_FOUND 栈里也带 "assets" 字样，会假绿。
    expect(r.stdout + r.stderr).toContain("不存在");
    expect(r.stdout + r.stderr).toContain("assets");
  });

  it("上游 .html.txt 映射到本地 .html 文件校验", async () => {
    // 这是当前约定的核心：round.json 是上游快照、asset_url 永远是 .html.txt，
    // 而本地按 .html 落盘才能让托管回 text/html（iframe 要 src 加载）。
    // 少了这条映射，闸门会拿上游名找本地文件，34 条全部假 missing。
    const root = await repo();
    await writeRound(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY) }]);

    const r = run(root);

    expect(r.code).toBe(0);
    // 命中项必须指向真实存在的那个文件，否则按输出去修会找不到。
    expect(r.stdout).toContain(`ok        public/assets/${LOCAL_NAME}`);
    // 映射后的名字才算命中：`.txt` 没去干净的话这里会落成 missing。
    expect(r.stdout).toContain("missing=0");
    expect(r.stdout).toContain("mismatch=0");
    // 多余的非预期后缀不应被造出来。
    expect(r.stdout).not.toContain(".html.txt");
  });

  it("上游本来就不带 .txt 时原样使用，不被改写成 .html", async () => {
    // 反向保护：只有末尾 .html.txt 才映射。上游哪天换命名（比如已经是 .html），
    // 无脑截断会把名字改坏。
    const root = await repo();
    const plain = NAME.slice(0, -".txt".length);
    await writeRound(root, [{ asset_url: `/assets/${plain}`, asset_sha256: sha256(BODY) }]);

    const r = run(root);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`ok        public/assets/${plain}`);
  });

  it("哈希比较不分大小写", async () => {
    // 上游哈希大小写不保证，sha256 本身也没有大小写语义，逐字节比会误报。
    const root = await repo();
    await writeRound(root, [
      { asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY).toUpperCase() },
    ]);

    const r = run(root);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("ok=1");
  });

  it("认 animations[] 复数形态", async () => {
    const root = await repo();
    await writeRoundPlural(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY) }]);

    const r = run(root);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("ok=1");
  });

  it("--json 输出可被解析且分类齐全", async () => {
    const root = await repo();
    await writeRound(root, [{ asset_url: `/assets/${NAME}`, asset_sha256: sha256(BODY) }]);

    const r = run(root, ["--json"]);

    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toHaveLength(1);
    expect(parsed.counts).toMatchObject({ ok: 1, missing: 0, mismatch: 0, unpinned: 0, orphan: 0 });
  });

  it("round.json 读不到时退出 1", async () => {
    const root = await repo();

    const r = run(root);

    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("round.json");
    // 同样钉住中文原因，避免「脚本不存在」被当成「数据读不到」混过去。
    expect(r.stdout + r.stderr).toContain("读不到");
  });

  it("数据里一条 asset_url 都没有时也算空跑，退出 1", async () => {
    // 全零计数最容易假绿：candidates 洗空了同样打印 ok=0 missing=0…，看着一切正常。
    const root = await repo();
    await writeRound(root, []);

    const r = run(root);

    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("没有声明");
  });

  it("默认 root 取脚本上两级目录", async () => {
    // 不带 --root 时必须自己定位到仓库根，否则 CI 里只能靠 cwd 碰运气。
    const out = spawnSync(process.execPath, [script], { cwd: tmpdir(), encoding: "utf8" });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("ok=34");
  });

  it("真实仓库的资产全部钉了哈希", async () => {
    const raw = await readFile(resolve(repoRoot, "public", "data", "round.json"), "utf8");
    const parsed = JSON.parse(raw) as { candidates?: { animation?: Anim }[] };
    // 数据本身漂了这里会先炸，比在下游读到一个「ok=0」更早暴露问题。
    expect(parsed.candidates?.length).toBe(34);
    const pinned = parsed.candidates?.filter((c) => c.animation?.asset_sha256) ?? [];
    expect(pinned).toHaveLength(34);
  });
});
