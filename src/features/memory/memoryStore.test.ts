import { beforeEach, describe, expect, it, vi } from 'vitest'
import { native } from '../../native/commands'
import { useMemoryStore } from './memoryStore'

vi.mock('../../native/commands',()=>({asNativeError:(error:unknown)=>({message:String(error)}),native:{memorySearch:vi.fn(),memoryHealth:vi.fn(),memoryGetItem:vi.fn(),memoryAddNote:vi.fn(),memoryCaptureFile:vi.fn(),memoryRebuildIndex:vi.fn()}}))

describe('project-scoped Memory state',()=>{
  beforeEach(()=>{useMemoryStore.setState({projectId:undefined,query:'',results:[],selected:undefined,health:undefined,loading:false,error:undefined});vi.mocked(native.memorySearch).mockResolvedValue({projectId:'p',query:'',results:[],total:0});vi.mocked(native.memoryHealth).mockResolvedValue({projectId:'p',itemCount:0,revisionCount:0,sourceCount:0,chunkCount:0,indexedChunkCount:0,healthy:true,messages:[]})})
  it('clears the selected item before loading a different Project',async()=>{useMemoryStore.setState({projectId:'old',selected:{id:'private',projectId:'old'} as never});await useMemoryStore.getState().openProject('new');expect(useMemoryStore.getState().projectId).toBe('new');expect(useMemoryStore.getState().selected).toBeUndefined();expect(native.memorySearch).toHaveBeenCalledWith('new','',50)})
})
