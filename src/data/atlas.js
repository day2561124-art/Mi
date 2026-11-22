// Rebuilt map IDs are new. They are not claimed to match the old Sites project IDs.
export const PLACES = Object.freeze([
  {id:'agency',name:'毛利偵探事務所',area:'米花町',kind:'偵探事務所',x:26,y:24,color:'#df9871',inside:['事務桌','會客區','樓梯口'],description:'事務所的招牌掛在二樓。樓下咖啡廳飄來新煮好的香氣。'},
  {id:'poiro',name:'白羅咖啡廳',area:'米花町',kind:'咖啡廳',x:29,y:39,color:'#e3ba6a',inside:['吧檯','窗邊座位','後廚'],description:'窗邊有幾張小桌，吧檯後能看到咖啡機和烤箱。'},
  {id:'station',name:'米花車站',area:'米花町',kind:'車站',x:76,y:18,color:'#8fbad8',inside:['售票區','月台','出口'],description:'列車準點進站，通勤的人群在出入口交會。'},
  {id:'school',name:'帝丹小學',area:'米花町',kind:'學校',x:70,y:68,color:'#a5cfab',inside:['校門','走廊','教室'],description:'操場上傳來孩子們的笑聲。'},
  {id:'park',name:'米花公園',area:'米花町',kind:'公園',x:49,y:59,color:'#8fc6a7',inside:['長椅','步道','噴水池'],description:'住宅區旁的綠地，黃昏時經常有人經過。'},
  {id:'bank',name:'米花銀行',area:'米花町',kind:'銀行',x:52,y:17,color:'#b9bdd5',inside:['營業廳','櫃檯','大門'],description:'提款機與營業櫃檯相鄰，門口保全正在巡視。'},
  {id:'sushi',name:'米花壽司店',area:'米花町',kind:'餐廳',x:15,y:68,color:'#e4ad93',inside:['板前座席','內場','門口'],description:'吧檯上整齊地擺著餐具。'},
  {id:'apartment',name:'住宅街',area:'米花町',kind:'住宅',x:89,y:45,color:'#bdafd8',inside:['玄關','客廳','樓梯'],description:'安靜的住宅區，巷子裡停著幾輛腳踏車。'},
  {id:'police',name:'警視廳',area:'東京',kind:'警察機關',x:18,y:30,color:'#839ec4',inside:['大廳','辦公室','會議室'],description:'調查員不斷出入的辦公空間。'},
  {id:'museum',name:'鈴木博物館',area:'東京',kind:'博物館',x:48,y:23,color:'#c2afe3',inside:['展廳','保全走廊','入口'],description:'展品照明明亮，保全設施隨展覽變動。'},
  {id:'hospital',name:'綜合醫院',area:'東京',kind:'醫院',x:80,y:73,color:'#99cfc9',inside:['掛號大廳','診間走廊','急診入口'],description:'大廳裡有廣播提醒候診者注意叫號。'},
  {id:'warehouse',name:'舊倉庫',area:'東京',kind:'倉庫',x:65,y:45,color:'#b7a58b',inside:['出入口','存放區','地下通道'],description:'久未使用的建築物，部分窗戶蒙上灰塵。'},
  {id:'yamaguchi',name:'日本山口縣',area:'日本山口縣',kind:'旅遊區',x:44,y:54,color:'#8cbdad',inside:['車站前','街道','旅館大廳'],description:'距離米花町很遠的旅行地點。'}
]);
export const AREA_ORDER=['米花町','東京','日本山口縣'];
export const AREA_COLORS={米花町:'#1f3546',東京:'#2c3047','日本山口縣':'#2d3d40'};
export const PLACE_BY_ID=Object.fromEntries(PLACES.map(place=>[place.id,place]));
export const CAST=Object.freeze([
 {id:'conan',name:'江戶川柯南',role:'小學生',home:'apartment',work:'school',favorite:'agency',color:'#80c1da',curiosity:90,energy:80},
 {id:'ran',name:'毛利蘭',role:'高中生',home:'agency',work:'agency',favorite:'poiro',color:'#e9a0ac',curiosity:55,energy:76},
 {id:'kogoro',name:'毛利小五郎',role:'偵探',home:'agency',work:'agency',favorite:'sushi',color:'#b8a6da',curiosity:65,energy:70},
 {id:'ai',name:'灰原哀',role:'小學生',home:'apartment',work:'school',favorite:'park',color:'#cfb1b5',curiosity:85,energy:72},
 {id:'azusa',name:'榎本梓',role:'咖啡廳店員',home:'apartment',work:'poiro',favorite:'poiro',color:'#e5c390',curiosity:55,energy:83},
 {id:'amuro',name:'安室透',role:'咖啡廳店員',home:'apartment',work:'poiro',favorite:'station',color:'#d5b38e',curiosity:91,energy:90},
 {id:'heiji',name:'服部平次',role:'高中生',home:'apartment',work:'station',favorite:'agency',color:'#91b7d1',curiosity:86,energy:78},
 {id:'kaito',name:'怪盜基德',role:'神秘人物',home:'apartment',work:'museum',favorite:'museum',color:'#c8d4e7',curiosity:88,energy:82},
 {id:'megure',name:'目暮十三',role:'警部',home:'apartment',work:'police',favorite:'police',color:'#aebfcf',curiosity:75,energy:75},
 {id:'takagi',name:'高木涉',role:'刑警',home:'apartment',work:'police',favorite:'bank',color:'#91b8a4',curiosity:79,energy:79},
 {id:'rume',name:'若狹留美',role:'教師',home:'apartment',work:'school',favorite:'school',color:'#b7a5ca',curiosity:80,energy:77},
 {id:'wakita',name:'脇田兼則',role:'壽司店員',home:'apartment',work:'sushi',favorite:'sushi',color:'#d5ac9c',curiosity:86,energy:81},
 {id:'ayumi',name:'吉田步美',role:'小學生',home:'apartment',work:'school',favorite:'park',color:'#edb5b5',curiosity:65,energy:85},
 {id:'jirokichi',name:'鈴木次郎吉',role:'收藏家',home:'apartment',work:'museum',favorite:'museum',color:'#d5bb8c',curiosity:74,energy:75}
]);