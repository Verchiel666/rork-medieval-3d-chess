import * as THREE from "three";

/**
 * 玩家的驱动到底是什么，以及它能否做到本场景依赖的两件事：
 * 可过滤的半浮点渲染目标（反射探针就建在其中一个上面）
 * 和一条可用的基于物理的光照路径。
 *
 * 这个问题主要出在 Linux 上。Mesa 的软件光栅器（llvmpipe、softpipe）
 * 和一些较老的开源驱动，要么拒绝 PMREM 生成器需要的浮点目标，
 * 要么在采样生成的立方体贴图时返回 NaN——而环境项里的一个 NaN
 * 会让大厅里所有金属/粗糙度表面变黑，自发光精灵却照常绘制，
 * 读起来就是"游戏全黑了"。
 */
export interface GpuReport {
  vendor: string;
  renderer: string;
  webgl2: boolean;
  /** llvmpipe / softpipe / SwiftShader——上下文背后没有 GPU。 */
  software: boolean;
  /** 浮点纹理的线性过滤。在若干 Mesa 构建上缺失。 */
  floatLinear: boolean;
  /** 渲染进半浮点缓冲，反射探针需要它。 */
  halfFloatBuffer: boolean;
}

const SOFTWARE_PATTERN = /(llvmpipe|softpipe|swiftshader|virgl|software rasterizer|mesa offscreen)/;

export function probeGpu(renderer: THREE.WebGLRenderer): GpuReport {
  const gl = renderer.getContext();
  let vendor = "unknown";
  let name = "unknown";
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (info) {
      vendor = String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL) ?? "unknown");
      name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "unknown");
    }
  } catch {
    // 某些隐私模式会整个屏蔽这个扩展——保留默认值即可。
  }

  return {
    vendor,
    renderer: name,
    webgl2: renderer.capabilities.isWebGL2,
    software: SOFTWARE_PATTERN.test(name.toLowerCase()),
    floatLinear: renderer.extensions.has("OES_texture_float_linear"),
    halfFloatBuffer: renderer.capabilities.isWebGL2 || renderer.extensions.has("EXT_color_buffer_half_float"),
  };
}

/** 给设置面板和控制台用的一行描述，例如 `llvmpipe · WebGL2 · software`。 */
export function describeGpu(report: GpuReport): string {
  const tags = [report.webgl2 ? "WebGL2" : "WebGL1"];
  if (report.software) tags.push("software");
  if (!report.floatLinear) tags.push("no float filtering");
  return `${report.renderer} · ${tags.join(" · ")}`;
}

/**
 * 渲染一帧 8×8 的、**只**被反射探针照亮的白色球体并读回像素。
 * 健康的驱动返回一个被照亮的球；无法采样探针的驱动返回黑色
 * （或 NaN，光栅化出来同样是黑色）——这正是让整个大厅
 * 看起来没有光照的那个故障。
 *
 * 便宜到可以在启动时跑一次：一次 8×8 绘制加一次回读。
 */
export function reflectionProbeWorks(renderer: THREE.WebGLRenderer, environment: THREE.Texture): boolean {
  const size = 8;
  const target = new THREE.WebGLRenderTarget(size, size);
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = 1;

  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0 });
  scene.add(new THREE.Mesh(geometry, material));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.set(0, 0, 2.2);
  camera.lookAt(0, 0, 0);

  const previousTarget = renderer.getRenderTarget();
  const previousTone = renderer.toneMapping;
  const previousExposure = renderer.toneMappingExposure;
  const pixels = new Uint8Array(size * size * 4);
  let lit = false;

  try {
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) {
        lit = true;
        break;
      }
    }
  } catch (error) {
    console.warn("[scene] 反射探针自检失败", error);
    lit = false;
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.toneMapping = previousTone;
    renderer.toneMappingExposure = previousExposure;
    geometry.dispose();
    material.dispose();
    target.dispose();
  }

  return lit;
}
