import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { ArrowLeft, Database, FilePlus2, Plus, RefreshCw, Search } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { useMemoryStore } from '../features/memory/memoryStore'
import { native } from '../native/commands'
import type { ProjectOverview } from '../native/types'

export function MemoryScreen(){
  const{projectId}=useParams<{projectId:string}>();const navigate=useNavigate();const store=useMemoryStore();const openProject=store.openProject;const[projects,setProjects]=useState<ProjectOverview[]>([]);const[note,setNote]=useState(false)
  useEffect(()=>{void native.listProjectsOverview().then(setProjects)},[])
  useEffect(()=>{if(projectId)void openProject(projectId)},[projectId,openProject])
  if(!projectId)return<Navigate to="/" replace/>
  const overview=projects.find((entry)=>entry.project.id===projectId)
  const capture=async()=>{const path=await open({multiple:false,directory:false,title:'Capture a Project file into Memory'});if(path&&!Array.isArray(path))await store.captureFile(path)}
  return <main className="memory-shell"><header className="project-missions-topbar"><Button variant="ghost" icon={<ArrowLeft size={16}/>} onClick={()=>navigate(-1)}/><Brand compact/><div className="project-missions-context"><strong>{overview?.project.name??'Project Memory'}</strong><span>Durable, Project-scoped context</span></div><label className="project-missions-switcher">Project<select value={projectId} onChange={(event)=>navigate(`/project/${event.target.value}/memory`)}>{projects.map((entry)=><option key={entry.project.id} value={entry.project.id}>{entry.project.name}</option>)}</select></label><Button variant="ghost" icon={<RefreshCw size={14}/>} onClick={()=>void store.rebuild()}>Rebuild index</Button><Button variant="ghost" icon={<FilePlus2 size={14}/>} onClick={()=>void capture()}>Capture file</Button><Button variant="primary" icon={<Plus size={14}/>} onClick={()=>setNote(true)}>Add note</Button></header>
  {store.error&&<ErrorNotice message={store.error} onRetry={store.clearError}/>}<div className="memory-layout"><aside className="memory-results"><header><h1>Memory</h1><span>{store.health?.itemCount??0} items · {store.health?.indexedChunkCount??0} indexed chunks</span></header><label className="mission-search"><Search size={14}/><input value={store.query} onChange={(event)=>{const value=event.target.value;void store.search(value)}} placeholder="Search this Project's Memory"/></label>{store.results.map((result)=><button key={result.itemId} className={store.selected?.id===result.itemId?'selected':''} onClick={()=>void store.select(result.itemId)}><strong>{result.title}</strong><span>{result.memoryType} · {new Date(result.updatedAt).toLocaleDateString()}</span><p>{result.excerpt||result.summary}</p></button>)}{!store.loading&&!store.results.length&&<div className="project-mission-unselected"><Database size={23}/><h2>No matching Memory</h2><p>Capture a Project file or add a durable note.</p></div>}</aside><section className="memory-detail">{store.selected?<><header><span className="section-label">{store.selected.memoryType} · revision {store.selected.revisionNumber}</span><h1>{store.selected.title}</h1><p>{store.selected.summary}</p></header><pre>{store.selected.body}</pre><h2>Sources</h2>{store.selected.sources.map((source)=><button key={source.id} onClick={()=>source.filePath&&void revealItemInDir(source.filePath)}><strong>{source.filePath??source.uri}</strong><span>{source.sensitivity} · {new Date(source.capturedAt).toLocaleString()}</span></button>)}</>:<div className="project-mission-unselected"><Database size={25}/><h1>Select a Memory item</h1><p>Results and source references never cross Project boundaries.</p></div>}</section></div>
  {note&&<TextPromptDialog title="Add Project Memory" label="Title, followed by a blank line and the durable note" confirmLabel="Save Note" onClose={()=>setNote(false)} onConfirm={(value)=>{const[title,...rest]=value.split(/\n\s*\n/);void store.addNote(title||'Project note',rest.join('\n\n')||value);setNote(false)}}/>}</main>
}
