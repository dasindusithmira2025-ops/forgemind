import { useMemo, useState } from 'react'
import { AlertTriangle, FolderOpen, Search } from 'lucide-react'
import { groupRecentsByProject } from '../sidebarSelectors'
import type { ForgeSpaceSidebarProps } from '../sidebarTypes'

export function ProjectSelectionSection({recents,openProjectIds,actions}:Pick<ForgeSpaceSidebarProps,'recents'|'actions'>&{openProjectIds:Set<string>}){
  const[query,setQuery]=useState('')
  const rows=useMemo(()=>groupRecentsByProject(recents),[recents]).filter((row)=>`${row.name} ${row.path}`.toLowerCase().includes(query.toLowerCase())).slice(0,5)
  return <section className="project-selection" aria-label="Project Selection"><header className="ws-section-head"><span className="section-label">Project Selection</span></header><label className="project-selection-search"><Search size={13}/><input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search recent Projects"/></label>{query&&<ul className="project-selection-results">{rows.map((row)=><li key={row.projectId}><button disabled={row.missing} onClick={()=>actions.onOpenProject?.(row.projectId)}><span><strong>{row.name}</strong><small>{openProjectIds.has(row.projectId)?'Already open · focus Project':`${row.workspaceCount} Workspace${row.workspaceCount===1?'':'s'}`}</small></span>{row.missing&&<AlertTriangle size={13}/>}</button></li>)}</ul>}<button className="open-project-add" onClick={actions.onOpenLauncher}><FolderOpen size={13}/> Open a Project folder</button></section>
}
