import { useMemo } from 'react'
import { useCanvas } from '../store/canvasStore'
import { useLive } from '../store/liveStore'
import { isLive } from './mode'
import {
  createLiveTeamSource,
  createScriptedTeamSource,
  type TeamDataSource,
} from './teamDataSource'

// feat-017：把 mode + live payload 解析成一个 TeamDataSource 给 HomeScene 用。
//
// story mode → ScriptedTeamSource（读 fixtures，与今日 DOM 完全一致，零回归）。
// live mode + 已 ingest → LiveTeamSource（读上传产出）。
// live mode 未 ingest → 仍回退 ScriptedTeamSource？不——回退到"空 live 源"，让 HomeScene 显
//   空态引导上传。这里返回 { source, isLiveEmpty }：HomeScene 据此决定显 UploadPanel 空态还是卡带。
export function useTeamData(): { source: TeamDataSource; live: boolean; liveEmpty: boolean } {
  const mode = useLive((s) => s.mode)
  const team = useLive((s) => s.team)
  const briefing = useCanvas((s) => s.briefing)
  const live = isLive(mode)

  const scripted = useMemo(() => createScriptedTeamSource(() => briefing), [briefing])
  const liveSource = useMemo(() => (team ? createLiveTeamSource(team) : null), [team])

  if (live && liveSource) {
    return { source: liveSource, live: true, liveEmpty: false }
  }
  if (live) {
    // live 但还没上传：用 scripted 作类型占位，HomeScene 会因 liveEmpty=true 显上传空态而非卡带。
    return { source: scripted, live: true, liveEmpty: true }
  }
  return { source: scripted, live: false, liveEmpty: false }
}
