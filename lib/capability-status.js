// Metadata only: no downloads, platform calls, account reads or model execution.
export function capabilityStatus({mainBound,mainLive,settings,presentation,video,hostSpeechInterface=null}){
  const pet=presentation.settings?.mode==='pet';
  return {session:{bound:!!mainBound,live:!!mainLive,note:mainBound?'已保存主会话；实时状态只表示当前是否加载。':'尚未绑定主会话，请在设置中选择已有会话。'},
    pet:{enabled:!!presentation.settings?.enabled&&pet,connection:presentation.connection??'unchecked',note:'桌宠状态来自最近一次联动；请点击检查连接，实际气泡仍需看界面。'},
    speech:{enabled:!!presentation.settings?.enabled&&!pet,note:'需浏览器提供本地中文音色，实际出声需试听。'},
    video:{enabled:!!settings.videoEnabled,probeRegistered:!!video.probe,storyboardRegistered:!!video.storyboard,busy:!!video.busy,hostSpeechInterface,note:'工具登记不代表主会话已准入、下载成功或模型能读图；需实际测试。'},
    rss:{enabled:!!settings.rssEnabled,feedCount:settings.feedCount,note:settings.feedCount?'已配置订阅源；实际访问尚需核验。':'尚未填写订阅源。'}};
}
