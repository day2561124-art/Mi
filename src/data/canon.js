// User-supplied November 2026 handoff metadata, adapted for NEW rebuilding map IDs.
// These are shortened event summaries, not original episode scripts or original Sites source.
const ARCS=[
 ['conan-tv-883-884','從繪本跳出的炸彈犯','police','conan,megure,takagi','威脅傳來|分頭追查|案件收束'],
 ['conan-tv-885-886','在白羅咖啡廳解謎','poiro','conan,heiji,ran,azusa','平次到訪|座位旁的異樣|推理結束'],
 ['conan-tv-887-888','怪盜基德的機關盒','museum','kaito,conan,jirokichi','機關盒展出|預告與部署|對決與收束'],
 ['conan-tv-889-890','新任教師的骸骨事件','school','conan,ai,ayumi,rume','倉庫異狀|地下室發現|舊案與線索'],
 ['conan-tv-891-892','幕末維新推理之旅','yamaguchi','conan,ran,kogoro','來到山口|萩市追查|旅程結案'],
 ['conan-tv-893-893','星級餐廳之謎','sushi','conan,ran,kogoro','餐廳到訪|異常調查|真相揭露'],
 ['conan-tv-894-895','隔壁的江戶前推理秀','sushi','conan,kogoro,wakita','壽司店訪客|追查線索|各自離開'],
 ['conan-tv-896-897','白手女子','police','conan,megure,takagi','照片浮現|鄰里目擊|案件釐清'],
 ['conan-tv-898-898','蛋糕融化了','poiro','conan,azusa,amuro','蛋糕異常|監視畫面疑點|恢復營業'],
 ['conan-tv-899-899','真兇的叫喊聲','warehouse','conan','異常聲響|現場調查|還原經過'],
 ['conan-tv-900-900','密室解謎秀','agency','conan,kogoro','推理邀約|密室疑點|節目收尾']
];
export const CANON_ARCS=ARCS.map(([id,title,placeId,actors,stages],arcIndex)=>({
 id,title,placeId,actorIds:actors.split(','),index:arcIndex,stages:stages.split('|').map((stageTitle,stageIndex)=>({
  id:`${id}-stage-${stageIndex+1}`,title:stageTitle,arcId:id,placeId,actorIds:actors.split(','),
  // Every 6 in-world hours: deterministic, same world-state event cannot run twice.
  atMinute:(arcIndex*3+stageIndex+1)*360
 }))
}));
export const CANON_BEATS=CANON_ARCS.flatMap(arc=>arc.stages);