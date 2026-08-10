import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { SquareId } from "../core/types";
import type { ArenaLook } from "./arena";
import {
  boardBorderTexture,
  captureMarkerTexture,
  castleMarkerTexture,
  columnTexture,
  marbleTexture,
  moveMarkerTexture,
  premoveCancelTexture,
  premoveMarkerTexture,
  premoveOrderTexture,
  premoveTargetTexture,
  premoveThreadTexture,
  promoteMarkerTexture,
  landingRingTexture,
  radialTexture,
  selectMarkerTexture,
  shockwaveTexture,
  tileMaskTexture,
} from "./textures";

export const TILE = 1.02;
export const BOARD_TOP = 0;

const FILES = "abcdefgh";

export type HighlightKind =
  | "select"
  | "move"
  | "capture"
  | "castle"
  | "promote"
  | "last"
  | "check"
  | "hint"
  /** 引擎思考时，排队着法*可能*瞄准的格子。 */
  | "premove"
  /** 排队着法出发的格子。 */
  | "queued"
  /** 排队着法瞄准的格子——必须清晰可读的那一个。 */
  | "queuedTarget";

const HIGHLIGHT_COLORS: Record<HighlightKind, number> = {
  select: 0xffc95e,
  move: 0x5cf2a4,
  capture: 0xff5a44,
  castle: 0x63b8ff,
  promote: 0xc784ff,
  last: 0xd9a441,
  check: 0xff3b30,
  hint: 0x6aa9ff,
  // 冷白镴色，刻意落在每个*已走出*着法所用的调色板之外：
  // 一个意图没资格与棋盘上的着法争艳。
  premove: 0x7d8ba3,
  queued: 0x8ea0bd,
  // 终点是排队着法中值得读的那一半，所以它是白镴色系里亮的一端：
  // 近白的钢色，衬着黯淡的起点。
  queuedTarget: 0xe6edff,
};

/** 棋子被选中时，不可达格子变暗的程度。 */
const SHROUD_OPACITY = 0.62;

/** 平铺在格砖上的柔和辉光盘的基础不透明度。 */
const GLOW_OPACITY: Record<HighlightKind, number> = {
  select: 0.5,
  move: 0.46,
  capture: 0.58,
  castle: 0.5,
  promote: 0.54,
  last: 0.22,
  check: 0.6,
  hint: 0.3,
  premove: 0.2,
  queued: 0.26,
  queuedTarget: 0.5,
};

/** 叠加在辉光之上的清晰标线的基础不透明度。 */
const MARKER_OPACITY: Record<HighlightKind, number> = {
  select: 0.85,
  move: 0.9,
  capture: 1,
  castle: 0.95,
  promote: 1,
  last: 0,
  check: 0.8,
  hint: 0.5,
  premove: 0.42,
  queued: 0.6,
  queuedTarget: 1,
};

/** 立在格子上的垂直光柱的基础不透明度。 */
const BEAM_OPACITY: Record<HighlightKind, number> = {
  select: 0.16,
  move: 0.3,
  capture: 0.42,
  castle: 0.34,
  promote: 0.46,
  last: 0,
  check: 0.3,
  hint: 0.12,
  premove: 0.08,
  queued: 0.12,
  queuedTarget: 0.28,
};

/**
 * 标线有多大一部分是*穿过*挡在它前面的东西画出来的。
 *
 * 人形是真人大小的而相机压得很低，所以一个目标格经常被身体挡住而不是
 * 露在旁边：在初始局面实测，马的两个目标格在桌面窗口上被遮住 88%，
 * 在手机上约 64%。因此只存在于石面上的标记就是玩家看不见的标记。
 * 每个目标格会被画第二遍：关掉深度测试、叠加混合、强度只取一小部分，
 * 这样被遮住的格子读起来像光从人形后面透出来，而不是凭空消失。刻意
 * 压得很低：这是一句"格子在我身后"的耳语，而不是贴在模型上的贴花。
 */
const XRAY_OPACITY: Record<HighlightKind, number> = {
  select: 0,
  move: 0.3,
  capture: 0.38,
  castle: 0.34,
  promote: 0.38,
  last: 0,
  check: 0,
  hint: 0.26,
  premove: 0.2,
  queued: 0.26,
  queuedTarget: 0.44,
};

/** 标线每秒旋转的弧度（吃子锁定环反向旋转）。 */
const MARKER_SPIN: Record<HighlightKind, number> = {
  select: 0,
  move: 0.35,
  capture: -0.7,
  castle: 0.5,
  promote: 0.9,
  last: 0,
  check: 0.5,
  hint: 0.2,
  premove: 0.12,
  queued: 0.22,
  // 旋转起来的边框就不再是边框。终点方框是棋盘上唯一必须与它宣告的
  // 格砖保持对齐的标记。
  queuedTarget: 0,
};

const POP_DURATION = 0.26;

/** 游戏允许的最深队列，也就是要预先备好的连线数量。 */
const MAX_PREMOVE_LINKS = 5;

/** 撤销硬币悬浮在目标格砖上方的高度。 */
const CANCEL_LIFT = 0.62;
/** 硬币精灵的世界尺寸，含透明的命中边距。 */
const CANCEL_SIZE = 0.62;
/** 撤销硬币的静置色调：排队着法的白镴色。 */
const CANCEL_COLD = new THREE.Color(0xd7e2f6);
/** 指针悬停时它变暖成余烬色——这是执行删除的按钮。 */
const CANCEL_HOT = new THREE.Color(0xff8f7a);

/**
 * 顺序数字悬浮的高度。低到足以属于这个格子，又远远避开
 * {@link CANCEL_LIFT} 处的撤销硬币，让两者在链条最后一环上也不会相撞
 * ——它们叠放时，数字在硬币下方。
 */
const ORDER_LIFT = 0.28;
/** 顺序数字精灵的世界尺寸。 */
const ORDER_SIZE = 0.34;
/** 整套预先走子语言所用的白镴色。 */
const ORDER_TINT = new THREE.Color(0xe6edff);

/**
 * 一条连线颜色渐变的两端。*下一个*要走的链环燃着近白的钢色；排在它
 * 后面的逐渐冷却向起点环的黯淡白镴，这样整条链沿着自己的线就能按序
 * 读出，而不只是靠数字。
 */
const THREAD_HEAD = new THREE.Color(0xe6edff);
const THREAD_TAIL = new THREE.Color(0x7f90ad);

/** 过冲缓动，让格子带着一点顿挫感弹入位置。 */
function easeOutBack(t: number): number {
  const c = 1.9;
  const p = t - 1;
  return 1 + (c + 1) * p * p * p + c * p * p;
}

export function squareToWorld(square: SquareId, y = BOARD_TOP): THREE.Vector3 {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return new THREE.Vector3((file - 3.5) * TILE, y, (3.5 - (rank - 1)) * TILE);
}

export function worldToSquare(x: number, z: number): SquareId | null {
  const file = Math.round(x / TILE + 3.5);
  const rank = Math.round(3.5 - z / TILE) + 1;
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${FILES[file]}${rank}`;
}

export function isLightSquare(square: SquareId): boolean {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 0;
}

/** 被冲击震离位置的格砖，带阻尼地弹回原位。 */
interface TileJolt {
  tile: THREE.Mesh;
  home: THREE.Vector3;
  /** 已经过的秒数；冲击波尚未传到这块格砖时为负。 */
  age: number;
  strength: number;
  duration: number;
  seed: number;
}

/** 在一个格子上播放的池化冲击波环 / 闪光对。 */
interface ImpactWave {
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  flare: THREE.Mesh;
  flareMaterial: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  active: boolean;
}

/** 人形刚刚落下的格子上的落地涟漪。 */
interface LandingRipple {
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  glowMaterial: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  strength: number;
  active: boolean;
}

/** 罩在选中棋子无法到达的格子上的暗纱。 */
interface ShroudSlot {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  target: number;
  current: number;
  /** 这个格子开始淡出之前还要等待的秒数。 */
  delay: number;
}

interface HighlightSlot {
  glow: THREE.Mesh;
  glowMaterial: THREE.MeshBasicMaterial;
  marker: THREE.Mesh;
  markerMaterial: THREE.MeshBasicMaterial;
  /** 同一个标线再画一遍，穿过任何挡路的东西。 */
  xray: THREE.Mesh;
  xrayMaterial: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  beamMaterial: THREE.MeshBasicMaterial;
  kind: HighlightKind | null;
  pulse: boolean;
  /** 高亮设置以来的秒数；等待自身的错峰延迟时为负。 */
  age: number;
  phase: number;
}

/**
 * 对局表面：64 块带倒角的大理石/玄武岩格砖，铺在带青铜包边雕刻边框的
 * 底座上，外加池化的高亮覆盖层。
 */
export class BoardView {
  readonly group = new THREE.Group();
  readonly tiles: THREE.Mesh[] = [];

  private slots = new Map<SquareId, HighlightSlot>();
  /** 模态面板占据屏幕（升变选择器）期间保持压制。 */
  private overlaysMuted = false;
  private shrouds = new Map<SquareId, ShroudSlot>();
  private markerMaps: Record<HighlightKind, THREE.Texture | null> = {
    select: null,
    move: null,
    capture: null,
    castle: null,
    promote: null,
    last: null,
    check: null,
    hint: null,
    premove: null,
    queued: null,
    queuedTarget: null,
  };
  private hoverRing: THREE.Mesh;
  /** 沿排队链条的每一环绘制的连线。 */
  private premoveLinks: THREE.Mesh[] = [];
  /** 每环一个材质：每条连线都携带自己在链中的位置。 */
  private premoveLinkMaterials: THREE.MeshBasicMaterial[] = [];
  /** 悬在排队着法终点上方的撤销硬币。 */
  private premoveCancel!: THREE.Sprite;
  private premoveCancelMaterial!: THREE.SpriteMaterial;
  private premoveCancelSquare: SquareId | null = null;
  private premoveCancelHot = false;
  private premoveCancelHeat = 0;
  private premoveCancelAge = 0;
  /** 悬浮在排队链条每个格子上的 1..5 数字。 */
  private premoveOrders: THREE.Sprite[] = [];
  private premoveOrderMaterials: THREE.SpriteMaterial[] = [];
  private premoveOrderAges: number[] = [];
  /** 竞技场主题会重绘的材质（格砖对比度、底座石料、包边）。 */
  private lightTileMaterial: THREE.MeshPhysicalMaterial;
  private darkTileMaterial: THREE.MeshPhysicalMaterial;
  private baseMaterial: THREE.MeshStandardMaterial | null = null;
  private borderMaterial: THREE.MeshStandardMaterial | null = null;
  private trimMaterial: THREE.MeshStandardMaterial | null = null;
  private disposables: { dispose: () => void }[] = [];
  private elapsed = 0;
  private tileBySquare = new Map<SquareId, THREE.Mesh>();
  private jolts: TileJolt[] = [];
  private waves: ImpactWave[] = [];
  private waveCursor = 0;
  private landings: LandingRipple[] = [];
  private landingCursor = 0;

  constructor() {
    this.group.name = "board";

    const lightMap = this.track(marbleTexture(false));
    const darkMap = this.track(marbleTexture(true));
    const lightMaterial = this.track(
      new THREE.MeshPhysicalMaterial({
        map: lightMap,
        color: 0xf6efe0,
        roughness: 0.22,
        metalness: 0.02,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.9,
      }),
    );
    const darkMaterial = this.track(
      new THREE.MeshPhysicalMaterial({
        map: darkMap,
        color: 0x23252c,
        roughness: 0.3,
        metalness: 0.12,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
        envMapIntensity: 0.8,
      }),
    );

    this.lightTileMaterial = lightMaterial;
    this.darkTileMaterial = darkMaterial;

    const tileGeometry = this.track(new RoundedBoxGeometry(TILE * 0.97, 0.18, TILE * 0.97, 3, 0.035));

    for (let rank = 1; rank <= 8; rank += 1) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
        const square = `${FILES[fileIndex]}${rank}`;
        const light = isLightSquare(square);
        const tile = new THREE.Mesh(tileGeometry, light ? lightMaterial : darkMaterial);
        const position = squareToWorld(square, -0.09);
        tile.position.copy(position);
        tile.receiveShadow = true;
        tile.castShadow = false;
        tile.userData.square = square;
        tile.userData.home = position.clone();
        this.tileBySquare.set(square, tile);
        this.tiles.push(tile);
        this.group.add(tile);
      }
    }

    this.buildBase();
    this.buildShroud();
    this.buildHighlights();
    this.buildImpactWaves();
    this.buildLandingRipples();

    const ringGeometry = this.track(new THREE.RingGeometry(TILE * 0.42, TILE * 0.48, 32));
    const ringMaterial = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffd88a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.hoverRing = new THREE.Mesh(ringGeometry, ringMaterial);
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.position.y = BOARD_TOP + 0.012;
    this.hoverRing.renderOrder = 5;
    this.group.add(this.hoverRing);

    this.buildPremoveLink();
    this.buildPremoveCancel();
    this.buildPremoveOrders();
  }

  /**
   * 顺序数字。和硬币一样，它们是关掉深度测试的精灵：链条会*穿过*仍站在
   * 棋盘上的人形，所以那个写着"这步第三个走"的标记绝不能被一座车挡住。
   */
  private buildPremoveOrders(): void {
    for (let index = 0; index < MAX_PREMOVE_LINKS; index += 1) {
      const material = this.track(
        new THREE.SpriteMaterial({
          map: this.track(premoveOrderTexture(index + 1)),
          color: ORDER_TINT.clone(),
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
        }),
      );
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      // 在硬币（12）之下，数字永远不会盖住撤销按钮。
      sprite.renderOrder = 11;
      sprite.scale.setScalar(ORDER_SIZE);
      this.premoveOrders.push(sprite);
      this.premoveOrderMaterials.push(material);
      this.premoveOrderAges.push(0);
      this.group.add(sprite);
    }
  }

  /**
   * 给排队链条的格子编号，最早的在前。
   *
   * 单独一步排队着法**不**给数字：孤零零一个"1"回答了一个没人问的问题，
   * 还给已经背着环、框、线和硬币的棋盘多添一个标记。只有出现了顺序
   * 可读——从第二环起——数字才出现。
   */
  setPremoveOrders(squares: SquareId[]): void {
    const numbered = squares.length > 1 ? squares : [];
    for (let index = 0; index < this.premoveOrders.length; index += 1) {
      const sprite = this.premoveOrders[index];
      const square = numbered[index];
      if (!square) {
        sprite.visible = false;
        this.premoveOrderMaterials[index].opacity = 0;
        continue;
      }
      const centre = squareToWorld(square, BOARD_TOP);
      sprite.position.set(centre.x, BOARD_TOP + ORDER_LIFT, centre.z);
      if (!sprite.visible) {
        this.premoveOrderAges[index] = 0;
        this.premoveOrderMaterials[index].opacity = 0;
      }
      // 链头是下一个要走的环，所以它最亮；链尾渐暗，让眼睛按顺序
      // 读出整个计划。
      const fade = index === 0 ? 1 : Math.max(0.62, 1 - index * 0.1);
      this.premoveOrderMaterials[index].color.copy(ORDER_TINT).multiplyScalar(fade);
      sprite.visible = !this.overlaysMuted;
    }
  }

  /**
   * 排队链条各格子之间的连线。光有标记，在繁忙的棋盘上读起来只是
   * 互不相干的光点；正是这些线让它们一眼看上去就是一个*计划*，
   * 而且它们会呼吸，所以绝不会被误当成已走出的着法。
   *
   * 每个可能的链环一个网格，预先建好、按需显示：游戏允许的最深队列
   * 是五层，所以没有任何东西需要在对局中途分配。每个链环都有**自己的**
   * 材质，因为一条连线要承载共享材质给不出的两样东西：它朝哪个方向走
   * （渐变贴图，其局部 +x 始终指向终点）以及它在链条的第几层（它的
   * 色调）。
   */
  private buildPremoveLink(): void {
    const geometry = this.track(new THREE.PlaneGeometry(1, 1));
    geometry.rotateX(-Math.PI / 2);
    const map = this.track(premoveThreadTexture());
    for (let index = 0; index < MAX_PREMOVE_LINKS; index += 1) {
      const material = this.track(
        new THREE.MeshBasicMaterial({
          map,
          color: THREAD_HEAD.clone(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.premoveLinkMaterials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = BOARD_TOP + 0.018;
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.premoveLinks.push(mesh);
      this.group.add(mesh);
    }
  }

  /**
   * 撤销硬币。它是精灵，所以从任何相机角度都始终面向玩家；它忽略深度
   * 缓冲：一个被挡在它前面的人形遮住的撤销按钮，就是一个不存在的
   * 撤销按钮。
   */
  private buildPremoveCancel(): void {
    const material = this.track(
      new THREE.SpriteMaterial({
        map: this.track(premoveCancelTexture()),
        color: CANCEL_COLD.clone(),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.premoveCancelMaterial = material;
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 12;
    sprite.scale.setScalar(CANCEL_SIZE);
    this.premoveCancel = sprite;
    this.group.add(sprite);
  }

  /** 把撤销硬币悬到某个格子上方，或者收走它。 */
  setPremoveCancel(square: SquareId | null): void {
    if (square === this.premoveCancelSquare) return;
    this.premoveCancelSquare = square;
    this.premoveCancelHot = false;
    this.premoveCancelHeat = 0;
    this.premoveCancelMaterial.color.copy(CANCEL_COLD);
    if (!square) {
      this.premoveCancel.visible = false;
      this.premoveCancelMaterial.opacity = 0;
      return;
    }
    const centre = squareToWorld(square, BOARD_TOP);
    this.premoveCancel.position.set(centre.x, BOARD_TOP + CANCEL_LIFT, centre.z);
    this.premoveCancelAge = 0;
    this.premoveCancelMaterial.opacity = 0;
    this.premoveCancel.visible = !this.overlaysMuted;
  }

  /** 指针悬停在硬币上时点亮它。 */
  setPremoveCancelHot(hot: boolean): void {
    this.premoveCancelHot = hot;
  }

  /** 作为射线目标的硬币；没有什么可撤销时为 `null`。 */
  premoveCancelHandle(): THREE.Object3D | null {
    return this.premoveCancel.visible && this.premoveCancelSquare ? this.premoveCancel : null;
  }

  /**
   * 沿排队链条的每一环铺一条连线，或者把它们收走。
   *
   * 网格的局部 +x 是行进方向——`atan2(-dz, dx)` 让它从起点瞄准终点——
   * 渐变贴图也沿同一根轴绘制，所以彗头总是*烧进*计划即将进入的格子，
   * 不需要任何逐链环的贴图处理。
   */
  setPremoveLinks(moves: { from: SquareId; to: SquareId }[]): void {
    for (let index = 0; index < this.premoveLinks.length; index += 1) {
      const mesh = this.premoveLinks[index];
      const move = moves[index];
      if (!move) {
        mesh.visible = false;
        this.premoveLinkMaterials[index].opacity = 0;
        continue;
      }
      // 下一个要走的链环是钢色；排在它后面的冷却向起点环的白镴色，
      // 让整条链沿着自己的线按序可读。
      const depth = moves.length > 1 ? index / (moves.length - 1) : 0;
      this.premoveLinkMaterials[index].color.copy(THREAD_HEAD).lerp(THREAD_TAIL, depth * 0.85);
      const from = squareToWorld(move.from, BOARD_TOP);
      const to = squareToWorld(move.to, BOARD_TOP);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.001) {
        mesh.visible = false;
        this.premoveLinkMaterials[index].opacity = 0;
        continue;
      }
      mesh.position.set((from.x + to.x) / 2, BOARD_TOP + 0.018, (from.z + to.z) / 2);
      mesh.rotation.y = Math.atan2(-dz, dx);
      // 两端都向内收，让连线在两个标线之内起止，而不是横穿它们。
      mesh.scale.set(Math.max(0.2, length - TILE * 0.5), 1, TILE * 0.22);
      mesh.visible = true;
    }
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildBase(): void {
    const size = TILE * 8 + 1.5;
    const geometry = this.track(new RoundedBoxGeometry(size, 0.62, size, 4, 0.09));
    const stone = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3b342b, roughness: 0.72, metalness: 0.25 }),
    );
    this.baseMaterial = stone;
    const top = this.track(
      new THREE.MeshStandardMaterial({
        map: this.track(boardBorderTexture()),
        color: 0xbfae8e,
        roughness: 0.55,
        metalness: 0.45,
        envMapIntensity: 1.1,
      }),
    );
    this.borderMaterial = top;
    const materials = [stone, stone, top, stone, stone, stone];
    const base = new THREE.Mesh(geometry, materials);
    base.position.y = -0.42;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    // 青铜包边：一圈细环面状边框，在掠射角度接住泛光。
    const trimGeometry = this.track(new RoundedBoxGeometry(size + 0.18, 0.14, size + 0.18, 3, 0.06));
    const trim = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x8a6a33,
        roughness: 0.28,
        metalness: 0.95,
        emissive: 0x2a1a06,
        emissiveIntensity: 0.4,
        envMapIntensity: 1.4,
      }),
    );
    this.trimMaterial = trim;
    const trimMesh = new THREE.Mesh(trimGeometry, trim);
    trimMesh.position.y = -0.7;
    trimMesh.castShadow = true;
    this.group.add(trimMesh);
  }

  private buildHighlights(): void {
    const glowGeometry = this.track(new THREE.PlaneGeometry(TILE * 0.98, TILE * 0.98));
    const markerGeometry = this.track(new THREE.PlaneGeometry(TILE * 0.92, TILE * 0.92));
    const beamGeometry = this.track(
      new THREE.CylinderGeometry(TILE * 0.4, TILE * 0.44, 0.55, 20, 1, true),
    );
    const glowMap = this.track(radialTexture("rgba(255,255,255,0.95)", "rgba(255,255,255,0)"));
    const beamMap = this.track(columnTexture());
    this.markerMaps = {
      select: this.track(selectMarkerTexture()),
      move: this.track(moveMarkerTexture()),
      capture: this.track(captureMarkerTexture()),
      castle: this.track(castleMarkerTexture()),
      promote: this.track(promoteMarkerTexture()),
      check: this.track(captureMarkerTexture()),
      hint: this.track(moveMarkerTexture()),
      last: null,
      premove: this.track(premoveMarkerTexture()),
      queued: this.track(premoveMarkerTexture()),
      queuedTarget: this.track(premoveTargetTexture()),
    };

    let index = 0;
    for (let rank = 1; rank <= 8; rank += 1) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
        const square = `${FILES[fileIndex]}${rank}`;

        const glowMaterial = this.track(
          new THREE.MeshBasicMaterial({
            map: glowMap,
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.rotation.x = -Math.PI / 2;
        glow.position.copy(squareToWorld(square, BOARD_TOP + 0.008));
        glow.visible = false;
        glow.renderOrder = 2;
        this.group.add(glow);

        const markerMaterial = this.track(
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.rotation.x = -Math.PI / 2;
        marker.position.copy(squareToWorld(square, BOARD_TOP + 0.016));
        marker.visible = false;
        marker.renderOrder = 4;
        this.group.add(marker);

        const xrayMaterial = this.track(
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        const xray = new THREE.Mesh(markerGeometry, xrayMaterial);
        xray.rotation.x = -Math.PI / 2;
        xray.position.copy(squareToWorld(square, BOARD_TOP + 0.017));
        xray.visible = false;
        // 高于所有棋盘覆盖层：没有深度测试替它排序，渲染顺序是让它
        // 待在所属辉光之上的唯一保证。
        xray.renderOrder = 9;
        this.group.add(xray);

        const beamMaterial = this.track(
          new THREE.MeshBasicMaterial({
            map: beamMap,
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
        );
        const beam = new THREE.Mesh(beamGeometry, beamMaterial);
        beam.position.copy(squareToWorld(square, BOARD_TOP + 0.275));
        beam.visible = false;
        beam.renderOrder = 3;
        this.group.add(beam);

        this.slots.set(square, {
          glow,
          glowMaterial,
          marker,
          markerMaterial,
          xray,
          xrayMaterial,
          beam,
          beamMaterial,
          kind: null,
          pulse: false,
          age: 0,
          phase: (index % 7) * 0.42,
        });
        index += 1;
      }
    }
  }

  /**
   * 每个格子一层暗纱，贴在石面略上方。选中棋子时，它到达不了的每个格子
   * 都会变暗，让亮起的目的地一眼可读，而不是与 64 块均匀照明的格砖
   * 争抢注意力。
   */
  private buildShroud(): void {
    const geometry = this.track(new THREE.PlaneGeometry(TILE * 1.01, TILE * 1.01));
    const map = this.track(tileMaskTexture());

    for (let rank = 1; rank <= 8; rank += 1) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
        const square = `${FILES[fileIndex]}${rank}`;
        const material = this.track(
          new THREE.MeshBasicMaterial({
            map,
            color: 0x05070e,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.copy(squareToWorld(square, BOARD_TOP + 0.004));
        mesh.visible = false;
        mesh.renderOrder = 1;
        this.group.add(mesh);
        this.shrouds.set(square, { mesh, material, target: 0, current: 0, delay: 0 });
      }
    }
  }

  /**
   * 给除 `reachable` 之外的每个格子罩上暗纱。传 `null` 揭开暗纱。
   * `origin` 让淡出错峰进行，使阴影从被选中棋子处向四周合拢。
   */
  setShroud(reachable: Iterable<SquareId> | null, origin?: SquareId): void {
    if (!reachable) {
      for (const slot of this.shrouds.values()) {
        slot.target = 0;
        slot.delay = 0;
      }
      return;
    }
    const lit = new Set<SquareId>(reachable);
    const originPosition = origin ? squareToWorld(origin) : null;
    for (const [square, slot] of this.shrouds) {
      const clear = lit.has(square);
      slot.target = clear ? 0 : SHROUD_OPACITY;
      slot.delay =
        clear || !originPosition
          ? 0
          : Math.min((squareToWorld(square).distanceTo(originPosition) / TILE) * 0.016, 0.12);
    }
  }

  private updateShroud(delta: number): void {
    for (const slot of this.shrouds.values()) {
      if (slot.delay > 0) {
        slot.delay -= delta;
        if (slot.delay > 0) continue;
      }
      if (Math.abs(slot.target - slot.current) < 0.002) {
        if (slot.current !== slot.target) {
          slot.current = slot.target;
          slot.material.opacity = slot.current;
          slot.mesh.visible = slot.current > 0.004;
        }
        continue;
      }
      // 合拢比揭开稍慢，这样取消选择时感觉干脆利落。
      const speed = slot.target > slot.current ? 8 : 13;
      slot.current += (slot.target - slot.current) * Math.min(1, delta * speed);
      slot.material.opacity = slot.current;
      slot.mesh.visible = slot.current > 0.004;
    }
  }

  /** 吃子冲击用的可复用冲击波环 + 闪光池。 */
  private buildImpactWaves(): void {
    const ringGeometry = this.track(new THREE.PlaneGeometry(TILE * 2.4, TILE * 2.4));
    const flareGeometry = this.track(new THREE.PlaneGeometry(TILE * 1.5, TILE * 1.5));
    const ringMap = this.track(shockwaveTexture());
    const flareMap = this.track(radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)"));

    for (let i = 0; i < 4; i += 1) {
      const ringMaterial = this.track(
        new THREE.MeshBasicMaterial({
          map: ringMap,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 6;
      this.group.add(ring);

      const flareMaterial = this.track(
        new THREE.MeshBasicMaterial({
          map: flareMap,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const flare = new THREE.Mesh(flareGeometry, flareMaterial);
      flare.rotation.x = -Math.PI / 2;
      flare.visible = false;
      flare.renderOrder = 7;
      this.group.add(flare);

      this.waves.push({ ring, ringMaterial, flare, flareMaterial, age: 0, duration: 0.5, active: false });
    }
  }

  /** 可复用落地涟漪池：一圈尘土环加一片柔和的地面辉光。 */
  private buildLandingRipples(): void {
    const ringGeometry = this.track(new THREE.PlaneGeometry(TILE * 2.1, TILE * 2.1));
    const glowGeometry = this.track(new THREE.PlaneGeometry(TILE * 1.35, TILE * 1.35));
    const ringMap = this.track(landingRingTexture());
    const glowMap = this.track(radialTexture("rgba(255,255,255,0.9)", "rgba(255,255,255,0)"));

    for (let i = 0; i < 5; i += 1) {
      const ringMaterial = this.track(
        new THREE.MeshBasicMaterial({
          map: ringMap,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 6;
      this.group.add(ring);

      const glowMaterial = this.track(
        new THREE.MeshBasicMaterial({
          map: glowMap,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.rotation.x = -Math.PI / 2;
      glow.visible = false;
      glow.renderOrder = 5;
      this.group.add(glow);

      this.landings.push({
        ring,
        ringMaterial,
        glow,
        glowMaterial,
        age: 0,
        duration: 0.7,
        strength: 1,
        active: false,
      });
    }
  }

  /**
   * 落子到一个格子：尘土环从人形脚下向外滚开，叠在一小段军队色辉光
   * 之上，格砖同时微微下沉。比 {@link impact} 更柔、更慢——这是重量
   * 落定，不是一击。
   */
  land(square: SquareId, color = 0xffd6a0, strength = 1): void {
    const centre = squareToWorld(square, BOARD_TOP + 0.018);

    const ripple = this.landings[this.landingCursor % this.landings.length];
    this.landingCursor += 1;
    ripple.age = 0;
    ripple.duration = 0.62 + strength * 0.16;
    ripple.strength = strength;
    ripple.active = true;
    ripple.ring.position.copy(centre);
    ripple.ring.rotation.z = Math.random() * Math.PI * 2;
    ripple.ring.scale.setScalar(0.2);
    ripple.ring.visible = true;
    ripple.ringMaterial.color.setHex(color);
    ripple.glow.position.copy(centre).setY(BOARD_TOP + 0.014);
    ripple.glow.scale.setScalar(0.6);
    ripple.glow.visible = true;
    ripple.glowMaterial.color.setHex(color);

    this.joltTiles(square, strength * 0.42, 1.4);
  }

  /**
   * 格子上的吃子冲击：一道白热闪光衰减成一个着色的冲击波环，与此同时
   * 被击中的格砖及其邻居被震出棋盘再弹回原位。
   */
  impact(square: SquareId, color = 0xff6a3c, strength = 1): void {
    const centre = squareToWorld(square, BOARD_TOP + 0.02);

    const wave = this.waves[this.waveCursor % this.waves.length];
    this.waveCursor += 1;
    wave.age = 0;
    wave.duration = 0.6;
    wave.active = true;
    wave.ring.position.copy(centre);
    wave.ring.rotation.z = Math.random() * Math.PI;
    wave.ring.visible = true;
    wave.ringMaterial.color.setHex(color);
    wave.flare.position.copy(centre).setY(BOARD_TOP + 0.03);
    wave.flare.visible = true;
    wave.flareMaterial.color.setHex(0xfff3d2);

    this.joltTiles(square, strength, 2.2);
  }

  /** 冲击向外扩散：邻居比中心更晚、更弱地受震。 */
  private joltTiles(square: SquareId, strength: number, reach: number): void {
    if (strength <= 0) return;
    const origin = squareToWorld(square);
    for (const [target, tile] of this.tileBySquare) {
      const distance = squareToWorld(target).distanceTo(origin) / TILE;
      if (distance > reach) continue;
      const falloff = Math.max(0, 1 - distance / (reach + 0.2));
      const amount = strength * falloff * falloff;
      if (amount < 0.04) continue;
      this.jolts = this.jolts.filter((entry) => entry.tile !== tile);
      this.jolts.push({
        tile,
        home: (tile.userData.home as THREE.Vector3).clone(),
        age: -distance * 0.035,
        strength: amount,
        duration: 0.5 + distance * 0.06,
        seed: Math.random() * Math.PI * 2,
      });
    }
  }

  private updateImpacts(delta: number): void {
    for (let i = this.jolts.length - 1; i >= 0; i -= 1) {
      const jolt = this.jolts[i];
      jolt.age += delta;
      if (jolt.age < 0) continue;
      const t = jolt.age / jolt.duration;
      if (t >= 1) {
        jolt.tile.position.copy(jolt.home);
        jolt.tile.rotation.set(0, 0, 0);
        this.jolts.splice(i, 1);
        continue;
      }
      // 阻尼振荡：先向下砸，然后回稳。
      const decay = Math.exp(-t * 6.5) * (1 - t);
      const swing = Math.sin(jolt.age * 34 + jolt.seed) * decay * jolt.strength;
      jolt.tile.position.set(
        jolt.home.x + Math.sin(jolt.age * 41 + jolt.seed) * decay * jolt.strength * 0.035,
        jolt.home.y - swing * 0.13,
        jolt.home.z + Math.cos(jolt.age * 38 + jolt.seed) * decay * jolt.strength * 0.035,
      );
      jolt.tile.rotation.set(swing * 0.05, 0, Math.cos(jolt.age * 30 + jolt.seed) * decay * jolt.strength * 0.05);
    }

    for (const wave of this.waves) {
      if (!wave.active) continue;
      wave.age += delta;
      const t = wave.age / wave.duration;
      if (t >= 1) {
        wave.active = false;
        wave.ring.visible = false;
        wave.flare.visible = false;
        wave.ringMaterial.opacity = 0;
        wave.flareMaterial.opacity = 0;
        continue;
      }
      const eased = 1 - Math.pow(1 - t, 2.6);
      wave.ring.scale.setScalar(0.25 + eased * 1.35);
      wave.ringMaterial.opacity = Math.pow(1 - t, 1.7) * 0.95;
      wave.ring.rotation.z += delta * 0.6;

      // 闪光是两帧的过曝：瞬间到达峰值，约 0.18 秒内消失。
      const flareT = Math.min(1, wave.age / 0.18);
      wave.flare.scale.setScalar(0.5 + flareT * 1.1);
      wave.flareMaterial.opacity = Math.pow(1 - flareT, 2) * 1.1;
      wave.flare.visible = flareT < 1;
    }

    for (const ripple of this.landings) {
      if (!ripple.active) continue;
      ripple.age += delta;
      const t = ripple.age / ripple.duration;
      if (t >= 1) {
        ripple.active = false;
        ripple.ring.visible = false;
        ripple.glow.visible = false;
        ripple.ringMaterial.opacity = 0;
        ripple.glowMaterial.opacity = 0;
        continue;
      }
      // 尘土先快速滚出再滑行；它下面的光熄灭得更快。
      const eased = 1 - Math.pow(1 - t, 3);
      ripple.ring.scale.setScalar(0.2 + eased * (0.85 + ripple.strength * 0.5));
      ripple.ringMaterial.opacity = Math.sin(Math.PI * Math.pow(t, 0.55)) * 0.55 * ripple.strength;
      ripple.ring.rotation.z += delta * 0.35;

      const glowT = Math.min(1, ripple.age / (ripple.duration * 0.45));
      ripple.glow.scale.setScalar(0.6 + glowT * 0.75);
      ripple.glowMaterial.opacity = Math.pow(1 - glowT, 2.1) * 0.5 * ripple.strength;
      ripple.glow.visible = glowT < 1;
    }
  }

  clearHighlights(kinds?: HighlightKind[]): void {
    if (!kinds) {
      this.setShroud(null);
      this.setPremoveLinks([]);
      this.setPremoveCancel(null);
      this.setPremoveOrders([]);
    }
    for (const slot of this.slots.values()) {
      if (kinds && slot.kind && !kinds.includes(slot.kind)) continue;
      slot.kind = null;
      slot.pulse = false;
      slot.age = 0;
      slot.glow.visible = false;
      slot.marker.visible = false;
      slot.xray.visible = false;
      slot.beam.visible = false;
      slot.glowMaterial.opacity = 0;
      slot.markerMaterial.opacity = 0;
      slot.xrayMaterial.opacity = 0;
      slot.beamMaterial.opacity = 0;
    }
  }

  /**
   * 点亮一个格子。`delay` 让弹入错峰进行，一扇合法着法从被选中棋子
   * 向外涟漪展开，而不是同时出现。
   */
  setHighlight(square: SquareId, kind: HighlightKind, pulse = false, delay = 0): void {
    const slot = this.slots.get(square);
    if (!slot) return;
    const restart = slot.kind !== kind;
    slot.kind = kind;
    slot.pulse = pulse;
    if (restart) slot.age = -delay;

    const color = HIGHLIGHT_COLORS[kind];
    slot.glowMaterial.color.setHex(color);
    slot.markerMaterial.color.setHex(color);
    slot.xrayMaterial.color.setHex(color);
    slot.beamMaterial.color.setHex(color);

    const markerMap = this.markerMaps[kind];
    slot.markerMaterial.map = markerMap;
    slot.markerMaterial.needsUpdate = true;
    slot.marker.rotation.z = 0;
    slot.xrayMaterial.map = markerMap;
    slot.xrayMaterial.needsUpdate = true;
    slot.xray.rotation.z = 0;

    const visible = slot.age >= 0;
    slot.glow.visible = visible;
    slot.marker.visible = visible && markerMap !== null;
    slot.xray.visible = visible && markerMap !== null && XRAY_OPACITY[kind] > 0;
    slot.beam.visible = visible && BEAM_OPACITY[kind] > 0;
  }

  /**
   * 让撤销硬币弹入、上下浮动，并在指针悬停时变暖。浮动正是让它不被
   * 读成石面一部分的原因：它悬在格子上方的空气里，所以一眼就是
   * 一个控件，而不是又一个标记。
   */
  private updatePremoveCancel(delta: number): void {
    if (!this.premoveCancel.visible || !this.premoveCancelSquare) return;
    this.premoveCancelAge = Math.min(this.premoveCancelAge + delta, POP_DURATION);
    const pop = easeOutBack(this.premoveCancelAge / POP_DURATION);
    const target = this.premoveCancelHot ? 1 : 0;
    this.premoveCancelHeat += (target - this.premoveCancelHeat) * Math.min(1, delta * 12);
    const heat = this.premoveCancelHeat;
    const bob = Math.sin(this.elapsed * 2.2) * 0.03;
    const centre = squareToWorld(this.premoveCancelSquare, BOARD_TOP);
    this.premoveCancel.position.set(centre.x, BOARD_TOP + CANCEL_LIFT + bob, centre.z);
    this.premoveCancel.scale.setScalar(CANCEL_SIZE * (0.4 + pop * 0.6) * (1 + heat * 0.16));
    this.premoveCancelMaterial.opacity = (0.78 + heat * 0.22) * Math.min(1, pop);
    this.premoveCancelMaterial.color.copy(CANCEL_COLD).lerp(CANCEL_HOT, heat);
  }

  /**
   * 让每个数字弹入。它们不浮动：浮动是把硬币标识为控件的特征，
   * 而一个可以按下去的数字就是个谎言。
   */
  private updatePremoveOrders(delta: number): void {
    for (let index = 0; index < this.premoveOrders.length; index += 1) {
      const sprite = this.premoveOrders[index];
      if (!sprite.visible) continue;
      this.premoveOrderAges[index] = Math.min(this.premoveOrderAges[index] + delta, POP_DURATION);
      const pop = easeOutBack(this.premoveOrderAges[index] / POP_DURATION);
      sprite.scale.setScalar(ORDER_SIZE * (0.5 + pop * 0.5));
      this.premoveOrderMaterials[index].opacity = 0.92 * Math.min(1, pop);
    }
  }

  /**
   * 让刻意忽略深度缓冲的覆盖层——透视标线——静默。它们穿过一切挡路的
   * 东西绘制，模态面板也包括在内，所以有面板弹出时它们必须退场。
   */
  setOverlaysMuted(muted: boolean): void {
    if (this.overlaysMuted === muted) return;
    this.overlaysMuted = muted;
    this.premoveCancel.visible = !muted && this.premoveCancelSquare !== null;
    for (let index = 0; index < this.premoveOrders.length; index += 1) {
      const sprite = this.premoveOrders[index];
      if (muted) sprite.visible = false;
      else if (this.premoveOrderMaterials[index].opacity > 0) sprite.visible = true;
    }
    if (!muted) return;
    for (const slot of this.slots.values()) {
      slot.xray.visible = false;
      slot.xrayMaterial.opacity = 0;
    }
  }

  setHover(square: SquareId | null): void {
    const material = this.hoverRing.material as THREE.MeshBasicMaterial;
    if (!square) {
      material.opacity = 0;
      return;
    }
    this.hoverRing.position.copy(squareToWorld(square, BOARD_TOP + 0.014));
    material.opacity = 0.5;
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.updateImpacts(delta);
    this.updateShroud(delta);
    if (this.premoveLinks[0].visible) {
      const wave = (Math.sin(this.elapsed * 2.2) + 1) * 0.5;
      const opacity = 0.16 + wave * 0.16;
      for (let index = 0; index < this.premoveLinks.length; index += 1) {
        if (!this.premoveLinks[index].visible) continue;
        this.premoveLinkMaterials[index].opacity = opacity;
      }
    }
    this.updatePremoveCancel(delta);
    this.updatePremoveOrders(delta);
    for (const slot of this.slots.values()) {
      const kind = slot.kind;
      if (!kind) continue;

      slot.age += delta;
      if (slot.age < 0) {
        slot.glow.visible = false;
        slot.marker.visible = false;
        slot.xray.visible = false;
        slot.beam.visible = false;
        continue;
      }

      const hasMarker = this.markerMaps[kind] !== null;
      const hasXray = hasMarker && XRAY_OPACITY[kind] > 0 && !this.overlaysMuted;
      const hasBeam = BEAM_OPACITY[kind] > 0;
      slot.glow.visible = true;
      slot.marker.visible = hasMarker;
      slot.xray.visible = hasXray;
      slot.beam.visible = hasBeam;

      // 弹入：缩放先过冲，然后呼吸。
      const t = Math.min(slot.age / POP_DURATION, 1);
      const pop = easeOutBack(t);
      const wave = (Math.sin(this.elapsed * (slot.pulse ? 5.6 : 3.4) + slot.phase) + 1) * 0.5;
      const breath = slot.pulse ? 0.45 + wave * 0.85 : 0.8 + wave * 0.25;
      const fade = t;

      slot.glowMaterial.opacity = GLOW_OPACITY[kind] * breath * fade;
      slot.glow.scale.setScalar(0.55 + pop * 0.45);

      if (hasMarker) {
        slot.markerMaterial.opacity = MARKER_OPACITY[kind] * (0.72 + breath * 0.34) * fade;
        slot.marker.scale.setScalar(0.35 + pop * 0.65 + (slot.pulse ? wave * 0.05 : wave * 0.02));
        slot.marker.rotation.z += delta * MARKER_SPIN[kind];
      }

      if (hasXray) {
        // 锁定到它跟随的标线上，略小一圈，这样空无一物时两者读起来是
        // 一个标记，而不是重影。
        slot.xrayMaterial.opacity = XRAY_OPACITY[kind] * (0.66 + breath * 0.34) * fade;
        slot.xray.scale.setScalar(slot.marker.scale.x * 0.9);
        slot.xray.rotation.z = slot.marker.rotation.z;
      }

      if (hasBeam) {
        slot.beamMaterial.opacity = BEAM_OPACITY[kind] * breath * fade;
        slot.beam.scale.set(1, 0.4 + pop * 0.6, 1);
        slot.beam.position.y = BOARD_TOP + 0.275 * (0.4 + pop * 0.6);
      }
    }
  }

  /**
   * 按竞技场主题重调对局表面。深色格子在这里分量最重：近黑的玄武岩
   * 在低光下会吞掉黑曜军队，所以白昼主题把它们提亮成可读的石板灰。
   */
  applyArena(look: ArenaLook): void {
    this.lightTileMaterial.color.setHex(look.board.light);
    this.darkTileMaterial.color.setHex(look.board.dark);
    this.baseMaterial?.color.setHex(look.board.base);
    this.borderMaterial?.color.setHex(look.board.border);
    this.trimMaterial?.color.setHex(look.board.trim);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.slots.clear();
    this.shrouds.clear();
    this.group.clear();
  }
}
