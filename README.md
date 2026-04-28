# FlyPath

FlyPath 是一个面向全球实时航班态势的可视化网站，用更偏“空域指挥台”的方式展示世界范围内的航班分布、航线状态和机场动态。

在线体验：
- https://flypath.mactive.workers.dev/

## 产品简介

FlyPath 聚焦三个核心场景：

- 看全球：在世界地图上查看实时航班分布、飞行密度和国家级流量概况。
- 看单机：点击任意航班，查看航班状态、起降机场、航司、机型、航迹和预测航线。
- 看机场：在底部滚动查看 Top 20 机场的出发告示牌，快速感知主要枢纽的放行与延误情况。

整体界面参考“战术态势屏”的设计语言，强调：
- 全局态势一眼可读
- 局部钻取足够直接
- 数据刷新和交互反馈尽量实时

## 当前能力

### 1. 全球航班地图

- 基于 `MapLibre GL` 的矢量地图渲染
- 支持滚轮缩放、拖拽平移、`W/A/S/D` 键盘移动
- 全局默认只渲染约 `1/4` 航班点，兼顾性能与密度感知
- 点击左侧国家后，会切换到该国家的全量航班并自动缩放到对应区域
- 点击 `World` 返回全局视角

### 2. 航班详情面板

- 点击地图上的航班或左侧列表项，可查看所选航班详情
- 展示内容包括：
  - callsign
  - 飞行状态
  - 高度、速度、航向、爬升率
  - 起飞机场与到达机场
  - 航司与机型
  - 历史航迹与预测航线

### 3. 航班点交互

- 航班圆点带 `1px` 灰色描边，方便在彩色底图上识别
- 鼠标移入航班点后会有 2 倍放大高亮动画
- hover tooltip 直接显示：
  - callsign
  - altitude
  - speed

### 4. 机场告示牌

- 页面底部提供 Top 20 机场的出发告示牌滚动带
- 展示机场代码、延误指数、出港数量，以及部分出发航班的：
  - 计划/预计时间
  - 航班号
  - 目的地
  - 登机口/航站楼
  - 状态

## 数据来源

当前版本主要接入以下数据：

- 全量航班列表：`flight-viz.com`
- 航班搜索与详情增强：`flight-viz-proxy`
- 机场告示牌：`flight-viz-proxy` 的机场接口

前端不会直接请求这些上游，而是统一通过 Hono 服务做代理和缓存，方便后续替换数据源。

## 技术方案概览

前端：
- React
- TypeScript
- Vite
- MapLibre GL
- Three.js

后端：
- Hono
- Cloudflare Workers
- Cloudflare KV
- Cloudflare R2
- Cloudflare D1

缓存策略：
- 每分钟拉取一次全量航班快照
- 单航班详情按点击时请求并缓存
- 基于详情写入航线级缓存，沉淀航司 / 机型 / 航程等筛选维度
- 定时产出航线目录快照，供后续线路筛选和事实渲染直接消费
- D1 维护当前 live 航班与航线索引，支持复杂线路筛选并直接驱动地图展示
- Top 20 机场告示牌按周期刷新并缓存

更完整的技术记忆文档见：
- [Agent.md](/Users/bytedance/Project/SideCar/flightMonitor/Agent.md)

## 本地开发

安装依赖：

```bash
npm install
```

启动前后端联调：

```bash
npm run dev
```

常用命令：

```bash
npm run build
npm run build:client
npm run typecheck:worker
npm run deploy:worker
```

## 部署

当前主部署目标为 Cloudflare Workers。

项目已经接入：
- Worker 路由
- KV 缓存
- R2 快照归档
- Cron 定时任务

如需查看部署与存储说明，可参考：
- [docs/cloudflare-workers-deploy.md](/Users/bytedance/Project/SideCar/flightMonitor/docs/cloudflare-workers-deploy.md)
- [docs/cloudflare-storage.md](/Users/bytedance/Project/SideCar/flightMonitor/docs/cloudflare-storage.md)

## 适合后续继续演进的方向

- 接入更稳定或更完整的商业级航班数据源
- 增加机场级钻取视图
- 支持航司、机型、状态等更细粒度筛选
- 增加历史回放与延误趋势分析
- 继续优化地图分包与首屏性能
