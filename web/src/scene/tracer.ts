/**
 * 弹丸在空气中留下的轨迹：一条沿弹丸*实际*飞过的路线铺设的短小 3D
 * 丝带，从枪口直到目标身体。
 *
 * 飞越这座大厅的弹丸只有几个像素宽，五分之一秒内就消失。过去让它可辨
 * 的一切都拴在弹丸自己身上——拖影锥、闪光、热浪精灵——所以它们都跟着
 * 金属走，没有一个告诉眼睛这一枪*曾经*在哪里。结果就是你会注意到弹丸
 * 命中，却永远看不到它飞行。
 *
 * 这是缺失的另一半。轨迹由弹丸自己飞过的路径构建，每帧重采样，所以：
 *
 * - 它是**几何体，不是公告板**：从任何相机角度都保持形状，并且会像真实
 *   物体一样被棋子和立柱遮挡；
 * - 它**在弹丸弯曲处弯曲**。滑膛枪的弹丸会偏离视线再兜回目标，这条曲线
 *   如今可见，而不是藏在笔直的锥体里；
 * - 它刻意**很短**。一条从枪口拉到目标的轨迹会读作激光，而黑火药从来
 *   不是激光。它大约一格长：足以显示飞行方向和速度，永远不至于像光束。
 *
 * 截面是三叶片管而不是面向相机的四边形——无需查询相机，弹丸穿过视轴
 * 时也不会翻转，而且够便宜（几十圈环），可以同时在空中跑好几条。尾部
 * 收成针尖，亮度沿尾部递减，所以轨迹在弹丸身后*消融*，而不是被硬边
 * 截断。
 */

import * as THREE from "three";

/** 一颗弹丸轨迹的绘制方式。 */
export interface StreakLook {
  /**
   * 可见弧长，以渲染出的弹丸直径计。刻意保持短：这是弹丸身后被扰动
   * 空气的长度，不是沿整条弹道烧下去的曳光。
   */
  span: number;
  /** 头部宽度，以弹丸渲染直径的比例计。 */
  width: number;
  /** 轨迹的主体——被大厅照亮的扰动空气，不是火焰。 */
  color: number;
  /** 其中的炽热细丝，只在轨迹头部附近可见。 */
  core: number;
  /** 主体峰值亮度，0–1。 */
  strength: number;
}

/** 管截面的叶片数：三是最便宜的实心截面。 */
const BLADES = 3;

const scratch = new THREE.Vector3();
const tangent = new THREE.Vector3();
const binormal = new THREE.Vector3();
const vertex = new THREE.Vector3();

/** 与给定向量垂直的任意单位向量——足以安置第一个环。 */
function anyPerpendicular(axis: THREE.Vector3): THREE.Vector3 {
  return Math.abs(axis.y) > 0.9
    ? new THREE.Vector3(0, 0, 1).cross(axis).normalize()
    : new THREE.Vector3(0, 1, 0).cross(axis).normalize();
}

/**
 * 轨迹的一层：沿脊线扫掠的管，向尾部逐渐变细变暗。
 *
 * 缓冲区按最大尺寸一次性分配，每帧原地重写；只有使用中的环才会被绘制
 * （`setDrawRange`），所以尚未长到全长的轨迹永远不会拖着陈旧三角形。
 */
class StreakTube {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly position: THREE.BufferAttribute;
  private readonly colour: THREE.BufferAttribute;
  private readonly normal = new THREE.Vector3(0, 1, 0);

  /**
   * @param rings 这一层最多绘制的脊线采样数
   * @param radius 头部半宽，世界单位
   * @param tint 满亮度时的颜色
   * @param falloff 亮度向尾部衰减的速度。数值小是长而均匀的轨迹；数值大
   *   只点亮弹丸身后几个口径的距离，炽热细丝正是这样被约束在头部的。
   */
  constructor(
    private readonly rings: number,
    private readonly radius: number,
    private readonly tint: THREE.Color,
    private readonly falloff: number,
    order: number,
  ) {
    const vertices = rings * BLADES;
    this.position = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.colour = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
    this.colour.setUsage(THREE.DynamicDrawUsage);
    const index: number[] = [];
    for (let ring = 0; ring < rings - 1; ring += 1) {
      for (let blade = 0; blade < BLADES; blade += 1) {
        const a = ring * BLADES + blade;
        const b = ring * BLADES + ((blade + 1) % BLADES);
        index.push(a, b, b + BLADES, a, b + BLADES, a + BLADES);
      }
    }
    this.geometry.setAttribute("position", this.position);
    this.geometry.setAttribute("color", this.colour);
    this.geometry.setIndex(index);
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      // 加色混合，让轨迹读作空气中的光而不是实心灰管，且永远不会把深度
      // 写到它所属的弹丸之上。
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "shot_streak";
    // 横跨棋盘一格的轨迹可能在帧与帧之间留下自己的陈旧包围球；绝不让
    // 它在飞行途中闪没。
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
  }

  /**
   * 以给定亮度沿脊线扫掠管体（最旧采样在前，弹丸自己在最后）。
   *
   * 环坐标系从采样到采样向前传递，而不是每环都按世界轴重建：每环新建
   * 基向量会让管体在路径转弯处出现可见的扭转。
   */
  write(spine: THREE.Vector3[], brightness: number): void {
    const count = spine.length;
    if (count < 2 || brightness <= 0.001) {
      this.geometry.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const used = Math.min(count, this.rings);
    const first = count - used;
    for (let i = 0; i < used; i += 1) {
      const point = spine[first + i];
      const ahead = spine[Math.min(count - 1, first + i + 1)];
      const behind = spine[Math.max(first, first + i - 1)];
      tangent.subVectors(ahead, behind);
      if (tangent.lengthSq() < 1e-12) tangent.set(0, 0, 1);
      else tangent.normalize();
      // 把传递下来的法线重新投影到与新切线垂直。
      this.normal.addScaledVector(tangent, -this.normal.dot(tangent));
      if (this.normal.lengthSq() < 1e-8) this.normal.copy(anyPerpendicular(tangent));
      this.normal.normalize();
      binormal.crossVectors(tangent, this.normal);

      const u = used === 1 ? 1 : i / (used - 1);
      // 尾部收成针尖：空气在弹丸身后合拢。
      const width = this.radius * Math.pow(u, 0.55);
      const fade = brightness * Math.pow(u, this.falloff);
      for (let blade = 0; blade < BLADES; blade += 1) {
        const angle = (blade / BLADES) * Math.PI * 2;
        vertex
          .copy(point)
          .addScaledVector(this.normal, Math.cos(angle) * width)
          .addScaledVector(binormal, Math.sin(angle) * width);
        const at = i * BLADES + blade;
        this.position.setXYZ(at, vertex.x, vertex.y, vertex.z);
        this.colour.setXYZ(at, this.tint.r * fade, this.tint.g * fade, this.tint.b * fade);
      }
    }
    this.geometry.setDrawRange(0, (used - 1) * BLADES * 6);
    this.position.needsUpdate = true;
    this.colour.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * 一颗弹丸身后的轨迹，分两层：一层宽而淡的扰动空气鞘，一层细而亮的
 * 细丝，只点亮紧贴金属的几个口径距离。单独一层要么读作雾（宽而淡），
 * 要么读作铁丝（细而亮）；合在一起读作速度。
 *
 * 存在于世界空间，由 `flyShot` 每帧喂入弹丸位置；不持有共享资源，所以
 * 弹丸用尽的瞬间就可以把它丢掉。
 */
export class TracerStreak {
  readonly object = new THREE.Group();
  private readonly sheath: StreakTube;
  private readonly filament: StreakTube;
  /** 飞过的路径，最旧在前；最后一项永远是活体弹丸。 */
  private readonly points: THREE.Vector3[] = [];
  /** 轨迹保持裁剪到的弧长，世界单位。 */
  private readonly span: number;
  /** 弹丸要飞多远才落下一个新的脊线采样。 */
  private readonly step: number;
  private readonly rings: number;
  private brightness = 1;

  /**
   * @param gauge 弹丸的渲染直径，让轨迹永远与制造它的东西成比例
   * @param rings 脊线分辨率——图形质量调节的唯一旋钮
   */
  constructor(look: StreakLook, gauge: number, rings: number) {
    this.rings = Math.max(4, Math.round(rings));
    this.span = look.span * gauge;
    this.step = this.span / (this.rings - 1);
    const head = look.width * gauge * 0.5;
    this.sheath = new StreakTube(this.rings, head, new THREE.Color(look.color), 1.6, 6);
    // 一半宽度、更亮、沿长度衰减得快得多：轨迹中仍然几乎就是弹丸自己
    // 的那部分。
    this.filament = new StreakTube(this.rings, head * 0.42, new THREE.Color(look.core), 4.2, 7);
    (this.sheath.mesh.material as THREE.MeshBasicMaterial).opacity = look.strength;
    this.object.name = "shot_trail";
    this.object.add(this.sheath.mesh, this.filament.mesh);
    this.brightness = look.strength;
  }

  /**
   * 把轨迹头部移到弹丸的新位置，飞出足够远需要新采样时落下一个新的
   * 脊线采样，然后把尾部裁剪回轨迹的长度。
   */
  extend(at: THREE.Vector3): void {
    const points = this.points;
    if (points.length < 2) {
      points.push(at.clone());
    } else {
      const anchor = points[points.length - 2];
      if (anchor.distanceToSquared(at) >= this.step * this.step) points.push(at.clone());
      else points[points.length - 1].copy(at);
    }
    this.trim();
    this.redraw();
  }

  /** 全局亮度，用于弹丸落地后轨迹悬停的那一拍。 */
  fade(amount: number): void {
    this.brightness = Math.max(0, amount);
    this.redraw();
  }

  dispose(): void {
    this.sheath.dispose();
    this.filament.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }

  private redraw(): void {
    this.sheath.write(this.points, this.brightness);
    this.filament.write(this.points, this.brightness);
  }

  /**
   * 通过把最后一个采样沿最旧线段*滑动*（而不是整段丢弃）来让轨迹保持
   * 恰好 `span` 长。弹出采样会让尾部每步可见地向后顿挫一次；滑动则让
   * 尾部以弹丸飞行的同样速度消融。
   */
  private trim(): void {
    const points = this.points;
    if (points.length < 2) return;
    let total = 0;
    let drop = 0;
    for (let i = points.length - 1; i > 0; i -= 1) {
      const segment = points[i].distanceTo(points[i - 1]);
      if (total + segment >= this.span) {
        const keep = (this.span - total) / Math.max(1e-6, segment);
        scratch.copy(points[i - 1]);
        points[i - 1].copy(points[i]).lerp(scratch, keep);
        drop = i - 1;
        break;
      }
      total += segment;
    }
    if (drop > 0) points.splice(0, drop);
    // 慢弹丸配高帧率会攒下管体永远画不完的采样；最旧的是没人看得到的
    // 那些。
    const overflow = points.length - (this.rings + 1);
    if (overflow > 0) points.splice(0, overflow);
  }
}
