/**
 * 巫术：施法者在杖首汇聚的火焰，以及掷过棋盘的火球。
 *
 * 一颗火球由两个叠加混合的广告牌（白热的内核裹在宽阔的
 * 火焰包络里）加上——预算允许时——一盏真实点光源构成，
 * 因此飞弹在行进中会照亮大厅、棋盘和它即将击杀的棋子。
 * 它活在世界空间里，由调用方每帧重新定位，
 * 从而避开雕塑动画骨骼的缩放干扰。
 *
 * 点光源是从 {@link SpellLightPool} *借*来的，绝不为单个法术新建。
 * three.js 按场景中可见光源的数量来索引着色器程序，
 * 所以增删一盏灯会迫使大厅里每个材质——包括三十二个
 * 带自定义溶解着色器的蒙皮棋子——全部重编译。
 * 在女巫的齐射里这么做四次，曾让帧循环卡死数秒，
 * 甚至可能把 WebGL 上下文一起拖垮。
 */

import * as THREE from "three";

import type { Faction } from "../core/types";
import { radialTexture } from "./textures";

/** 一个文明的魔法如何燃烧。 */
export interface SpellLook {
  /** 白热的中心。 */
  core: number;
  /** 环绕它的火焰包络。 */
  flame: number;
  /** 汇聚与飞行途中洒落的火星。 */
  ember: number;
  /** 投进房间的光色。 */
  light: number;
}

/**
 * 白曜王国的火是冷的——水晶法杖上的巫火。
 * 太阳帝国掷出的是太阳本身的一小块。
 */
export const SPELL_LOOK: Record<Faction, SpellLook> = {
  w: { core: 0xf4f9ff, flame: 0x4f9cff, ember: 0xbcd8ff, light: 0x7cb8ff },
  b: { core: 0xfff0c6, flame: 0xff5f18, ember: 0xff9a3c, light: 0xff7a2a },
};

let coreMap: THREE.CanvasTexture | null = null;
function sharedCoreMap(): THREE.CanvasTexture {
  if (!coreMap) coreMap = radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)");
  return coreMap;
}

/**
 * 为单个法术的时长从池中借出的一盏点光源。
 * 释放它只是把强度降到零——灯本身留在场景图里、
 * 保持可见，因此渲染器的光源数量从不变动。
 */
export class SpellLight {
  private released = false;

  constructor(
    private readonly light: THREE.PointLight,
    private readonly onRelease: () => void,
  ) {}

  /** 放置火焰，并设置它烧进房间的强度。 */
  set(position: THREE.Vector3, intensity: number): void {
    if (this.released) return;
    this.light.position.copy(position);
    this.light.intensity = Math.max(0, intensity);
  }

  /** 把槽位熄灭着还回去。 */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.light.intensity = 0;
    this.onRelease();
  }
}

/**
 * 一组固定数量的点光源，一次性加入场景，
 * 被每个法术、裁决光柱和爆炸复用。只有颜色、位置和强度
 * 会变化，而它们都只是普通 uniform——因此战斗中
 * 任何着色器都不会被重编译。当所有槽位都借出时，
 * 调用方直接放弃照明，而不是扩容。
 */
export class SpellLightPool {
  private readonly lights: THREE.PointLight[] = [];
  private readonly free: number[] = [];

  constructor(parent: THREE.Object3D, count: number) {
    for (let i = 0; i < count; i += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 5.2, 2);
      light.name = `spell_light_${i}`;
      // 从不隐藏：不可见的灯会被从渲染状态中剔除，
      // 那对光源数量的改变和删除它完全一样。
      light.visible = true;
      light.castShadow = false;
      parent.add(light);
      this.lights.push(light);
      this.free.push(i);
    }
  }

  get size(): number {
    return this.lights.length;
  }

  /** 取一个槽位；战斗已把槽位用尽时返回 null。 */
  acquire(color: number, distance = 5.2): SpellLight | null {
    const index = this.free.pop();
    if (index === undefined) return null;
    const light = this.lights[index];
    light.color.setHex(color);
    light.distance = distance;
    light.intensity = 0;
    return new SpellLight(light, () => {
      this.free.push(index);
    });
  }

  dispose(): void {
    for (const light of this.lights) {
      light.removeFromParent();
      light.dispose();
    }
    this.lights.length = 0;
    this.free.length = 0;
  }
}

let flameMap: THREE.CanvasTexture | null = null;
function sharedFlameMap(): THREE.CanvasTexture {
  if (!flameMap) flameMap = radialTexture("rgba(255,255,255,0.75)", "rgba(255,255,255,0)");
  return flameMap;
}

/** 单颗火球：正在杖首汇聚，或飞行途中。 */
export class SpellOrb {
  readonly group = new THREE.Group();

  private readonly core: THREE.Sprite;
  private readonly flame: THREE.Sprite;
  private readonly light: SpellLight | null;
  private readonly size: number;
  private intensity = 0;

  constructor(look: SpellLook, size: number, light: SpellLight | null = null) {
    this.size = size;
    this.light = light;
    this.group.name = "spell_orb";

    this.flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sharedFlameMap(),
        color: look.flame,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    );
    this.core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sharedCoreMap(),
        color: look.core,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    );
    this.flame.renderOrder = 6;
    this.core.renderOrder = 7;
    this.flame.frustumCulled = false;
    this.core.frustumCulled = false;
    this.group.add(this.flame, this.core);

    this.setIntensity(0);
  }

  /** 0 = 空无一物，1 = 完全成形的火球，大于 1 = 过载充能。 */
  setIntensity(value: number): void {
    const t = THREE.MathUtils.clamp(value, 0, 1.6);
    this.intensity = t;
    this.core.scale.setScalar(this.size * (0.3 + t * 0.6));
    this.flame.scale.setScalar(this.size * (0.8 + t * 2));
    (this.core.material as THREE.SpriteMaterial).opacity = Math.min(1, t * 1.5);
    (this.flame.material as THREE.SpriteMaterial).opacity = Math.min(0.92, t * 0.8);
    this.light?.set(this.group.position, t * t * 11);
  }

  /**
   * 火永远不会静止：包络按两个节拍闪烁并缓慢滚动，
   * 因此蓄力中的火球不会读作一张钉在法杖上的贴花。
   */
  animate(time: number): void {
    const flicker = 1 + Math.sin(time * 33) * 0.08 + Math.sin(time * 57 + 1.4) * 0.05;
    this.flame.scale.setScalar(this.size * (0.8 + this.intensity * 2) * flicker);
    const material = this.flame.material as THREE.SpriteMaterial;
    material.rotation = time * 2.2;
    this.light?.set(this.group.position, this.intensity * this.intensity * 11 * flicker);
  }

  dispose(): void {
    this.light?.release();
    (this.core.material as THREE.Material).dispose();
    (this.flame.material as THREE.Material).dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
