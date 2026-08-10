import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ARMY_SKINS, DEFAULT_ARMY_SKINS, type ArmySkinId } from "../assets/generated";
import { audio } from "../audio/audioManager";
import {
  DEFAULT_PREMOVE_DEPTH,
  DEFAULT_THINK_FLOOR_MS,
  GameController,
  PREMOVE_DEPTH_CHOICES,
  THINK_FLOOR_CHOICES,
} from "../core/gameController";
import type { Faction, LedgerMove, PieceKind } from "../core/types";
import { Clapperboard } from "lucide-react";
import { ARENA_LOOKS, DEFAULT_ARENA } from "../scene/arena";
import { detectQualityPreset, type QualityPreset } from "../scene/quality";
import { SceneEngine, type CameraPreset, type ShowcaseCamera } from "../scene/sceneEngine";
import { GameOverModal } from "./GameOverModal";
import { Hud } from "./Hud";
import { useHasKeyboard } from "./inputMode";
import { MainMenu, type MatchConfig } from "./MainMenu";
import type { MusterChoice } from "./Muster";
import { SettingsPanel, type GameSettings } from "./SettingsPanel";
import { useGameSnapshot } from "./useGameSnapshot";
import "./medieval.css";

type Phase = "loading" | "menu" | "playing";

const ATTRACT_DELAY_MS = 30_000;
/**
 * 一场已结束的 AI 对战在裁决卡升起之前静置多久。
 * 终局运镜会用约 2.4 秒缓缓推近倒下的国王——在一局
 * 被观赏（或被录制）的对局中，那个镜头本身就是重点，
 * 所以卡片会等它演完，而不是压在它上面。
 */
const SHOWCASE_VERDICT_DELAY_MS = 2200;
const RENDER_PREFS_KEY = "kg.render";
const ARMY_PREFS_KEY = "kg.armies";
const TABLE_PREFS_KEY = "kg.table";
const PREMOVE_PREFS_KEY = "kg.premove";
const PREMOVE_DEPTH_KEY = "kg.premovedepth";
const THINK_PREFS_KEY = "kg.think";

interface RenderPrefs {
  safeMode: boolean;
  brightness: number;
}

/** 渲染降级提示的中文文案（消息原文来自渲染引擎，这里映射为中文）。 */
const FALLBACK_COPY: Record<string, string> = {
  "Post-processing produced an empty frame on this driver — cinematic effects turned off.":
    "此显卡驱动的后处理渲染出了空画面——电影特效已关闭。",
  "This driver cannot sample the reflection probe — switched to plain skylight.":
    "此驱动无法采样反射探针——已切换为普通天光。",
  "Switched to safe rendering — your graphics driver could not draw the full scene.":
    "已切换为安全渲染——你的显卡驱动无法绘制完整场景。",
};

/** 画质档位的界面展示名（用于画质自动降档提示）。 */
const QUALITY_LABEL: Record<QualityPreset, string> = {
  low: "低",
  medium: "中",
  high: "高",
  ultra: "极致",
};

/** 上次访问选用的军队——皮肤是口味偏好，不是对局设置。 */
function loadArmyPrefs(): Record<Faction, ArmySkinId> {
  const fallback: Record<Faction, ArmySkinId> = { ...DEFAULT_ARMY_SKINS };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(ARMY_PREFS_KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<Record<Faction, string>>;
    const pick = (value: string | undefined, side: Faction): ArmySkinId =>
      value && value in ARMY_SKINS ? (value as ArmySkinId) : fallback[side];
    return { w: pick(stored.w, "w"), b: pick(stored.b, "b") };
  } catch {
    return fallback;
  }
}

function saveArmyPrefs(skins: Record<Faction, ArmySkinId>): void {
  try {
    window.localStorage.setItem(ARMY_PREFS_KEY, JSON.stringify(skins));
  } catch {
    // 隐私浏览——选择只是无法跨刷新保留而已。
  }
}

/**
 * 双人轮流对弈换边时，镜头是否转向另一侧。
 *
 * 默认关闭且会被记住：整间大厅在每一步之间转动半圈，
 * 是游戏里最大的运动量，在共享屏幕上每分钟要触发两次。
 * 并排坐在同一屏幕前的两位玩家不需要棋盘重新定向——
 * 他们需要保持方向感。转向在设置里一点即可开启，
 * 手动翻转（`F`）不受影响。
 */
function loadSeatSwing(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TABLE_PREFS_KEY) === "swing";
  } catch {
    return false;
  }
}

function saveSeatSwing(enabled: boolean): void {
  try {
    window.localStorage.setItem(TABLE_PREFS_KEY, enabled ? "swing" : "hold");
  } catch {
    // 隐私浏览——选择只是无法跨刷新保留而已。
  }
}

/**
 * 机器还在计时时，是否可以预先排入一步棋。
 *
 * 默认开启：它填充的等待是真实存在的（实测中等难度每步
 * 约 0.7 秒、困难约 3.1 秒，还不含走子动画），而队列
 * 在玩家真正瞄准目标之前是不可见的。
 */
function loadPremoves(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PREMOVE_PREFS_KEY) !== "off";
  } catch {
    return true;
  }
}

function savePremoves(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREMOVE_PREFS_KEY, enabled ? "queue" : "off");
  } catch {
    // 隐私浏览——选择只是无法跨刷新保留而已。
  }
}

/**
 * 队列中一次最多可以叠几步棋。
 *
 * 这是一种品味，而非单次会话设置：习惯叠五步的快棋玩家
 * 每次来访都想叠五步。落在可选深度之外的值会被忽略而不是
 * 被钳制——存储值不在选项之列，说明是过期数据，而非偏好。
 */
function loadPremoveDepth(): number {
  if (typeof window === "undefined") return DEFAULT_PREMOVE_DEPTH;
  try {
    const value = Number(window.localStorage.getItem(PREMOVE_DEPTH_KEY));
    return PREMOVE_DEPTH_CHOICES.includes(value as (typeof PREMOVE_DEPTH_CHOICES)[number])
      ? value
      : DEFAULT_PREMOVE_DEPTH;
  } catch {
    return DEFAULT_PREMOVE_DEPTH;
  }
}

function savePremoveDepth(depth: number): void {
  try {
    window.localStorage.setItem(PREMOVE_DEPTH_KEY, String(depth));
  } catch {
    // 隐私浏览——选择只是无法跨刷新保留而已。
  }
}

/**
 * 电脑在应手之前至少停留多久，单位毫秒。
 *
 * 会被记住，因为这是一种节奏品味，而非单次会话设置：
 * 想让机器从容一些（慢慢思考，或留出瞄准预排走子的窗口）
 * 的玩家，每次来访都想要这个节奏，而不是只此一次。
 */
function loadThinkFloor(): number {
  if (typeof window === "undefined") return DEFAULT_THINK_FLOOR_MS;
  try {
    const raw = window.localStorage.getItem(THINK_PREFS_KEY);
    if (raw === null) return DEFAULT_THINK_FLOOR_MS;
    const value = Number(raw);
    return THINK_FLOOR_CHOICES.includes(value as (typeof THINK_FLOOR_CHOICES)[number])
      ? value
      : DEFAULT_THINK_FLOOR_MS;
  } catch {
    return DEFAULT_THINK_FLOOR_MS;
  }
}

function saveThinkFloor(ms: number): void {
  try {
    window.localStorage.setItem(THINK_PREFS_KEY, String(ms));
  } catch {
    // 隐私浏览——选择只是无法跨刷新保留而已。
  }
}

/**
 * 安全渲染与亮度会跨访问记住，且 `?safe=1` 会强制开启——
 * 驱动会把大厅渲染成全黑的玩家，不应每次刷新都要重新
 * 寻找那个开关。
 */
function loadRenderPrefs(): RenderPrefs {
  const fallback: RenderPrefs = { safeMode: false, brightness: 1 };
  if (typeof window === "undefined") return fallback;
  try {
    const forced = new URLSearchParams(window.location.search).has("safe");
    const raw = window.localStorage.getItem(RENDER_PREFS_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<RenderPrefs>) : {};
    return {
      safeMode: forced || stored.safeMode === true,
      brightness: typeof stored.brightness === "number" ? Math.min(1.8, Math.max(0.6, stored.brightness)) : 1,
    };
  } catch {
    return fallback;
  }
}

function saveRenderPrefs(prefs: RenderPrefs): void {
  try {
    window.localStorage.setItem(RENDER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私浏览——本次会话照常工作，只是不会被记住。
  }
}

export function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const attractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const controller = useMemo(() => new GameController(), []);
  const snapshot = useGameSnapshot(controller);

  const detected = useMemo<QualityPreset>(() => detectQualityPreset(), []);
  const initialRender = useMemo<RenderPrefs>(() => loadRenderPrefs(), []);
  const initialArmies = useMemo<Record<Faction, ArmySkinId>>(() => loadArmyPrefs(), []);
  const initialSeatSwing = useMemo<boolean>(() => loadSeatSwing(), []);
  const initialPremoves = useMemo<boolean>(() => loadPremoves(), []);
  const initialPremoveDepth = useMemo<number>(() => loadPremoveDepth(), []);
  const initialThinkFloor = useMemo<number>(() => loadThinkFloor(), []);
  /** 是否打印按键提示——手机上没有 `F` 可按。 */
  const hasKeyboard = useHasKeyboard();
  const [settings, setSettings] = useState<GameSettings>(() => ({
    quality: detected,
    arena: DEFAULT_ARENA,
    skins: initialArmies,
    captureCinematics: true,
    rotateBoard: initialSeatSwing,
    premoves: initialPremoves,
    premoveDepth: initialPremoveDepth,
    thinkFloorMs: initialThinkFloor,
    rankBadges: true,
    muted: false,
    safeMode: initialRender.safeMode,
    brightness: initialRender.brightness,
  }));
  const [gpu, setGpu] = useState<string>("");

  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [introPlaying, setIntroPlaying] = useState(false);
  const [attract, setAttract] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [fps, setFps] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [cameraFlipped, setCameraFlipped] = useState(false);
  /** 平面俯瞰地图：任何 3D 棋子都挡不住格子。 */
  const [tactical, setTactical] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** 对战录制模式：剥离所有面板，画面只剩棋盘。 */
  const [cinema, setCinema] = useState(false);
  /** AI 对战对局中的镜头行为：固定、环绕或跟随。 */
  const [showcaseCamera, setShowcaseCamera] = useState<ShowcaseCamera>("follow");

  // ------------------------------------------------------------ 启动场景
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 无头/被拦截的环境无法创建 WebGL 上下文——大声报错，
    // 给出可读信息，而不是黑屏。
    const probe = document.createElement("canvas");
    const supported = Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
    if (!supported) {
      setUnsupported(true);
      return;
    }

    let engine: SceneEngine;
    try {
      engine = new SceneEngine(
        canvas,
        controller,
        {
          onLoadProgress: (ratio) => setProgress(ratio),
          onReady: () => setPhase("menu"),
          onPromotionOpen: (open) => setPromotionOpen(open),
          onQualityAdjusted: (preset) => {
            setSettings((current) => ({ ...current, quality: preset }));
            setNotice(`画质已降至「${QUALITY_LABEL[preset]}」档，以保持流畅帧率。`);
            setTimeout(() => setNotice(null), 5000);
          },
          onFps: (value) => setFps(value),
          onContextLost: () => setContextLost(true),
          onCameraFlipped: (flipped) => setCameraFlipped(flipped),
          onTacticalView: (active) => setTactical(active),
          onRenderFallback: (message, safe) => {
            if (safe) setSettings((current) => ({ ...current, safeMode: true }));
            setNotice(FALLBACK_COPY[message] ?? message);
            setTimeout(() => setNotice(null), 9000);
          },
        },
        detected,
        DEFAULT_ARENA,
      );
    } catch (error) {
      console.error("[ui] could not start the renderer", error);
      setUnsupported(true);
      return;
    }

    engineRef.current = engine;
    engine.setInteractive(false);
    // 在首次加载之前设置，保证下载的就是所选军队。
    engine.setArmySkins(initialArmies);
    audio.setArmyCries({ w: ARMY_SKINS[initialArmies.w].cries, b: ARMY_SKINS[initialArmies.b].cries });
    engine.setSafeMode(initialRender.safeMode);
    engine.setBrightness(initialRender.brightness);
    setGpu(engine.getGpuSummary());
    engine.start();

    void engine.load().then(async () => {
      setIntroPlaying(true);
      await engine.playIntro();
      setIntroPlaying(false);
    });

    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, [controller, detected, initialArmies, initialRender]);

  useEffect(() => () => controller.dispose(), [controller]);

  // ----------------------------------------------------- 输入时解锁音频
  useEffect(() => {
    const unlock = (): void => {
      void audio.unlock();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // ----------------------------------------------------------- 应用设置
  //
  // 点将（军队 + 战场）刻意只在非对局状态下推送。
  // 对局进行中，选择器在界面上已是锁定的；这里是第二道锁，
  // 保证任何未来的调用方都无法在棋子激战正酣时换掉军队。
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setQuality(settings.quality);
    if (phase !== "playing") {
      engine.setArena(settings.arena);
      engine.setArmySkins(settings.skins);
    }
    engine.setCaptureCinematics(settings.captureCinematics);
    engine.setRotateBoard(settings.rotateBoard);
    controller.setPremovesEnabled(settings.premoves);
    controller.setPremoveDepth(settings.premoveDepth);
    controller.setThinkFloorMs(settings.thinkFloorMs);
    engine.setRankBadges(settings.rankBadges);
    engine.setSafeMode(settings.safeMode);
    engine.setBrightness(settings.brightness);
    audio.setMuted(settings.muted);
    saveRenderPrefs({ safeMode: settings.safeMode, brightness: settings.brightness });
    saveArmyPrefs(settings.skins);
    saveSeatSwing(settings.rotateBoard);
    savePremoves(settings.premoves);
    savePremoveDepth(settings.premoveDepth);
    saveThinkFloor(settings.thinkFloorMs);
  }, [settings, phase, controller]);

  // ------------------------------------------------------------- 吸引模式
  const stopAttract = useCallback(() => {
    if (attractTimer.current) {
      clearTimeout(attractTimer.current);
      attractTimer.current = null;
    }
    if (!attract) return;
    setAttract(false);
    controller.stop();
    engineRef.current?.setAttract(false);
    engineRef.current?.resync();
  }, [attract, controller]);

  const scheduleAttract = useCallback(() => {
    if (attractTimer.current) clearTimeout(attractTimer.current);
    attractTimer.current = setTimeout(() => {
      if (phase !== "menu" || showSettings) return;
      setAttract(true);
      engineRef.current?.setAttract(true);
      controller.start({ mode: "attract", difficulty: "medium", playerColor: "w", clockMinutes: null });
    }, ATTRACT_DELAY_MS);
  }, [controller, phase, showSettings]);

  useEffect(() => {
    if (phase !== "menu" || attract || introPlaying) return;
    scheduleAttract();
    return () => {
      if (attractTimer.current) clearTimeout(attractTimer.current);
    };
  }, [phase, attract, introPlaying, scheduleAttract]);

  // ------------------------------------------------------------------ 操作
  const startMatch = useCallback(
    (config: MatchConfig) => {
      stopAttract();
      void audio.unlock();
      audio.blip("press");
      const engine = engineRef.current;
      const showcase = config.mode === "demo";
      engine?.setAttract(false);
      engine?.setInteractive(true);
      // AI 对战自带构图（以及自带的通透影调）。
      engine?.setShowcase(showcase, showcaseCamera);
      if (!showcase) {
        engine?.setCameraPreset(config.mode === "ai" && config.playerColor === "b" ? "black" : "white");
      }
      controller.start({
        mode: config.mode,
        difficulty: config.difficulty,
        playerColor: config.playerColor,
        clockMinutes: config.clockMinutes,
        demo: config.demo,
      });
      setPhase("playing");
    },
    [controller, showcaseCamera, stopAttract],
  );

  const returnToMenu = useCallback(() => {
    controller.stop();
    const engine = engineRef.current;
    engine?.setTacticalView(false);
    engine?.setInteractive(false);
    engine?.setShowcase(false);
    engine?.setCameraPreset("cinematic");
    setCinema(false);
    setPhase("menu");
  }, [controller]);

  // -------------------------------------------------------- AI 对战控制
  const handleTogglePause = useCallback(() => {
    audio.blip("press");
    controller.togglePaused();
  }, [controller]);

  const handleDemoSpeed = useCallback(
    (speed: number) => {
      audio.blip("press");
      controller.setDemoSpeed(speed);
    },
    [controller],
  );

  const handleDemoLoop = useCallback(
    (loop: boolean) => {
      audio.blip("press");
      controller.setDemoAutoRematch(loop);
    },
    [controller],
  );

  const handleDemoRestart = useCallback(() => {
    audio.blip("press");
    controller.restartDemo();
  }, [controller]);

  const handleShowcaseCamera = useCallback((mode: ShowcaseCamera) => {
    audio.blip("press");
    setShowcaseCamera(mode);
    engineRef.current?.setShowcaseCamera(mode);
  }, []);

  const handleUndo = useCallback(() => {
    if (controller.undo()) {
      audio.blip("press");
      engineRef.current?.resync();
    } else {
      audio.blip("deny");
    }
  }, [controller]);

  const handleResign = useCallback(() => {
    audio.blip("deny");
    controller.resign();
  }, [controller]);

  const handleRematch = useCallback(() => {
    const current = controller.getSnapshot();
    // AI 对战要经由控制器重启，这样两位引擎的强度、
    // 节奏与局数计数才能全部保留——若改走 `startMatch`，
    // 对局会被悄悄降级为一场人机对弈。
    if (current.mode === "demo") {
      audio.blip("press");
      controller.restartDemo();
      return;
    }
    startMatch({
      mode: current.mode === "hotseat" ? "hotseat" : "ai",
      difficulty: current.difficulty,
      playerColor: current.playerColor,
      clockMinutes: current.clock.enabled ? current.clock.initialMs / 60_000 : null,
    });
  }, [controller, startMatch]);

  const handleFullscreen = useCallback(() => {
    const element = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen().catch((error) => console.warn("[ui] fullscreen refused", error));
  }, []);

  const handleCamera = useCallback((preset: CameraPreset) => {
    audio.blip("press");
    engineRef.current?.setCameraPreset(preset);
  }, []);

  const handleFlipCamera = useCallback(() => {
    audio.blip("press");
    engineRef.current?.flipCamera();
  }, []);

  const handleToggleTactical = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    audio.blip("press");
    engine.setTacticalView(!engine.isTacticalView());
  }, []);

/** 来自菜单的点将台抉择——第一步棋之前的军队与战场。 */
  const handleMuster = useCallback((choice: MusterChoice) => {
    audio.blip("press");
    setSettings((current) =>
      current.arena === choice.arena && current.skins.w === choice.skins.w && current.skins.b === choice.skins.b
        ? current
        : { ...current, arena: choice.arena, skins: choice.skins },
    );
  }, []);

  /** 战况栏的双方实时用时，按它自己的节拍读取。 */
  const getElapsed = useCallback(() => controller.getElapsed(), [controller]);

  /** 排队中的对战再战实时倒计时，按对话框的节拍读取。 */
  const getRematchRemaining = useCallback(() => controller.getDemoRematchRemaining(), [controller]);

  /** 停驻对战循环，让终局局面留在棋盘上。 */
  const holdShowcase = useCallback(() => {
    audio.blip("press");
    controller.setDemoAutoRematch(false);
  }, [controller]);

  const handlePreviewMove = useCallback((move: LedgerMove | null) => {
    engineRef.current?.previewMove(move ? { from: move.from, to: move.to } : null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setShowSettings(false);
        // 同一个键，两件差事，按玩家预期的顺序：先收面板，
        // 再清掉棋盘上排队的整条预排链。Esc 是清空键；
        // 末格上的 X 才是单步撤销。
        if (!showSettings) controller.clearPremove();
      }
      const target = event.target as HTMLElement | null;
      const typing = target ? /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable : false;
      if (typing || event.metaKey || event.ctrlKey || event.altKey || phase !== "playing") return;
      // 当兵在底线等待升变时，键盘属于选择器：
      // 快捷键印在每位候选者自己的铭牌上。
      if (promotionOpen) {
        const key = event.key.toLowerCase();
        const byLetter: Record<string, PieceKind | undefined> = { q: "q", r: "r", b: "b", n: "n" };
        const byIndex: Record<string, PieceKind | undefined> = { "1": "q", "2": "r", "3": "b", "4": "n" };
        const choice = byLetter[key] ?? byIndex[key];
        if (choice && engineRef.current?.choosePromotion(choice)) event.preventDefault();
        return;
      }
      if (event.key === "f" || event.key === "F") handleFlipCamera();
      if (event.key === "t" || event.key === "T") handleToggleTactical();
      if (event.key === "c" || event.key === "C") setCinema((hidden) => !hidden);
      if (event.key === " " && snapshot.mode === "demo") {
        event.preventDefault();
        controller.togglePaused();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, handleFlipCamera, handleToggleTactical, phase, promotionOpen, showSettings, snapshot.mode]);

  const skipIntro = useCallback(() => {
    engineRef.current?.skipIntro();
  }, []);

  // ------------------------------------------------------- 对战裁决
  const showcaseFinished = phase === "playing" && snapshot.mode === "demo" && snapshot.status === "over";
  const [verdictReady, setVerdictReady] = useState(false);

  useEffect(() => {
    if (!showcaseFinished) {
      setVerdictReady(false);
      return;
    }
    const timer = setTimeout(() => setVerdictReady(true), SHOWCASE_VERDICT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [showcaseFinished]);

  return (
    <div
      className="mc-root fixed inset-0 select-none overflow-hidden bg-[#05060a]"
      data-arena={settings.arena}
      style={{ "--mc-vignette": ARENA_LOOKS[settings.arena].screenVignette } as CSSProperties}
    >
      <div className="mc-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <div className="mc-vignette" />

      {/* 将军警报的屏幕部分——3D 部分是国王头顶的红灯。
          以步数为 key，让每次将军着法都重现一次红光涌动，
          而不是只有本局第一次将军。菜单与吸引模式中不会出现，
          那时没有玩家受到威胁。 */}
      {phase === "playing" && snapshot.status === "playing" && snapshot.inCheck ? (
        <div key={snapshot.moves.length} className="mc-check-wash" aria-hidden="true" />
      ) : null}

      {/* 覆盖层 */}
      <div className="pointer-events-none absolute inset-0">
        {phase === "loading" && !unsupported ? <LoadingScreen progress={progress} /> : null}

        {unsupported ? (
          <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center px-6 text-center">
            <div className="mc-slate mc-goldleaf max-w-sm p-6">
              <h2 className="mc-display text-lg text-[#f2e2bd]">大厅需要 WebGL</h2>
              <p className="mt-2 text-sm text-[#b7a88a]">
                当前浏览器或预览环境无法创建 3D 上下文。请在已开启硬件加速的桌面或平板浏览器中打开游戏。
              </p>
            </div>
          </div>
        ) : null}

        {phase === "menu" && !introPlaying ? (
          <MainMenu
            onStart={startMatch}
            onOpenSettings={() => setShowSettings(true)}
            muster={{ skins: settings.skins, arena: settings.arena }}
            onMuster={handleMuster}
            attract={attract}
            onInteract={stopAttract}
          />
        ) : null}

        {phase === "playing" && !cinema ? (
          <Hud
            snapshot={snapshot}
            muted={settings.muted}
            fps={fps}
            onNewGame={returnToMenu}
            onUndo={handleUndo}
            onResign={handleResign}
            onToggleSound={() => setSettings((current) => ({ ...current, muted: !current.muted }))}
            onFullscreen={handleFullscreen}
            onSettings={() => setShowSettings(true)}
            onCamera={handleCamera}
            onFlipCamera={handleFlipCamera}
            cameraFlipped={cameraFlipped}
            tactical={tactical}
            onToggleTactical={handleToggleTactical}
            onPreviewMove={handlePreviewMove}
            onTogglePause={handleTogglePause}
            onDemoSpeed={handleDemoSpeed}
            onDemoLoop={handleDemoLoop}
            onDemoRestart={handleDemoRestart}
            showcaseCamera={showcaseCamera}
            onShowcaseCamera={handleShowcaseCamera}
            onToggleCinema={() => setCinema(true)}
            getElapsed={getElapsed}
          />
        ) : null}

        {phase === "playing" && cinema ? (
          <button
            type="button"
            className="mc-cinema-restore pointer-events-auto"
            onClick={() => setCinema(false)}
            title={hasKeyboard ? "重新显示界面（C）" : "重新显示界面"}
            aria-label="重新显示界面"
          >
            <Clapperboard size={15} />
          </button>
        ) : null}

        {/* 升变选择器本体在 3D 场景中——每位候选者都站在标有
            军衔的铭牌底座上。这条横幅只负责渲染仪式感并复述
            快捷键，位置很高，绝不会遮住任何候选者。 */}
        {promotionOpen ? (
          <div className="mc-fade pointer-events-none absolute inset-x-0 top-[13%] flex flex-col items-center gap-1.5">
            <p className="mc-display mc-slate px-4 py-2 text-xs tracking-[0.28em] text-[#f0dfb6]">
              选择升变的勇士
            </p>
            <p className="mc-display text-[0.6rem] tracking-[0.3em] text-[#c8ab74]">
              {hasKeyboard ? "点击棋子 · 或按 Q R B N" : "点击棋子"}
            </p>
          </div>
        ) : null}

        {introPlaying ? (
          <button
            type="button"
            onClick={skipIntro}
            className="pointer-events-auto absolute inset-0 flex cursor-pointer items-end justify-center bg-transparent pb-10"
          >
            <span className="mc-display mc-pulse text-[0.68rem] tracking-[0.4em] text-[#c8ab74]">
              {hasKeyboard ? "点击跳过" : "点按跳过"}
            </span>
          </button>
        ) : null}

        {showSettings ? (
          <SettingsPanel
            settings={settings}
            autoDetected={detected}
            gpu={gpu}
            fps={fps}
            matchInProgress={phase === "playing"}
            onChange={setSettings}
            onClose={() => setShowSettings(false)}
          />
        ) : null}

        {/* AI 对战同样显示结果对话框，无论是否循环：
            观众会得知谁赢了，并拿到退出路径。只有纯净录屏
            （cinema）模式才不让它上屏。 */}
        {phase === "playing" &&
        !cinema &&
        snapshot.status === "over" &&
        snapshot.result &&
        (snapshot.mode !== "demo" || verdictReady) ? (
          <GameOverModal
            result={snapshot.result}
            pgn={snapshot.pgn}
            playerColor={snapshot.playerColor}
            versusComputer={snapshot.mode === "ai"}
            moveCount={snapshot.history.length}
            showcase={
              snapshot.demo
                ? {
                    round: snapshot.demoRound,
                    white: snapshot.demo.white,
                    black: snapshot.demo.black,
                    autoRematch: snapshot.demo.autoRematch,
                    getRematchRemaining,
                    onHold: holdShowcase,
                  }
                : null
            }
            onRematch={handleRematch}
            onMenu={returnToMenu}
          />
        ) : null}

        {notice ? (
          <div className="mc-fade mc-slate pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 text-xs text-[#e4d3ac]">
            {notice}
          </div>
        ) : null}

        {contextLost ? (
          <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/80 px-6 text-center">
            <div className="mc-slate mc-goldleaf max-w-sm p-6">
              <h2 className="mc-display text-lg text-[#f2e2bd]">大厅陷入黑暗</h2>
              <p className="mt-2 text-sm text-[#b7a88a]">
                图形上下文已丢失。重新加载，让火把再次点亮。
              </p>
              <button type="button" className="mc-btn mc-btn-primary mt-4 w-full" onClick={() => window.location.reload()}>
                重新加载
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LoadingScreen({ progress }: { progress: number }) {
  return (
    <div className="mc-fade absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#05060a]/85 px-6">
      <p className="mc-display text-[0.62rem] tracking-[0.5em] text-[#a89268]">正在召集军队</p>
      <h1 className="mc-display mc-title-glow text-4xl text-[#f4e3bd]">王翼弃兵</h1>
      <div className="h-[3px] w-64 overflow-hidden rounded-full bg-[#2a251c]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#8a6522] via-[#f6dfa5] to-[#8a6522] transition-[width] duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="text-xs italic text-[#7d6f57]">正在雕刻棋子 {Math.round(progress * 6)} / 6…</p>
    </div>
  );
}
