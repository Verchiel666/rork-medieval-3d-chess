import * as THREE from "three";

/**
 * 程序化生成的 CC0-free 纹理。所有内容都在启动时绘制进画布，因此游戏无需
 * 下载任何纹理，仍能获得大理石脉络、麻点玄武岩、雕刻的横纵坐标标签和
 * 柔和的粒子精灵。
 */

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, alpha: number): void {
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    data[i + 3] = Math.max(0, Math.min(255, data[i + 3] * alpha + 255 * (1 - alpha)));
  }
  ctx.putImageData(image, 0, 0);
}

/** 柔和的脉络大理石。`dark` 切换为玄武岩配色。 */
export function marbleTexture(dark: boolean): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = dark ? "#191a20" : "#e9e2d2";
  ctx.fillRect(0, 0, size, size);

  // 大块的色调斑块。
  for (let i = 0; i < 26; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 40 + Math.random() * 150;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = dark ? 40 + Math.random() * 25 : 205 + Math.random() * 40;
    gradient.addColorStop(0, `rgba(${tone},${tone},${tone + (dark ? 6 : 0)},0.35)`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 脉络：宽度逐渐变细的随机游走线条。
  const veins = dark ? 8 : 16;
  for (let v = 0; v < veins; v += 1) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    let angle = Math.random() * Math.PI * 2;
    ctx.strokeStyle = dark ? "rgba(96,102,120,0.22)" : "rgba(120,116,104,0.34)";
    ctx.lineWidth = 0.6 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 60 + Math.floor(Math.random() * 60);
    for (let s = 0; s < steps; s += 1) {
      angle += (Math.random() - 0.5) * 0.7;
      x += Math.cos(angle) * 7;
      y += Math.sin(angle) * 7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  grain(ctx, size, dark ? 16 : 12, 1);
  return toTexture(canvas);
}

/** 粗糙的城堡石板地面，带灰浆接缝。 */
export function flagstoneTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = "#1b1a19";
  ctx.fillRect(0, 0, size, size);

  const cell = size / 4;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const offset = row % 2 === 0 ? 0 : cell / 2;
      const x = (col * cell + offset) % size;
      const y = row * cell;
      const shade = 38 + Math.random() * 26;
      ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 5})`;
      ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(x + 3, y + 3, cell - 6, 3);
    }
  }
  grain(ctx, size, 26, 1);
  return toTexture(canvas);
}

/** 镶铜边的边框，刻有 a–h / 1–8 标签，映射到底座顶面。 */
export function boardBorderTexture(): THREE.CanvasTexture {
  const size = 1024;
  const { canvas, ctx } = createCanvas(size);
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

  ctx.fillStyle = "#221d17";
  ctx.fillRect(0, 0, size, size);

  // 雕刻的石环。
  const border = size * 0.085;
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#4a4136");
  gradient.addColorStop(0.5, "#332c24");
  gradient.addColorStop(1, "#241f19");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // 铜嵌线。
  ctx.strokeStyle = "#8a6a34";
  ctx.lineWidth = 6;
  ctx.strokeRect(border * 0.55, border * 0.55, size - border * 1.1, size - border * 1.1);
  ctx.strokeStyle = "rgba(214,178,102,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(border * 0.55 + 5, border * 0.55 + 5, size - border * 1.1 - 10, size - border * 1.1 - 10);

  // 内井（被棋格遮挡，保持深色）。
  ctx.fillStyle = "#0e0c0a";
  ctx.fillRect(border, border, size - border * 2, size - border * 2);

  const inner = size - border * 2;
  const step = inner / 8;
  ctx.font = `600 ${Math.floor(border * 0.52)}px "Cinzel", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < 8; i += 1) {
    const centre = border + step * (i + 0.5);
    const engrave = (text: string, x: number, y: number): void => {
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillText(text, x + 2, y + 2);
      ctx.fillStyle = "rgba(212,175,105,0.85)";
      ctx.fillText(text, x, y);
    };
    engrave(files[i], centre, border * 0.5);
    engrave(files[i], centre, size - border * 0.5);
    engrave(String(8 - i), border * 0.5, centre);
    engrave(String(8 - i), size - border * 0.5, centre);
  }

  grain(ctx, size, 14, 1);
  return toTexture(canvas, 1);
}

/** 用于接触阴影和发光圆盘的径向渐变。 */
export function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.55, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 沿队列走法链某一环铺设的丝线，绘制成只能按一个方向读取。
 *
 * 旧的丝线是把 {@link radialTexture} 拉伸在两个格子之间：两个轴上都是
 * 对称的，所以反过来看一模一样。在实测的 23923 条三环走法链中，19.9%
 * 有两条丝线在石面上交叉，5.1% 的链环*两端*都与另一环共享——这正是
 * 仅凭标记无法判断计划走向的时刻。
 *
 * 所以丝线是一颗彗星：在计划离开的格子处是一根几乎看不见的暗色细发，
 * 在进入的格子处长成明亮宽阔的头部。透明度和宽度指向同一方向，因此
 * 即使交叉、昏暗大厅、辉光后期处理和色盲玩家，方向依然可辨。
 *
 * 逐列绘制（只在启动时画一次）；每列都是一条柔和的垂直截面，所以丝线
 * 保持羽化边缘而不是硬色带。
 */
export function premoveThreadTexture(): THREE.CanvasTexture {
  const width = 256;
  const height = 64;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const middle = height / 2;
  for (let x = 0; x < width; x += 1) {
    const u = x / (width - 1);
    // 缓动而非线性：直线渐变读起来是"那边稍微亮一点"而不是一个方向，
    // 所以尾部过半程前保持安静，大部分亮度由头部承担。
    const alpha = 0.06 + 0.94 * Math.pow(u, 1.7);
    const half = height * (0.14 + 0.34 * Math.pow(u, 0.85));
    const column = ctx.createLinearGradient(0, middle - half, 0, middle + half);
    column.addColorStop(0, "rgba(255,255,255,0)");
    column.addColorStop(0.5, `rgba(255,255,255,${alpha.toFixed(3)})`);
    column.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = column;
    ctx.fillRect(x, middle - half, 1, half * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 画在棋子脚下格子上的环带，标记它属于哪支军队。
 *
 * 仅靠颜色不够：它必须能挺过昏暗大厅、辉光后期处理、手机屏幕和色盲
 * 玩家，所以每支军队还有**自己的形状**——王国方是朴素的双环带，帝国方
 * 是带刺的太阳项圈。从任何相机高度都能一眼读出，两者永远不会像两团
 * 染色光晕那样糊在一起。
 *
 * 以白色绘制，这样同一种形状只需一张画布，可按阵营染色。
 */
export function factionRingTexture(shape: "band" | "sunburst"): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  // 地面晕染：格子只染上*一丝*军队颜色，仅此而已。这是标记中唯一直接
  // 压在棋子脚下的部分，再亮就会反射到腿部和衣摆上、开始给雕塑重新染色——
  // 而且它也是最宽的部分，当屏幕上出现三十二个棋子时，正是它填满画面。
  // 保持微弱并收紧（格子的 0.46 → 0.4）：足以把棋子从白曜大理石上托起，
  // 又不足以涂满整格。
  const wash = ctx.createRadialGradient(c, c, size * 0.06, c, c, size * 0.4);
  wash.addColorStop(0, "rgba(255,255,255,0.12)");
  wash.addColorStop(0.6, "rgba(255,255,255,0.05)");
  wash.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, size, size);

  const radius = size * 0.375;

  // 先晕染后硬边——即使在辉光下环带也保持清晰线条。
  // 晕染是辉光处理抓住的光晕，所以它又窄又淡；其下的清晰线条负责阅读，
  // 而一条*细*亮线比粗软的线更易读。
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = size * 0.07;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.lineWidth = size * 0.032;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (shape === "band") {
    // 内侧第二道更细的环带：两条同心线，没有齿。
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = size * 0.014;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.285, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // 带刺项圈：环带外十二道渐细的射线。比王国方的晕染宽度短，所以两种
    // 形状一眼可辨，同时帝国的标记不会盖住自家格子的更多面积。
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    const inner = size * 0.4;
    const outer = size * 0.472;
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const spread = 0.055;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
      ctx.lineTo(c + Math.cos(angle - spread) * inner, c + Math.sin(angle - spread) * inner);
      ctx.lineTo(c + Math.cos(angle + spread) * inner, c + Math.sin(angle + spread) * inner);
      ctx.closePath();
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * 画在合法落子格上的准星：一个明亮的核心圆点，外绕一圈细光晕。
 * 清晰到足以穿透火光和辉光阅读。
 */
export function moveMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.19);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.45, "rgba(255,255,255,0.85)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.19, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.38, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = size * 0.01;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.44, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 画在吃子格上的目标锁定：四段括弧弧加刻度线。 */
export function captureMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.05;
  for (let i = 0; i < 4; i += 1) {
    const start = i * (Math.PI / 2) + Math.PI * 0.12;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.37, start, start + Math.PI * 0.26);
    ctx.stroke();
  }

  ctx.lineWidth = size * 0.018;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 4; i += 1) {
    const angle = i * (Math.PI / 2);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(c + dx * size * 0.15, c + dy * size * 0.15);
    ctx.lineTo(c + dx * size * 0.25, c + dy * size * 0.25);
    ctx.stroke();
  }

  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.46);
  core.addColorStop(0, "rgba(255,255,255,0.28)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 王车易位落点的标记：一个被两支相对箭头打断的圆环，
 * 读作"这两枚棋子交换位置"。
 */
export function castleMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.028;
  for (let i = 0; i < 2; i += 1) {
    const start = i * Math.PI + Math.PI * 0.14;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.36, start, start + Math.PI * 0.72);
    ctx.stroke();
  }

  // 水平轴上的两个箭头，彼此指向相反方向。
  ctx.lineWidth = size * 0.04;
  for (const dir of [-1, 1]) {
    const tip = c + dir * size * 0.42;
    ctx.beginPath();
    ctx.moveTo(tip - dir * size * 0.09, c - size * 0.075);
    ctx.lineTo(tip, c);
    ctx.lineTo(tip - dir * size * 0.09, c + size * 0.075);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.moveTo(c - size * 0.2, c);
  ctx.lineTo(c + size * 0.2, c);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 升变格的标记：辐条光环中的王冠剪影。 */
export function promoteMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    ctx.lineWidth = size * (i % 3 === 0 ? 0.022 : 0.012);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * size * 0.33, c + Math.sin(angle) * size * 0.33);
    ctx.lineTo(c + Math.cos(angle) * size * 0.44, c + Math.sin(angle) * size * 0.44);
    ctx.stroke();
  }

  // 王冠：条纹底座上的三个尖顶。
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(c - size * 0.2, c + size * 0.08);
  ctx.lineTo(c - size * 0.24, c - size * 0.14);
  ctx.lineTo(c - size * 0.1, c - size * 0.01);
  ctx.lineTo(c, c - size * 0.19);
  ctx.lineTo(c + size * 0.1, c - size * 0.01);
  ctx.lineTo(c + size * 0.24, c - size * 0.14);
  ctx.lineTo(c + size * 0.2, c + size * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(c - size * 0.21, c + size * 0.1, size * 0.42, size * 0.05);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 形状为带羽化边缘的棋格 alpha 遮罩——用于给单个格子染色或加阴影，
 * 而不会画出一块生硬的黑色矩形。
 */
export function tileMaskTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const inset = size * 0.045;
  const span = size - inset * 2;
  const radius = size * 0.1;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(inset, inset, span, span, radius);
  ctx.fill();
  // 羽化边缘，让相邻的加阴影格子互相融合。
  ctx.filter = "blur(4px)";
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 用于*意向*而非已执行走法的准星：一圈中心镂空的虚线段。
 * 棋盘上为真实走法绘制的一切都是实心闭合的；让这个保持开放
 * 正是在说"尚未执行"。
 */
export function premoveMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;
  const radius = size * 0.36;

  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "butt";
  ctx.lineWidth = size * 0.03;
  const dashes = 8;
  const sweep = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i += 1) {
    const start = i * sweep;
    ctx.beginPath();
    ctx.arc(c, c, radius, start, start + sweep * 0.52);
    ctx.stroke();
  }

  // 一圈淡淡的内侧晕染，让低机位下格子仍读作已被认领，
  // 但没有可落子目的地那样的实心核心点。
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.3);
  core.addColorStop(0, "rgba(255,255,255,0.22)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.3, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 队列走法*目标格*的准星。
 *
 * 预走法的起点和终点过去戴着同一款虚线环，玩家得端详这一对标记才能
 * 弄清走法方向。这个是**边框**而不是圆环：围绕整格的括弧框，让终点读作
 * 正在被认领的地面，而不是第二枚被选中的棋子。它保留了预走法语言的
 * 断裂边缘——四边画成缺口，只有四角是实线——所以它仍然在说"意向"，
 * 永远不是"已下"。
 */
export function premoveTargetTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const inset = size * 0.13;
  const span = size - inset * 2;
  const arm = size * 0.16;

  // 断裂的边：每条边两端各画一小段，中间留空。把它们连起来就会变成
  // 实心框，而那是真正已发生走法的词汇。
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = size * 0.022;
  ctx.lineCap = "butt";
  const stub = span * 0.16;
  const edges: [number, number, number, number][] = [
    [inset, inset, 1, 0],
    [inset + span, inset, 0, 1],
    [inset + span, inset + span, -1, 0],
    [inset, inset + span, 0, -1],
  ];
  for (const [x, y, dx, dy] of edges) {
    ctx.beginPath();
    ctx.moveTo(x + dx * arm, y + dy * arm);
    ctx.lineTo(x + dx * (arm + stub), y + dy * (arm + stub));
    ctx.stroke();
  }

  // 角部括弧承担主要信息——即使四边隐没在石纹中，四个硬角在低机位下
  // 依然读作一个框。
  ctx.strokeStyle = "rgba(255,255,255,0.98)";
  ctx.lineWidth = size * 0.05;
  ctx.lineCap = "square";
  const corners: [number, number, number, number][] = [
    [inset, inset, 1, 1],
    [inset + span, inset, -1, 1],
    [inset, inset + span, 1, -1],
    [inset + span, inset + span, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
    ctx.stroke();
  }

  // 正中央一个小的实心点：起点环是空心的，所以实心中心就是"哪头是
  // 目的地"这个问题的一眼答案。
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.045, 0, Math.PI * 2);
  ctx.fill();

  const halo = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.26);
  halo.addColorStop(0, "rgba(255,255,255,0.3)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.26, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 悬在队列走法上方的小小撤销圆盘。
 *
 * 收回一个预走法本来就有四种方式——点棋子、点目的地、按 Esc，或者再
 * 排一个别的——但每一种都是你得*知道*的事。棋盘上没有任何东西提示过。
 * 这就是那个唯一的提示：深色硬币上的一道叉，与玩家用来关闭面板的
 * 手势相同。
 *
 * 画成硬币而不是光秃秃的符号，是因为它轮流悬在石面、棋子和火光之上，
 * 一根孤线会在其中一半背景上消失。
 */
export function premoveCancelTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const centre = size / 2;
  // 圆盘刻意比画布小：透明边距是白送的触控区域，硬币在屏幕上可以保持
  // 小巧，同时用拇指依然点得到。
  const radius = size * 0.34;

  const body = ctx.createRadialGradient(centre, centre - radius * 0.3, 0, centre, centre, radius);
  body.addColorStop(0, "rgba(46,52,66,0.96)");
  body.addColorStop(1, "rgba(18,21,28,0.96)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.lineWidth = size * 0.055;
  ctx.lineCap = "round";
  const arm = radius * 0.44;
  ctx.beginPath();
  ctx.moveTo(centre - arm, centre - arm);
  ctx.lineTo(centre + arm, centre + arm);
  ctx.moveTo(centre + arm, centre - arm);
  ctx.lineTo(centre - arm, centre + arm);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 悬在队列走法链每一格上方的序号。
 *
 * 一条三格队列走法链会画出三个环和三条丝线，低机位下丝线互相交叉：
 * 这些标记说明了计划*走到哪里*，却没说*按什么顺序*。这就是答案，而且它
 * 刻意**不是**硬币——撤销圆盘是预走法语言里唯一可按的东西，再来一个
 * 实心圆盘就会被读成第二个按钮。一个光秃秃的数字、背后衬一圈柔和暗色
 * 光晕，是一个标签：在浅色大理石、深色玄武岩和棋子肩膀上都清晰可读，
 * 又永远不像能点的东西。
 */
export function premoveOrderTexture(index: number): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const centre = size / 2;

  // 这圈光晕正是它在石面上可读的全部原因；它是渐变而不是圆盘，所以
  // 没有边缘会被误认为硬币的边。
  const halo = ctx.createRadialGradient(centre, centre, 0, centre, centre, size * 0.42);
  halo.addColorStop(0, "rgba(8,10,14,0.78)");
  halo.addColorStop(0.55, "rgba(8,10,14,0.42)");
  halo.addColorStop(1, "rgba(8,10,14,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(centre, centre, size * 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `600 ${Math.floor(size * 0.56)}px "Cinzel", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // 与棋盘边缘横纵坐标字母同款的雕刻衬线字体，让计数读作大厅的一部分，
  // 而不是 HUD 贴纸。
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillText(String(index), centre + size * 0.016, centre + size * 0.032);
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.fillText(String(index), centre, centre + size * 0.016);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 画在玩家拾起的棋子下方的金框。 */
export function selectMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const inset = size * 0.1;
  const span = size - inset * 2;

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = size * 0.026;
  ctx.strokeRect(inset, inset, span, span);

  // 角部装饰，让框读作锻造金属而不是普通方框。
  ctx.lineWidth = size * 0.055;
  ctx.lineCap = "round";
  const arm = size * 0.12;
  const corners: [number, number, number, number][] = [
    [inset, inset, 1, 1],
    [size - inset, inset, -1, 1],
    [inset, size - inset, 1, -1],
    [size - inset, size - inset, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 高亮格上竖立的光柱所用的向上渐变。 */
export function columnTexture(): THREE.CanvasTexture {
  const size = 64;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0.7)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 用于余烬、尘埃和撞击火花的柔和圆点精灵。 */
export function sparkTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,226,168,0.85)");
  gradient.addColorStop(1, "rgba(255,150,60,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 吃子落点格上扩散的冲击波环：炽热的白色边缘、柔和的内侧辉光，
 * 再加几缕放射状碎屑。
 */
export function shockwaveTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const ring = ctx.createRadialGradient(c, c, size * 0.16, c, c, size * 0.5);
  ring.addColorStop(0, "rgba(255,255,255,0)");
  ring.addColorStop(0.55, "rgba(255,255,255,0.1)");
  ring.addColorStop(0.82, "rgba(255,255,255,0.95)");
  ring.addColorStop(0.93, "rgba(255,255,255,0.35)");
  ring.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, size, size);

  // 放射状碎屑让冲击波带上碎裂、碎屑飞溅的感觉。
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2 + 0.2;
    const inner = size * (0.3 + Math.random() * 0.1);
    const outer = size * (0.44 + Math.random() * 0.05);
    ctx.lineWidth = size * (0.008 + Math.random() * 0.012);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * inner, c + Math.sin(angle) * inner);
    ctx.lineTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 棋子落到格子时扬起的柔和尘环：一道细亮的边缘、宽阔羽化的外侧薄雾，
 * 没有碎屑——落下必须读作重量落定，绝不能读作爆炸。
 */
export function landingRingTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const halo = ctx.createRadialGradient(c, c, size * 0.1, c, c, size * 0.5);
  halo.addColorStop(0, "rgba(255,255,255,0)");
  halo.addColorStop(0.62, "rgba(255,255,255,0.06)");
  halo.addColorStop(0.8, "rgba(255,255,255,0.55)");
  halo.addColorStop(0.88, "rgba(255,255,255,0.9)");
  halo.addColorStop(0.95, "rgba(255,255,255,0.18)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // 几处柔和的凹缺打破完美的圆形，让尘环读作被踢起的尘土。
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
    const radius = size * (0.4 + Math.random() * 0.06);
    const blot = ctx.createRadialGradient(
      c + Math.cos(angle) * radius,
      c + Math.sin(angle) * radius,
      0,
      c + Math.cos(angle) * radius,
      c + Math.sin(angle) * radius,
      size * (0.05 + Math.random() * 0.05),
    );
    blot.addColorStop(0, "rgba(0,0,0,0.55)");
    blot.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = blot;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 翻搅过的战场泥土：深色泥浆、裂缝、碎石和湿斑。 */
export function mudTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = "#2a2219";
  ctx.fillRect(0, 0, size, size);

  // 干湿地面的大块色调斑。
  for (let i = 0; i < 40; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 30 + Math.random() * 120;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const wet = Math.random() > 0.5;
    gradient.addColorStop(0, wet ? "rgba(18,15,12,0.55)" : "rgba(74,62,45,0.4)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 车辙和裂缝。
  for (let i = 0; i < 26; i += 1) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    let angle = Math.random() * Math.PI * 2;
    ctx.strokeStyle = "rgba(12,10,8,0.5)";
    ctx.lineWidth = 0.8 + Math.random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 40; s += 1) {
      angle += (Math.random() - 0.5) * 0.5;
      x += Math.cos(angle) * 9;
      y += Math.sin(angle) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 碎石和被踩踏的石子。
  for (let i = 0; i < 420; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.6 + Math.random() * 2.4;
    const tone = 40 + Math.random() * 46;
    ctx.fillStyle = `rgba(${tone},${tone - 6},${tone - 14},0.7)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  grain(ctx, size, 30, 1);
  return toTexture(canvas);
}

/** 纹章营帐布：底色加 V 形条纹带和缝线。 */
export function clothTexture(base: string, accent: string): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = accent;
  ctx.fillRect(0, size * 0.52, size, size * 0.12);

  // V 形条纹。
  ctx.strokeStyle = accent;
  ctx.lineWidth = size * 0.035;
  for (let i = -1; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, size * (0.16 + i * 0.26));
    ctx.lineTo(size * 0.5, size * (0.28 + i * 0.26));
    ctx.lineTo(size, size * (0.16 + i * 0.26));
    ctx.stroke();
  }

  // 垂直编织阴影，让布面受光不均。
  for (let x = 0; x < size; x += 4) {
    ctx.fillStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.09})`;
    ctx.fillRect(x, 0, 2, size);
  }

  grain(ctx, size, 18, 1);
  return toTexture(canvas);
}

/** 蓬松的软边团块，用于火堆上飘散的烟柱。 */
export function smokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(150,142,132,0.5)");
  gradient.addColorStop(0.45, "rgba(104,98,92,0.24)");
  gradient.addColorStop(1, "rgba(60,56,52,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // 几个偏移的团块让烟团不至于读作完美的圆。
  for (let i = 0; i < 5; i += 1) {
    const x = size * (0.3 + Math.random() * 0.4);
    const y = size * (0.3 + Math.random() * 0.4);
    const r = size * (0.14 + Math.random() * 0.16);
    const lobe = ctx.createRadialGradient(x, y, 0, x, y, r);
    lobe.addColorStop(0, "rgba(160,152,142,0.22)");
    lobe.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lobe;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 细粒度的火药烟：*线膛*枪管而非火枪留下的烟。
 *
 * 线膛枪的装药少、填塞紧、几乎燃烧完全，所以它留下的烟幕是淡灰白色、
 * 薄到能透出大厅——而 {@link smokeTexture} 是滑膛枪齐射那种肮脏、
 * 饱含烟炱的浓烟。刻意保持高明度低透明度：颜色会被精灵颜色相乘，
 * 所以纹理本身不能携带暗部。
 */
export function fineSmokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(238,241,244,0.34)");
  gradient.addColorStop(0.38, "rgba(214,219,224,0.15)");
  gradient.addColorStop(0.72, "rgba(190,196,203,0.05)");
  gradient.addColorStop(1, "rgba(180,186,193,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // 比火枪烟团更细、数量更多：线膛枪的烟会撕成丝缕，而不是滚作一团。
  for (let i = 0; i < 7; i += 1) {
    const x = size * (0.26 + Math.random() * 0.48);
    const y = size * (0.26 + Math.random() * 0.48);
    const r = size * (0.08 + Math.random() * 0.13);
    const lobe = ctx.createRadialGradient(x, y, 0, x, y, r);
    lobe.addColorStop(0, "rgba(246,248,250,0.13)");
    lobe.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lobe;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 剑光弧：一弯细细的光之新月，前缘炽热、尾部渐渐消隐，画一次，
 * 在重击时扫过整个身体。
 */
export function crescentTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  // 扫掠：绕大半个圆的一笔宽描边，越走越细。
  const steps = 46;
  const from = -Math.PI * 0.78;
  const to = Math.PI * 0.32;
  ctx.lineCap = "round";
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const angle = from + (to - from) * t;
    // 前缘又亮又宽，沿拖尾逐渐羽化。
    const fade = Math.pow(1 - t, 1.5);
    const radius = size * (0.4 - t * 0.03);
    const width = size * (0.012 + fade * 0.055);
    ctx.strokeStyle = `rgba(255,255,255,${(0.1 + fade * 0.9).toFixed(3)})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, radius, angle - 0.05, angle + 0.05);
    ctx.stroke();
  }

  // 挥击末端的闪光，钢铁移动最快之处。
  const tipX = c + Math.cos(from) * size * 0.4;
  const tipY = c + Math.sin(from) * size * 0.4;
  const glint = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, size * 0.1);
  glint.addColorStop(0, "rgba(255,255,255,0.95)");
  glint.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glint;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 光柱的壁面：贴地处最亮，向上爬出画面时逐渐变淡，带隐约的竖向条纹，
 * 让它读作洒落的光而不是塑料管。
 */
export function pillarTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createLinearGradient(0, size, 0, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.42)");
  gradient.addColorStop(0.75, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 14; i += 1) {
    const x = Math.random() * size;
    const width = size * (0.01 + Math.random() * 0.05);
    ctx.fillStyle = `rgba(0,0,0,${(0.1 + Math.random() * 0.25).toFixed(3)})`;
    ctx.fillRect(x, 0, width, size);
  }
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 枪口焰：白热的核心包在一团形状参差的燃烧火药星芒里。画一次后作为
 * 公告板渲染，所以从棋盘上任何相机角度都能读出这一枪。
 *
 * 星芒被刻意*过曝*——中间三分之一是一片纯白的宽平台，而不是中心一个
 * 孤零零的亮点。两个原因。其一，辉光处理只会拾取已经达到 1 的部分，
 * 所以做成礼貌渐变的枪口焰只在寥寥几个像素上泛光，读作一颗暗淡的火星。
 * 其二，从这根枪管射出的弹丸如今是按数倍口径宽绘制的实体雕塑：比它
 * 发射的弹丸更窄更暗的火焰，会让这一枪看起来像弹丸是被扔出去而不是
 * 射出去的。
 */
export function muzzleFlashTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const halo = ctx.createRadialGradient(c, c, 0, c, c, size * 0.5);
  // 纯白一直铺到半径的五分之一：这是会过曝的部分，因此也是辉光处理
  // 真正看到的部分。
  halo.addColorStop(0, "rgba(255,255,255,1)");
  halo.addColorStop(0.2, "rgba(255,255,251,1)");
  halo.addColorStop(0.34, "rgba(255,244,198,0.82)");
  halo.addColorStop(0.54, "rgba(255,198,104,0.42)");
  halo.addColorStop(0.78, "rgba(255,138,44,0.16)");
  halo.addColorStop(1, "rgba(255,110,30,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "lighter";

  // 火药不会烧成一个圆：枪口喷出的火焰花瓣参差不齐。它们现在几乎伸到
  // 精灵边缘，所以火焰在完整绘制宽度上呈现参差的轮廓，而不是中间一团
  // 软球。
  const petals = 13;
  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * Math.PI * 2 + Math.random() * 0.34;
    const reach = size * (0.31 + Math.random() * 0.18);
    const width = size * (0.035 + Math.random() * 0.045);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    const petal = ctx.createLinearGradient(0, 0, reach, 0);
    petal.addColorStop(0, "rgba(255,255,244,1)");
    petal.addColorStop(0.3, "rgba(255,238,178,0.72)");
    petal.addColorStop(0.62, "rgba(255,196,96,0.34)");
    petal.addColorStop(1, "rgba(255,140,48,0)");
    ctx.fillStyle = petal;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(reach, 0);
    ctx.lineTo(0, width);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 三条长的主喷流：装药真正泄出的地方。纤细、近乎纯白、一路伸到精灵
  // 边缘，正是它们让枪口焰读作从管子里喷出的爆炸，而不是一团发光体。
  for (let i = 0; i < 3; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const reach = size * (0.44 + Math.random() * 0.06);
    const width = size * 0.022;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    const jet = ctx.createLinearGradient(0, 0, reach, 0);
    jet.addColorStop(0, "rgba(255,255,255,1)");
    jet.addColorStop(0.5, "rgba(255,246,206,0.5)");
    jet.addColorStop(1, "rgba(255,170,70,0)");
    ctx.fillStyle = jet;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(reach, 0);
    ctx.lineTo(0, width);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 在中央叠加第二遍纯白（加色混合），让核心真正过曝而不是仅仅偏亮。
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.17);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.6, "rgba(255,252,235,0.7)");
  core.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 沿弹丸飞行轨迹的运动拖影：弹头处不透明，尾部消隐，中间一条亮线。
 *
 * 映射到跟在弹丸后的锥形拖尾上，所以拖影沿长度方向淡出而不是以硬边
 * 截断。一颗半秒内飞越大厅的弹丸只有几个像素宽——这抹拖影是眼睛唯一
 * 能追随的东西，所以它带着炽热的核心而不是平淡的底色。
 */
export function tracerTexture(): THREE.CanvasTexture {
  const width = 32;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.clearRect(0, 0, width, height);

  // 圆柱体 UV 从尾部的 0 到弹头的 1，所以渐变自下而上构建：拖影消逝处
  // 为空，金属所在处为实。
  const along = ctx.createLinearGradient(0, height, 0, 0);
  along.addColorStop(0, "rgba(255,255,255,0)");
  along.addColorStop(0.34, "rgba(255,255,255,0.1)");
  along.addColorStop(0.74, "rgba(255,255,255,0.42)");
  along.addColorStop(1, "rgba(255,255,255,0.92)");
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, width, height);

  // 拖影轴线上一条更亮的细线——被模糊物体的中心永远比边缘更亮。
  const core = ctx.createLinearGradient(0, 0, width, 0);
  core.addColorStop(0, "rgba(255,255,255,0)");
  core.addColorStop(0.5, "rgba(255,255,255,0.5)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 竖向光柱渐变（窗口处最亮，向地面渐隐）。 */
export function shaftTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "rgba(255,224,170,0.55)");
  gradient.addColorStop(0.45, "rgba(255,206,140,0.18)");
  gradient.addColorStop(1, "rgba(255,190,120,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
