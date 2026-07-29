import{beforeEach,describe,expect,it}from'vitest'
import{useSessionStore}from'./sessionStore'

describe('multi-Project session UI cache',()=>{
  beforeEach(()=>useSessionStore.getState().reset())
  it('keeps several open Projects while exactly one is active',()=>{const sessions=[{projectId:'p1',isActive:false,expanded:true,openedAt:'t',updatedAt:'t'},{projectId:'p2',isActive:true,lastWorkspaceId:'w2',lastPaneId:'pane2',expanded:true,openedAt:'t',updatedAt:'t'}];useSessionStore.getState().setOpenProjects(sessions);expect(useSessionStore.getState().openProjects).toHaveLength(2);expect(useSessionStore.getState().openProjects.filter((item)=>item.isActive).map((item)=>item.projectId)).toEqual(['p2'])})
  it('keeps placement lists isolated by Project',()=>{useSessionStore.getState().setPlacements('p1',[{workspaceId:'w1',mode:'attached',maximized:false,fullscreen:false,placementRevision:0}]);useSessionStore.getState().setPlacements('p2',[{workspaceId:'w2',mode:'detached',maximized:false,fullscreen:false,placementRevision:1}]);expect(useSessionStore.getState().placementsByProject.p1.map((item)=>item.workspaceId)).toEqual(['w1']);expect(useSessionStore.getState().placementsByProject.p2.map((item)=>item.workspaceId)).toEqual(['w2'])})
})
