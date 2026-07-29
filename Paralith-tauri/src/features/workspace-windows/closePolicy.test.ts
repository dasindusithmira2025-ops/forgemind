import{describe,expect,it}from'vitest'
import{detachedCloseEffects}from'./closePolicy'

describe('detached Workspace close policy',()=>{
  it('keeps processes for attach and background choices',()=>{expect(detachedCloseEffects('attach').stopTerminals).toBe(false);expect(detachedCloseEffects('keep_running')).toEqual({attachToMain:true,stopTerminals:false,closeWindow:true})})
  it('stops only the selected Workspace for the destructive choice',()=>{expect(detachedCloseEffects('stop_and_close')).toEqual({attachToMain:true,stopTerminals:true,closeWindow:true})})
  it('does nothing on cancel',()=>{expect(detachedCloseEffects('cancel')).toEqual({attachToMain:false,stopTerminals:false,closeWindow:false})})
})
