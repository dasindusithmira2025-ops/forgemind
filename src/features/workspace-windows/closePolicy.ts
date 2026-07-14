export type DetachedCloseChoice='attach'|'keep_running'|'stop_and_close'|'cancel'
export interface DetachedCloseEffects{attachToMain:boolean;stopTerminals:boolean;closeWindow:boolean}

export function detachedCloseEffects(choice:DetachedCloseChoice):DetachedCloseEffects{
  switch(choice){
    case'attach':return{attachToMain:true,stopTerminals:false,closeWindow:true}
    case'keep_running':return{attachToMain:true,stopTerminals:false,closeWindow:true}
    case'stop_and_close':return{attachToMain:true,stopTerminals:true,closeWindow:true}
    case'cancel':return{attachToMain:false,stopTerminals:false,closeWindow:false}
  }
}
