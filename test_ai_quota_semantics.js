/**
 * v1.2.9：AI 侧配额语义回归测试
 *
 * 背景（用户实测反馈）：
 *   上一版按「尝试次数」计配额，AI 连续输出工具日志，3 分钟就把 60 次额度刷满，
 *   之后整整一小时用户真正说的话一条也记不进来 —— 配额本该防刷屏，却拦住了重要信息。
 *
 * 本测试要钉住的语义：
 *   1. 规则能拦下的操作流水，不消耗配额（拦多少都不影响）
 *   2. 只有真正写进库的记忆才计入小时配额
 *   3. 配额用尽时，跳过原因必须明确写「已记满」，不能伪装成「模型判断无需记忆」
 */
const path = require("path");
const fs = require("fs");

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } }

const ROOT = path.resolve(__dirname);
const SRC = fs.readFileSync(path.join(ROOT, "src/ai-extract.ts"), "utf8");

console.log("=== 1. 配额按「已写入条数」而非「尝试次数」 ===");
ok(/aiSideHourSaved/.test(SRC), "存在 aiSideHourSaved 字段");
ok(/const savedThisHour = st\.aiSideHourSaved \|\| 0;/.test(SRC), "配额判断读的是 savedThisHour");
ok(/if \(savedThisHour >= cap\)/.test(SRC), "限流条件是 savedThisHour >= cap");
ok(!/if \(\(st\.aiSideCallCount \|\| 0\) >= cap\)/.test(SRC), "旧逻辑（按尝试次数）已移除");

console.log("\n=== 2. 只有写入成功才累加配额 ===");
ok(/st\.aiSideHourSaved = \(st\.aiSideHourSaved \|\| 0\) \+ rows\.length;/.test(SRC),
  "markRemembered 里按 rows.length 累加");
// 计数块里不应再出现「调用前就扣配额」的写法
const incBlock = SRC.slice(SRC.indexOf("st.aiSideCallCount = (st.aiSideCallCount || 0) + 1;") - 200,
  SRC.indexOf("st.aiSideCallCount = (st.aiSideCallCount || 0) + 1;") + 300);
ok(/只做观测，不再当配额用/.test(incBlock), "尝试计数已注明只做观测");

console.log("\n=== 3. 新小时会重置「已写入条数」 ===");
ok(/st\.aiSideHourKey = hk;[\s\S]{0,120}st\.aiSideHourSaved = 0;/.test(SRC),
  "小时切换时 aiSideHourSaved 归零");

console.log("\n=== 4. 限流文案必须点明「已记满」 ===");
ok(/本小时已记满/.test(SRC), "限流文案含「本小时已记满」");
ok(!/AI 侧已达每小时上限/.test(SRC), "旧文案（容易被误解为尝试次数上限）已移除");

console.log("\n=== 5. 规则拦截仍然在配额之前（拦掉的不该扣额度） ===");
const rulePos = SRC.indexOf("const ruleSkip = shouldSkipByRule(");
const capPos = SRC.indexOf("const savedThisHour = st.aiSideHourSaved || 0;");
ok(rulePos > 0 && capPos > 0 && rulePos < capPos,
  "shouldSkipByRule 在配额检查之前执行（rulePos=" + rulePos + " < capPos=" + capPos + "）");

console.log("\n=== 6. 用户侧配额不受影响（保持原语义） ===");
ok(/if \(st\.callCount >= cap\)/.test(SRC), "用户侧仍按 callCount 计配额");
ok(/aiExtractMaxPerHour/.test(SRC), "用户侧上限配置项仍在使用");

console.log("\n=== 7. AI 侧最短字数默认值 ===");
ok(/aiSideMinLen: 24,/.test(SRC), "aiSideMinLen 默认 24（与用户侧一致，短句也能进判断）");

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " / 失败 " + fail);
process.exit(fail === 0 ? 0 : 1);