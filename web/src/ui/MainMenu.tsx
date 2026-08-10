import { useState } from "react";
import { Clapperboard, Crown, Swords, Settings as SettingsIcon, Users } from "lucide-react";

import type { DemoOptions, Difficulty, Faction } from "../core/types";
import { Crest } from "./Heraldry";
import { useHasKeyboard } from "./inputMode";
import { MusterSection, type MusterChoice } from "./Muster";

export interface MatchConfig {
  mode: "ai" | "hotseat" | "demo";
  difficulty: Difficulty;
  playerColor: Faction;
  clockMinutes: number | null;
  demo?: DemoOptions;
}

interface MainMenuProps {
  onStart: (config: MatchConfig) => void;
  onOpenSettings: () => void;
  /** 军队与战场——在第一步棋落下之前，就在这里敲定。 */
  muster: MusterChoice;
  onMuster: (choice: MusterChoice) => void;
  attract: boolean;
  onInteract: () => void;
}

const DIFFICULTY_COPY: Record<Difficulty, string> = {
  easy: "侍从 — 落子快而随性",
  medium: "骑士 — 能细算三步棋",
  hard: "战将 — 全盘搜索，毫不留情",
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "侍从",
  medium: "骑士",
  hard: "战将",
};

const DEMO_SPEEDS: { label: string; value: number }[] = [
  { label: "0.5×", value: 0.5 },
  { label: "1×", value: 1 },
  { label: "2×", value: 2 },
  { label: "4×", value: 4 },
];

const CLOCKS: { label: string; value: number | null }[] = [
  { label: "无时限", value: null },
  { label: "5 分钟", value: 5 },
  { label: "10 分钟", value: 10 },
  { label: "15 分钟", value: 15 },
];

export function MainMenu({ onStart, onOpenSettings, muster, onMuster, attract, onInteract }: MainMenuProps) {
  const hasKeyboard = useHasKeyboard();
  const [tab, setTab] = useState<"ai" | "hotseat" | "demo">("ai");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [playerColor, setPlayerColor] = useState<Faction>("w");
  const [clock, setClock] = useState<number | null>(null);
  const [demoWhite, setDemoWhite] = useState<Difficulty>("medium");
  const [demoBlack, setDemoBlack] = useState<Difficulty>("hard");
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [demoLoop, setDemoLoop] = useState(true);

  const start = (): void =>
    onStart({
      mode: tab,
      difficulty,
      playerColor,
      clockMinutes: tab === "demo" ? null : clock,
      demo: tab === "demo" ? { white: demoWhite, black: demoBlack, speed: demoSpeed, autoRematch: demoLoop } : undefined,
    });

  return (
    <div
      className="mc-menu mc-modal-pad pointer-events-auto absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      onPointerDown={onInteract}
      onPointerMove={onInteract}
    >
      <div className="mc-unfurl mc-menu-hero mb-6 shrink-0 text-center">
        <p className="mc-display text-[0.68rem] tracking-[0.55em] text-[#c8ab74]">纪元一四九二年</p>
        <h1 className="mc-display mc-title-glow mt-2 text-5xl font-bold text-[#f4e3bd] sm:text-6xl">
          王翼弃兵
        </h1>
        <div className="mc-rule mx-auto mt-3 w-64" />
        <p className="mt-3 text-sm italic text-[#c5b28d]">
          {attract ? "一场 AI 对决正在进行——动一动即可接管大厅" : "在奥尔德穆尔大厅中对弈"}
        </p>
      </div>

      <div className="mc-slate mc-goldleaf mc-rise flex w-full min-h-0 max-w-md flex-col p-5 sm:p-6">
        <div className="mb-5 grid shrink-0 grid-cols-3 gap-2">
          <button
            type="button"
            className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
            data-active={tab === "ai"}
            onClick={() => setTab("ai")}
          >
            <Swords size={14} /> 人机对战
          </button>
          <button
            type="button"
            className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
            data-active={tab === "hotseat"}
            onClick={() => setTab("hotseat")}
          >
            <Users size={14} /> 双人对弈
          </button>
          <button
            type="button"
            className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
            data-active={tab === "demo"}
            onClick={() => setTab("demo")}
          >
            <Clapperboard size={14} /> AI 对战
          </button>
        </div>

        <div className="mc-scroll -mr-2 min-h-0 flex-auto overflow-y-auto pr-2">
        {tab === "ai" ? (
          <div className="mc-fade space-y-5">
            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">对手</p>
              <div className="grid grid-cols-3 gap-2">
                {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="mc-chip py-2.5"
                    data-active={difficulty === level}
                    onClick={() => setDifficulty(level)}
                  >
                    {DIFFICULTY_LABEL[level]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs italic text-[#9c8b6c]">{DIFFICULTY_COPY[difficulty]}</p>
            </div>

            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">你的军旗</p>
              <div className="grid grid-cols-2 gap-2">
                {(["w", "b"] as Faction[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="mc-chip flex items-center justify-center gap-2 py-2.5"
                    data-active={playerColor === color}
                    onClick={() => setPlayerColor(color)}
                  >
                    <Crest faction={color} size={18} active={playerColor === color} />
                    {color === "w" ? "白曜" : "黑曜"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : tab === "hotseat" ? (
          <p className="mc-fade text-sm italic leading-relaxed text-[#b7a88a]">
            两位统帅，一方棋盘。视角在回合之间保持不变——{" "}
            {hasKeyboard ? (
              <>
                随时可按 <span className="mc-display text-[#e2c98f]">F</span> 翻转视角，或
              </>
            ) : (
              <>随时可在镜头菜单中翻转视角，或</>
            )}{" "}
            在设置中开启自动转向。
          </p>
        ) : (
          <div className="mc-fade space-y-5">
            <p className="text-sm italic leading-relaxed text-[#b7a88a]">
              两位 AI 统帅自行对决，镜头缓缓环绕大厅——适合观赏，也适合录制画面。{" "}
              {hasKeyboard ? (
                <>
                  对局中按 <span className="mc-display text-[#e2c98f]">C</span> 可隐藏全部界面。
                </>
              ) : (
                <>对局中点击纯净录屏印记可隐藏全部界面。</>
              )}
            </p>

            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">白曜引擎</p>
              <div className="grid grid-cols-3 gap-2">
                {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="mc-chip py-2.5"
                    data-active={demoWhite === level}
                    onClick={() => setDemoWhite(level)}
                  >
                    {DIFFICULTY_LABEL[level]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">黑曜引擎</p>
              <div className="grid grid-cols-3 gap-2">
                {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="mc-chip py-2.5"
                    data-active={demoBlack === level}
                    onClick={() => setDemoBlack(level)}
                  >
                    {DIFFICULTY_LABEL[level]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">节奏</p>
              <div className="grid grid-cols-4 gap-2">
                {DEMO_SPEEDS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className="mc-chip py-2.5"
                    data-active={demoSpeed === option.value}
                    onClick={() => setDemoSpeed(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="mc-chip flex w-full items-center justify-between px-3 py-2.5"
              data-active={demoLoop}
              onClick={() => setDemoLoop((loop) => !loop)}
              aria-pressed={demoLoop}
            >
              <span>循环再战</span>
              <span className="mc-display text-[0.62rem] tracking-[0.24em]">{demoLoop ? "开" : "关"}</span>
            </button>
          </div>
        )}

        {tab === "demo" ? null : (
          <div className="mt-5">
            <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">沙漏计时</p>
            <div className="grid grid-cols-4 gap-2">
              {CLOCKS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="mc-chip py-2.5"
                  data-active={clock === option.value}
                  onClick={() => setClock(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mc-rule my-5" />

        <MusterSection choice={muster} onChange={onMuster} />
        </div>

        <div className="mc-panel-foot shrink-0">
        <button
          type="button"
          className="mc-btn mc-btn-primary mt-5 flex w-full items-center justify-center gap-2 py-3.5 text-sm"
          onClick={start}
        >
          {tab === "demo" ? (
            <>
              <Clapperboard size={16} /> 开始 AI 对战
            </>
          ) : (
            <>
              <Crown size={16} /> 出 征
            </>
          )}
        </button>

        <button
          type="button"
          className="mc-btn mt-2 flex w-full items-center justify-center gap-2"
          onClick={onOpenSettings}
        >
          <SettingsIcon size={15} /> 设置
        </button>
        </div>
      </div>

      {/* 手指与鼠标驱动大厅的方式不同，所以常驻提示只列出
          当前设备真正具备的手势。 */}
      <p className="mc-menu-hint mt-5 shrink-0 text-[0.68rem] tracking-[0.2em] text-[#7d6f57]">
        {hasKeyboard
          ? "拖拽旋转视角 · 滚轮缩放 · 点击棋子进行指挥"
          : "拖拽旋转视角 · 双指缩放 · 点按棋子进行指挥"}
      </p>
    </div>
  );
}
