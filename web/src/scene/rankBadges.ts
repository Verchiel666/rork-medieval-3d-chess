/**
 * 悬浮军衔徽记——悬浮在每枚棋子上方的小纹章，让玩家一眼读懂棋盘。
 *
 * 每枚徽记都是 Canvas 绘制的铭牌：白曜王国的哥特式熨斗形纹章，
 * 太阳帝国的阶梯状日轮，内部是手绘的棋子剪影。纹理按棋子种类+阵营缓存
 * （共 12 张），由所有精灵共享，整套只需十几张小纹理。
 */

import * as THREE from "three";

import type { Faction, PieceKind } from "../core/types";

const SIZE = 256;

interface BadgeTheme {
  /** 外圈。 */
  rim: string;
  /** 内圈细线，与外圈相衬的第二种金属色。 */
  inner: string;
  plate: string;
  glyph: string;
  glow: string;
}

/**
 * 纹章过去只在金属色上有差异——金色外圈对橙色外圈，底牌则两边都接近黑色。
 * 在徽记尺寸下那就是两块深色菱形：形状能说明是哪支军队，颜色却什么也说不了。
 * 现在每块底牌都浸染了各自军队的底色，纹章因而与棋子脚下的光环、
 * 剪影上的光一样，携带同一套天青/余烬编码。
 */
const THEMES: Record<Faction, BadgeTheme> = {
  w: {
    rim: "#a8d6ff",
    inner: "#e8f3ff",
    plate: "rgba(16,54,120,0.95)",
    glyph: "#f4fbff",
    glow: "rgba(110,168,255,0.6)",
  },
  b: {
    rim: "#ffb083",
    inner: "#ffe6c8",
    plate: "rgba(122,25,14,0.95)",
    glyph: "#fff2df",
    glow: "rgba(255,92,58,0.6)",
  },
};

/** 徽记宽度，世界单位（1 单位 = 一格棋盘）。 */
export const BADGE_SCALE: Record<PieceKind, number> = {
  p: 0.34,
  // 军官级棋子现在与后等高（见 `PIECE_HEIGHT`），在王级尺寸的棋子头顶
  // 放一枚小子棋纹章会显得像一张缩水贴纸。
  n: 0.41,
  b: 0.41,
  r: 0.41,
  q: 0.42,
  k: 0.44,
};

/** 徽记悬浮在棋子头顶上方的高度。 */
export const BADGE_LIFT = 0.3;

function canvas2d(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return { canvas, ctx };
}

// --------------------------------------------------------------- 铭牌形状

/** 哥特式熨斗形纹章——白曜王国的盾牌。 */
function heaterPlate(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(16, 20);
  ctx.quadraticCurveTo(50, 10, 84, 20);
  ctx.lineTo(84, 52);
  ctx.quadraticCurveTo(84, 80, 50, 93);
  ctx.quadraticCurveTo(16, 80, 16, 52);
  ctx.closePath();
}

/** 阶梯状日轮——太阳帝国的黑曜石徽章。 */
function sunPlate(ctx: CanvasRenderingContext2D): void {
  const cx = 50;
  const cy = 51;
  const outer = 38;
  const inner = 32;
  const steps = 12;
  ctx.beginPath();
  for (let i = 0; i < steps * 2; i += 1) {
    const angle = (i / (steps * 2)) * Math.PI * 2 - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------- 棋子字形

function pedestal(ctx: CanvasRenderingContext2D, top: number): void {
  ctx.moveTo(31, top);
  ctx.lineTo(69, top);
  ctx.lineTo(75, top + 9);
  ctx.lineTo(25, top + 9);
  ctx.closePath();
}

function pawnGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(50, 33, 11, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(38, 45);
  ctx.lineTo(62, 45);
  ctx.lineTo(59, 52);
  ctx.lineTo(41, 52);
  ctx.closePath();
  ctx.moveTo(42, 52);
  ctx.quadraticCurveTo(38, 63, 34, 70);
  ctx.lineTo(66, 70);
  ctx.quadraticCurveTo(62, 63, 58, 52);
  ctx.closePath();
  pedestal(ctx, 70);
}

function rookGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(29, 24);
  ctx.lineTo(38, 24);
  ctx.lineTo(38, 31);
  ctx.lineTo(45, 31);
  ctx.lineTo(45, 24);
  ctx.lineTo(55, 24);
  ctx.lineTo(55, 31);
  ctx.lineTo(62, 31);
  ctx.lineTo(62, 24);
  ctx.lineTo(71, 24);
  ctx.lineTo(71, 41);
  ctx.lineTo(29, 41);
  ctx.closePath();
  ctx.moveTo(35, 41);
  ctx.lineTo(65, 41);
  ctx.lineTo(62, 69);
  ctx.lineTo(38, 69);
  ctx.closePath();
  pedestal(ctx, 69);
}

function knightGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(36, 71);
  ctx.quadraticCurveTo(33, 55, 37, 44);
  ctx.lineTo(26, 41);
  ctx.quadraticCurveTo(21, 39, 25, 34);
  ctx.lineTo(37, 27);
  ctx.lineTo(38, 15);
  ctx.lineTo(47, 24);
  ctx.lineTo(52, 14);
  ctx.lineTo(58, 25);
  ctx.quadraticCurveTo(73, 34, 71, 52);
  ctx.quadraticCurveTo(69, 64, 63, 71);
  ctx.closePath();
  pedestal(ctx, 71);
}

function bishopGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(50, 17, 5, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(50, 22);
  ctx.quadraticCurveTo(69, 36, 65, 52);
  ctx.lineTo(35, 52);
  ctx.quadraticCurveTo(31, 36, 50, 22);
  ctx.closePath();
  ctx.moveTo(36, 54);
  ctx.lineTo(64, 54);
  ctx.lineTo(61, 61);
  ctx.lineTo(39, 61);
  ctx.closePath();
  ctx.moveTo(40, 61);
  ctx.lineTo(60, 61);
  ctx.lineTo(63, 70);
  ctx.lineTo(37, 70);
  ctx.closePath();
  pedestal(ctx, 70);
}

function crownGlyph(ctx: CanvasRenderingContext2D, king: boolean): void {
  ctx.beginPath();
  if (king) {
    ctx.moveTo(46, 10);
    ctx.lineTo(54, 10);
    ctx.lineTo(54, 16);
    ctx.lineTo(60, 16);
    ctx.lineTo(60, 23);
    ctx.lineTo(54, 23);
    ctx.lineTo(54, 30);
    ctx.lineTo(46, 30);
    ctx.lineTo(46, 23);
    ctx.lineTo(40, 23);
    ctx.lineTo(40, 16);
    ctx.lineTo(46, 16);
    ctx.closePath();
    ctx.moveTo(31, 32);
    ctx.lineTo(69, 32);
    ctx.lineTo(65, 46);
    ctx.lineTo(35, 46);
    ctx.closePath();
  } else {
    ctx.moveTo(30, 47);
    ctx.lineTo(30, 22);
    ctx.lineTo(40, 36);
    ctx.lineTo(50, 18);
    ctx.lineTo(60, 36);
    ctx.lineTo(70, 22);
    ctx.lineTo(70, 47);
    ctx.closePath();
    for (const [x, y] of [
      [30, 20],
      [50, 16],
      [70, 20],
    ]) {
      ctx.moveTo(x + 4, y);
      ctx.arc(x, y, 4, 0, Math.PI * 2);
    }
  }
  ctx.moveTo(34, 48);
  ctx.lineTo(66, 48);
  ctx.lineTo(63, 56);
  ctx.lineTo(37, 56);
  ctx.closePath();
  ctx.moveTo(38, 56);
  ctx.quadraticCurveTo(35, 64, 33, 70);
  ctx.lineTo(67, 70);
  ctx.quadraticCurveTo(65, 64, 62, 56);
  ctx.closePath();
  pedestal(ctx, 70);
}

const GLYPHS: Record<PieceKind, (ctx: CanvasRenderingContext2D) => void> = {
  p: pawnGlyph,
  r: rookGlyph,
  n: knightGlyph,
  b: bishopGlyph,
  q: (ctx) => crownGlyph(ctx, false),
  k: (ctx) => crownGlyph(ctx, true),
};

// ------------------------------------------------------------ 战术视图圆牌

/** 圆牌直径，世界单位（1 单位 = 一格棋盘），按棋子种类。 */
export const TOKEN_SCALE: Record<PieceKind, number> = {
  p: 0.64,
  // 军官级棋子在 3D 棋盘上是王级尺寸；平面地图保持同样的两档分级，
  // 切换视图时军队层级不会错乱。
  n: 0.81,
  b: 0.81,
  r: 0.82,
  q: 0.84,
  k: 0.9,
};

interface TokenTheme {
  /** 底牌径向渐变，中心 → 边缘。 */
  plateIn: string;
  plateOut: string;
  rim: string;
  hairline: string;
  glyph: string;
  /** 溢出外圈的阵营光晕。 */
  halo: string;
  notch: string;
}

const TOKEN_THEMES: Record<Faction, TokenTheme> = {
  w: {
    plateIn: "#eaf4ff",
    plateOut: "#7fa8d8",
    rim: "#bfe0ff",
    hairline: "#1d3f78",
    glyph: "#0d2246",
    halo: "rgba(122,168,255,0.55)",
    notch: "#2f5c9c",
  },
  b: {
    plateIn: "#8e2413",
    plateOut: "#3d0d07",
    rim: "#ffa365",
    hairline: "#ffd0a8",
    glyph: "#fff0dd",
    halo: "rgba(255,96,64,0.55)",
    notch: "#a83d1c",
  },
};

/**
 * 平面战术视图的俯视计数牌：一块阵营配色的雕花石盘，
 * 军衔剪影压印其上。从上往下直视，因此底牌承载了
 * 原本由雕塑传达的全部身份信息。
 */
export function tacticalTokenTexture(kind: PieceKind, faction: Faction): THREE.CanvasTexture {
  const key = `token_${faction}${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const theme = TOKEN_THEMES[faction];
  const { canvas, ctx } = canvas2d();
  ctx.scale(SIZE / 100, SIZE / 100);

  // 阵营光晕，扫一眼全盘即可区分两支军队。
  const halo = ctx.createRadialGradient(50, 50, 30, 50, 50, 50);
  halo.addColorStop(0, theme.halo);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 100, 100);

  // 底牌：从左上打光，让圆盘带一点浮雕感。
  const plate = ctx.createRadialGradient(41, 39, 4, 50, 50, 41);
  plate.addColorStop(0, theme.plateIn);
  plate.addColorStop(1, theme.plateOut);
  ctx.beginPath();
  ctx.arc(50, 50, 40, 0, Math.PI * 2);
  ctx.fillStyle = plate;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1.5;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 对角线上四个雕花凹槽——俯视时像錾刻金属。
  ctx.fillStyle = theme.notch;
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    ctx.save();
    ctx.translate(50 + Math.cos(angle) * 37, 50 + Math.sin(angle) * 37);
    ctx.rotate(angle);
    ctx.fillRect(-3.2, -1.4, 6.4, 2.8);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(50, 50, 40, 0, Math.PI * 2);
  ctx.strokeStyle = theme.rim;
  ctx.lineWidth = 3.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(50, 50, 34.5, 0, Math.PI * 2);
  ctx.strokeStyle = theme.hairline;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.save();
  ctx.translate(50, 51);
  ctx.scale(0.72, 0.72);
  ctx.translate(-50, -50);
  ctx.shadowColor = faction === "w" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 2.5;
  ctx.shadowOffsetY = faction === "w" ? -1 : 1;
  ctx.fillStyle = theme.glyph;
  GLYPHS[kind](ctx);
  ctx.fill("nonzero");
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

// -------------------------------------------------------------------- 纹理

const cache = new Map<string, THREE.CanvasTexture>();

/** 单个棋子种类+阵营的缓存徽记纹理。 */
export function rankBadgeTexture(kind: PieceKind, faction: Faction): THREE.CanvasTexture {
  const key = `${faction}${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const theme = THEMES[faction];
  const { canvas, ctx } = canvas2d();
  ctx.scale(SIZE / 100, SIZE / 100);

  // 光晕，让纹章在身后明亮火把的映衬下依然清晰可辨。
  const halo = ctx.createRadialGradient(50, 50, 6, 50, 50, 50);
  halo.addColorStop(0, theme.glow);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 100, 100);

  const plate = faction === "w" ? heaterPlate : sunPlate;

  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = 6;
  plate(ctx);
  ctx.fillStyle = theme.plate;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.lineJoin = "round";
  ctx.strokeStyle = theme.rim;
  ctx.lineWidth = 3.4;
  plate(ctx);
  ctx.stroke();

  ctx.strokeStyle = theme.inner;
  ctx.lineWidth = 1.1;
  ctx.save();
  ctx.translate(50, faction === "w" ? 51 : 51);
  ctx.scale(0.87, 0.87);
  ctx.translate(-50, faction === "w" ? -51 : -51);
  plate(ctx);
  ctx.stroke();
  ctx.restore();

  // 剪影在纹章内略微偏上，避免字形基座与铭牌圆角底部相撞。
  ctx.save();
  ctx.translate(50, faction === "w" ? 49 : 51);
  ctx.scale(0.62, 0.62);
  ctx.translate(-50, -50);
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 3;
  ctx.fillStyle = theme.glyph;
  GLYPHS[kind](ctx);
  ctx.fill("nonzero");
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

// ---------------------------------------------------------- 升变铭牌

const PLAQUE_WIDTH = 512;
const PLAQUE_HEIGHT = 176;

/** 铭牌宽高比，供调用方直接确定精灵尺寸，无需重新推导。 */
export const PLAQUE_ASPECT = PLAQUE_WIDTH / PLAQUE_HEIGHT;

function tablet(ctx: CanvasRenderingContext2D, inset: number): void {
  const w = PLAQUE_WIDTH - inset * 2;
  const h = PLAQUE_HEIGHT - inset * 2;
  const cut = 22;
  ctx.beginPath();
  ctx.moveTo(inset + cut, inset);
  ctx.lineTo(inset + w - cut, inset);
  ctx.lineTo(inset + w, inset + cut);
  ctx.lineTo(inset + w, inset + h - cut);
  ctx.lineTo(inset + w - cut, inset + h);
  ctx.lineTo(inset + cut, inset + h);
  ctx.lineTo(inset, inset + h - cut);
  ctx.lineTo(inset, inset + cut);
  ctx.closePath();
}

/**
 * 升变候选棋子下方的铭牌：军衔专属的纹章图形、完整拼写的军衔名，
 * 以及选择它的按键。
 *
 * 选择器曾经是四个没有文字标注的雕塑悬浮在远侧军队上方，
 * 而 3D 人形并不是好的标签——这支军队里的两名军官等高，
 * 雕塑只在手臂上有差别。把军衔名写在下方正是这张纹理的全部意义；
 * 纹章与棋子在棋盘上佩戴的是同一剪影，
 * 因此选择与结果读起来是同一件东西。
 */
export function promotionPlaqueTexture(kind: PieceKind, faction: Faction, label: string, key: string): THREE.CanvasTexture {
  const cacheKey = `plaque_${faction}${kind}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const theme = THEMES[faction];
  const canvas = document.createElement("canvas");
  canvas.width = PLAQUE_WIDTH;
  canvas.height = PLAQUE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");

  // 石板，从上方打光，这样它不会看起来像一个扁平的 UI 矩形。
  const plate = ctx.createLinearGradient(0, 8, 0, PLAQUE_HEIGHT - 8);
  plate.addColorStop(0, "rgba(26,24,20,0.94)");
  plate.addColorStop(1, "rgba(9,8,7,0.94)");
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 14;
  tablet(ctx, 10);
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.lineJoin = "round";
  tablet(ctx, 10);
  ctx.strokeStyle = theme.rim;
  ctx.lineWidth = 4;
  ctx.stroke();
  tablet(ctx, 19);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 军队颜色从左边缘渗入，与棋子脚下色带用的是同一套代码——
  // 因此白曜铭牌绝不会被误认成焰红铭牌。
  const wash = ctx.createLinearGradient(10, 0, 190, 0);
  wash.addColorStop(0, theme.plate);
  wash.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  tablet(ctx, 12);
  ctx.clip();
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, PLAQUE_WIDTH, PLAQUE_HEIGHT);
  ctx.restore();

  // 纹章：军衔剪影，绘制在字形自己的 100x100 网格上。
  ctx.save();
  ctx.translate(44, PLAQUE_HEIGHT / 2 - 46);
  ctx.scale(0.92, 0.92);
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur = 10;
  ctx.fillStyle = theme.glyph;
  GLYPHS[kind](ctx);
  ctx.fill("nonzero");
  ctx.restore();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  // 中文军衔名（如"王后"）在 Cinzel 中没有字形，需要 CJK 字体回退；
  // 西文标签仍优先用 Cinzel 保持原版观感。
  const isCjk = /[\u3000-\u9fff]/.test(label);
  ctx.font = isCjk
    ? `600 50px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`
    : `600 54px "Cinzel", Georgia, serif`;
  ctx.fillStyle = "#f6e6c2";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 6;
  // 西文标签逐字母加细空格撑开字距；中文本身方块等宽，直接书写即可。
  const letters = isCjk ? label : label.toUpperCase().split("").join(" ");
  ctx.fillText(letters, 150, PLAQUE_HEIGHT / 2 - 2);
  ctx.shadowBlur = 0;

  // 键帽，右对齐：铭牌同时充当键盘提示图例。
  const capSize = 52;
  const capX = PLAQUE_WIDTH - 34 - capSize;
  const capY = (PLAQUE_HEIGHT - capSize) / 2;
  ctx.beginPath();
  ctx.roundRect(capX, capY, capSize, capSize, 12);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = `600 30px "Cinzel", Georgia, serif`;
  ctx.fillStyle = theme.rim;
  ctx.fillText(key.toUpperCase(), capX + capSize / 2, capY + capSize / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(cacheKey, texture);
  return texture;
}

/** 释放所有缓存的纹章纹理（仅引擎销毁时调用）。 */
export function disposeRankBadgeTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
