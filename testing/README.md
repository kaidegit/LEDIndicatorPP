# ledip_tester

`ledip_tester` 将本仓库真实的 LEDIndicatorPP C++ 组件、GPIO/RGB GPIO 驱动和 TLSF 编译到 WASM。Node.js 与 Web Worker 加载同一份产物；功能测试由虚拟时间驱动，不需要开发板、浏览器自动化或真实等待。

## 准备与构建

已验证环境：Node.js 25.8.0、npm 11.11.0、Emscripten 5.0.2、CMake 4.2.2、Clang/LLD 22.1.0。Node 22 及以上可使用相同协议，但性能基线必须记录实际运行时版本。

```sh
# 在仓库根目录；原生三方库使用 submodule，不使用浮动下载
git submodule update --init --recursive
cd testing
npm ci
npm run build                 # Debug WASM + CLI + Web
npm run build:all             # 四种 WASM 配置 + CLI + Web
```

`magic_enum` 固定为 v0.9.7；TLSF 固定为 `deff9ab509341f264addbd3c8ada533678591905`。npm 包由 `package-lock.json` 固定。

构建脚本从 `PATH` 查找 `emcc`、`emcmake`、`cmake` 和 Ninja。可通过 `EM_NODE_JS`、`EM_LLVM_ROOT`、`EM_BINARYEN_ROOT` 覆盖 Emscripten 配置。Homebrew 如果把 LLVM 和 LLD 分开安装，需要在同一工具目录提供它们的工具 symlink；该目录可放在已忽略的 `testing/.tools/llvm`。

## CLI

```sh
npm run cli -- run --scenario scenarios/regression/basic-gpio.json --format json
npm run cli -- run --scenario scenarios/regression/basic-gpio.json --format md > artifacts/basic-report.md
npm run cli -- run --scenario - --format json < scenario.json
npm run cli -- suite --name regression
npm run cli -- suite --name all --format json > artifacts/suite.json
npm run cli -- fuzz --seed 12345 --iterations 10000 --heap-size 32KiB
npm run cli -- scan --scenario scenarios/regression/basic-gpio.json --from 4KiB --to 64KiB --step 256
npm run cli -- bench --profile release --output artifacts/bench.json
npm run cli -- size --profile size --output artifacts/size.json
npm run cli -- report --input artifacts/suite.json artifacts/bench.json artifacts/size.json --output artifacts/ledip-report.md
npm run cli -- serve
```

也可以直接运行 `node dist/cli/index.js ...`。默认 JSON 模式下 stdout 只包含协议数据，日志写 stderr。`--repro-dir artifacts/` 保存失败复现包。`suite` 支持 `regression`、`boundary`、`memory`、`stress`、`all`；`robustness` 目录中的用例需显式运行，因为 trap、OOM 和 timeout 正是它们的探测结果。

## 中文 Markdown 报告

内部执行和中间产物始终保留 JSON。`run`、`suite`、`fuzz`、`scan`、`bench`、`size` 均支持 `--format md`（或 `markdown`），输出中文摘要、环境、断言、首次偏差、内存及相应指标表格。

最终汇总使用 `report` 读取一个或多个 JSON 文件，而不是重新运行测试：

```sh
npm run cli -- report \
  --input artifacts/suite.json artifacts/bench.json artifacts/size.json \
  --output artifacts/ledip-report.md
```

`--output -` 将完整 Markdown 写到 stdout。套件正文优先展示汇总及失败/不支持项，通过用例的完整轨迹仍保留在 JSON 中间结果中；单场景 Markdown 包含可折叠轨迹和事件明细。Web 页面也可导出当前用例的中文 Markdown 报告。

退出码：

| 代码 | 含义 |
| --- | --- |
| 0 | 通过；`unsupported`/`skipped` 不冒充功能通过 |
| 1 | 断言、轨迹溢出、预算或容量扫描失败 |
| 2 | JSON/Schema/语义输入错误，错误包含字段路径 |
| 3 | Worker、trap、OOM、timeout 等执行异常 |

`fuzz` 报告包含生成器版本 `ledip-fuzz-v1`、原场景、缩减场景和缩减后再次运行的确认结果。`scan` 的 `minimumVerifiedBytes` 只表示该场景、该构建和该步长下已验证的容量。

## Web

`npm run cli -- serve` 默认监听 `127.0.0.1:5173`。页面支持：

- 示例选择、字段表单、JSON 编辑、场景和复现包导入导出；
- 从头运行、初始化、暂停、单步、速度控制、插入“推进时间 + update”；
- 驱动请求、RGB 缓存和实际引脚的独立预览；
- 多 pattern 状态/步骤/优先级时间线和输出事件，点击断言定位首次偏差；
- 向后拖动仅查看既有轨迹；“从光标确定性重放”会新建 Worker 并重放，不使用内存快照；
- 内存曲线、峰值、失败计数、碎片和按需 TLSF 块分布；
- “运行浏览器 Release 基准”在独立 Web Worker 中测量；也可导入 CLI 性能/体积报告并比较同配置基线。

Worker 外部计时器负责真实超时并终止卡死场景，之后可以运行下一用例。CLI 与 Web 的语义比较应排除真实耗时、路径和运行时字段。

## 构建配置

| Profile | 用途 | 主要配置 |
| --- | --- | --- |
| Debug | 功能、轨迹、状态观测 | `-O1 -g`、详细轨迹、活动列表 |
| Memory-check | 分配与内存诊断 | `-O1 -g`、16 字节红区、释放填充、TLSF 检查 |
| Release | WASM 性能 | `-O3 -flto`、无详细轨迹、无活动列表观测 |
| Size | WASM 体积 | `-Oz -flto`、无调试信息、固定导出根 |

所有配置使用原生 `-fwasm-exceptions`，以便分配失败能由 C++ 桥接层捕获。固定池耗尽后不会回退到 Emscripten 默认堆。一个 1024 字节、单飞的静态异常应急区用于在池已满时抛出 `std::bad_alloc`，其成本计入 `allocatorOverheadBytes`；不支持并发异常或超过该区域的异常对象。

## 结果与限制

- 结果包含协议版本、有效场景、构建/源码、宿主环境、断言、轨迹、指标、产物路径和复现命令。
- 内存分配序号从实例创建开始，包含实例和驱动。`failureMemory` 报告失败序号、大小和操作索引。
- 碎片率为 `(1 - largestFreeBlock / freeBytes) * 100`；无空闲块时为 0。固定开销、请求字节和 TLSF 实际占用分别报告。
- WASM 线性内存、TLSF backing 固定预留量和 1 MiB 栈预留分别列出。`physicalPoolBytes` / `tlsfPoolBytes` 是 backing 的固定 1 MiB 预留量，`configuredBytes` 是本次交给 TLSF 的容量，`currentPoolBytes` / `peakPoolBytes` 是池内占用；这些数值不可重复相加。静态区总量和可靠栈高水位目前为 `null`，不会填零。
- 每个 Worker 一个场景；固定池最大 1 MiB，事件最多 4096 条/次读取，活动观测每页 16 项并读取全部分页，块快照最多 1024 项。不静默丢失事件。
- 断言失败优先于 `unsupported`，两者同时出现时仍返回失败及非零退出码。C ABI 对 start、stop、update 和批量执行中的分配失败统一返回 OOM。
- 事件只保存 `uint32_t` 时间；超过一个完整 `uint32_t` 周期的单批轨迹不能还原所有高 32 位。性能批量应使用 Release 的无轨迹构建。
- Memory-check 的红区/释放填充/TLSF 检查不等价于完整 ASan；锁回调配对不证明真实 RTOS 并发正确。
- 所有内存、性能和体积数据只针对 WASM，不能标成实测 MCU SRAM、Flash 或速度。

行为契约及分配归属详见 [SEMANTICS.md](./SEMANTICS.md)。
