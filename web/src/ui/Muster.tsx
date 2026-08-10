import { Lock } from "lucide-react";

import { ARMY_SKINS, ARMY_SKIN_ORDER, type ArmySkinId } from "../assets/generated";
import type { Faction } from "../core/types";
import { ARENA_LOOKS, ARENA_ORDER, type ArenaTheme } from "../scene/arena";

/**
 * 点将台上的抉择：双方各自召集哪支军队、在哪片土地上交锋。
 * 两者都在第一步棋落下*之前*敲定——对局中途更换军队，
 * 需要拆除并重新下载棋盘上的每一枚棋子；更换战场，
 * 则要在已在厮杀的棋子脚下重新搭建大厅。
 * 因此这些选择器放在菜单里，对局内面板只显示为锁定状态。
 */
export interface MusterChoice {
  skins: Record<Faction, ArmySkinId>;
  arena: ArenaTheme;
}

/** 军队行下方的简介——如实描述镜像对局（双方同军队）的观感。 */
export function armyBlurb(skins: Record<Faction, ArmySkinId>): string {
  return skins.w === skins.b
    ? `双方都召集了${ARMY_SKINS[skins.w].label}——近侧以蔚蓝标示、远侧以焰红标示，体现在地面与每道剪影上。`
    : ARMY_SKINS[skins.w].blurb;
}

/** 一方的军队选择：一排卡片，每支军队一张。 */
export function ArmyPicker({
  side,
  name,
  chosen,
  onChoose,
}: {
  side: Faction;
  name: string;
  chosen: ArmySkinId;
  onChoose: (skin: ArmySkinId) => void;
}) {
  return (
    <div className="mb-2">
      <p className="mb-1.5 flex items-center gap-2 text-[0.66rem] italic text-[#9c8b6c]">
        <SideDot side={side} />
        {name}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {ARMY_SKIN_ORDER.map((skin) => (
          <button
            key={skin}
            type="button"
            className="mc-army-card"
            data-active={chosen === skin}
            onClick={() => onChoose(skin)}
            title={ARMY_SKINS[skin].blurb}
          >
            <span className="mc-army-swatch" data-army={skin} />
            <span className="mc-display text-[0.64rem] leading-tight text-[#f0e0be]">{ARMY_SKINS[skin].label}</span>
            <span className="text-[0.58rem] leading-tight text-[#9c8b6c]">{ARMY_SKINS[skin].ranks.p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 棋盘所搭建的土地。 */
export function ArenaPicker({ chosen, onChoose }: { chosen: ArenaTheme; onChoose: (theme: ArenaTheme) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ARENA_ORDER.map((theme) => (
          <button
            key={theme}
            type="button"
            className="mc-arena-card"
            data-active={chosen === theme}
            onClick={() => onChoose(theme)}
          >
            <span className="mc-arena-swatch" data-arena={theme} />
            <span className="mc-display text-[0.68rem] leading-tight text-[#f0e0be]">{ARENA_LOOKS[theme].label}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs italic text-[#9c8b6c]">{ARENA_LOOKS[chosen].note}</p>
    </>
  );
}

/**
 * 完整的点将台——双方军队加战场。用于对局前的主菜单，
 * 以及没有进行中对局时的设置面板。
 */
export function MusterSection({
  choice,
  onChange,
}: {
  choice: MusterChoice;
  onChange: (choice: MusterChoice) => void;
}) {
  return (
    <>
      <p className="mc-display mb-2 text-[0.6rem] tracking-[0.3em] text-[#a89268]">军队</p>
      <ArmyPicker
        side="w"
        name="近侧"
        chosen={choice.skins.w}
        onChoose={(skin) => onChange({ ...choice, skins: { ...choice.skins, w: skin } })}
      />
      <ArmyPicker
        side="b"
        name="远侧"
        chosen={choice.skins.b}
        onChoose={(skin) => onChange({ ...choice, skins: { ...choice.skins, b: skin } })}
      />
      <p className="mt-2 text-xs italic text-[#9c8b6c]">{armyBlurb(choice.skins)}</p>

      <div className="mc-rule my-5" />

      <p className="mc-display mb-2 text-[0.6rem] tracking-[0.3em] text-[#a89268]">战场</p>
      <ArenaPicker chosen={choice.arena} onChoose={(arena) => onChange({ ...choice, arena })} />
    </>
  );
}

/**
 * 同样三项选择的只读版本，用于已在进行中的对局：
 * 它说明棋盘上是哪支军队、哪片战场，以及为何此刻无法更改。
 */
export function MusterLocked({ choice }: { choice: MusterChoice }) {
  return (
    <div className="mc-muster-locked">
      <p className="mc-display mb-2 flex items-center gap-2 text-[0.6rem] tracking-[0.3em] text-[#a89268]">
        <Lock size={11} />
        点将 · 已锁定
      </p>
      <dl className="space-y-1.5">
        <LockedRow label={<SideDot side="w" />} name="近侧" value={ARMY_SKINS[choice.skins.w].label} />
        <LockedRow label={<SideDot side="b" />} name="远侧" value={ARMY_SKINS[choice.skins.b].label} />
        <LockedRow
          label={<span className="mc-arena-dot" data-arena={choice.arena} />}
          name="战场"
          value={ARENA_LOOKS[choice.arena].label}
        />
      </dl>
      <p className="mt-2.5 text-xs italic text-[#9c8b6c]">
        军队与战场需在第一步棋之前选定。点击{" "}
        <span className="mc-display not-italic text-[#e2c98f]">新的一局</span>退出本局，即可重新点将。
      </p>
    </div>
  );
}

function LockedRow({ label, name, value }: { label: React.ReactNode; name: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[#8a652222] pb-1.5 last:border-b-0 last:pb-0">
      {label}
      <dt className="text-[0.66rem] italic text-[#9c8b6c]">{name}</dt>
      <dd className="mc-display ml-auto text-[0.72rem] text-[#d9c69c]">{value}</dd>
    </div>
  );
}

/** 一方的颜色代码，与其棋子脚下绘制的色带一致。 */
function SideDot({ side }: { side: Faction }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full border"
      style={{
        background: side === "w" ? "#5fb0ff" : "#ff5230",
        borderColor: side === "w" ? "#bfe0ffcc" : "#ffb083cc",
      }}
    />
  );
}
