import {PLACE_BY_ID} from '../data/atlas.js';

// A deliberately small, explicit graph. These are simulation travel costs, not
// geographic claims or live navigation estimates. Adding a place requires
// linking it to the graph rather than silently allowing teleportation.
export const ROAD_EDGES=Object.freeze([
 ['agency','poiro',5],['agency','bank',15],['agency','sushi',15],
 ['poiro','park',15],['poiro','sushi',20],['bank','park',18],
 ['bank','station',15],['park','sushi',20],['park','school',15],
 ['park','apartment',20],['school','apartment',18],['school','station',20],
 ['apartment','station',18],['station','police',45],
 ['police','museum',20],['police','warehouse',23],
 ['museum','warehouse',20],['museum','hospital',27],
 ['warehouse','hospital',20],['station','yamaguchi',360]
]);
const adjacency=new Map(Object.keys(PLACE_BY_ID).map(id=>[id,[]]));
for(const [a,b,minutes] of ROAD_EDGES){
 if(!adjacency.has(a)||!adjacency.has(b)||!Number.isInteger(minutes)||minutes<=0)throw new Error(`無效的地圖路線：${a} / ${b}`);
 adjacency.get(a).push({id:b,minutes});adjacency.get(b).push({id:a,minutes});
}
export function findRoute(from,to){
 if(!adjacency.has(from)||!adjacency.has(to))throw new Error('找不到地圖上的出發地或目的地。');
 if(from===to)return {nodes:[from],legs:[],minutes:0};
 const costs=new Map([[from,0]]),previous=new Map(),queue=new Set(adjacency.keys());
 while(queue.size){
  let current=null,best=Infinity;
  for(const id of queue){const score=costs.get(id)??Infinity;if(score<best){best=score;current=id;}}
  if(current===null)break;
  if(current===to)break;
  queue.delete(current);
  for(const next of adjacency.get(current)){
   const total=best+next.minutes;
   if(queue.has(next.id)&&total<(costs.get(next.id)??Infinity)){
    costs.set(next.id,total);previous.set(next.id,{from:current,minutes:next.minutes});
   }
  }
 }
 if(!previous.has(to))throw new Error('此處目前沒有可通行的道路。');
 const legs=[];let at=to;
 while(at!==from){const step=previous.get(at);legs.unshift({from:step.from,to:at,minutes:step.minutes});at=step.from;}
 return {nodes:[from,...legs.map(x=>x.to)],legs,minutes:legs.reduce((n,x)=>n+x.minutes,0)};
}
export function adjacentPlaces(id){return [...(adjacency.get(id)||[])];}
