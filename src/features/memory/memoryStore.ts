import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import type { MemoryHealth, MemoryItem, MemorySearchResult } from './memoryTypes'

interface MemoryState {
  projectId?:string; query:string; results:MemorySearchResult[]; selected?:MemoryItem; health?:MemoryHealth; loading:boolean; error?:string
  openProject:(projectId:string)=>Promise<void>; search:(query?:string)=>Promise<void>; select:(itemId:string)=>Promise<void>
  addNote:(title:string,body:string,workspaceId?:string)=>Promise<void>; captureFile:(path:string,workspaceId?:string)=>Promise<void>; rebuild:()=>Promise<void>; clearError:()=>void
}

export const useMemoryStore=create<MemoryState>((set,get)=>({
  query:'',results:[],loading:false,
  openProject:async(projectId)=>{
    if(get().projectId!==projectId)set({projectId,query:'',results:[],selected:undefined,health:undefined,error:undefined})
    set({loading:true})
    try{const [response,health]=await Promise.all([native.memorySearch(projectId,'',50),native.memoryHealth(projectId)]);if(get().projectId===projectId)set({results:response.results,health})}
    catch(error){set({error:asNativeError(error).message})}finally{set({loading:false})}
  },
  search:async(query=get().query)=>{const projectId=get().projectId;if(!projectId)return;set({query,loading:true,error:undefined});try{const response=await native.memorySearch(projectId,query,50);if(get().projectId===projectId&&get().query===query)set({results:response.results})}catch(error){set({error:asNativeError(error).message})}finally{set({loading:false})}},
  select:async(itemId)=>{const projectId=get().projectId;if(!projectId)return;set({loading:true,error:undefined});try{const selected=await native.memoryGetItem(projectId,itemId);if(get().projectId===projectId)set({selected})}catch(error){set({error:asNativeError(error).message})}finally{set({loading:false})}},
  addNote:async(title,body,workspaceId)=>{const projectId=get().projectId;if(!projectId)return;await native.memoryAddNote(projectId,title,body,'note',workspaceId);await get().search()},
  captureFile:async(path,workspaceId)=>{const projectId=get().projectId;if(!projectId)return;await native.memoryCaptureFile(projectId,path,workspaceId);await get().search()},
  rebuild:async()=>{const projectId=get().projectId;if(!projectId)return;set({loading:true,error:undefined});try{await native.memoryRebuildIndex(projectId);const health=await native.memoryHealth(projectId);set({health});await get().search()}catch(error){set({error:asNativeError(error).message})}finally{set({loading:false})}},
  clearError:()=>set({error:undefined}),
}))
