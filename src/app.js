import {PLACES,AREA_ORDER,PLACE_BY_ID,AREA_COLORS} from './data/atlas.js';
import {CANON_ARCS,CANON_BEATS} from './data/canon.js';
import {makeWorld,worldClock,advanceWorld,catchUpWorld,toExport,fromImport,visitPlace,inspectRoom} from './core/world.js';
import {findRoute,ROAD_EDGES} from './core/routes.js';
import {makeBoundedBrainRequest,applyBrainDecision,characterActionCatalog} from './core/brain-bridge.js';
import {storage} from './core/storage.js';
const root=document.getElementById('app');
const ui={brainStatus:{connected:false,decision_provider:false,mode:null},brainBusy:false,brainLastCycle:null,world:null,worlds:[],view:'map',chosenPlace:'agency',chosenActor:null,inside:false,notice:'',saveStatus:'',saving:Promise.resolve(),lastTick:Date.now(),error:''};
function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function when(ms){return new Intl.DateTimeFormat('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(ms);}
function actorHere(placeId){return ui.world.people.filter(p=>p.placeId===placeId);}
function avatar(p,size='normal'){return `<span class="avatar ${size}" style="--avatar:${esc(p.color)}" title="${esc(p.name)}">${esc(p.name.slice(0,1))}</span>`;}
function flash(text){ui.notice=text;render();}
function logType(kind){return ({canon:'原作事件',movement:'移動',social:'互動',investigation:'調查',discovery:'發現',decision:'決定',rumor:'交流',exploration:'走訪',system:'系統'})[kind]||kind;}
function formatLog(l){return `<article class="log-entry"><span class="log-time">${esc(worldClock(l.minute).label)}</span><span class="tag ${esc(l.kind)}">${esc(logType(l.kind))}</span><div class="log-text">${esc(l.text)}</div>${l.placeId?`<button class="inline-link" data-place="${esc(l.placeId)}">${esc(PLACE_BY_ID[l.placeId]?.name||l.placeId)}</button>`:''}</article>`;}
function saveWorld(){
 if(!ui.world)return Promise.resolve();
 const snapshot=structuredClone({...ui.world,savedAt:Date.now()});ui.world.savedAt=snapshot.savedAt;ui.saveStatus='儲存中';
 ui.saving=ui.saving.catch(()=>{}).then(async()=>{const layer=await storage.put(snapshot);ui.saveStatus=`已自動儲存 · ${layer}`;ui.error='';render();}).catch(err=>{ui.error=err.message;ui.saveStatus='儲存失敗';render();});
 return ui.saving;
}
function commit(w){ui.world=w;saveWorld();render();}
async function openWorld(id){
 let saved;try{saved=await storage.get(id);}catch(err){flash(`存檔無法開啟：${err.message}`);return;}
 if(!saved){flash('找不到這個世界的存檔。');return;}
 ui.world=catchUpWorld(saved);ui.world.area=PLACE_BY_ID[ui.world.observer.placeId]?.area||'米花町';ui.chosenPlace=ui.world.observer.placeId;ui.chosenActor=null;ui.inside=false;ui.view='map';ui.lastTick=Date.now();await saveWorld();render();
}
async function refreshWorlds(){ui.worlds=await storage.list();}
function heading(){
 const clock=worldClock(ui.world.minutes);
 return `<header class="topbar"><div class="brand"><span class="brand-mark">米</span><div><strong>米花大舞台</strong><small>有命你就來 · REBUILD / 0.3</small></div></div><div class="top-world"><span class="overline">目前的世界</span><strong>${esc(ui.world.name)}</strong></div><div class="clock"><span>世界時間</span><strong>${esc(clock.label)}</strong></div><div class="top-actions"><button data-action="toggle" class="primary">${ui.world.paused?'▶ 開始運行':'❚❚ 暫停'}</button><button data-action="save" title="立即儲存">儲存</button><button data-action="worlds" title="世界列表">世界列表</button></div></header>`;
}
function leftNav(){const views=[['map','地圖','▦'],['people','人物','♙'],['journal','事件簿','▤'],['settings','世界設定','⚙']];return `<aside class="nav"><span class="nav-caption">觀察模式</span>${views.map(([id,name,icon])=>`<button class="nav-button ${ui.view===id?'active':''}" data-view="${id}"><span>${icon}</span>${name}</button>`).join('')}<div class="nav-grow"></div><div class="side-legend"><span class="status-orbit"></span>這是一個新建的獨立模擬器，不會更動原正式站。<p>${esc(ui.saveStatus||'每次操作自動存檔')}</p></div></aside>`;}
function map(){
 const place=PLACE_BY_ID[ui.chosenPlace]||PLACES[0];const area=ui.world.area;
 const observer=PLACE_BY_ID[ui.world.observer.placeId];
 const selectedRoute=findRoute(observer.id,place.id);
 const highlighted=new Set(selectedRoute.legs.map(l=>[l.from,l.to].sort().join('|')));
 const visible=PLACES.filter(p=>p.area===area);
 const roads=ROAD_EDGES.filter(([a,b])=>PLACE_BY_ID[a].area===area&&PLACE_BY_ID[b].area===area).map(([a,b])=>{const start=PLACE_BY_ID[a],end=PLACE_BY_ID[b],highlight=highlighted.has([a,b].sort().join('|'));return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" class="${highlight?'route-highlight':'route-segment'}"/>`;}).join('');
 const locations=visible.map(p=>{
  const active=p.id===ui.chosenPlace;const occupants=actorHere(p.id);
  return `<button data-place="${esc(p.id)}" class="map-building ${active?'selected':''}" style="left:${p.x}%;top:${p.y}%;--place:${p.color}" title="${esc(p.name)}"><span class="building-glyph">${p.kind==='公園'?'♧':p.kind==='車站'?'≡':p.kind==='學校'?'▤':'▣'}</span><span class="building-name">${esc(p.name)}</span>${occupants.length?`<span class="occupants">${occupants.length}</span>`:''}</button>`;
 }).join('');
 const people=ui.world.people.filter(p=>PLACE_BY_ID[p.placeId]?.area===area).map((p,i)=>{
  const site=PLACE_BY_ID[p.placeId];if(!site)return '';const index=ui.world.people.filter(a=>a.placeId===p.placeId).findIndex(a=>a.id===p.id);
  return `<button data-char="${esc(p.id)}" class="map-person" style="left:calc(${site.x}% + ${14+(index%3)*23}px);top:calc(${site.y}% + ${21+Math.floor(index/3)*25}px);--avatar:${esc(p.color)}" title="${esc(p.name)}">${esc(p.name[0])}</button>`;
 }).join('');
 const interiors=place.inside.map((room,i)=>`<button data-room="${esc(room)}" class="room room-${i} ${ui.world.observer.roomId===room?'active-room':''}"><span>${esc(room)}</span><small>點擊觀察（＋5 分鐘）</small></button>`).join('');
 const canvas=ui.inside?`<div class="floor-plan">${interiors}<div class="room-people">${actorHere(place.id).map(p=>`<button data-char="${esc(p.id)}" class="room-person">${avatar(p)}<span>${esc(p.name)}</span></button>`).join('')||'<span class="empty-room">房內暫時沒有已知人物</span>'}</div></div>`:`<div class="map-canvas" style="--district:${esc(AREA_COLORS[area]||'#1f3546')}"><div class="map-road vertical v1"></div><div class="map-road vertical v2"></div><div class="map-road horizontal h1"></div><div class="map-road horizontal h2"></div><div class="road-dash d1"></div><svg class="route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${roads}</svg>${locations}${people}${observer.area===area?`<span class="map-observer" style="left:${observer.x}%;top:${observer.y}%" title="觀察者目前在${esc(observer.name)}">◎</span>`:''}<div class="map-compass">N ↑</div></div>`;
 return `<div class="stage-layout"><section class="stage-main"><div class="stage-heading"><div><span class="eyebrow">LIVE WORLD · 自主生活 / 路網探索</span><h1>${ui.inside?esc(place.name):'街區地圖'}</h1></div><div class="speed-controls"><span>時間倍率</span>${[1,4,12].map(s=>`<button data-speed="${s}" class="${ui.world.speed===s?'current':''}">${s}×</button>`).join('')}<button data-action="step">＋1 小時</button></div></div><div class="area-nav">${AREA_ORDER.map(a=>`<button data-area="${esc(a)}" class="${area===a?'on':''}">${esc(a)}</button>`).join('')}</div>${canvas}<div class="stage-foot"><span class="dot"></span>觀察者在${esc(observer.name)}。${place.id===observer.id?'目前已在現場':`前往${esc(place.name)}約需 ${selectedRoute.minutes} 分鐘`}。NPC 自主安排生活，觀察者不能直接操縱。<span class="stage-foot-right">${esc(ui.world.people.length)} 位人物 · ${esc(ui.world.completedBeatIds.length)}/${CANON_BEATS.length} 段事件</span></div></section><section class="inspector">${personOrPlace(place)}</section></div>`;
}
function personOrPlace(place){
 const actor=ui.chosenActor?ui.world.people.find(p=>p.id===ui.chosenActor):null;
 if(actor){
  const home=PLACE_BY_ID[actor.home],here=PLACE_BY_ID[actor.placeId];
  const rel=Object.entries(actor.relationships||{}).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const intention=actor.intent?.reason||'暫時沒有明確的下一步';
  const destination=actor.targetId?PLACE_BY_ID[actor.targetId]?.name:null;
  const known=(actor.facts||[]).filter(x=>x.startsWith('lead:')).length;
  const checked=(actor.facts||[]).filter(x=>x.startsWith('checked:')).length;
  return `<div class="inspector-head"><span class="eyebrow">角色觀察記錄</span><button data-action="close-actor" aria-label="關閉人物詳細資訊">×</button></div>
  <div class="profile">${avatar(actor,'large')}<h2>${esc(actor.name)}</h2><p>${esc(actor.role)}</p></div>
  <div class="facts"><div><span>所在地</span><button class="inline-link" data-place="${esc(actor.placeId)}">${esc(here?.name||'未知')}</button></div>
  <div><span>目前行動</span><strong>${esc(actor.activity)}</strong></div>
  <div><span>下一步原因</span><strong>${esc(intention)}</strong></div>
  ${destination?`<div><span>目的地</span><strong>${esc(destination)}</strong></div>`:''}
  <div><span>居住地</span><strong>${esc(home?.name||'未知')}</strong></div></div>
  <h3>狀態</h3><div class="meter-row">體力 <b>${actor.energy}</b><div class="meter"><i style="width:${actor.energy}%"></i></div></div>
  <div class="meter-row">社交需求 <b>${actor.social}</b><div class="meter warm"><i style="width:${actor.social}%"></i></div></div>
  <h3>已掌握的資訊</h3><p class="small-line">待查證線索：${known} · 已核對：${checked}</p>
  <p class="muted">人物只會透過現場觀察與同地點交流取得事件線索。</p>
  <h3>關係變化</h3>${rel.length?rel.map(([id,v])=>`<p class="small-line">${esc(ui.world.people.find(p=>p.id===id)?.name||id)}：${v>0?'+':''}${v}</p>`).join(''):'<p class="muted">尚未觀察到明確的互動變化。</p>'}`;
 }
 const observer=ui.world.observer,here=observer.placeId===place.id;
 const route=findRoute(observer.placeId,place.id);
 const latest=observer.notes.filter(n=>n.placeId===place.id).at(-1);
 return `<div class="inspector-head"><span class="eyebrow">地點探索</span><span class="place-kind">${esc(place.kind)}</span></div><h2>${esc(place.name)}</h2><p class="muted">${esc(place.description)}</p>
 <div class="location-stats"><span>所在區域</span><strong>${esc(place.area)}</strong></div>
 <div class="observer-location"><strong>觀察者目前在 ${esc(PLACE_BY_ID[observer.placeId].name)}</strong><p>${here?'已抵達現場，可以進入並查看房間。':`道路路線：${esc(route.nodes.map(id=>PLACE_BY_ID[id].name).join(' → '))}（${route.minutes} 分鐘）`}</p></div>
 ${here?`<button data-action="enter" class="primary wide">${ui.inside?'返回街區':'進入場景'}</button>`:`<button data-action="travel" class="primary wide">走訪此處（＋${route.minutes} 分鐘）</button>`}
 ${here&&latest?`<div class="observation-note"><h3>最近現場觀察</h3><p>${esc(latest.room)} · ${esc(worldClock(latest.minute).label)}</p><p>在此場景活動的人物：${esc(latest.people.join('、')||'未觀察到')}；事件跡象：${esc(latest.signals.join('、')||'未觀察到')}</p></div>`:''}
 <h3>此處人物 <span class="count">${actorHere(place.id).length}</span></h3><div class="actors-here">${actorHere(place.id).map(a=>`<button data-char="${esc(a.id)}" class="person-row">${avatar(a)}<span><strong>${esc(a.name)}</strong><small>${esc(a.activity)}</small></span><span>›</span></button>`).join('')||'<p class="muted">目前沒有角色留在此處。</p>'}</div>
 <h3>最近發生的事</h3><div class="mini-log">${ui.world.logs.filter(l=>l.placeId===place.id).slice(-3).reverse().map(l=>`<p>${esc(l.text)}</p>`).join('')||'<p class="muted">暫無事件紀錄。</p>'}</div>`;
}

function peoplePage(){return `<section class="content-page"><div class="page-title"><div><span class="eyebrow">SIMULATED LIVES</span><h1>人物觀察</h1></div><p>所有人物共用世界時間，不會因切換視角而停下。</p></div><div class="people-grid">${ui.world.people.map(p=>`<button class="people-card" data-char="${esc(p.id)}">${avatar(p,'large')}<div><h3>${esc(p.name)}</h3><small>${esc(p.role)} · ${esc(PLACE_BY_ID[p.placeId]?.name||'未知地點')}</small><p>${esc(p.activity)}</p></div><span>›</span></button>`).join('')}</div></section>`;}
function journalPage(){const logs=[...ui.world.logs].reverse();return `<section class="content-page"><div class="page-title"><div><span class="eyebrow">WORLD CHRONICLE</span><h1>事件簿</h1></div><p>時間線、現場觀察、人物決策與查證後果都保留發生時間及地點。</p></div><div class="journal-columns"><div class="journal-stream"><h2>世界紀錄</h2>${logs.map(formatLog).join('')}</div><aside class="canon-panel"><h2>原作事件排程</h2><p class="muted">第 883～900 話的 11 組摘要，以重新製作的地圖位置顯示。不是原站的正式事件資料。</p>${CANON_ARCS.map(a=>`<div class="arc-row"><span class="arc-index">${String(a.index+1).padStart(2,'0')}</span><span><strong>${esc(a.title)}</strong><small>${a.stages.filter(x=>ui.world.completedBeatIds.includes(x.id)).length}/3 已發生</small></span></div>`).join('')}</aside></div></section>`;}
function settingsPage(){const ready=ui.brainStatus.connected&&ui.brainStatus.decision_provider;return `<section class="content-page settings"><div class="page-title"><div><span class="eyebrow">WORLD CONTROL</span><h1>世界設定</h1></div></div><div class="settings-grid"><section class="settings-card"><h2>存檔與遷移</h2><p>每次變化都寫入 IndexedDB；無法使用時會嘗試 localStorage。匯出 JSON 可自行備份。</p><div class="actions-line"><button data-action="save" class="primary">立即儲存</button><button data-action="export">匯出存檔 JSON</button><button data-action="import">匯入 JSON</button></div><small>${esc(ui.saveStatus)}</small></section><section class="settings-card"><h2>世界模擬</h2><p>切換暫停及速度；離線重開會補算經過的世界時間，單次最多七天。</p><label class="check"><input type="checkbox" id="canon-enabled" ${ui.world.canonEnabled?'checked':''}/>啟用原作事件時間線（新重作版）</label><p class="muted">一個事件階段最多執行一次，事件本身不強迫自訂人物前往現場。</p></section><section class="settings-card"><h2>GitHub 角色腦接線</h2><p>上游：day2561124-art/wRITE。感知、認知、候選行動使用固定版本的上游 Node.js 模組，角色選擇需額外設定決策提供者。</p><p>目前狀態：${ready?(ui.brainStatus.mode==='native_turn'?'wRITE Native 回合已就緒（候選行動交給米花執行）':'上游能力與決策提供者已就緒'):ui.brainStatus.connected?'上游已連線，但尚無決策提供者':'後端未連線，沿用本地規則模擬'}</p><label class="check"><input type="checkbox" id="brain-enabled" ${ui.world.brainEnabled?'checked':''} ${ready?'':'disabled'}/>啟用角色腦決策（實驗性，單次處理一名 NPC）</label><p class="muted">只送出當前角色可感知的資訊；World 負責核對行動並執行。停用或失敗時保留離線規則。無法在純靜態 GitHub Pages 直接運作。</p></section><section class="settings-card"><h2>獨立重製的限制</h2><p>目前已實作世界建立與持久化、路網走訪、室內觀察、人物自主日常、線索傳播與查證、事件時間線及存檔遷移。</p><p>仍未取得 Sites 第 35 版完整程式，因此原作全資料庫、雲端多裝置同步、原版美術與全部遊戲機制尚未還原。</p></section><section class="settings-card danger"><h2>移除世界</h2><p>刪除後，這部裝置中的該世界將不能復原。建議先匯出備份。</p><button data-action="delete">刪除此世界</button></section></div></section>`;}
function startPage(){return `<div class="start"><header class="start-top"><div class="brand"><span class="brand-mark">米</span><div><strong>米花大舞台</strong><small>有命你就來</small></div></div><span class="pill">獨立重作 · 本地存檔版</span></header><section class="start-hero"><span class="eyebrow">AN IDLE WORLD OF STORIES</span><h1>街道照常運轉。<br /><em>故事不一定等你。</em></h1><p>建立自己的米花世界，觀察人物在地圖上生活、相遇、調查與經歷事件。每個世界獨立保存，離開頁面也不會丟掉進度。</p></section><div class="start-columns"><section class="new-world"><h2>創建新世界</h2><form id="create-world"><label for="world-name">世界名稱</label><input id="world-name" name="worldName" placeholder="例如：米花的週末" maxlength="60" required /><label class="check"><input name="custom" type="checkbox"/>加入可觀察的自訂居民</label><button type="submit" class="primary wide">創建並保存世界 →</button></form></section><section class="saved-worlds"><div class="section-head"><h2>我的世界</h2><span>${ui.worlds.length} 個存檔</span></div>${ui.worlds.length?ui.worlds.map(w=>`<button class="save-card" data-open="${esc(w.id)}"><span class="save-icon">▦</span><span><strong>${esc(w.name)}</strong><small>${esc(worldClock(w.minutes).label)} · 最近儲存 ${esc(when(w.savedAt))}</small></span><span>繼續 →</span></button>`).join(''):'<div class="empty-state"><span>◌</span><p>尚無存檔。建立世界後，此裝置會保存世界入口，建議定期匯出備份。</p></div>'}<div class="import-line"><button data-action="import">匯入既有重作版存檔 JSON</button></div></section></div><footer class="start-footer">新 GitHub 重作專案。原 Sites 正式站完全獨立，未經修改。</footer></div>`;}
function render(){
 if(!ui.world){root.innerHTML=startPage()+(ui.notice?`<div class="toast">${esc(ui.notice)}<button data-action="dismiss">×</button></div>`:'');return;}
 root.innerHTML=`<div class="app-shell">${heading()}<div class="app-layout">${leftNav()}<main class="main">${ui.view==='map'?map():ui.view==='people'?peoplePage():ui.view==='journal'?journalPage():settingsPage()}</main></div>${ui.notice?`<div class="toast">${esc(ui.notice)}<button data-action="dismiss">×</button></div>`:''}${ui.error?`<div class="toast error">${esc(ui.error)}<button data-action="clear-error">×</button></div>`:''}</div>`;
}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function importFile(){const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';picker.onchange=async()=>{if(!picker.files?.[0])return;try{const file=picker.files[0];if(file.size>5_000_000)throw new Error('存檔超過 5 MB。');const imported=fromImport(await file.text());await storage.put(imported);await refreshWorlds();await openWorld(imported.id);flash('已匯入世界並重新建立獨立存檔。');}catch(err){flash(`匯入失敗：${err.message}`);}};picker.click();}
async function action(name){switch(name){
 case 'toggle':ui.lastTick=Date.now();commit({...ui.world,paused:!ui.world.paused});break;
 case 'step':ui.lastTick=Date.now();commit(advanceWorld(ui.world,60));break;
 case 'travel':{const route=findRoute(ui.world.observer.placeId,ui.chosenPlace);if(!route.minutes){flash('已經在這個地點。');return;}ui.lastTick=Date.now();ui.inside=false;commit(visitPlace(ui.world,ui.chosenPlace));break;}
 case 'save':await saveWorld();flash(ui.error||'已儲存目前世界。');break;
 case 'worlds':await saveWorld();ui.world=null;ui.chosenActor=null;await refreshWorlds();render();break;
 case 'enter':if(ui.chosenPlace!==ui.world.observer.placeId){flash('請先走訪現場。');break;}ui.inside=!ui.inside;render();break;
 case 'close-actor':ui.chosenActor=null;render();break;
 case 'dismiss':ui.notice='';render();break;
 case 'clear-error':ui.error='';render();break;
 case 'export':if(ui.world)download(`beika-${ui.world.id}.json`,toExport(ui.world),'application/json');break;
 case 'import':await importFile();break;
 case 'delete':if(ui.world&&confirm(`確定刪除「${ui.world.name}」？此操作無法復原。`)){await storage.remove(ui.world.id);ui.world=null;await refreshWorlds();render();}break;
 }}
document.addEventListener('submit',async event=>{if(event.target.id!=='create-world')return;event.preventDefault();const form=new FormData(event.target);const name=String(form.get('worldName')||'').trim();if(!name)return;const world=makeWorld(name,form.get('custom')!==null);try{await storage.put(world);await refreshWorlds();await openWorld(world.id);}catch(err){flash(`創建失敗：${err.message}`);}});
document.addEventListener('click',async event=>{const target=event.target.closest('button');if(!target)return;const data=target.dataset;
 if(data.action){await action(data.action);return;}
 if(data.open){await openWorld(data.open);return;}
 if(!ui.world)return;
 if(data.view){ui.view=data.view;ui.chosenActor=null;render();return;}
 if(data.speed){ui.lastTick=Date.now();commit({...ui.world,speed:Number(data.speed)});return;}
 if(data.room){try{ui.lastTick=Date.now();commit(inspectRoom(ui.world,data.room));}catch(err){flash(err.message);}return;}
 if(data.area){ui.world={...ui.world,area:data.area};ui.inside=false;ui.chosenActor=null;ui.chosenPlace=PLACES.find(p=>p.area===data.area)?.id||'agency';commit(ui.world);return;}
 if(data.place){const selected=PLACE_BY_ID[data.place];if(!selected)return;ui.world={...ui.world,area:selected.area};ui.chosenPlace=selected.id;ui.inside=false;ui.chosenActor=null;ui.view='map';render();return;}
 if(data.char){const p=ui.world.people.find(p=>p.id===data.char);if(!p)return;ui.chosenActor=p.id;ui.chosenPlace=p.placeId;ui.world={...ui.world,area:PLACE_BY_ID[p.placeId]?.area||'米花町'};ui.view='map';ui.inside=false;render();return;}
});
document.addEventListener('change',event=>{if(event.target.id==='canon-enabled'&&ui.world)commit({...ui.world,canonEnabled:event.target.checked});if(event.target.id==='brain-enabled'&&ui.world)commit({...ui.world,brainEnabled:event.target.checked});});
setInterval(()=>{if(document.hidden||!ui.world)return;if(ui.brainBusy){ui.lastTick=Date.now();return;}if(ui.world.paused){ui.lastTick=Date.now();return;}const now=Date.now();const seconds=Math.min(30,Math.floor((now-ui.lastTick)/1000));if(seconds<5)return;ui.lastTick=now;commit(advanceWorld(ui.world,seconds*ui.world.speed));},5000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(ui.world)saveWorld();return;}const now=Date.now();ui.lastTick=now;if(ui.world){if(!ui.world.paused)commit(catchUpWorld(ui.world,now));else saveWorld();}});
async function refreshBrainStatus(){
 try{const res=await fetch('/api/brain/status',{cache:'no-store'});if(!res.ok)throw new Error('backend unavailable');const state=await res.json();ui.brainStatus={connected:state.connected===true,decision_provider:state.decision_provider===true,mode:state.mode||null};}
 catch{ui.brainStatus={connected:false,decision_provider:false,mode:null};}render();
}
async function runOneBrainCycle(){
 if(!ui.world||ui.world.paused||!ui.world.brainEnabled||ui.brainBusy||!ui.brainStatus.connected||!ui.brainStatus.decision_provider)return;
 const eligible=ui.world.people.filter(p=>!p.targetId&&!p.travel);
 if(!eligible.length)return;
 const cycle=Math.floor(ui.world.minutes/30);if(ui.brainLastCycle===`${ui.world.id}:${cycle}`)return;
 ui.brainLastCycle=`${ui.world.id}:${cycle}`;
 const actor=eligible[cycle%eligible.length],request=makeBoundedBrainRequest(ui.world,actor.id);
 if(!request.actions.length)return;
 ui.brainBusy=true;
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  let answer;
  try{const res=await fetch('/api/brain/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});if(!res.ok)throw new Error(`角色腦服務回應 ${res.status}`);answer=await res.json();}finally{clearTimeout(timer);}
  if(answer.status!=='selected'||!answer.action_id||!ui.world||ui.world.id!==request.world_id||ui.world.minutes!==request.world_minute)return;
  if(!characterActionCatalog(ui.world,actor.id).some(a=>a.action_id===answer.action_id))return;
  commit(applyBrainDecision(ui.world,actor.id,answer.action_id));
 }catch(error){ui.error=`角色腦暫時無法使用：${error.message}`;render();}finally{ui.brainBusy=false;}
}
setInterval(()=>{runOneBrainCycle();},10000);
(async()=>{try{await refreshWorlds();refreshBrainStatus();render();}catch(err){root.innerHTML=`<p class="loading">無法啟動世界列表：${esc(err.message)}</p>`;}})();
