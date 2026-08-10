/**
 * 重击的视觉语言。
 *
 * 步卒的击杀是火花加一记推搡；它之上的军衔出手重到
 * 会留下痕迹——钢铁划破空气、冲击波沿石板滚开，
 * 或者在王冠挥落之前，一柱光先砸在被裁决者头上。
 * 每个辅助函数都构建自己的一次性对象，
 * 用调用方的补间时钟驱动动画并自行销毁，
 * 因此这里没有任何东西需要占用帧循环的槽位。
 */

import * as THREE from "three";

import type { SpellLight } from "./spells";
import { crescentTexture, factionRingTexture, pillarTexture, shockwaveTexture } from "./textures";
import { Ease, type TweenManager } from "./tween";

let crescentMap: THREE.CanvasTexture | null = null;
let waveMap: THREE.CanvasTexture | null = null;
let pillarMap: THREE.CanvasTexture | null = null;
let sealMap: THREE.CanvasTexture | null = null;
let waveGeometry: THREE.PlaneGeometry | null = null;
let pillarGeometry: THREE.CylinderGeometry | null = null;

function sharedCrescentMap(): THREE.CanvasTexture {
  if (!crescentMap) crescentMap = crescentTexture();
  return crescentMap;
}

function sharedWaveMap(): THREE.CanvasTexture {
  if (!waveMap) waveMap = shockwaveTexture();
  return waveMap;
}

function sharedPillarMap(): THREE.CanvasTexture {
  if (!pillarMap) pillarMap = pillarTexture();
  return pillarMap;
}

function sharedSealMap(): THREE.CanvasTexture {
  if (!sealMap) sealMap = factionRingTexture("sunburst");
  return sealMap;
}

function sharedWaveGeometry(): THREE.PlaneGeometry {
  if (!waveGeometry) waveGeometry = new THREE.PlaneGeometry(2, 2);
  return waveGeometry;
}

function sharedPillarGeometry(): THREE.CylinderGeometry {
  if (!pillarGeometry) pillarGeometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  return pillarGeometry;
}

/** 释放共享的贴图与几何体（场景销毁时调用）。 */
export function disposeStrikeAssets(): void {
  crescentMap?.dispose();
  waveMap?.dispose();
  pillarMap?.dispose();
  sealMap?.dispose();
  waveGeometry?.dispose();
  pillarGeometry?.dispose();
  crescentMap = null;
  waveMap = null;
  pillarMap = null;
  sealMap = null;
  waveGeometry = null;
  pillarGeometry = null;
}

export interface SlashOptions {
  /** 钢铁的颜色——刀刃用冷白，王冠用金色。 */
  color: number;
  /** 弧光的世界单位宽度。 */
  size: number;
  /** 挥砍在平面内的角度，弧度制。 */
  tilt?: number;
  /** 弧光在屏幕上停留的时长。 */
  life?: number;
}

/**
 * 斩击本体：刀刃落下的那一帧，一弯月牙形的光
 * 穿过身体甩出，继续多摆一段、边消散边拉长——
 * 用广告牌渲染，因此从棋盘上任何镜头角度都成立。
 */
export async function spawnSlash(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: SlashOptions,
): Promise<void> {
  const life = options.life ?? 0.22;
  const tilt = options.tilt ?? -0.7;
  const material = new THREE.SpriteMaterial({
    map: sharedCrescentMap(),
    color: options.color,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    opacity: 1,
    rotation: tilt,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(at);
  sprite.renderOrder = 8;
  sprite.frustumCulled = false;
  sprite.scale.set(options.size * 0.72, options.size * 0.72, 1);
  scene.add(sprite);

  try {
    await tweens.to({
      duration: life,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        // 快速张开，在变薄的同时继续向外推进。
        const spread = options.size * (0.72 + t * 0.66);
        sprite.scale.set(spread, spread * (1 - t * 0.22), 1);
        material.rotation = tilt + t * 0.85;
        material.opacity = t < 0.18 ? t / 0.18 : Math.pow(1 - (t - 0.18) / 0.82, 1.6);
      },
    });
  } finally {
    sprite.removeFromParent();
    material.dispose();
  }
}

export interface GroundWaveOptions {
  color: number;
  /** 冲击波达到的半径，世界单位。 */
  radius: number;
  /** 平面距地面的高度。 */
  height: number;
  life?: number;
  /** 紧随其后的第二道更宽的回波。 */
  echo?: boolean;
}

/**
 * 灌入地面的力道：一圈光从撞击点向外滚开，
 * 在扩散中消散。这是战锤或权杖留下的痕迹——
 * 刀刃不会有。
 */
export async function spawnGroundWave(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: GroundWaveOptions,
): Promise<void> {
  const life = options.life ?? 0.5;
  const material = new THREE.MeshBasicMaterial({
    map: sharedWaveMap(),
    color: options.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(sharedWaveGeometry(), material);
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = Math.random() * Math.PI;
  ring.position.set(at.x, options.height, at.z);
  ring.renderOrder = 7;
  ring.scale.setScalar(0.18);
  scene.add(ring);

  const echo = options.echo === true ? ring.clone() : null;
  let echoMaterial: THREE.MeshBasicMaterial | null = null;
  if (echo) {
    echoMaterial = material.clone();
    echoMaterial.opacity = 0.5;
    echo.material = echoMaterial;
    echo.position.y = options.height + 0.004;
    scene.add(echo);
  }

  try {
    await tweens.to({
      duration: life,
      easing: Ease.linear,
      onUpdate: (t) => {
        const eased = 1 - Math.pow(1 - t, 2.4);
        ring.scale.setScalar(0.18 + eased * options.radius * 0.5);
        material.opacity = Math.pow(1 - t, 1.6) * 0.95;
        ring.rotation.z += 0.006;
        if (echo && echoMaterial) {
          // 回波出发更晚、走得更远，因此石板读起来
          // 在打击之后仍嗡嗡作响。
          const lag = Math.max(0, (t - 0.22) / 0.78);
          const spread = 1 - Math.pow(1 - lag, 2.2);
          echo.scale.setScalar(0.18 + spread * options.radius * 0.76);
          echoMaterial.opacity = Math.pow(1 - lag, 2) * 0.45;
        }
      },
    });
  } finally {
    ring.removeFromParent();
    material.dispose();
    if (echo) {
      echo.removeFromParent();
      echoMaterial?.dispose();
    }
  }
}

export interface ConquestClaimOptions {
  /** 胜者的颜色——关键在于这格现在*属于谁*。 */
  color: number;
  /** 光环收拢前的初始宽度，世界单位。 */
  radius: number;
  /** 圆盘距地面的高度。 */
  height: number;
  /** 0 表示吃掉步卒，1 表示吃掉王：缩放停留时长与大小。 */
  weight?: number;
}

/**
 * 从敌军手中夺下的一格。
 *
 * 棋盘上其他所有光环都向*外*扩散——打击、落子、冲击波。
 * 这一个向**内**收拢：一圈胜者颜色的宽环在格子四周收紧，
 * 汇聚时增亮，猛地闭合成军队自己的印记，然后消散。
 * 反向运动就是它的签名。游戏中没有别的东西这样动，
 * 所以即使在视野边缘，被占领的格子也不会被误认成一次撞击。
 *
 * 两个一次性圆盘跑在调用方的补间时钟上，用完即销毁——
 * 便宜到可以在每档画质预设下运行。
 */
export async function spawnConquestClaim(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: ConquestClaimOptions,
): Promise<void> {
  const weight = Math.max(0, Math.min(1, options.weight ?? 0.4));
  const spin = Math.random() * Math.PI;

  const loopMaterial = new THREE.MeshBasicMaterial({
    map: sharedWaveMap(),
    color: options.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const loop = new THREE.Mesh(sharedWaveGeometry(), loopMaterial);
  loop.rotation.x = -Math.PI / 2;
  loop.rotation.z = spin;
  loop.position.set(at.x, options.height, at.z);
  loop.renderOrder = 7;
  scene.add(loop);

  // 军队自己的印记，等在光环下方，等它到来。
  const sealMaterial = new THREE.MeshBasicMaterial({
    map: sharedSealMap(),
    color: options.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const seal = new THREE.Mesh(sharedWaveGeometry(), sealMaterial);
  seal.rotation.x = -Math.PI / 2;
  seal.rotation.z = -spin;
  seal.position.set(at.x, options.height + 0.004, at.z);
  seal.renderOrder = 8;
  seal.scale.setScalar(0.9 + weight * 0.2);
  scene.add(seal);

  const wide = Math.max(0.4, options.radius * 0.5);
  const tight = 0.42 + weight * 0.12;

  try {
    // 收拢：先快后柔地到达，让视线跟着它回家。
    await tweens.to({
      duration: 0.3 + weight * 0.1,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        loop.scale.setScalar(wide + (tight - wide) * t);
        loopMaterial.opacity = 0.2 + t * 0.75;
        loop.rotation.z = spin + t * 0.5;
        // 印记在收拢的后半程升起来迎接光环。
        sealMaterial.opacity = Math.max(0, (t - 0.45) / 0.55) * 0.7;
      },
    });
    // 闭合：格子上亮起一记节拍，然后消失。
    await tweens.to({
      duration: 0.34 + weight * 0.16,
      easing: Ease.outQuint,
      onUpdate: (t) => {
        loop.scale.setScalar(tight * (1 + t * 0.7));
        loopMaterial.opacity = Math.pow(1 - t, 1.7) * 0.95;
        seal.scale.setScalar((0.9 + weight * 0.2) * (1 + t * 0.35));
        sealMaterial.opacity = Math.pow(1 - t, 1.4) * 0.7;
      },
    });
  } finally {
    loop.removeFromParent();
    seal.removeFromParent();
    loopMaterial.dispose();
    sealMaterial.dispose();
  }
}

export interface PillarOptions {
  color: number;
  /** 光柱在地面处的半径。 */
  radius: number;
  /** 光柱爬出画面的高度。 */
  height: number;
  /** 光柱所立的地面高度。 */
  floor: number;
  /** 在被裁决者头顶停留多久才散去。 */
  hold: number;
  /**
   * 从场景的法术光池借来的一盏灯；传 null 则光柱无照明运行。
   * 绝不要在这里新建灯：改变场景的灯数量
   * 会重编译大厅里的每个材质。
   */
  light: SpellLight | null;
}

/**
 * 裁决：一柱光垂直砸落在一格上，在行刑期间停留，
 * 然后向上收回、化为虚无。王冠专属——
 * 棋盘上任何其他棋子都无权召唤它。
 */
export async function spawnPillar(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: PillarOptions,
): Promise<void> {
  const material = new THREE.MeshBasicMaterial({
    map: sharedPillarMap(),
    color: options.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const column = new THREE.Mesh(sharedPillarGeometry(), material);
  column.renderOrder = 6;
  column.position.set(at.x, options.floor + options.height * 0.5, at.z);
  column.scale.set(options.radius, options.height, options.radius);
  scene.add(column);

  const light = options.light;
  const lightAt = new THREE.Vector3(at.x, options.floor + 0.9, at.z);

  const setSpread = (radius: number, opacity: number): void => {
    column.scale.set(radius, options.height, radius);
    material.opacity = opacity;
    light?.set(lightAt, opacity * 9);
  };

  try {
    // 宽幅砸落，然后猛地收紧裹住身体。
    await tweens.to({
      duration: 0.16,
      easing: Ease.outQuint,
      onUpdate: (t) => setSpread(options.radius * (2.4 - t * 1.4), t * 0.95),
    });
    // 停留：光像在呼吸，而不是一张贴花钉在那里。
    await tweens.to({
      duration: Math.max(0.05, options.hold),
      easing: Ease.linear,
      onUpdate: (t) => {
        const pulse = 1 + Math.sin(t * Math.PI * 6) * 0.06;
        setSpread(options.radius * pulse, 0.95 - t * 0.12);
      },
    });
    // 向上收回，边升边淡。
    await tweens.to({
      duration: 0.32,
      easing: Ease.inCubic,
      onUpdate: (t) => {
        column.scale.set(options.radius * (1 - t * 0.55), options.height, options.radius * (1 - t * 0.55));
        material.opacity = 0.83 * (1 - t);
        light?.set(lightAt, 7.5 * (1 - t));
      },
    });
  } finally {
    column.removeFromParent();
    material.dispose();
    light?.release();
  }
}
