// 一次性工具：按旁白新节奏重映射子场景 GSAP 时间轴的节拍位置（只改位置参数，不改动画时长）。
// 用法：node scripts/retimelines.mjs（原地改写 compositions/，原文件备份到 scripts/debug/）
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = join(root, "scripts", "debug", "retimelines-backup");
mkdirSync(backupDir, { recursive: true });

// 每个文件一组锚点 [旧位置, 新位置]，锚点间线性插值；必须严格递增
const plans = {
  "compositions/scene1-5-pareto-concept.html": [
    // 语音起点（场景内相对）：c01 0.1 / c02 4.5 / c03 8.3 / c04 12.5 / c05 16.6 / c06 20.5，场景末 23.5
    [0, 0], [2.4, 3.9], [4.6, 7.4], [7.6, 12.4], [10.4, 16.6], [12.8, 20.4], [15, 23.5],
  ],
  "compositions/scene3-features.html": [
    // 阶段起点对齐语音：c10 0.1 / c11 4.5 / c09 9.0 / c12 11.4 / c13 15.6，场景末 19.95
    [0, 0], [3.0, 3.4], [3.3, 4.6], [5.9, 9.1], [8.4, 11.5], [10.3, 13.6], [12.0, 15.6], [13.6, 17.2], [16, 19.95],
  ],
};

function remap(t, anchors) {
  if (t <= anchors[0][0]) {
    const [o, n] = anchors[0];
    return t + (n - o);
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const [o1, n1] = anchors[i], [o2, n2] = anchors[i + 1];
    if (t <= o2) {
      const k = (n2 - n1) / (o2 - o1);
      return n1 + (t - o1) * k;
    }
  }
  const [o1, n1] = anchors[anchors.length - 1];
  return t + (n1 - o1);
}

for (const [rel, anchors] of Object.entries(plans)) {
  const file = join(root, rel);
  copyFileSync(file, join(backupDir, rel.split("/").pop()));
  let src = readFileSync(file, "utf8");
  let count = 0;
  // 匹配 GSAP 调用结尾的位置参数：`}, 3.3);`（跨行调用与单行调用均以该形式收尾）
  src = src.replace(/\},\s*(-?\d+(?:\.\d+)?)\s*\);/g, (m, num) => {
    const t = parseFloat(num);
    const mapped = Math.round(remap(t, anchors) * 100) / 100;
    count++;
    return `}, ${mapped.toFixed(2)});`;
  });
  writeFileSync(file, src);
  console.log(`${rel}: remapped ${count} positions`);
}
