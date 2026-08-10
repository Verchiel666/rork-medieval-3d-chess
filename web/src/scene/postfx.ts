import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

import type { ArenaLook } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import { QUALITY_SETTINGS, type QualityPreset } from "./quality";

/**
 * 冷/暖中世纪调色：提亮黑位、高光与阴影分离色调、
 * 轻微颗粒感和暗角。在色调映射之后、SMAA 之前运行。
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.05 },
    uGrain: { value: 0.045 },
    uLift: { value: 0.02 },
    uStrength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uLift;
    uniform float uStrength;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));

      // 分离色调：高光染上火把光，阴影染上月光下的钢色。
      vec3 warm = vec3(1.06, 0.99, 0.88);
      vec3 cool = vec3(0.86, 0.93, 1.10);
      vec3 graded = color * mix(cool, warm, smoothstep(0.15, 0.75, luma));

      // 电影感对比度，黑位上提。
      graded = mix(vec3(uLift), graded, 1.04);
      graded = clamp((graded - 0.5) * 1.06 + 0.5, 0.0, 1.4);

      // 暗角。
      vec2 centred = vUv - 0.5;
      float vignette = 1.0 - dot(centred, centred) * uVignette;
      graded *= clamp(vignette, 0.0, 1.0);

      // 胶片颗粒。
      float grain = (hash(vUv * 512.0 + fract(uTime) * 97.0) - 0.5) * uGrain;
      graded += grain;

      gl_FragColor = vec4(mix(color, graded, uStrength), texel.a);
    }
  `,
};

/**
 * 电影化管线。画质预设变化时各通道会重建，因此每一档
 * 预设确实更省——低画质完全绕过合成器。
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bokehPass: BokehPass | null = null;
  private gradePass: ShaderPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private preset: QualityPreset;
  private grade: ArenaLook["grade"] = ARENA_LOOKS[DEFAULT_ARENA].grade;
  private bloom: ArenaLook["bloom"] = ARENA_LOOKS[DEFAULT_ARENA].bloom;
  private cinematic = false;
  /** 展示清晰度：收回颗粒、暗角与泛光，让雕塑清晰可辨。 */
  private clarity = false;
  private elapsed = 0;
  /** 当某个通道在此 GPU 上出问题时置位——此后直接渲染。 */
  private direct = false;
  /** 上面那个开关的可逆版本，由安全渲染设置驱动。 */
  private bypassed = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.preset = "high";
  }

  get enabled(): boolean {
    return this.composer !== null;
  }

  setPreset(preset: QualityPreset): void {
    this.preset = preset;
    this.build();
  }

  private build(): void {
    this.dispose();
    const settings = QUALITY_SETTINGS[this.preset];
    if (this.direct || this.bypassed || !settings.postFx) return;

    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(size.x, size.y);

    const renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(renderPass);

    // SSAO 只是把遮蔽乘到 RenderPass 填好的缓冲上——
    // 它自己不画美颜通道，所以 RenderPass 必须保持启用。
    if (settings.ssao) {
      const ssao = new SSAOPass(this.scene, this.camera, size.x, size.y);
      ssao.kernelRadius = 0.35;
      ssao.minDistance = 0.0015;
      ssao.maxDistance = 0.12;
      composer.addPass(ssao);
      this.ssaoPass = ssao;
    }

    if (settings.bloom) {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        this.bloom.strength,
        this.bloom.radius,
        this.bloom.threshold,
      );
      composer.addPass(bloom);
      this.bloomPass = bloom;
      this.pushBloom();
    }

    if (settings.dof) {
      const bokeh = new BokehPass(this.scene, this.camera, { focus: 11, aperture: 0.0016, maxblur: 0.008 });
      bokeh.enabled = false;
      composer.addPass(bokeh);
      this.bokehPass = bokeh;
    }

    composer.addPass(new OutputPass());

    if (settings.grade) {
      const grade = new ShaderPass(GradeShader);
      composer.addPass(grade);
      this.gradePass = grade;
      this.pushGrade();
    }

    if (settings.smaa) {
      composer.addPass(new SMAAPass());
    }

    this.composer = composer;
  }

  /**
   * 竞技场主题自带调色：黄昏围城保留浓重的暗角与颗粒，
   * 白昼地图则把两者大幅收回，让雕塑保持清晰。
   */
  setGrade(grade: ArenaLook["grade"]): void {
    this.grade = grade;
    this.pushGrade();
  }

  /**
   * 白昼地图需要高得多的泛光阈值：它们的格子在色调映射后
   * 已接近白色，用黄昏调校的阈值会让整个棋盘发光并把
   * 雕塑洗白。
   */
  setBloom(bloom: ArenaLook["bloom"]): void {
    this.bloom = bloom;
    this.pushBloom();
  }

  /**
   * 电脑对电脑对局的展示模式，观众只在旁观：胶片颗粒、
   * 暗角和泛光晕圈都大幅收回，让十二座雕塑保持锐利，
   * 而不是隔在一层薄雾之后。此模式从不使用景深。
   */
  setClarity(active: boolean): void {
    if (this.clarity === active) return;
    this.clarity = active;
    this.pushGrade();
    this.pushBloom();
  }

  private pushBloom(): void {
    if (!this.bloomPass) return;
    const bloom = this.bloom;
    this.bloomPass.strength = this.clarity ? bloom.strength * 0.62 : bloom.strength;
    this.bloomPass.radius = this.clarity ? bloom.radius * 0.8 : bloom.radius;
    this.bloomPass.threshold = this.clarity ? Math.min(0.98, bloom.threshold + 0.04) : bloom.threshold;
  }

  private pushGrade(): void {
    if (!this.gradePass) return;
    const uniforms = this.gradePass.uniforms as unknown as Record<string, { value: number }>;
    const grade = this.grade;
    const soften = this.clarity;
    uniforms.uVignette.value = soften ? grade.vignette * 0.5 : grade.vignette;
    uniforms.uGrain.value = soften ? grade.grain * 0.3 : grade.grain;
    uniforms.uLift.value = grade.lift;
    uniforms.uStrength.value = soften ? grade.strength * 0.82 : grade.strength;
  }

  /** 为开场、升变选择器和将杀推镜启用景深。 */
  setCinematic(active: boolean, focus = 11): void {
    this.cinematic = active;
    if (!this.bokehPass) return;
    this.bokehPass.enabled = active;
    const uniforms = this.bokehPass.uniforms as unknown as Record<string, { value: number }>;
    if (uniforms.focus) uniforms.focus.value = focus;
  }

  get isCinematic(): boolean {
    return this.cinematic;
  }

  setSize(width: number, height: number): void {
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(width, height);
    if (this.ssaoPass) this.ssaoPass.setSize(width, height);
  }

  /**
   * 安全渲染：完全跳过合成器，但保留随时恢复的能力，
   * 让玩家无需刷新即可再次尝试电影化管线。
   */
  setBypassed(active: boolean): void {
    if (this.bypassed === active) return;
    this.bypassed = active;
    this.build();
  }

  get isBypassed(): boolean {
    return this.bypassed || this.direct;
  }

  /**
   * 永久回退到普通前向渲染。当合成器在玩家的 GPU 上
   * 抛错或产出空帧时使用。
   */
  forceDirect(reason: string): void {
    if (this.direct) return;
    this.direct = true;
    console.warn(`[postfx] 正在关闭后处理：${reason}`);
    this.dispose();
  }

  render(delta: number): void {
    this.elapsed += delta;
    if (this.gradePass) {
      (this.gradePass.uniforms as unknown as Record<string, { value: number }>).uTime.value = this.elapsed;
    }
    if (this.composer) {
      try {
        this.composer.render(delta);
        return;
      } catch (error) {
        this.forceDirect(`合成器错误（${String(error)}）`);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.bokehPass = null;
    this.gradePass = null;
    this.ssaoPass = null;
  }
}
