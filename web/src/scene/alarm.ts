import * as THREE from "three";

import { radialTexture } from "./textures";

/** 警报红——与被将军国王自身自发光燃烧所用的同一个十六进制色值。 */
const ALARM_COLOUR = 0xff2a1a;

/**
 * 将军警报：一盏红灯，立在处于危险中的那位国王上方。
 *
 * 它有两种状态，因为将军有两个时刻。**骤亮**（flare）是威胁被宣告的那一瞬——
 * 一次不到一秒就衰减完毕的猛烈冲击。**守望**（watch）是之后的一切：只要国王
 * 仍被将军，灯光就以低得多的强度持续呼吸，这样移开视线再回来的玩家仍然能
 * 看出是哪顶王冠正悬于剑下。
 *
 * 这盏灯只创建一次，以零强度永久驻留在场景中。每当场景的光源数量变化时，
 * three.js 会重新编译大厅里的每一个材质，所以在将军时添加一盏灯、事后又
 * 移除它，会让帧恰好卡在必须感觉锐利的那一拍上。
 */
export class CheckAlarm {
  readonly group = new THREE.Group();

  private lamp: THREE.PointLight;
  /** 柔和的地面光晕，让警报即使在灯光无处投射的地方也能被读出。 */
  private halo: THREE.Sprite;
  private haloMap: THREE.Texture;
  private threatened = false;
  /** 缓动后的存在度，没有国王被将军时为 0。 */
  private watch = 0;
  /** 自将军被宣告那一刻起逐渐衰减的骤亮。 */
  private flare = 0;
  private phase = 0;

  constructor() {
    this.group.name = "check-alarm";
    this.group.visible = false;

    this.lamp = new THREE.PointLight(ALARM_COLOUR, 0, 5.5, 2);
    this.lamp.castShadow = false;
    this.group.add(this.lamp);

    this.haloMap = radialTexture("rgba(255,58,36,0.85)", "rgba(255,26,12,0)");
    const material = new THREE.SpriteMaterial({
      map: this.haloMap,
      color: ALARM_COLOUR,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Sprite(material);
    this.halo.renderOrder = 3;
    this.group.add(this.halo);
  }

  /**
   * 把警报指向受威胁的国王，或者解除它。
   * 每帧调用都安全——移动灯光不会触发任何重新编译。
   */
  setThreat(position: THREE.Vector3 | null): void {
    this.threatened = position !== null;
    if (!position) return;
    this.lamp.position.set(position.x, position.y + 1.15, position.z);
    this.halo.position.set(position.x, position.y + 0.95, position.z);
  }

  /** 将军被宣告的那一刻：在守望强度之上叠加一次猛烈的脉冲。 */
  strike(): void {
    this.flare = 1;
    // 在骤亮时重启呼吸相位，让随后的第一次起伏是完整的一次，
    // 而不是正弦波恰好路过的任意相位。
    this.phase = 0;
  }

  update(delta: number): void {
    const target = this.threatened ? 1 : 0;
    // 亮起来快、熄下去慢：威胁先声夺人，然后缓缓散去。
    const rate = target > this.watch ? 6 : 2.6;
    this.watch += Math.sign(target - this.watch) * Math.min(Math.abs(target - this.watch), delta * rate);
    this.flare = Math.max(0, this.flare - delta * 1.8);

    if (this.watch <= 0.001 && this.flare <= 0) {
      if (this.group.visible) {
        this.group.visible = false;
        this.lamp.intensity = 0;
        (this.halo.material as THREE.SpriteMaterial).opacity = 0;
      }
      return;
    }
    this.group.visible = true;

    this.phase += delta;
    // 缓慢的心跳，权重偏向暗的半周，让它像在搏动而不是在发光。
    const breath = Math.pow(Math.sin(this.phase * 2.4) * 0.5 + 0.5, 1.6);
    const surge = this.flare * this.flare;
    // 守望强度是一次将军的大部分时间里玩家看到的东西，所以压得很低：
    // 只是王冠上的一圈红边，而不是把周围一整排都洗亮的灯。
    const level = this.watch * (0.2 + breath * 0.26) + surge * 0.7;

    this.lamp.intensity = level * 2.1;
    const material = this.halo.material as THREE.SpriteMaterial;
    material.opacity = Math.min(0.3, level * 0.24);
    this.halo.scale.setScalar(1.35 + breath * 0.2 + surge * 0.45);
  }

  dispose(): void {
    (this.halo.material as THREE.Material).dispose();
    this.haloMap.dispose();
    this.group.clear();
  }
}
