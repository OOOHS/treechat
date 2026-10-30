'use strict';
function layoutTree(graph,owner) {
  const groups=new Map();
  for(const b of Object.values(graph.branches))if(!b.promoted){if(!groups.has(b.parentId))groups.set(b.parentId,[]);groups.get(b.parentId).push(b);}
  for(const list of groups.values())list.sort((a,b)=>a.anchor.atSeq-b.anchor.atSeq||a.createdAt-b.createdAt||a.sessionId.localeCompare(b.sessionId));
  const nodes=[],edges=[],seen=new Set([owner]);
  const visit=(id,depth,parent)=>{
    for(const b of groups.get(id)||[]){
      if(seen.has(b.sessionId))continue;seen.add(b.sessionId);
      const n={id:b.sessionId,title:b.title,depth,x:100+(depth-1)*232,y:132+nodes.length*94,width:188,height:58};
      nodes.push(n);
      edges.push({id:n.id,source:parent?.id||owner,target:n.id,x1:parent?parent.x+188:46,y1:parent?parent.y+29:n.y+29,x2:n.x,y2:n.y+29});
      visit(n.id,depth+1,n);
    }
  };
  visit(owner,1,null);
  return {nodes,edges,width:Math.max(350,...nodes.map(n=>n.x+220)),height:Math.max(260,132+nodes.length*94),axisX:46};
}
module.exports={layoutTree};
function zoomCamera(camera,value,x,y){
 const zoom=Math.max(.35,Math.min(2,value));
 return {zoom,pan:{x:x-(x-camera.pan.x)*zoom/camera.zoom,y:y-(y-camera.pan.y)*zoom/camera.zoom}};
}
function bindMapWheel(element,read,apply){
 const wheel=e=>{if(!e.ctrlKey)return;e.preventDefault();const r=element.getBoundingClientRect(),c=read();apply(zoomCamera(c,c.zoom*Math.exp(-e.deltaY*(e.deltaMode===1?.04:.002)),e.clientX-r.left,e.clientY-r.top));};
 element.addEventListener('wheel',wheel,{passive:false});
 return()=>element.removeEventListener('wheel',wheel);
}
module.exports.zoomCamera=zoomCamera;
module.exports.bindMapWheel=bindMapWheel;
